import asyncio
import json
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException

from aistudio_api.api.browser_relay import create_browser_app, text_prompt

MODEL = "gemini-test"
BASE = "/v1beta/models/" + MODEL
API = {"x-goog-api-key": "local-api"}
PAIR = {"Authorization": "Bearer local-tab"}
PROMPT = {"contents": [{"parts": [{"text": "hello"}]}]}


@pytest.fixture
async def relay():
    app = create_browser_app("local-api", "local-tab")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1:8090"
    ) as client:
        info = {
            "tab": str(uuid4()),
            "page": str(uuid4()),
            "state": "ready",
            "model": MODEL,
        }

        async def pulse(**changes):
            response = await client.post(
                "/browser/pulse", headers=PAIR, json=info | changes
            )
            response.raise_for_status()
            return response.json()

        yield client, info, pulse


async def pending(client, method="generateContent"):
    task = asyncio.create_task(
        client.post(BASE + ":" + method, headers=API, json=PROMPT)
    )
    await asyncio.sleep(0)
    return task


async def test_pair_and_api_keys_are_separate(relay):
    client, info, pulse = relay
    assert (await client.get("/v1beta/models", headers=PAIR)).status_code == 401
    assert (
        await client.post("/browser/pulse", headers=API, json=info)
    ).status_code == 401
    assert (await client.get("/v1beta/models", headers=API)).json() == {"models": []}
    assert (
        await client.post(BASE + ":generateContent", headers=API, json=PROMPT)
    ).status_code == 503
    await pulse()
    assert (await client.get("/v1beta/models", headers=API)).json()["models"][0][
        "name"
    ] == "models/" + MODEL
    assert (
        await client.get("/v1beta/models", headers=API | {"host": "example.invalid"})
    ).status_code == 400
    second = await client.post(
        "/browser/pulse", headers=PAIR, json=info | {"tab": str(uuid4())}
    )
    assert second.status_code == 409


@pytest.mark.parametrize("stream", [False, True])
async def test_recover_and_generate(relay, stream):
    client, info, pulse = relay
    await pulse()
    task = await pending(
        client, "streamGenerateContent" if stream else "generateContent"
    )
    assert (await pulse(state="recover"))["action"] == "refresh"
    info["page"] = str(uuid4())
    command = await pulse()
    assert command["action"] == "run" and command["prompt"] == "hello"
    job = command["job"]
    assert (
        await client.post(BASE + ":generateContent", headers=API, json=PROMPT)
    ).status_code == 409
    for part in ("he", "llo"):
        assert (await pulse(state="working", job=job, event="delta", text=part))[
            "action"
        ] == "wait"
    await pulse(state="working", job=job, event="done")
    response = await asyncio.wait_for(task, 2)
    assert response.status_code == 200
    if stream:
        frames = [
            json.loads(s.removeprefix("data: "))
            for s in response.text.strip().split("\n\n")
        ]
        assert [f["candidates"][0]["content"]["parts"][0]["text"] for f in frames] == [
            "he",
            "llo",
            "",
        ]
        assert frames[-1]["candidates"][0]["finishReason"] == "STOP"
    else:
        assert response.json()["candidates"][0]["content"]["parts"] == [
            {"text": "hello"}
        ]


async def test_reload_after_dispatch_never_replays(relay):
    client, info, pulse = relay
    await pulse()
    task = await pending(client)
    job = (await pulse())["job"]
    info["page"] = str(uuid4())
    assert (await pulse())["action"] == "wait"
    assert (await task).status_code == 502
    assert (await pulse(state="working", job=job))["action"] == "cancel"


async def test_failed_recovery_does_not_loop(relay):
    client, info, pulse = relay
    await pulse()
    task = await pending(client)
    assert (await pulse(state="recover"))["action"] == "refresh"
    info["page"] = str(uuid4())
    assert (await pulse(state="recover"))["action"] == "wait"
    assert (await task).status_code == 502


async def test_late_event_cannot_interrupt_next_job(relay):
    client, info, pulse = relay
    await pulse()
    old_task = await pending(client)
    old = await pulse()
    old_page = info["page"]
    info["page"] = str(uuid4())
    await pulse()
    assert (await old_task).status_code == 502
    fresh_task = await pending(client)
    fresh = await pulse()
    assert (await pulse(page=old_page, job=old["job"], event="error"))[
        "action"
    ] == "cancel"
    await pulse(job=fresh["job"], event="done", text="fresh")
    assert (await fresh_task).json()["candidates"][0]["content"]["parts"] == [
        {"text": "fresh"}
    ]


async def test_abandoned_request_releases_slot(relay):
    client, _, pulse = relay
    await pulse()
    task = await pending(client)
    command = await pulse()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert (await pulse(state="working", job=command["job"]))["action"] == "cancel"


def test_transcript_preserves_roles_and_refuses_multimodal():
    assert (
        text_prompt(
            {
                "contents": [
                    {"role": "model", "parts": [{"text": "earlier"}]},
                    *PROMPT["contents"],
                ],
                "systemInstruction": {"parts": [{"text": "brief"}]},
            }
        )
        == "System:\nbrief\n\nAssistant:\nearlier\n\nUser:\nhello"
    )
    with pytest.raises(HTTPException):
        text_prompt({"contents": [{"parts": [{"inlineData": {"data": "AA=="}}]}]})


@pytest.mark.parametrize("mode", ["AUTO", "NONE"])
def test_optional_sillytavern_functions_allow_text_reply(mode):
    body = {
        **PROMPT,
        "tools": [{"function_declarations": [{"name": "example"}]}],
        "toolConfig": {"functionCallingConfig": {"mode": mode}},
    }
    assert text_prompt(body) == "hello"
    body["toolConfig"]["functionCallingConfig"]["mode"] = "ANY"
    with pytest.raises(HTTPException, match="客户端函数调用"):
        text_prompt(body)
    with pytest.raises(HTTPException, match="工具"):
        text_prompt({**PROMPT, "tools": [{"google_search": {}}]})


async def test_model_catalogue_and_legacy_replacement(relay):
    client, _, pulse = relay
    await pulse(models=[MODEL, "gemini-alternate", MODEL])
    url = "/v1beta/models/gemini-alternate"
    assert len((await client.get("/v1beta/models", headers=API)).json()["models"]) == 2
    assert (await client.get(url, headers=API)).status_code == 200
    task = asyncio.create_task(
        client.post(url + ":generateContent", json=PROMPT, headers=API)
    )
    await asyncio.sleep(0)
    command = await pulse(models=[MODEL, "gemini-alternate"])
    assert command["model"] == "gemini-alternate"
    await pulse(job=command["job"], event="done", text="OK", model="gemini-alternate")
    assert (await task).status_code == 200
    await pulse()
    assert (await client.get(url, headers=API)).status_code == 404
