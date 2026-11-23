import { Queue, type JobsOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';

export const QUEUES = {
  inbound: 'inbound-message',
  notifications: 'notifications',
  scheduler: 'scheduler',
  calls: 'calls',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export type JobMap = {
  'process-inbound': { messageId: string };
  'send-notification': { notificationId: string };
  'followup-scan': Record<string, never>;
  'expire-call-links': Record<string, never>;
  'recording-retention': Record<string, never>;
  'summarize-conversation': { conversationId: string };
};
export type JobName = keyof JobMap;

export const JOB_QUEUE: Record<JobName, QueueName> = {
  'process-inbound': QUEUES.inbound,
  'send-notification': QUEUES.notifications,
  'followup-scan': QUEUES.scheduler,
  'expire-call-links': QUEUES.scheduler,
  'recording-retention': QUEUES.scheduler,
  'summarize-conversation': QUEUES.calls,
};

type Handler<N extends JobName> = (data: JobMap[N], meta: { attempt: number; finalAttempt: boolean }) => Promise<void>;
const handlers = new Map<JobName, Handler<JobName>>();

export function registerHandler<N extends JobName>(name: N, fn: Handler<N>) {
  handlers.set(name, fn as unknown as Handler<JobName>);
}
export function getHandler(name: JobName) {
  return handlers.get(name);
}

export const DEFAULT_JOB_OPTS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

let connection: Redis | null = null;
export function redisConnection(): Redis {
  if (!env.REDIS_URL) throw new Error('REDIS_URL not configured');
  connection ??= new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return connection;
}

const queues = new Map<QueueName, Queue>();
export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redisConnection(), defaultJobOptions: DEFAULT_JOB_OPTS });
    queues.set(name, q);
  }
  return q;
}

/**
 * Enqueue a background job. In QUEUE_MODE=inline (tests / single-process dev) the handler
 * runs immediately in-process; failures are logged and recorded but never thrown to the caller.
 */
export async function enqueue<N extends JobName>(name: N, data: JobMap[N], opts: JobsOptions = {}): Promise<void> {
  if (env.QUEUE_MODE === 'inline') {
    const h = handlers.get(name);
    if (!h) {
      logger.warn({ name }, 'no handler registered for inline job');
      return;
    }
    try {
      await h(data, { attempt: 1, finalAttempt: true });
    } catch (err) {
      logger.error({ err, name }, 'inline job failed');
      await recordFailedJob(JOB_QUEUE[name], name, opts.jobId ?? null, data, err, 1);
    }
    return;
  }
  await getQueue(JOB_QUEUE[name]).add(name, data, opts);
}

export async function recordFailedJob(queue: string, jobName: string, jobId: string | null, data: unknown, err: unknown, attempts: number) {
  try {
    await prisma.failedJob.create({
      data: {
        queue,
        jobName,
        jobId,
        data: (data ?? {}) as object,
        error: err instanceof Error ? err.message.slice(0, 2000) : String(err).slice(0, 2000),
        attempts,
      },
    });
  } catch (e) {
    logger.error({ err: e }, 'failed to record failed job');
  }
}

export async function closeQueues() {
  await Promise.all([...queues.values()].map((q) => q.close()));
  queues.clear();
  if (connection) {
    await connection.quit().catch(() => undefined);
    connection = null;
  }
}
