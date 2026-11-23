# LiveKit voice calling setup

The platform provides **browser-based** AI voice conversations. The customer opens a secure link from WhatsApp and talks to the AI through their browser microphone. It does not place phone-network (PSTN) calls; telephony via LiveKit SIP is a future extension.

## 1. LiveKit server
Use [LiveKit Cloud](https://cloud.livekit.io) or self-host. You need the **URL** (`wss://…`), **API key** and **API secret**.

```
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
LIVEKIT_AGENT_NAME=realestate-agent
```

In the LiveKit project settings add a **webhook** to `https://<your-domain>/api/webhooks/livekit`. The API verifies the signed `Authorization` header with your API key/secret and uses events to record call start/end and recording completion.

## 2. Voice agent (apps/voice-agent)
```bash
cd apps/voice-agent
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
python -m agent.main download-files      # Silero VAD model
python -m agent.main dev                 # local development
# production: python -m agent.main start   (or the Docker image / compose profile "voice")
```
Environment (shared `.env` works): `BACKEND_URL`, `AGENT_API_KEY`, `GROQ_API_KEY`, `AI_MODEL`, `STT_MODEL`, `TTS_PROVIDER` (`cartesia` | `elevenlabs`), `CARTESIA_API_KEY` or `ELEVENLABS_API_KEY`, and the LiveKit variables. The agent validates its configuration at start-up and refuses to run with missing keys.

The agent registers with an `agent_name`, so it only joins rooms it is **explicitly dispatched** to by the API.

## 3. Call flow
1. Customer asks to talk on WhatsApp → the lead is qualified/assigned first (independently) → the API creates a `VoiceCall` with a random 32-byte join code (only its SHA-256 hash is stored, link valid `CALL_LINK_TTL_MINUTES`, default 30) and sends `https://<app>/call/<code>`.
2. The call page explains microphone use, optionally asks for recording consent, and requests mic permission.
3. `POST /api/voice/token` validates the code, creates the room if needed (`emptyTimeout` 120 s, max 3 participants), dispatches the agent once, and returns a token valid for `CALL_TOKEN_TTL_SECONDS` (default 600) with only `roomJoin`, `canPublish`, `canSubscribe` for that single room. The LiveKit secret never leaves the server.
4. The agent loads call context from `GET /api/agent/calls/:room/context` (agent key), greets the customer, searches properties through `POST /api/agent/properties/search` (available listings only), handles silence (prompts, then ends after repeated silence) and enforces `maxCallMinutes`.
5. On shutdown it posts the transcript + summary to `POST /api/webhooks/voice-summary`, signed with `HMAC-SHA256(AGENT_API_KEY, "<timestamp>.<body>")`; requests older than 5 minutes are rejected. The summary is stored against the call's **lead id**, fills gaps in the lead (never overwrites), and appears in the dashboard.

## 4. Recording (optional)
Enable in **Business settings → Call recording**. Requires:
- S3-compatible storage configured (**Integrations → Storage**, driver `s3`),
- LiveKit Egress available on your LiveKit deployment,
- customer consent on the call page (unchecked by default).

The API starts an audio-only room-composite egress to `recordings/<room>.ogg`. Playback uses a 5-minute pre-signed URL and is audit-logged. Recordings are deleted after the configured retention period by a daily job. Without storage or consent, the call proceeds and the recording status says why it is unavailable.
