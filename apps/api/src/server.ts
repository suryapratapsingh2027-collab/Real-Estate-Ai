import http from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { closeQueues } from './queues/queue';
import { loadAuthUser, verifyAccessToken } from './services/authService';
import { realtime } from './services/realtime';
import { registerAllHandlers } from './workers/handlers';

registerAllHandlers(); // needed for QUEUE_MODE=inline

const app = createApp();
const server = http.createServer(app);

const io = new Server(server, {
  path: '/socket.io',
  cors: { origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()), credentials: true },
});
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('unauthorized'));
    const { sub } = verifyAccessToken(token);
    const user = await loadAuthUser(sub);
    socket.data.user = { id: user.id, role: user.role, brokerId: user.brokerId };
    await socket.join(`user:${user.id}`);
    if (user.permissions.has('lead:read_all')) await socket.join('staff');
    if (user.brokerId) await socket.join(`broker:${user.brokerId}`);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});
realtime.attach(io);

server.listen(env.PORT, () => logger.info(`API listening on :${env.PORT} (queue mode: ${env.QUEUE_MODE}, AI: ${env.AI_PROVIDER})`));

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close();
  io.close();
  await closeQueues();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
