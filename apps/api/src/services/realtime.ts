import type { Server } from 'socket.io';
import { Redis } from 'ioredis';
import { env } from '../config/env';
import { logger } from '../lib/logger';

/**
 * Real-time fan-out. The API process owns the Socket.IO server; the worker process
 * publishes events over Redis pub/sub and the API forwards them to sockets.
 */
const CHANNEL = 'rea:realtime';
let io: Server | null = null;
let pub: Redis | null = null;

export type RealtimeEvent = {
  event: 'message:new' | 'message:status' | 'conversation:updated' | 'lead:updated' | 'call:updated' | 'notification:new' | 'dashboard:refresh';
  payload: Record<string, unknown>;
  /** Rooms: "staff" (admins), "broker:<brokerId>", "user:<userId>" */
  rooms: string[];
};

function emitLocal(e: RealtimeEvent) {
  if (!io) return;
  for (const room of e.rooms) io.to(room).emit(e.event, e.payload);
}

export const realtime = {
  attach(server: Server) {
    io = server;
    if (env.REDIS_URL && env.QUEUE_MODE === 'queue') {
      const sub = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
      sub.subscribe(CHANNEL).catch((err) => logger.error({ err }, 'realtime subscribe failed'));
      sub.on('message', (_ch, msg) => {
        try {
          emitLocal(JSON.parse(msg) as RealtimeEvent);
        } catch {
          /* ignore malformed */
        }
      });
    }
  },
  publish(e: RealtimeEvent) {
    if (io) return emitLocal(e);
    if (!env.REDIS_URL || env.QUEUE_MODE !== 'queue') return;
    pub ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false });
    pub.publish(CHANNEL, JSON.stringify(e)).catch((err) => logger.warn({ err }, 'realtime publish failed'));
  },
};

export function roomsFor(brokerId?: string | null): string[] {
  return brokerId ? ['staff', `broker:${brokerId}`] : ['staff'];
}
