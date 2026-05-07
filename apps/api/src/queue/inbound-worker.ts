// inbound-worker.ts — Processa jobs debounced da InboundQueue com isolamento multi-tenant
import { Worker, type Job } from 'bullmq'
import pino from 'pino'
import { QUEUE_CONCURRENCY } from '../config/constants'
import { traceEmitter } from '../observability/trace-emitter'
import { ConversationBatcher } from './conversation-batcher'
import { type InboundQueueJob } from './inbound-message-queue'
import { redisConnection } from './redis'

const log = pino({ name: 'attendentai-inbound-worker' })

let inboundWorker: Worker<InboundQueueJob> | null = null

/**
 * Inicia o worker da fila inbound se ele ainda não estiver ativo.
 * @returns Worker BullMQ ativo.
 */
export function startInboundWorker(): Worker<InboundQueueJob> {
  if (inboundWorker) {
    return inboundWorker
  }

  const batcher = new ConversationBatcher()
  inboundWorker = new Worker<InboundQueueJob>(
    'inbound-message-processing',
    async (job) => processInboundJob(job, batcher),
    {
      connection: redisConnection,
      concurrency: QUEUE_CONCURRENCY
    }
  )

  inboundWorker.on('completed', (job) => {
    log.info({ jobId: job.id, phone: job.data.phone, tenantId: job.data.tenantId }, 'inbound batch completed')
  })

  inboundWorker.on('failed', (job, error) => {
    log.error({ err: error, jobId: job?.id, phone: job?.data.phone, tenantId: job?.data.tenantId }, 'inbound batch failed')
  })

  return inboundWorker
}

/**
 * Fecha o worker inbound quando a API encerra.
 * @returns Nada.
 */
export async function closeInboundWorker(): Promise<void> {
  if (!inboundWorker) {
    return
  }

  await inboundWorker.close()
  inboundWorker = null
}

async function processInboundJob(job: Job<InboundQueueJob>, batcher: ConversationBatcher): Promise<unknown> {
  const timer = traceEmitter.startTimer()
  const { phone, tenantId, instanceId } = job.data

  try {
    log.info({ jobId: job.id, phone, tenantId, instanceId }, 'processing inbound batch')
    return await batcher.process(job.data)
  } catch (error) {
    await traceEmitter.emit('batch_processed', {
      tenant_id: tenantId,
      phone,
      status: 'error',
      data: {
        job_id: job.id ?? null,
        instance_id: instanceId,
        error: error instanceof Error ? error.message : String(error)
      }
    }, timer.elapsed())
    throw error
  }
}
