// health.ts — Expõe endpoint de saúde da API
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { db } from '../db/client'
import { settings } from '../db/schema'
import { getLastMessageProcessed } from '../monitoring/status'
import { messageQueue } from '../queue/message-queue'
import { redisConnection } from '../queue/redis'

async function checkRedis(): Promise<'connected' | 'error'> {
  try {
    return (await redisConnection.ping()) === 'PONG' ? 'connected' : 'error'
  } catch {
    return 'error'
  }
}

async function checkDb(): Promise<'ok' | 'error'> {
  try {
    await db.select().from(settings).where(eq(settings.key, 'agent_name')).limit(1)
    return 'ok'
  } catch {
    return 'error'
  }
}

async function getQueueSize(): Promise<number> {
  try {
    const [waiting, delayed, active] = await Promise.all([
      messageQueue.getWaitingCount(),
      messageQueue.getDelayedCount(),
      messageQueue.getActiveCount()
    ])
    return waiting + delayed + active
  } catch {
    return -1
  }
}

/**
 * Registra a rota GET /health.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  }))

  app.get('/health/detailed', async () => {
    const [redis, dbStatus, queueSize] = await Promise.all([
      checkRedis(),
      checkDb(),
      getQueueSize()
    ])
    const status = redis === 'connected' && dbStatus === 'ok' ? 'ok' : 'degraded'

    return {
      status,
      uptime: process.uptime(),
      redis,
      db: dbStatus,
      last_message_processed: getLastMessageProcessed(),
      queue_size: queueSize
    }
  })
}
