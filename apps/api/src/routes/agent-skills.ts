// agent-skills.ts — Endpoints para gerenciar vínculos agente ↔ skills
import { and, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client'
import { agentSkills, skills, tokenUsage } from '../db/schema'

const agentParamsSchema = z.object({ id: z.string().min(1) })

const agentSkillsBodySchema = z.object({
  // Array de { skill_id, order } representando os vínculos desejados
  skills: z.array(z.object({ skill_id: z.string(), order: z.number().int().default(0) }))
})

/**
 * Registra endpoints de skills de um agente.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerAgentSkillRoutes(app: FastifyInstance): Promise<void> {
  // Lista skills vinculadas a um agente
  app.get('/api/agents/:id/skills', async (request) => {
    const { id } = agentParamsSchema.parse(request.params)
    const rows = await db
      .select({ skill_id: agentSkills.skill_id, order: agentSkills.order, name: skills.name, description: skills.description, category: skills.category })
      .from(agentSkills)
      .leftJoin(skills, eq(agentSkills.skill_id, skills.id))
      .where(eq(agentSkills.agent_id, id))
    return rows
  })

  // Substitui todos os vínculos de skills de um agente (upsert completo)
  app.put('/api/agents/:id/skills', async (request) => {
    const { id } = agentParamsSchema.parse(request.params)
    const body = agentSkillsBodySchema.parse(request.body)

    // Remove vínculos antigos e reinsertion
    await db.delete(agentSkills).where(eq(agentSkills.agent_id, id))

    if (body.skills.length > 0) {
      await db.insert(agentSkills).values(
        body.skills.map(s => ({ agent_id: id, skill_id: s.skill_id, order: s.order }))
      )
    }

    request.log.info({ agent_id: id, count: body.skills.length }, 'agent skills updated')
    return { success: true, count: body.skills.length }
  })

  // Métricas de uso do agente (total de chamadas, tokens, custo estimado)
  app.get('/api/agents/:id/metrics', async (request) => {
    const { id } = agentParamsSchema.parse(request.params)

    const usageRows = await db
      .select()
      .from(tokenUsage)
      .where(eq(tokenUsage.agent_type, id))

    const totalCalls = usageRows.length
    const totalTokens = usageRows.reduce((s, r) => s + (r.total_tokens ?? 0), 0)
    const estimatedCost = usageRows.reduce((s, r) => s + (r.estimated_cost_usd ?? 0), 0)

    return { total_calls: totalCalls, total_tokens: totalTokens, estimated_cost_usd: estimatedCost }
  })
}
