// webhook.ts — Recebe webhooks do n8n e valida payloads do WhatsApp
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { env } from '../config/env'
import { enforcePhoneRateLimit } from '../rate-limit'
import { enqueueMessage } from '../queue/message-queue'
import { PhoneLockedError, QueryEngine } from '../orchestrator'
import { recordTrace } from '../monitoring/trace-recorder'

const webhookPayloadSchema = z.object({
  phone: z.string().min(1),
  name: z.string(),
  message: z.string().min(1),
  message_type: z.enum(['text', 'audio', 'image']),
  timestamp: z.number().int(),
  session_id: z.string().optional(),
  current_time: z.string().optional(),
  timezone: z.string().optional(),
  contact_info: z
    .object({
      email: z.string().optional(),
      city: z.string().optional(),
      timezone: z.string().optional()
    })
    .catchall(z.unknown())
    .optional()
})

const webhookQuerySchema = z.object({
  sync: z.enum(['true', 'false']).optional()
})

type WebhookPayload = z.infer<typeof webhookPayloadSchema>

function validateAuth(request: FastifyRequest): boolean {
  return request.headers.authorization === `Bearer ${env.WEBHOOK_SECRET}`
}

/**
 * Registra a rota POST /api/webhook.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  const queryEngine = new QueryEngine()

  app.post('/api/webhook', async (request, reply) => {
    if (!validateAuth(request)) {
      return reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    }

    const parsed = webhookPayloadSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid webhook payload',
        code: 'INVALID_PAYLOAD',
        details: parsed.error.issues
      })
    }

    const payload: WebhookPayload = parsed.data
    const allowed = await enforcePhoneRateLimit(request, reply, payload.phone, 10)
    if (!allowed) {
      return reply
    }

    request.log.info({ phone: payload.phone, timestamp: payload.timestamp }, 'webhook received')

    const query = webhookQuerySchema.parse(request.query)
    const sync = query.sync === 'true'

    if (!sync) {
      const job = await enqueueMessage(payload)
      request.log.info({ jobId: job.id, phone: payload.phone }, 'webhook enqueued')
      return reply.code(202).send({ success: true, job_id: job.id, status: 'queued' })
    }

    try {
      const response = await queryEngine.process(payload)
      request.log.info(response.metadata, 'webhook processed')
      return response
    } catch (error) {
      if (error instanceof PhoneLockedError) {
        return reply.code(429).send({ error: 'Mensagem anterior ainda processando', code: 'PHONE_LOCKED' })
      }

      await recordTrace({
        phone: payload.phone,
        agent: 'orchestrator',
        eventType: 'pipeline_error',
        title: 'Erro no processamento do webhook',
        data: {
          message: error instanceof Error ? error.message : 'Unknown error',
          name: error instanceof Error ? error.name : 'UnknownError'
        }
      })

      throw error
    }
  })
}
