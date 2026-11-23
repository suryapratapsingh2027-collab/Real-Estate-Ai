"""Authenticated client for the platform API (read-only lookups + signed summary webhook)."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import time
from typing import Any

import httpx

log = logging.getLogger("voice-agent.backend")


def sign_body(secret: str, body: bytes, timestamp: int | None = None) -> tuple[str, str]:
    """HMAC-SHA256 over f"{ts}.{body}" — must match the API's /api/webhooks/voice-summary check."""
    ts = str(int(time.time()) if timestamp is None else timestamp)
    sig = hmac.new(secret.encode(), ts.encode() + b"." + body, hashlib.sha256).hexdigest()
    return ts, sig


class BackendClient:
    def __init__(self, base_url: str, agent_key: str, client: httpx.AsyncClient | None = None):
        self._base = base_url.rstrip("/")
        self._key = agent_key
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(10.0))

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _request(self, method: str, path: str, *, json_body: Any = None, retries: int = 2) -> Any:
        last: Exception | None = None
        for attempt in range(retries + 1):
            try:
                r = await self._client.request(method, f"{self._base}{path}", json=json_body, headers={"x-agent-key": self._key})
                if r.status_code >= 500 or r.status_code == 429:
                    raise httpx.HTTPStatusError(f"server error {r.status_code}", request=r.request, response=r)
                r.raise_for_status()
                return r.json()
            except (httpx.TransportError, httpx.HTTPStatusError) as e:
                last = e
                retryable = isinstance(e, httpx.TransportError) or (e.response is not None and (e.response.status_code >= 500 or e.response.status_code == 429))
                if not retryable or attempt == retries:
                    break
                await asyncio.sleep(0.5 * 2**attempt)
        assert last is not None
        raise last

    async def get_context(self, room_name: str) -> dict[str, Any]:
        return await self._request("GET", f"/api/agent/calls/{room_name}/context")

    async def mark_started(self, room_name: str) -> None:
        try:
            await self._request("POST", f"/api/agent/calls/{room_name}/started", json_body={})
        except Exception:  # non-critical; LiveKit webhook also records start
            log.warning("mark_started failed", exc_info=True)

    async def search_properties(self, args: dict[str, Any]) -> list[dict[str, Any]]:
        data = await self._request("POST", "/api/agent/properties/search", json_body=args)
        return list(data.get("properties", []))

    async def post_summary(self, payload: dict[str, Any], retries: int = 3) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode()
        for attempt in range(retries + 1):
            ts, sig = sign_body(self._key, body)
            try:
                r = await self._client.post(
                    f"{self._base}/api/webhooks/voice-summary",
                    content=body,
                    headers={"content-type": "application/json", "x-agent-timestamp": ts, "x-agent-signature": sig},
                )
                if r.status_code < 500:
                    r.raise_for_status()
                    return
            except httpx.TransportError:
                pass
            if attempt < retries:
                await asyncio.sleep(1.0 * 2**attempt)
        log.error("failed to deliver call summary for room %s", payload.get("roomName"))
