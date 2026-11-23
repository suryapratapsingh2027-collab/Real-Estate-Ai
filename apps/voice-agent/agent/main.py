"""
LiveKit voice agent for the Real Estate AI Platform.

Run locally:   python -m agent.main dev
Production:    python -m agent.main start

The API dispatches this agent (by LIVEKIT_AGENT_NAME) into a call room when the customer
opens their secure join link. The agent:
  - reads call context from the API (authenticated, read-only),
  - talks with Groq Whisper STT -> Groq Llama -> Cartesia/ElevenLabs TTS,
  - searches only real, available properties via the API,
  - posts a signed transcript + summary when the call ends.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any

from livekit import rtc
from livekit.agents import (
    Agent,
    AgentSession,
    ConversationItemAddedEvent,
    JobContext,
    RunContext,
    UserStateChangedEvent,
    WorkerOptions,
    cli,
    function_tool,
)
from livekit.plugins import cartesia, elevenlabs, groq, silero

from services.backend import BackendClient
from services.config import Settings
from services.prompt import build_instructions, greeting
from services.transcript import TranscriptCollector, summarise

log = logging.getLogger("voice-agent")
SETTINGS = Settings.from_env()


class PropertyAssistant(Agent):
    def __init__(self, ctx_data: dict[str, Any], backend: BackendClient, job: JobContext):
        super().__init__(instructions=build_instructions(ctx_data))
        self._backend = backend
        self._job = job

    @function_tool()
    async def search_properties(
        self,
        context: RunContext,
        location: str | None = None,
        property_type: str | None = None,
        listing_type: str | None = None,
        max_price: float | None = None,
        min_price: float | None = None,
        bedrooms: int | None = None,
    ) -> dict[str, Any]:
        """Search the company's database for currently available properties.

        Args:
            location: Locality, area or city the customer wants.
            property_type: Apartment, Villa, Independent House, Plot, Commercial, Office or Shop.
            listing_type: "Sale" or "Rent".
            max_price: Maximum price in rupees.
            min_price: Minimum price in rupees.
            bedrooms: Number of bedrooms (BHK).
        """
        args = {
            "location": location,
            "property_type": property_type,
            "listing_type": listing_type,
            "max_price": max_price,
            "min_price": min_price,
            "bedrooms": bedrooms,
            "limit": 3,
        }
        try:
            props = await self._backend.search_properties({k: v for k, v in args.items() if v is not None})
        except Exception:
            log.warning("property search failed", exc_info=True)
            return {"error": "Property search is temporarily unavailable. Tell the customer a consultant will follow up."}
        # Keep the payload small and speakable.
        return {
            "count": len(props),
            "properties": [
                {k: p.get(k) for k in ("code", "title", "location", "city", "bedrooms", "priceText", "listing", "furnishing")}
                for p in props
            ],
        }

    @function_tool()
    async def end_call(self, context: RunContext) -> None:
        """End the call after the customer says goodbye or has no more questions."""
        await context.wait_for_playout()
        self._job.shutdown(reason="agent ended call")


def _tts(voice_id: str | None):
    if SETTINGS.tts_provider == "elevenlabs":
        kwargs: dict[str, Any] = {"api_key": SETTINGS.elevenlabs_api_key, "model": "eleven_turbo_v2_5"}
        if voice_id:
            kwargs["voice_id"] = voice_id
        return elevenlabs.TTS(**kwargs)
    kwargs = {"api_key": SETTINGS.cartesia_api_key, "language": "en"}
    if voice_id:
        kwargs["voice"] = voice_id
    return cartesia.TTS(**kwargs)


async def entrypoint(ctx: JobContext) -> None:
    backend = BackendClient(SETTINGS.backend_url, SETTINGS.agent_api_key)
    collector = TranscriptCollector()
    room_name = ctx.room.name

    try:
        call_ctx = await backend.get_context(room_name)
    except Exception:
        log.exception("could not load call context for %s; refusing to join", room_name)
        await backend.aclose()
        return

    await ctx.connect()
    voice = call_ctx.get("voice") or {}
    max_minutes = int(voice.get("maxCallMinutes") or 15)

    session: AgentSession = AgentSession(
        vad=silero.VAD.load(),
        stt=groq.STT(model=SETTINGS.stt_model, api_key=SETTINGS.groq_api_key, detect_language=True),
        llm=groq.LLM(model=call_ctx.get("model") or SETTINGS.llm_model, api_key=SETTINGS.groq_api_key, temperature=float(call_ctx.get("temperature") or 0.4)),
        tts=_tts(voice.get("voiceId")),
        user_away_timeout=20.0,
    )

    @session.on("conversation_item_added")
    def _on_item(ev: ConversationItemAddedEvent) -> None:
        item = ev.item
        role = getattr(item, "role", None)
        text = getattr(item, "text_content", None)
        if role in ("user", "assistant"):
            collector.add(role, text)

    away_count = {"n": 0}

    @session.on("user_state_changed")
    def _on_user_state(ev: UserStateChangedEvent) -> None:
        if ev.new_state == "away":
            away_count["n"] += 1
            if away_count["n"] >= 2:
                asyncio.create_task(_goodbye("It seems we got disconnected. A consultant will follow up with you. Goodbye!"))
            else:
                session.generate_reply(instructions="The customer has been silent. Gently ask if they are still there.")
        elif ev.new_state in ("speaking", "listening"):
            away_count["n"] = 0

    async def _goodbye(message: str) -> None:
        try:
            handle = session.say(message, allow_interruptions=False)
            await handle
        finally:
            ctx.shutdown(reason="goodbye")

    @ctx.room.on("participant_disconnected")
    def _on_left(p: rtc.RemoteParticipant) -> None:
        if p.identity.startswith("customer-"):
            ctx.shutdown(reason="customer left")

    async def _on_shutdown() -> None:
        ended = datetime.now(timezone.utc).isoformat()
        try:
            summary = await summarise(collector, api_key=SETTINGS.groq_api_key, model=SETTINGS.llm_model)
            await backend.post_summary(
                {
                    "roomName": room_name,
                    "transcript": collector.segments,
                    "startedAt": collector.started_at,
                    "endedAt": ended,
                    **summary,
                }
            )
        finally:
            await backend.aclose()

    ctx.add_shutdown_callback(_on_shutdown)

    await session.start(agent=PropertyAssistant(call_ctx, backend, ctx), room=ctx.room)
    await backend.mark_started(room_name)
    session.generate_reply(instructions=greeting(call_ctx))

    async def _limit() -> None:
        await asyncio.sleep(max_minutes * 60)
        await _goodbye("We have reached the time limit for this call. Our consultant will follow up with you. Thank you!")

    asyncio.create_task(_limit())


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name=SETTINGS.agent_name,  # explicit dispatch only
            ws_url=SETTINGS.livekit_url,
            api_key=SETTINGS.livekit_api_key,
            api_secret=SETTINGS.livekit_api_secret,
        )
    )
