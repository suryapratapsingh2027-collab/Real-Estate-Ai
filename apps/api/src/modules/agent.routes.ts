import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAgentKey } from '../middleware/auth';
import { leadNo } from '../services/leadService';
import { searchAvailableProperties } from '../services/propertySearch';
import { settingsService } from '../services/settingsService';
import { notFound } from '../utils/errors';

/**
 * Endpoints for the Python LiveKit voice agent (service-to-service, X-Agent-Key).
 * Read-only: the agent can look up call context and search available properties.
 */
export const agentRouter = Router();
agentRouter.use(requireAgentKey);

agentRouter.get('/calls/:roomName/context', async (req, res) => {
  const call = await prisma.voiceCall.findUnique({
    where: { roomName: String(req.params.roomName) },
    include: { customer: true, lead: true },
  });
  if (!call) throw notFound('Call');
  const [business, ai] = await Promise.all([settingsService.getBusiness(), settingsService.getAi()]);
  res.json({
    callId: call.id,
    roomName: call.roomName,
    businessName: business.businessName,
    workingHours: business.workingHours,
    customer: { firstName: call.customer.fullName?.split(' ')[0] ?? null, preferredLanguage: call.customer.preferredLanguage },
    lead: call.lead
      ? {
          leadNumber: leadNo(call.lead.number),
          propertyType: call.lead.propertyType,
          listingType: call.lead.listingType,
          budgetRange: call.lead.budgetRange,
          preferredLocation: call.lead.preferredLocation,
          bedrooms: call.lead.bedrooms,
          urgency: call.lead.urgency,
          summary: call.lead.summary,
        }
      : null,
    voice: ai.voice,
    model: ai.model,
    temperature: ai.temperature,
    systemPromptAddendum: ai.systemPromptAddendum,
  });
});

agentRouter.post('/properties/search', async (req, res) => {
  res.json({ properties: await searchAvailableProperties(req.body) });
});

agentRouter.post('/calls/:roomName/started', async (req, res) => {
  const call = await prisma.voiceCall.findUnique({ where: { roomName: String(req.params.roomName) } });
  if (!call) throw notFound('Call');
  const { voiceService } = await import('../services/voiceService');
  await voiceService.markStarted(call.id);
  res.json({ ok: true });
});
