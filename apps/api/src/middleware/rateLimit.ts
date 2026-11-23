import rateLimit from 'express-rate-limit';
import { isTest } from '../config/env';

const common = { standardHeaders: 'draft-7' as const, legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } } };

export const apiLimiter = rateLimit({ ...common, windowMs: 60_000, limit: isTest ? 10_000 : 300 });
export const loginLimiter = rateLimit({ ...common, windowMs: 15 * 60_000, limit: isTest ? 50 : 20, skipSuccessfulRequests: true });
export const webhookLimiter = rateLimit({ ...common, windowMs: 60_000, limit: isTest ? 10_000 : 1200 });
export const publicCallLimiter = rateLimit({ ...common, windowMs: 60_000, limit: isTest ? 10_000 : 30 });
