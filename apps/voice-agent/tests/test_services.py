import hashlib
import hmac
import json

import httpx
import pytest

from services.backend import BackendClient, sign_body
from services.config import ConfigError, Settings
from services.prompt import build_instructions, greeting
from services.transcript import TranscriptCollector, fallback_summary, parse_summary

BASE_ENV = {
    "BACKEND_URL": "http://api:4000/",
    "AGENT_API_KEY": "k" * 30,
    "GROQ_API_KEY": "gsk",
    "LIVEKIT_URL": "wss://x",
    "LIVEKIT_API_KEY": "a",
    "LIVEKIT_API_SECRET": "b",
    "CARTESIA_API_KEY": "c",
}


def test_settings_validation():
    s = Settings.from_env(BASE_ENV)
    assert s.backend_url == "http://api:4000"
    assert s.tts_provider == "cartesia"
    with pytest.raises(ConfigError):
        Settings.from_env({**BASE_ENV, "GROQ_API_KEY": ""})
    with pytest.raises(ConfigError):
        Settings.from_env({**BASE_ENV, "TTS_PROVIDER": "elevenlabs"})


def test_signature_matches_api_scheme():
    body = b'{"roomName":"r"}'
    ts, sig = sign_body("secret", body, timestamp=1700000000)
    expected = hmac.new(b"secret", b"1700000000." + body, hashlib.sha256).hexdigest()
    assert ts == "1700000000" and sig == expected


def test_instructions_include_context_and_rules():
    text = build_instructions(
        {
            "businessName": "Acme Homes",
            "customer": {"firstName": "Meera", "preferredLanguage": "hi"},
            "lead": {"leadNumber": "LD-000007", "preferredLocation": "Bhopal", "budgetRange": "50 lakh", "urgency": "UNKNOWN"},
        }
    )
    assert "Acme Homes" in text and "Meera" in text and "LD-000007" in text
    assert "Never invent" in text
    assert "urgency" not in text.split("KNOWN CONTEXT")[1]  # UNKNOWN urgency omitted
    assert "Meera" in greeting({"customer": {"firstName": "Meera"}})


def test_transcript_collector_filters_and_formats():
    c = TranscriptCollector()
    c.add("system", "ignored")
    c.add("user", "  ")
    c.add("assistant", "Hello")
    c.add("user", "Need a flat")
    assert len(c.segments) == 2
    assert c.has_customer_speech
    assert c.as_text() == "Assistant: Hello\nCustomer: Need a flat"


def test_parse_summary_validates_shape():
    ok = parse_summary('```json\n{"summary":"Wants villa","budget":"2 Cr","preferredLocation":null}\n```')
    assert ok == {"summary": "Wants villa", "propertyType": None, "budget": "2 Cr", "preferredLocation": None, "urgency": None}
    assert parse_summary("nope") is None
    assert parse_summary('{"summary": 5}') is None
    assert "did not speak" in fallback_summary(TranscriptCollector())["summary"]


@pytest.mark.asyncio
async def test_backend_client_auth_retry_and_signed_summary():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.url.path == "/api/agent/properties/search":
            if len([c for c in calls if c.url.path == request.url.path]) == 1:
                return httpx.Response(503)
            return httpx.Response(200, json={"properties": [{"code": "P-0001"}]})
        if request.url.path == "/api/webhooks/voice-summary":
            ts = request.headers["x-agent-timestamp"]
            expected = hmac.new(b"key", ts.encode() + b"." + request.content, hashlib.sha256).hexdigest()
            assert request.headers["x-agent-signature"] == expected
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(404)

    client = BackendClient("http://api", "key", httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    props = await client.search_properties({"location": "Bhopal"})
    assert props == [{"code": "P-0001"}]
    assert all(c.headers.get("x-agent-key") == "key" for c in calls)
    await client.post_summary({"roomName": "r", "transcript": [], "summary": "s"})
    assert json.loads(calls[-1].content)["roomName"] == "r"
    await client.aclose()
