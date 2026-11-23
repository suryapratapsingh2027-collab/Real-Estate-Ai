import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-hub-signature-256"]',
      'req.headers["x-agent-key"]',
      '*.password',
      '*.passwordHash',
      '*.token',
      '*.accessToken',
      '*.secrets',
    ],
    censor: '[redacted]',
  },
});
