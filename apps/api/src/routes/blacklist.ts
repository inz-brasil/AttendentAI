// blacklist.ts — Expõe CRUD de blacklist/manual pause para o dashboard
import { desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { activateAutomationBlacklist, deactivateAutomationBlacklist } from '../automation/control'
import { db } from '../db/client'
import { automationBlacklist } from '../db/schema'

const blacklistQuerySchema = z.object({ tenant_id: z.string().min(1).default('default') })
const blacklistBodySchema = z.object({
  tenant_id: z.string().min(1).default('default'),
  phone: z.string().min(1),
  reason: z.string().min(1).default('blacklist'),
  source: z.string().min(1).default('dashboard'),
  duration_minutes: z.number().int().min(1).max(10080).optional()
})
const phoneParamsSchema = z.object({ phone: z.string().min(1) })

/**
 * Registra endpoints /api/blacklist.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerBlacklistRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/blacklist', async (request) => {
    const query = blacklistQuerySchema.parse(request.query)
    const rows = await db.select().from(automationBlacklist).orderBy(desc(automationBlacklist.updated_at))
    return {
      tenant_id: query.tenant_id,
      items: rows.map((row) => ({
        phone: row.phone,
        reason: row.reason,
        source: row.source,
        expires_at: row.expires_at,
        created_at: row.created_at,
        updated_at: row.updated_at
      }))
    }
  })

  app.post('/api/blacklist', async (request, reply) => {
    const body = blacklistBodySchema.parse(request.body)
    const result = body.duration_minutes
      ? await activateWithCustomDuration(body.phone, body.reason, body.source, body.duration_minutes)
      : await activateAutomationBlacklist(body.phone, body.reason, body.source)
    return reply.code(201).send({ success: true, tenant_id: body.tenant_id, ...result })
  })

  app.delete('/api/blacklist/:phone', async (request) => {
    const params = phoneParamsSchema.parse(request.params)
    await deactivateAutomationBlacklist(params.phone)
    return { success: true }
  })
}

async function activateWithCustomDuration(
  phone: string,
  reason: string,
  source: string,
  durationMinutes: number
): Promise<{ phone: string; expires_at: Date }> {
  const expiresAt = new Date(Date.now() + durationMinutes * 60_000)
  const [existing] = await db.select().from(automationBlacklist).where(eq(automationBlacklist.phone, phone)).limit(1)
  if (existing) {
    await db
      .update(automationBlacklist)
      .set({ reason, source, expires_at: expiresAt, updated_at: new Date() })
      .where(eq(automationBlacklist.phone, phone))
  } else {
    await db.insert(automationBlacklist).values({ phone, reason, source, expires_at: expiresAt })
  }

  return { phone, expires_at: expiresAt }
}
