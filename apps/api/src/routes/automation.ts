// automation.ts — Expõe controle operacional de automação e blacklist
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  activateAutomationBlacklist,
  deactivateAutomationBlacklist,
  getAutomationStatus,
  updateAutomationSettings
} from '../automation/control'

const tenantQuerySchema = z.object({ tenant_id: z.string().min(1).default('default') })

const updateAutomationSchema = z.object({
  tenant_id: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  schedule_enabled: z.boolean().optional(),
  schedule_start: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  schedule_end: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
  timezone: z.string().min(1).optional(),
  blacklist_default_minutes: z.number().int().min(1).max(10080).optional()
})

const blacklistBodySchema = z.object({
  tenant_id: z.string().min(1).default('default'),
  phone: z.string().min(1),
  reason: z.string().min(1).optional(),
  source: z.string().min(1).optional()
})

const phoneParamsSchema = z.object({ phone: z.string().min(1) })
const phoneDeleteSchema = z.object({ phone: z.string().min(1), tenant_id: z.string().min(1).default('default') })

/**
 * Registra endpoints de controle da automação.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerAutomationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/automation', async (request) => {
    const query = tenantQuerySchema.parse(request.query)
    return getAutomationStatus(query.tenant_id)
  })

  app.put('/api/automation', async (request) => {
    const body = updateAutomationSchema.parse(request.body)
    const tenantId = body.tenant_id ?? 'default'
    const { tenant_id: _tenantId, ...settings } = body
    void _tenantId
    return updateAutomationSettings(settings, tenantId)
  })

  app.post('/api/automation/blacklist', async (request, reply) => {
    const body = blacklistBodySchema.parse(request.body)
    const result = await activateAutomationBlacklist(body.phone, body.reason, body.source ?? 'admin', body.tenant_id)
    return reply.code(201).send({ success: true, ...result })
  })

  app.delete('/api/automation/blacklist/:phone', async (request) => {
    const params = phoneParamsSchema.parse(request.params)
    const query = tenantQuerySchema.parse(request.query)
    await deactivateAutomationBlacklist(params.phone, query.tenant_id)
    return { success: true }
  })
}
