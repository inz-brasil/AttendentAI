// inbound-message-queue.ts — Enfileira mensagens inbound com debounce BullMQ por tenant e telefone
import { Queue, type Job } from 'bullmq'
import { BATCH_WINDOW_MS } from '../config/constants'
import { traceEmitter } from '../observability/trace-emitter'
import { redisConnection } from './redis'

export interface InboundQueueJob {
  phone: string
  instanceId: string | null
  tenantId: string
}

export const inboundMessageQueue = new Queue<InboundQueueJob>('inbound-message-processing', {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: 100,
    removeOnFail: 500,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  }
})

/**
 * Enfileira processamento debounced de mensagens de um telefone.
 * @param input Tenant, telefone e instância da conversa.
 * @returns Job criado ou substituído pelo BullMQ.
 */
export async function enqueueInboundMessage(input: InboundQueueJob): Promise<Job<InboundQueueJob>> {
  const { phone, instanceId, tenantId } = input

  const job = await inboundMessageQueue.add(
    'process-phone',
    { phone, instanceId, tenantId },
    {
      deduplication: {
        id: `tenant:${tenantId}:phone:${phone}`,
        ttl: BATCH_WINDOW_MS,
        extend: true,
        replace: true
      },
      delay: BATCH_WINDOW_MS
    }
  )

  await traceEmitter.emit('batch_created', {
    tenant_id: tenantId,
    phone,
    status: 'ok',
    data: {
      job_id: job.id ?? null,
      instance_id: instanceId,
      batch_window_ms: BATCH_WINDOW_MS,
      deduplication_id: `tenant:${tenantId}:phone:${phone}`
    }
  })

  return job
}
