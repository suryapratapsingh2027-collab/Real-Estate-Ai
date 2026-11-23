"""Transcript collection and post-call summary extraction."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx

log = logging.getLogger("voice-agent.transcript")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class TranscriptCollector:
    segments: list[dict[str, str]] = field(default_factory=list)
    started_at: str | None = None

    def add(self, role: str, text: str | None) -> None:
        if role not in ("user", "assistant"):
            return
        t = (text or "").strip()
        if not t:
            return
        if self.started_at is None:
            self.started_at = _now()
        self.segments.append({"role": role, "text": t[:5000], "at": _now()})

    def as_text(self) -> str:
        return "\n".join(f"{'Customer' if s['role'] == 'user' else 'Assistant'}: {s['text']}" for s in self.segments)

    @property
    def has_customer_speech(self) -> bool:
        return any(s["role"] == "user" for s in self.segments)


SUMMARY_SYSTEM = (
    "You summarise real-estate sales calls for a broker. Respond with ONLY a JSON object: "
    '{"summary": string (2-3 English sentences), "propertyType": string|null, "budget": string|null, '
    '"preferredLocation": string|null, "urgency": string|null}. Use only facts stated by the customer; use null when unknown.'
)


def parse_summary(content: str | None) -> dict[str, Any] | None:
    if not content:
        return None
    m = re.search(r"\{.*\}", content, re.S)
    if not m:
        return None
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict) or not isinstance(data.get("summary"), str):
        return None
    out: dict[str, Any] = {"summary": data["summary"][:2000]}
    for k in ("propertyType", "budget", "preferredLocation", "urgency"):
        v = data.get(k)
        out[k] = str(v)[:120] if isinstance(v, (str, int, float)) and str(v).strip() else None
    return out


def fallback_summary(collector: TranscriptCollector) -> dict[str, Any]:
    customer = [s["text"] for s in collector.segments if s["role"] == "user"]
    if not customer:
        return {"summary": "Customer joined but did not speak.", "propertyType": None, "budget": None, "preferredLocation": None, "urgency": None}
    gist = " ".join(customer)[:400]
    return {"summary": f"Automatic summary unavailable. Customer said: {gist}", "propertyType": None, "budget": None, "preferredLocation": None, "urgency": None}


async def summarise(collector: TranscriptCollector, *, api_key: str, model: str, base_url: str = "https://api.groq.com/openai/v1") -> dict[str, Any]:
    if not collector.has_customer_speech:
        return fallback_summary(collector)
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": model,
                    "temperature": 0.1,
                    "response_format": {"type": "json_object"},
                    "messages": [
                        {"role": "system", "content": SUMMARY_SYSTEM},
                        {"role": "user", "content": collector.as_text()[-15000:]},
                    ],
                },
            )
            r.raise_for_status()
            parsed = parse_summary(r.json()["choices"][0]["message"]["content"])
            if parsed:
                return parsed
    except Exception:
        log.warning("summary generation failed", exc_info=True)
    return fallback_summary(collector)
