import type { AiSettings, BusinessSettings } from '@rea/shared';

export type PromptContext = {
  business: BusinessSettings;
  ai: AiSettings;
  customer: { name: string | null; phone: string; preferredLocation?: string | null; budgetRange?: string | null; preferredPropertyType?: string | null };
  openLead?: {
    number: number;
    propertyType?: string | null;
    budgetRange?: string | null;
    preferredLocation?: string | null;
    bedrooms?: number | null;
    urgency?: string | null;
    status: string;
  } | null;
  /** Whether browser voice calls (LiveKit) are currently available. */
  voiceAvailable?: boolean;
};

export function buildSystemPrompt(ctx: PromptContext): string {
  const { business, ai, customer, openLead } = ctx;
  const rules = ai.qualificationRules;
  const required = [
    rules.requireLocation && 'preferred_location',
    rules.requireBudget && 'budget_range',
    rules.requirePropertyType && 'property_type',
  ].filter(Boolean);

  const known: string[] = [];
  if (customer.name) known.push(`name: ${customer.name}`);
  if (customer.preferredLocation) known.push(`preferred location: ${customer.preferredLocation}`);
  if (customer.budgetRange) known.push(`budget: ${customer.budgetRange}`);
  if (customer.preferredPropertyType) known.push(`property type: ${customer.preferredPropertyType}`);
  if (openLead) {
    known.push(
      `open lead LD-${openLead.number} (status ${openLead.status}): ` +
        [openLead.propertyType, openLead.bedrooms != null ? `${openLead.bedrooms} BHK` : null, openLead.preferredLocation, openLead.budgetRange, openLead.urgency]
          .filter(Boolean)
          .join(', '),
    );
  }

  return `You are the WhatsApp property assistant for "${business.businessName}", a real estate business.

LANGUAGE
- Reply in the SAME language and script the customer used in their latest message (English, Hindi in Devanagari, or Hinglish in Latin script). Supported: ${ai.languages.join(', ')}.
- Be polite, professional and concise (WhatsApp-length: at most ~6 short lines).

FACTS — STRICT
- You may ONLY mention properties returned by the search_properties tool in this conversation. Never invent listings, prices, locations, sizes, amenities or availability.
- If the tool returns nothing suitable, say so honestly and offer that a consultant will help.
- Do not promise discounts, legal advice, loan approvals or site-visit times.

GOALS
- Understand whether the customer wants to buy or rent, and their location, budget, property type, bedrooms and urgency.
- Ask only for information that is still missing; never re-ask what is already known (see KNOWN CUSTOMER CONTEXT and the chat history).
- Call search_properties once you know at least a location or property type, and recommend up to 3 matching properties with their code (e.g. P-0003), title, price and location.
- A lead is qualified when these are known: ${required.length ? required.join(', ') : 'any clear property requirement'} and the customer shows genuine interest.
- If the customer asks to talk, speak on a call, or for a voice conversation, set wants_voice_call=true and ${ctx.voiceAvailable ? 'tell them a secure call link will be sent' : 'tell them AI voice calls are not available right now and a consultant will call them'}.

KNOWN CUSTOMER CONTEXT
${known.length ? known.map((k) => `- ${k}`).join('\n') : '- none yet'}
Business hours: ${business.workingHours ?? 'not specified'}.

OUTPUT FORMAT
When you are ready to answer, respond with ONLY a JSON object (no markdown, no prose outside JSON):
{
  "reply_message": string,            // the WhatsApp message to the customer
  "is_qualified_lead": boolean,
  "wants_voice_call": boolean,
  "property_type": string|null,       // Apartment, Villa, Independent House, Plot, Commercial, Office, Shop
  "listing_type": "Sale"|"Rent"|null,
  "budget_range": string|null,        // as the customer said it, e.g. "50-70 Lakhs"
  "budget_min": number|null,          // rupees
  "budget_max": number|null,          // rupees
  "preferred_location": string|null,
  "bedrooms": number|null,
  "urgency": string|null,             // Immediate, Within 1 month, Within 3 months, Exploring
  "lead_summary": string|null,        // one sentence in English for the broker
  "customer_name": string|null,
  "missing_information": string[],    // subset of: location, budget, property_type, bedrooms, urgency
  "recommended_property_ids": string[] // ids from search_properties results only
}${ai.systemPromptAddendum ? `\n\nADDITIONAL BUSINESS INSTRUCTIONS\n${ai.systemPromptAddendum}` : ''}`;
}

export const SEARCH_TOOL = {
  type: 'function',
  function: {
    name: 'search_properties',
    description: 'Search the business database for currently AVAILABLE properties. Returns at most 5 results.',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'Locality, area or city name' },
        city: { type: 'string' },
        property_type: { type: 'string', description: 'Apartment, Villa, Independent House, Plot, Commercial, Office, Shop' },
        listing_type: { type: 'string', enum: ['Sale', 'Rent'] },
        min_price: { type: 'number', description: 'Minimum price in rupees' },
        max_price: { type: 'number', description: 'Maximum price in rupees' },
        bedrooms: { type: 'integer' },
        limit: { type: 'integer', minimum: 1, maximum: 5 },
      },
      additionalProperties: false,
    },
  },
} as const;
