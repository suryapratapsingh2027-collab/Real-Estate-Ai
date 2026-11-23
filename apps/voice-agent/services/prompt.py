"""Instructions for the voice assistant, built from backend call context."""

from __future__ import annotations

from typing import Any


def _fmt_lead(lead: dict[str, Any] | None) -> str:
    if not lead:
        return "No requirement captured yet."
    parts = [
        f"type: {lead.get('propertyType')}" if lead.get("propertyType") else None,
        f"bedrooms: {lead.get('bedrooms')}" if lead.get("bedrooms") is not None else None,
        f"location: {lead.get('preferredLocation')}" if lead.get("preferredLocation") else None,
        f"budget: {lead.get('budgetRange')}" if lead.get("budgetRange") else None,
        f"urgency: {lead.get('urgency')}" if lead.get("urgency") and lead.get("urgency") != "UNKNOWN" else None,
    ]
    known = ", ".join(p for p in parts if p)
    ref = lead.get("leadNumber", "")
    return f"Lead {ref}: {known or 'details not yet known'}."


def build_instructions(ctx: dict[str, Any]) -> str:
    business = ctx.get("businessName") or "our real estate company"
    customer = (ctx.get("customer") or {}).get("firstName")
    lang = (ctx.get("customer") or {}).get("preferredLanguage") or "en"
    addendum = (ctx.get("systemPromptAddendum") or "").strip()
    return f"""You are a friendly voice property assistant for {business}, speaking with {customer or 'a customer'} on a live call.

VOICE STYLE
- Speak naturally in short sentences (1–3 per turn). No lists, markdown, emojis or URLs.
- Reply in the language the customer speaks: English, Hindi, or Hinglish. The customer's previous language preference: {'Hindi/Hinglish' if lang == 'hi' else 'English'}.
- Say prices the Indian way, e.g. "sixty-two lakh rupees" or "1.2 crore".
- If you did not catch something, ask the customer to repeat. If interrupted, stop and listen.

FACTS — STRICT
- Only describe properties returned by the search_properties tool during this call. Never invent listings, prices, locations or availability.
- If nothing matches, say so honestly and say a consultant will follow up.
- Do not promise discounts, loans, legal outcomes or specific visit times.

GOAL
- Confirm or collect: buy or rent, location, budget, property type, bedrooms, and timeline. Don't re-ask what is already known.
- Suggest up to three matching properties from the tool, then offer a consultant follow-up.
- When the customer is done or says goodbye, thank them and call end_call.

KNOWN CONTEXT
- {_fmt_lead(ctx.get('lead'))}
- Business hours: {ctx.get('workingHours') or 'not specified'}.
{('ADDITIONAL INSTRUCTIONS' + chr(10) + addendum) if addendum else ''}""".strip()


def greeting(ctx: dict[str, Any]) -> str:
    voice = ctx.get("voice") or {}
    base = (voice.get("greeting") or "Hello! I am your property assistant. How can I help you today?").strip()
    name = (ctx.get("customer") or {}).get("firstName")
    return f"Greet the customer{(' by name, ' + name) if name else ''} and say: {base}"
