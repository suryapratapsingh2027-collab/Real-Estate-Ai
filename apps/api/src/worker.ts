import { Worker } from 'bullmq';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { DEFAULT_JOB_OPTS, getHandler, getQueue, QUEUES, recordFailedJob, redisConnection, type JobName, closeQueues } from './queues/queue';
import { registerAllHandlers } from './workers/handlers';

if (env.QUEUE_MODE !== 'queue') {
  logger.error('Worker requires QUEUE_MODE=queue');
  process.exit(1);
}

registerAllHandlers();

const concurrency: Record<string, number> = {
  [QUEUES.inbound]: 5,
  [QUEUES.notifications]: 10,
  [QUEUES.scheduler]: 1,
  [QUEUES.calls]: 2,
};

const workers = Object.values(QUEUES).map((name) => {
  const w = new Worker(
    name,
    async (job) => {
      const handler = getHandler(job.name as JobName);
      if (!handler) throw new Error(`No handler for ${job.name}`);
      const attempts = job.opts.attempts ?? DEFAULT_JOB_OPTS.attempts ?? 1;
      await handler(job.data as never, { attempt: job.attemptsMade + 1, finalAttempt: job.attemptsMade + 1 >= attempts });
    },
    { connection: redisConnection(), concurrency: concurrency[name] ?? 2 },
  );
  w.on('failed', async (job, err) => {
    if (!job) return;
    const attempts = job.opts.attempts ?? 1;
    logger.warn({ queue: name, job: job.name, id: job.id, attempt: job.attemptsMade, err: err.message }, 'job failed');
    if (job.attemptsMade >= attempts) await recordFailedJob(name, job.name, job.id ?? null, job.data, err, job.attemptsMade);
  });
  w.on('error', (err) => logger.error({ err, queue: name }, 'worker error'));
  return w;
});

// Repeatable maintenance jobs (idempotent upserts of schedulers).
async function scheduleRepeatables() {
  const q = getQueue(QUEUES.scheduler);
  await q.upsertJobScheduler('followup-scan', { every: 60_000 }, { name: 'followup-scan', data: {} });
  await q.upsertJobScheduler('expire-call-links', { every: 5 * 60_000 }, { name: 'expire-call-links', data: {} });
  await q.upsertJobScheduler('recording-retention', { pattern: '30 2 * * *' }, { name: 'recording-retention', data: {} });
}
scheduleRepeatables()
  .then(() => logger.info(`Worker started: ${Object.values(QUEUES).join(', ')}`))
  .catch((err) => logger.error({ err }, 'failed to schedule repeatable jobs'));

async function shutdown() {
  await Promise.all(workers.map((w) => w.close()));
  await closeQueues();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
