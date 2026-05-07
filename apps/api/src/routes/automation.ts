// automation.ts — Expõe controle operacional de automação e blacklist
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  activateAutomationBlacklist,
  deactivateAutomationBlacklist,
  getAutomationStatus,
  updateAutomationSettings
} from '../automation/control'

const updateAutomationSchema = z.object({
  enabled: z.boolean().optional(),
  schedule_enabled: z.boolean().optional(),
  schedule_start: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  schedule_end: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  timezone: z.string().min(1).optional(),
  blacklist_default_minutes: z.number().int().min(1).max(10080).optional()
})

const blacklistBodySchema = z.object({
  phone: z.string().min(1),
  reason: z.string().min(1).optional(),
  source: z.string().min(1).optional()
})

const phoneParamsSchema = z.object({ phone: z.string().min(1) })

/**
 * Registra endpoints de controle da automação.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerAutomationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/automation', async () => getAutomationStatus())

  app.put('/api/automation', async (request) => {
    const body = updateAutomationSchema.parse(request.body)
    return updateAutomationSettings(body)
  })

  app.post('/api/automation/blacklist', async (request, reply) => {
    const body = blacklistBodySchema.parse(request.body)
    const result = await activateAutomationBlacklist(body.phone, body.reason, body.source ?? 'admin')
    return reply.code(201).send({ success: true, ...result })
  })

  app.delete('/api/automation/blacklist/:phone', async (request) => {
    const params = phoneParamsSchema.parse(request.params)
    await deactivateAutomationBlacklist(params.phone)
    return { success: true }
  })
}
