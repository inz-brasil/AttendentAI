// traces.ts — Expõe rastros de tools e etapas dos agentes para debug
import { desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client'
import { agentTraces } from '../db/schema'

const phoneParamsSchema = z.object({ phone: z.string().min(1) })

/**
 * Registra endpoints de rastreio dos agentes.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerTraceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/traces', async () => {
    const traces = await db.select().from(agentTraces).orderBy(desc(agentTraces.created_at)).limit(100)
    return { traces }
  })

  app.get('/api/traces/:phone', async (request) => {
    const { phone } = phoneParamsSchema.parse(request.params)
    const traces = await db
      .select()
      .from(agentTraces)
      .where(eq(agentTraces.phone, phone))
      .orderBy(desc(agentTraces.created_at))
      .limit(100)
    return { traces }
  })
}
