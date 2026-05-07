// queue-status.ts — Expõe status BullMQ para o dashboard de debug
import type { FastifyInstance } from 'fastify'
import { inboundMessageQueue } from '../queue/inbound-message-queue'

/**
 * Registra endpoint /api/queue/status.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerQueueStatusRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/queue/status', async () => {
    const [counts, waiting, delayed, active, failed] = await Promise.all([
      inboundMessageQueue.getJobCounts('waiting', 'delayed', 'active', 'completed', 'failed', 'paused'),
      inboundMessageQueue.getJobs(['waiting'], 0, 20),
      inboundMessageQueue.getJobs(['delayed'], 0, 20),
      inboundMessageQueue.getJobs(['active'], 0, 20),
      inboundMessageQueue.getJobs(['failed'], 0, 20)
    ])

    return {
      queue: 'inbound-message-processing',
      counts,
      jobs: {
        waiting: waiting.map(formatJob),
        delayed: delayed.map(formatJob),
        active: active.map(formatJob),
        failed: failed.map(formatJob)
      }
    }
  })
}

function formatJob(job: Awaited<ReturnType<typeof inboundMessageQueue.getJobs>>[number]): Record<string, unknown> {
  return {
    id: job.id ?? null,
    name: job.name,
    data: job.data,
    attempts_made: job.attemptsMade,
    timestamp: job.timestamp,
    processed_on: job.processedOn ?? null,
    finished_on: job.finishedOn ?? null,
    failed_reason: job.failedReason ?? null
  }
}
