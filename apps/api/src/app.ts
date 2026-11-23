import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimit';
import { agentRouter } from './modules/agent.routes';
import { auditRouter, integrationsRouter, notificationsRouter, settingsRouter, usersRouter } from './modules/admin.routes';
import { authRouter, profileRouter } from './modules/auth.routes';
import { brokersRouter } from './modules/brokers.routes';
import { conversationsRouter } from './modules/conversations.routes';
import { customersRouter } from './modules/customers.routes';
import { dashboardRouter } from './modules/dashboard.routes';
import { followUpsRouter } from './modules/followups.routes';
import { leadsRouter } from './modules/leads.routes';
import { propertiesRouter } from './modules/properties.routes';
import { voiceRouter } from './modules/voice.routes';
import { storage } from './services/storage';
import { webhooksRouter } from './webhooks';
import { notFound } from './utils/errors';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind nginx
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
  app.use(cors({ origin: origins, credentials: true, allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'] }));
  if (env.NODE_ENV !== 'test') app.use(
      pinoHttp({
        logger,
        autoLogging: { ignore: (req) => req.url === '/api/health' },
        serializers: {
          req: (req: { method: string; url: string }) => ({ method: req.method, url: req.url.split('?')[0] }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
      }),
    );

  // Webhooks need the raw body — mount before the JSON parser.
  app.use('/api/webhooks', webhooksRouter);

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    let db = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    res.status(db ? 200 : 503).json({ status: db ? 'ok' : 'degraded', db, queueMode: env.QUEUE_MODE });
  });

  // Public file serving for property images only (recordings use signed URLs).
  app.get('/api/files/properties/*path', async (req, res) => {
    const parts = (req.params as unknown as { path: string[] }).path;
    const key = `properties/${parts.join('/')}`;
    if (key.includes('..')) throw notFound('File');
    const obj = await storage.get(key);
    if (!obj) throw notFound('File');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const ext = key.split('.').pop();
    res.type(obj.contentType ?? (ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg'));
    obj.stream.pipe(res);
  });

  app.use('/api/agent', agentRouter);
  app.use('/api', apiLimiter);
  app.use('/api/auth', authRouter);
  app.use('/api/profile', profileRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/properties', propertiesRouter);
  app.use('/api/brokers', brokersRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/leads', leadsRouter);
  app.use('/api/follow-ups', followUpsRouter);
  app.use('/api/conversations', conversationsRouter);
  app.use('/api/voice', voiceRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/integrations', integrationsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/audit-logs', auditRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
