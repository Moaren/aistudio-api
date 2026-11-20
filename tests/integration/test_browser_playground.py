"""Exercise the shipped userscript and relay together in a disposable local Chrome."""

import os
import secrets
import socket
import subprocess
import time
from threading import Thread

import httpx
import pytest
import uvicorn
from fastapi.responses import HTMLResponse

from aistudio_api.api.browser_relay import create_browser_app

FIXTURE = """
<ms-model-selector><button class="model-selector-card"><span class="subtitle">test-model</span></button></ms-model-selector>
<textarea aria-label="Enter a prompt"></textarea>
<ms-run-button><button disabled>Run Ctrl</button></ms-run-button>
<script>
const path = location.pathname;
const saved = JSON.parse(sessionStorage.paired || 'null') ||
    {localPlaygroundRelay: {path, secret:'PAIR_KEY', tab:crypto.randomUUID()}};
sessionStorage.paired = JSON.stringify(saved);
const navigation = Number(sessionStorage.navigation || 0) + 1;
sessionStorage.navigation = navigation;
function GM_getTab(fn) { fn(saved); }
function GM_registerMenuCommand() {}
function GM_xmlhttpRequest(options) {
    fetch('/browser/pulse', {method:'POST', headers:options.headers, body:options.data})
        .then(async res => options.onload({status:res.status, responseText:await res.text()}))
        .catch(options.onerror);
}
const field = document.querySelector('textarea');
const run = document.querySelector('ms-run-button button');
field.oninput = () => {run.disabled = !field.value;};
run.onclick = () => {
    const prompt = field.value;
    field.value = '';
    run.innerText = 'Stop';
    const turn = document.createElement('ms-chat-turn');
    turn.innerHTML = '<div class="chat-turn-container model"><div class="turn-content"><ms-prompt-chunk class="text-chunk"><ms-text-chunk></ms-text-chunk></ms-prompt-chunk></div></div>';
    document.body.append(turn);
    const answer = turn.querySelector('ms-text-chunk');
    answer.innerText = 'Local fixture response ';
    setTimeout(() => {
        answer.innerText = 'Local fixture response ' + prompt + ' on page ' + navigation;
        run.innerText = 'Run Ctrl'; run.disabled = true;
    }, 1000);
};
</script><script src="/aistudio-browser.user.js"></script>
"""


@pytest.mark.skipif(
    not os.environ.get("AISTUDIO_TEST_CHROME"),
    reason="requires a disposable Chrome process",
)
def test_userscript_uses_fresh_page_for_next_conversation(tmp_path):
    api, pairing = secrets.token_hex(24), secrets.token_hex(24)
    app = create_browser_app(api, pairing)

    @app.get("/u/1/prompts/new_chat")
    def fake_playground():
        return HTMLResponse(FIXTURE.replace("PAIR_KEY", pairing))

    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        server = uvicorn.Server(
            uvicorn.Config(app, log_level="error", ws="none", access_log=False)
        )
        thread = Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{sock.getsockname()[1]}"
        args = [
            os.environ["AISTUDIO_TEST_CHROME"],
            "--headless",
            "--disable-gpu",
            "--disable-background-networking",
            "--no-first-run",
            "--no-default-browser-check",
            f"--user-data-dir={tmp_path / 'profile'}",
            url + "/u/1/prompts/new_chat?temporary=true",
        ]
        try:
            with subprocess.Popen(
                args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            ) as chrome:
                try:
                    with httpx.Client(
                        base_url=url,
                        headers={"x-goog-api-key": api},
                        trust_env=False,
                        timeout=20,
                    ) as client:
                        deadline = time.monotonic() + 20
                        while time.monotonic() < deadline:
                            if client.get("/v1beta/models").json()["models"]:
                                break
                            time.sleep(0.15)
                        for i in (1, 2):
                            body = {"contents": [{"parts": [{"text": f"request-{i}"}]}]}
                            res = client.post(
                                "/v1beta/models/test-model:generateContent", json=body
                            )
                            res.raise_for_status()
                            text = res.json()["candidates"][0]["content"]["parts"][0][
                                "text"
                            ]
                            assert (
                                text
                                == f"Local fixture response request-{i} on page {i}"
                            )
                finally:
                    chrome.terminate()
        finally:
            server.should_exit = True
            thread.join(timeout=5)
