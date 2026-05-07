// inbound-message-queue.ts — Enfileira mensagens inbound com debounce BullMQ por tenant e telefone
import { Queue, type Job } from 'bullmq'
import { BATCH_WINDOW_MS } from '../config/constants'
import { getSettingValue } from '../config/dashboard-config'
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
  const batchWindowMs = await getBatchWindowMs()

  const job = await inboundMessageQueue.add(
    'process-phone',
    { phone, instanceId, tenantId },
    {
      deduplication: {
        id: `tenant:${tenantId}:phone:${phone}`,
        ttl: batchWindowMs,
        extend: true,
        replace: true
      },
      delay: batchWindowMs
    }
  )

  await traceEmitter.emit('batch_created', {
    tenant_id: tenantId,
    phone,
    status: 'ok',
    data: {
        job_id: job.id ?? null,
        instance_id: instanceId,
        batch_window_ms: batchWindowMs,
        deduplication_id: `tenant:${tenantId}:phone:${phone}`
    }
  })

  return job
}

async function getBatchWindowMs(): Promise<number> {
  const raw = await getSettingValue('batch_window_ms')
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : BATCH_WINDOW_MS
}
