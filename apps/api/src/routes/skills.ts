// skills.ts — Expõe endpoints CRUD básicos para skills
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client'
import { skills } from '../db/schema'

const skillParamsSchema = z.object({ id: z.string().min(1) })
const skillBodySchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  slug: z.string().min(1).nullable().optional(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  when_to_use: z.string().nullable().optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  is_active: z.boolean().optional()
})

/**
 * Registra endpoints de /api/skills.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerSkillRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/skills', async () => db.select().from(skills))

  app.get('/api/skills/:id', async (request, reply) => {
    const params = skillParamsSchema.parse(request.params)
    const [skill] = await db.select().from(skills).where(eq(skills.id, params.id)).limit(1)
    return skill ?? reply.code(404).send({ error: 'Skill not found', code: 'SKILL_NOT_FOUND' })
  })

  app.post('/api/skills', async (request, reply) => {
    const body = skillBodySchema.parse(request.body)
    const values = { id: body.id ?? crypto.randomUUID(), ...body }
    await db.insert(skills).values(values)
    return reply.code(201).send(values)
  })

  app.put('/api/skills/:id', async (request) => {
    const params = skillParamsSchema.parse(request.params)
    const body = skillBodySchema.partial().parse(request.body)
    await db.update(skills).set({ ...body, updated_at: new Date() }).where(eq(skills.id, params.id))
    const [skill] = await db.select().from(skills).where(eq(skills.id, params.id)).limit(1)
    return skill
  })

  app.delete('/api/skills/:id', async (request) => {
    const params = skillParamsSchema.parse(request.params)
    await db.delete(skills).where(eq(skills.id, params.id))
    return { success: true }
  })
}
