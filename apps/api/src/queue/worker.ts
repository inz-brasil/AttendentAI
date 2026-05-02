// worker.ts — Processa fila de mensagens com lock Redis por phone
import { Worker } from 'bullmq'
import pino from 'pino'
import { env } from '../config/env'
import { QueryEngine, type WebhookPayload } from '../orchestrator'
import { acquirePhoneLock, delay, redisConnection, releasePhoneLock } from './redis'

const log = pino({ name: 'attendentai-worker' })
const queryEngine = new QueryEngine()

async function acquireWithRetries(phone: string, token: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const acquired = await acquirePhoneLock(phone, token, env.LOCK_TTL_SECONDS)
    if (acquired) {
      return true
    }

    await delay(2000)
  }

  return false
}

export const messageWorker = new Worker<WebhookPayload>(
  'message-processing',
  async (job) => {
    const token = crypto.randomUUID()
    const payload = job.data
    const acquired = await acquireWithRetries(payload.phone, token)

    if (!acquired) {
      throw new Error(`Could not acquire lock for phone ${payload.phone}`)
    }

    try {
      log.info({ jobId: job.id, phone: payload.phone }, 'processing queued message')
      return await queryEngine.process(payload, { skipLock: true })
    } catch (error) {
      log.error({ err: error, jobId: job.id, phone: payload.phone }, 'queued message failed')
      throw error
    } finally {
      await releasePhoneLock(payload.phone, token)
    }
  },
  {
    connection: redisConnection,
    concurrency: 5
  }
)

messageWorker.on('completed', (job) => {
  log.info({ jobId: job.id, phone: job.data.phone }, 'queued message completed')
})

messageWorker.on('failed', (job, error) => {
  log.error({ err: error, jobId: job?.id, phone: job?.data.phone }, 'queued message failed')
})
