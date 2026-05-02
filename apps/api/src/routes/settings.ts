// settings.ts — Expõe endpoints CRUD básicos para configurações globais
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client'
import { settings } from '../db/schema'

const settingParamsSchema = z.object({ key: z.string().min(1) })
const settingBodySchema = z.object({
  key: z.string().min(1),
  value: z.string().nullable().optional(),
  description: z.string().nullable().optional()
})

/**
 * Registra endpoints de /api/settings.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerSettingRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/settings', async () => db.select().from(settings))

  app.get('/api/settings/:key', async (request, reply) => {
    const params = settingParamsSchema.parse(request.params)
    const [setting] = await db.select().from(settings).where(eq(settings.key, params.key)).limit(1)
    return setting ?? reply.code(404).send({ error: 'Setting not found', code: 'SETTING_NOT_FOUND' })
  })

  app.post('/api/settings', async (request, reply) => {
    const body = settingBodySchema.parse(request.body)
    await db.insert(settings).values(body)
    return reply.code(201).send(body)
  })

  app.put('/api/settings/:key', async (request) => {
    const params = settingParamsSchema.parse(request.params)
    const body = settingBodySchema.omit({ key: true }).partial().parse(request.body)
    await db.update(settings).set({ ...body, updated_at: new Date() }).where(eq(settings.key, params.key))
    const [setting] = await db.select().from(settings).where(eq(settings.key, params.key)).limit(1)
    return setting
  })

  // Upsert em lote — usado pela página de Settings do dashboard
  app.put('/api/settings', async (request) => {
    const bulkSchema = z.array(z.object({ key: z.string().min(1), value: z.string().nullable() }))
    const items = bulkSchema.parse(request.body)
    const now = new Date()
    for (const item of items) {
      const existing = await db.select().from(settings).where(eq(settings.key, item.key)).limit(1)
      if (existing.length > 0) {
        await db.update(settings).set({ value: item.value, updated_at: now }).where(eq(settings.key, item.key))
      } else {
        await db.insert(settings).values({ key: item.key, value: item.value, updated_at: now })
      }
    }
    return { success: true, updated: items.length }
  })

  app.delete('/api/settings/:key', async (request) => {
    const params = settingParamsSchema.parse(request.params)
    await db.delete(settings).where(eq(settings.key, params.key))
    return { success: true }
  })
}
