"""/api/accounts/sync-cookies：浏览器扩展推送的 Cookie 必须就地覆盖同会话账号并解除登录态隔离。"""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import httpx
import pytest

from aistudio_api.api.app import app
from aistudio_api.api.state import runtime_state
from aistudio_api.application.account_rotator import AccountRotator
from aistudio_api.application.account_service import AccountService
from aistudio_api.infrastructure.account.account_store import AccountStore
from aistudio_api.infrastructure.account.cookie_parser import (
    load_cookies_from_auth_file,
)
from aistudio_api.infrastructure.gateway.session import GatewaySession


def _browser_export(psidts: str) -> str:
    return json.dumps(
        [
            {"name": "SAPISID", "value": "anchor-1", "domain": ".google.com"},
            {"name": "SID", "value": "sid-1", "domain": ".google.com"},
            {"name": "__Secure-1PSIDTS", "value": psidts, "domain": ".google.com"},
            {"name": "NID", "value": "junk", "domain": ".google.com"},
        ]
    )


@pytest.mark.asyncio
async def test_sync_cookies_updates_siblings_and_restores_session(
    tmp_path, monkeypatch
):
    store = AccountStore(accounts_dir=tmp_path / "accounts")
    service = AccountService(store)
    seed = {
        "cookies": [
            {"name": "SAPISID", "value": "anchor-1"},
            {"name": "SID", "value": "sid-1"},
            {"name": "__Secure-1PSIDTS", "value": "old"},
        ]
    }
    u0 = service.save_account_from_cookies(
        name="u0", email="a@x", storage_state=seed, auth_user="0", cookie_id="gen1"
    )
    u1 = service.save_account_from_cookies(
        name="u1", email="b@x", storage_state=seed, auth_user="1", cookie_id="gen1"
    )
    session = GatewaySession()
    await service.activate_account(u1.id, session)
    rotator = AccountRotator(store)
    rotator.record_session_expired(u0.id)
    client = MagicMock()
    client.session = session
    monkeypatch.setattr(runtime_state, "account_service", service)
    monkeypatch.setattr(runtime_state, "rotator", rotator)
    monkeypatch.setattr(runtime_state, "client", client)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as http:
        resp = await http.post(
            "/api/accounts/sync-cookies", json={"cookies": _browser_export("new")}
        )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["mode"] == "updated"
    assert set(body["account_ids"]) == {u0.id, u1.id}
    for acc in (u0, u1):
        on_disk = load_cookies_from_auth_file(service.get_account_auth_path(acc.id))
        assert on_disk["__Secure-1PSIDTS"] == "new"
        assert "NID" not in on_disk  # 非白名单 Cookie 不落盘
        assert (service.get_account(acc.id).last_rotated_at or 0) > 0
    assert rotator.get_account_stats(u0.id).session_expired is False
    assert session.active_context.cookies["__Secure-1PSIDTS"] == "new"
