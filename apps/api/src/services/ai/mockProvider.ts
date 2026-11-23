import {
  detectLanguage,
  normalizeListingType,
  normalizePropertyType,
  normalizeUrgency,
  parseBudget,
  humanize,
  type AiReply,
  type AiSettings,
} from '@rea/shared';
import { knownLocations, searchAvailableProperties, type PropertyHit } from '../propertySearch';

/**
 * Deterministic, rule-based responder used when AI_PROVIDER=mock (demo mode and tests).
 * It uses the same read-only property search as the real model and never invents data.
 */
export async function mockReply(input: {
  customerTexts: string[];
  latest: string;
  known: { location?: string | null; budget?: string | null; type?: string | null; bedrooms?: number | null; name?: string | null };
  rules: AiSettings['qualificationRules'];
  voiceAvailable?: boolean;
}): Promise<{ reply: AiReply; hits: PropertyHit[] }> {
  const all = input.customerTexts.join(' \n ');
  const lang = detectLanguage(input.latest);

  const locations = await knownLocations();
  const loc =
    locations.find((l) => new RegExp(`\\b${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(all)) ?? input.known.location ?? null;

  const budgetMatch = all.match(/(?:(?:under|below|upto|up to|max|within)\s+)?(?:₹|rs\.?|inr)?\s*\d+(?:\.\d+)?\s*(?:-|to)?\s*(?:\d+(?:\.\d+)?)?\s*(?:lakhs?|lacs?|lac|l\b|crores?|cr\b|k\b)(?:\s+(?:tak|tk|max))?/i);
  const budget = budgetMatch?.[0]?.trim() ?? input.known.budget ?? null;
  const { min, max } = parseBudget(budget);

  const typeNorm = normalizePropertyType(all) ?? normalizePropertyType(input.known.type);
  const bhk = all.match(/(\d)\s*bhk/i);
  const bedrooms = bhk ? Number(bhk[1]) : (input.known.bedrooms ?? null);
  const listing = normalizeListingType(all);
  const urgency = normalizeUrgency(all);
  const wantsVoice = /\b(call|voice|baat|phone|talk|speak)\b/i.test(input.latest);

  const missing: string[] = [];
  if (input.rules.requireLocation && !loc) missing.push('location');
  if (input.rules.requireBudget && !budget) missing.push('budget');
  if (input.rules.requirePropertyType && !typeNorm) missing.push('property_type');

  let hits: PropertyHit[] = [];
  if (loc || typeNorm) {
    hits = await searchAvailableProperties({
      location: loc,
      property_type: typeNorm,
      listing_type: listing,
      max_price: max ? Math.round(max * 1.1) : null,
      bedrooms,
      limit: 3,
    });
  }

  const ask: Record<string, [string, string]> = {
    location: ['Which area or city are you looking in?', 'Aap kis area ya shehar mein property dekh rahe hain?'],
    budget: ['What is your budget range?', 'Aapka budget kitna hai?'],
    property_type: ['What type of property do you need (apartment, villa, plot…)?', 'Aapko kis type ki property chahiye (flat, villa, plot…)?'],
  };
  const i = lang === 'hi' ? 1 : 0;
  const lines: string[] = [];
  if (hits.length) {
    lines.push(lang === 'hi' ? 'Aapke liye ye available properties hain:' : 'Here are available properties that match:');
    for (const h of hits) lines.push(`• ${h.code}: ${h.title}, ${h.location} — ${h.priceText}`);
  } else if (loc || typeNorm) {
    lines.push(lang === 'hi' ? 'Abhi is requirement ke liye koi available property nahi mili.' : 'I could not find an available property matching this right now.');
  } else {
    lines.push(lang === 'hi' ? 'Namaste! Main aapki property search mein madad karunga.' : 'Hello! I can help you find a property.');
  }
  for (const m of missing.slice(0, 2)) lines.push(ask[m]![i]);
  if (!missing.length) lines.push(lang === 'hi' ? 'Hamare consultant aapse jaldi sampark karenge.' : 'Our consultant will get in touch with you shortly.');
  if (wantsVoice) {
    if (input.voiceAvailable) lines.push(lang === 'hi' ? 'Main aapko ek secure call link bhej raha hoon.' : 'I am sending you a secure link for a voice call.');
    else lines.push(lang === 'hi' ? 'Abhi AI voice call uplabdh nahi hai; hamare consultant aapko call karenge.' : 'AI voice calls are not available right now; our consultant will call you.');
  }

  const qualified = missing.length === 0;
  const reply: AiReply = {
    reply_message: lines.join('\n'),
    is_qualified_lead: qualified,
    wants_voice_call: wantsVoice,
    property_type: typeNorm ? humanize(typeNorm) : null,
    listing_type: listing === 'RENT' ? 'Rent' : listing === 'SALE' ? 'Sale' : null,
    budget_range: budget,
    budget_min: min,
    budget_max: max,
    preferred_location: loc,
    bedrooms,
    urgency: urgency === 'UNKNOWN' ? null : humanize(urgency),
    lead_summary: qualified
      ? `Customer wants ${bedrooms != null ? `a ${bedrooms} BHK ` : 'a '}${typeNorm ? humanize(typeNorm).toLowerCase() : 'property'}${listing === 'RENT' ? ' on rent' : ''} in ${loc} within ${budget}`
      : null,
    customer_name: input.known.name ?? null,
    missing_information: missing,
    recommended_property_ids: hits.map((h) => h.id),
  };
  return { reply, hits };
}
