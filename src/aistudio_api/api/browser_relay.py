"""Gemini text requests executed in one explicitly paired Playground tab."""

from __future__ import annotations

import asyncio
import json
import os
import secrets
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
from uuid import UUID

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.types import Receive, Scope, Send

PORT = 8090
LEASE = 90
SCRIPT = Path(__file__).resolve().parents[3] / "userscripts/aistudio-browser.user.js"


class Pulse(BaseModel):
    tab: UUID
    page: UUID
    state: Literal["ready", "loading", "recover", "occupied", "login", "working"]
    model: str = Field(max_length=128, pattern=r"^[A-Za-z0-9._-]*$")
    job: str = Field(default="", max_length=64)
    event: Literal["", "delta", "done", "error"] = ""
    text: str = Field(default="", max_length=262144)


@dataclass
class Job:
    model: str
    prompt: str
    id: str = field(default_factory=lambda: secrets.token_hex(16))
    page: UUID | None = None
    refreshed: bool = False
    terminal: bool = False
    size: int = 0
    events: asyncio.Queue[tuple[str, str]] = field(default_factory=asyncio.Queue)

    def publish(self, kind: str, value: str = "") -> None:
        if self.terminal:
            return
        self.size += len(value)
        if self.size > 2_000_000 or self.events.qsize() >= 2048:
            kind, value = "error", "浏览器回复超过本机缓冲上限"
        self.terminal = kind in {"done", "error"}
        self.events.put_nowait((kind, value))


def text_prompt(body: dict[str, object]) -> str:
    if body.get("tools") or body.get("toolConfig") or body.get("cachedContent"):
        raise HTTPException(400, "浏览器模式仅支持文本对话")
    config = body.get("generationConfig") or {}
    if not isinstance(config, dict) or (
        config.get("candidateCount", 1) != 1
        or config.get("responseMimeType", "text/plain") != "text/plain"
        or config.get("responseModalities", ["TEXT"]) != ["TEXT"]
        or config.get("responseSchema")
        or config.get("responseJsonSchema")
    ):
        raise HTTPException(400, "浏览器模式仅支持一个纯文本回答")

    def extract(content: object) -> str:
        parts = content.get("parts") if isinstance(content, dict) else None
        if (
            not isinstance(parts, list)
            or not parts
            or not all(
                isinstance(p, dict)
                and set(p) == {"text"}
                and isinstance(p["text"], str)
                for p in parts
            )
        ):
            raise HTTPException(400, "消息必须包含纯文本 parts")
        return "".join(p["text"] for p in parts)

    turns = body.get("contents")
    if not isinstance(turns, list) or not turns:
        raise HTTPException(400, "contents 不能为空")
    lines: list[tuple[str, str]] = []
    system = body.get("systemInstruction", body.get("system_instruction"))
    if system:
        lines.append(("System", extract(system)))
    for t in turns:
        if not isinstance(t, dict) or t.get("role", "user") not in ("user", "model"):
            raise HTTPException(400, "消息角色必须为 user 或 model")
        lines.append(("Assistant" if t.get("role") == "model" else "User", extract(t)))
    prompt = (
        lines[0][1]
        if len(lines) == 1 and lines[0][0] == "User"
        else "\n\n".join(f"{role}:\n{value}" for role, value in lines)
    )
    if not prompt.strip() or len(prompt) > 262144:
        raise HTTPException(400, "提示词为空或超过 262144 个字符")
    return prompt


def candidate(value: str, *, final: bool = False) -> dict[str, object]:
    result: dict[str, object] = {
        "index": 0,
        "content": {"role": "model", "parts": [{"text": value}]},
    }
    if final:
        result["finishReason"] = "STOP"
    return {"candidates": [result]}


def create_browser_app(api_key: str, pair_key: str) -> FastAPI:
    if not api_key or not pair_key or api_key == pair_key:
        raise ValueError("请使用两个不同的非空密钥")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost"])
    tab: UUID | None = None
    seen = 0.0
    model = ""
    state = "offline"
    current: Job | None = None

    def authorize(request: Request, key: str) -> None:
        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        if key == api_key:
            token = (
                token
                or request.headers.get("x-goog-api-key")
                or request.headers.get("x-api-key")
                or request.query_params.get("key", "")
            )
        if not secrets.compare_digest(key.encode(), token.encode()):
            raise HTTPException(401, "本机密钥无效")

    @app.exception_handler(HTTPException)
    async def error(_request: Request, exc: HTTPException):
        return JSONResponse(
            {"error": {"code": exc.status_code, "message": exc.detail}},
            status_code=exc.status_code,
        )

    @app.get("/aistudio-browser.user.js")
    def script():
        if not SCRIPT.is_file():
            raise HTTPException(404, "请从项目 userscripts 目录安装脚本")
        return FileResponse(SCRIPT, media_type="application/javascript")

    @app.post("/browser/pulse")
    async def pulse(p: Pulse, request: Request):
        nonlocal tab, seen, model, state
        authorize(request, pair_key)
        now = time.monotonic()
        if tab != p.tab and now - seen < LEASE and tab is not None:
            raise HTTPException(409, "已有标签页接单")
        j = current
        if p.job and (
            not j or j.terminal or p.job != j.id or p.page != j.page or p.tab != tab
        ):
            return {"action": "cancel"}
        if j and j.page and (tab != p.tab or j.page != p.page or now - seen >= LEASE):
            j.publish("error", "执行页已断开，本次请求已中断")
        if tab != p.tab:
            model = ""
        seen, tab, state = now, p.tab, p.state
        if p.model:
            model = p.model
        if p.job:
            if not j or j.terminal or j.id != p.job or j.page != p.page:
                return {"action": "cancel"}
            if p.event:
                j.publish(p.event, p.text)
                if j.terminal:
                    state = "recover"
            return {"action": "wait"}
        if not j or j.terminal:
            return {"action": "wait"}
        if j.page:
            j.publish("error", "执行页已失去任务状态")
        elif state == "recover" and not j.refreshed:
            j.refreshed = True
            return {"action": "refresh"}
        elif state == "ready" and p.model == j.model:
            j.page = p.page
            return {"action": "run", "job": j.id, "prompt": j.prompt, "model": j.model}
        elif state != "loading":
            j.publish("error", "请检查专用临时页的登录状态、草稿和所选模型")
        return {"action": "wait"}

    @app.get("/v1beta/models")
    @app.get("/v1beta/models/{name}")
    async def models(request: Request, name: str | None = None):
        authorize(request, api_key)
        online = bool(tab and time.monotonic() - seen < LEASE and model)
        descriptor = {
            "name": f"models/{model}",
            "displayName": model,
            "supportedGenerationMethods": ["generateContent", "streamGenerateContent"],
        }
        if name is None:
            return {"models": [descriptor] if online else []}
        if not online or name != model:
            raise HTTPException(404, "请检查专用标签页当前选择的模型")
        return descriptor

    @app.post("/v1beta/models/{name}:{method}")
    async def generate(
        name: str, method: str, body: dict[str, object], request: Request
    ):
        nonlocal current
        authorize(request, api_key)
        if method not in ("generateContent", "streamGenerateContent"):
            raise HTTPException(501, "本模式仅支持文本生成")
        if tab is None or time.monotonic() - seen >= LEASE:
            raise HTTPException(503, "请打开并配对 AI Studio 临时聊天页")
        if name != model:
            raise HTTPException(404, "请求模型与页面选择不一致")
        if current is not None or state == "working":
            raise HTTPException(409, "浏览器已有任务")
        if state in ("login", "occupied"):
            raise HTTPException(503, "请先检查专用页的登录状态或草稿")
        j = Job(name, text_prompt(body))
        current = j
        started = time.monotonic()

        def release() -> None:
            nonlocal current
            if current is j:
                current = None

        async def next_event() -> tuple[str, str]:
            while True:
                try:
                    return await asyncio.wait_for(j.events.get(), timeout=1)
                except TimeoutError:
                    if await request.is_disconnected():
                        raise HTTPException(499, "酒馆已断开") from None
                    now = time.monotonic()
                    if now - seen >= LEASE or now - started > (900 if j.page else 75):
                        raise HTTPException(
                            504, "等待浏览器超时，本次请求已中断"
                        ) from None

        async def stream(first: tuple[str, str]):
            try:
                kind, value = first
                while True:
                    if kind == "error":
                        payload = {"error": {"code": 502, "message": value}}
                    else:
                        payload = candidate(value, final=kind == "done")
                    yield "data: " + json.dumps(payload, ensure_ascii=False) + "\n\n"
                    if kind in ("done", "error"):
                        break
                    kind, value = await next_event()
            except HTTPException as exc:
                yield (
                    "data: "
                    + json.dumps(
                        {"error": {"code": exc.status_code, "message": exc.detail}}
                    )
                    + "\n\n"
                )
            finally:
                release()

        class JobStream(StreamingResponse):
            async def __call__(
                self, scope: Scope, receive: Receive, send: Send
            ) -> None:
                try:
                    await super().__call__(scope, receive, send)
                finally:
                    release()

        handing_off = False
        try:
            event = await next_event()
            if event[0] == "error":
                raise HTTPException(502, event[1])
            if method == "streamGenerateContent":
                response = JobStream(
                    stream(event),
                    media_type="text/event-stream",
                    headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
                )
                handing_off = True
                return response
            parts = []
            while event[0] == "delta":
                parts.append(event[1])
                event = await next_event()
            if event[0] != "done":
                raise HTTPException(502, event[1])
            return candidate("".join(parts) + event[1], final=True)
        finally:
            if not handing_off:
                release()

    return app


def _startup_key(name: str) -> str:
    if value := os.getenv(name):
        return value
    # Already-open Windows terminals may predate the user's persistent settings.
    if os.name == "nt":
        import winreg

        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
                value, kind = winreg.QueryValueEx(key, name)
                if kind == winreg.REG_SZ and isinstance(value, str) and value:
                    return value
        except FileNotFoundError:
            pass
    return secrets.token_urlsafe(32)


def serve() -> None:
    import uvicorn

    api_key = _startup_key("AISTUDIO_BROWSER_API_KEY")
    pair_key = _startup_key("AISTUDIO_BROWSER_PAIR_KEY")
    app = create_browser_app(api_key, pair_key)
    print(f"脚本安装地址 http://127.0.0.1:{PORT}/aistudio-browser.user.js", flush=True)
    print(f"酒馆代理密码 {api_key}\n标签页配对码 {pair_key}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=PORT, access_log=False, proxy_headers=False)
