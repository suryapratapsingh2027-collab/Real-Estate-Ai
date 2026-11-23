"""Environment configuration for the voice agent (validated at startup)."""

from __future__ import annotations

import os
from dataclasses import dataclass


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    backend_url: str
    agent_api_key: str
    agent_name: str
    groq_api_key: str
    llm_model: str
    stt_model: str
    tts_provider: str
    cartesia_api_key: str | None
    elevenlabs_api_key: str | None
    livekit_url: str
    livekit_api_key: str
    livekit_api_secret: str

    @staticmethod
    def from_env(env: dict[str, str] | None = None) -> "Settings":
        e = dict(os.environ if env is None else env)

        def req(key: str) -> str:
            v = (e.get(key) or "").strip()
            if not v:
                raise ConfigError(f"Missing required environment variable: {key}")
            return v

        tts = (e.get("TTS_PROVIDER") or "cartesia").strip().lower()
        if tts not in ("cartesia", "elevenlabs"):
            raise ConfigError("TTS_PROVIDER must be 'cartesia' or 'elevenlabs'")
        s = Settings(
            backend_url=req("BACKEND_URL").rstrip("/"),
            agent_api_key=req("AGENT_API_KEY"),
            agent_name=(e.get("LIVEKIT_AGENT_NAME") or "realestate-agent").strip(),
            groq_api_key=req("GROQ_API_KEY"),
            llm_model=(e.get("AI_MODEL") or "llama-3.3-70b-versatile").strip(),
            stt_model=(e.get("STT_MODEL") or "whisper-large-v3-turbo").strip(),
            tts_provider=tts,
            cartesia_api_key=(e.get("CARTESIA_API_KEY") or "").strip() or None,
            elevenlabs_api_key=(e.get("ELEVENLABS_API_KEY") or "").strip() or None,
            livekit_url=req("LIVEKIT_URL"),
            livekit_api_key=req("LIVEKIT_API_KEY"),
            livekit_api_secret=req("LIVEKIT_API_SECRET"),
        )
        if s.tts_provider == "cartesia" and not s.cartesia_api_key:
            raise ConfigError("CARTESIA_API_KEY is required when TTS_PROVIDER=cartesia")
        if s.tts_provider == "elevenlabs" and not s.elevenlabs_api_key:
            raise ConfigError("ELEVENLABS_API_KEY is required when TTS_PROVIDER=elevenlabs")
        return s
