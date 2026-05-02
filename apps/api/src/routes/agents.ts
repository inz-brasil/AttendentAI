// agents.ts — Expõe endpoints CRUD básicos para agentes configurados
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client'
import { agents } from '../db/schema'

const agentParamsSchema = z.object({ id: z.string().min(1) })
const agentBodySchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  type: z.enum(['orchestrator', 'classifier', 'responder', 'memory', 'identifier', 'custom']).optional(),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  system_prompt: z.string().nullable().optional(),
  is_active: z.boolean().optional()
})

/**
 * Registra endpoints de /api/agents.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/agents', async () => db.select().from(agents))

  app.get('/api/agents/:id', async (request, reply) => {
    const params = agentParamsSchema.parse(request.params)
    const [agent] = await db.select().from(agents).where(eq(agents.id, params.id)).limit(1)
    return agent ?? reply.code(404).send({ error: 'Agent not found', code: 'AGENT_NOT_FOUND' })
  })

  app.post('/api/agents', async (request, reply) => {
    const body = agentBodySchema.parse(request.body)
    const values = { id: body.id ?? crypto.randomUUID(), ...body }
    await db.insert(agents).values(values)
    return reply.code(201).send(values)
  })

  app.put('/api/agents/:id', async (request) => {
    const params = agentParamsSchema.parse(request.params)
    const body = agentBodySchema.partial().parse(request.body)
    await db.update(agents).set({ ...body, updated_at: new Date() }).where(eq(agents.id, params.id))
    const [agent] = await db.select().from(agents).where(eq(agents.id, params.id)).limit(1)
    return agent
  })

  app.delete('/api/agents/:id', async (request) => {
    const params = agentParamsSchema.parse(request.params)
    await db.delete(agents).where(eq(agents.id, params.id))
    return { success: true }
  })
}
