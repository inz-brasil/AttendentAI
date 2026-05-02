// playground.ts — Endpoint de teste do pipeline multiagente sem criar leads reais
// Prefixo "playground_" isola dados de teste dos leads de produção
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { runPlaygroundAgent } from '../agents/playground-agent'
import { db } from '../db/client'
import { agents, settings } from '../db/schema'
import { loadMemory } from '../memory/persistent'
import { enforceIpRateLimit } from '../rate-limit'
import { broadcast } from '../websocket/server'

const chatBodySchema = z.object({
  message: z.string().min(1).max(4000),
  phone: z.string().default('playground_test_001'),
  sourceLeadPhone: z.string().optional(),
  agentId: z.string().optional(),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .default([])
})

/**
 * Registra endpoint POST /api/playground/chat.
 * Simula o pipeline sem persistir leads ou mensagens reais.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerPlaygroundRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/playground/chat', async (request, reply) => {
    const allowed = await enforceIpRateLimit(request, reply, 'playground', 20)
    if (!allowed) {
      return reply
    }

    const body = chatBodySchema.parse(request.body)

    // Garante que o phone é sempre prefixado (impede criação de leads reais)
    const phone = body.phone.startsWith('playground_') ? body.phone : `playground_${body.phone}`

    // Busca agente configurado (fallback: responder)
    const [targetAgent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, body.agentId ?? 'responder'))
      .limit(1)

    if (!targetAgent) {
      return reply.code(404).send({ error: 'Agent not found', code: 'AGENT_NOT_FOUND' })
    }

    // Lê settings: chave do banco tem prioridade sobre env (troca sem restart)
    const allSettings = await db.select().from(settings)
    const s = Object.fromEntries(allSettings.map(row => [row.key, row.value ?? '']))

    const sourceMemory = body.sourceLeadPhone ? await loadMemory(body.sourceLeadPhone) : null
    const sourceContext = sourceMemory
      ? [
          'Contexto carregado de lead existente para simulação:',
          sourceMemory.lead_summary,
          sourceMemory.history_summary ? `Histórico:\n${sourceMemory.history_summary}` : '',
          sourceMemory.recent_messages.length > 0
            ? `Mensagens recentes:\n${sourceMemory.recent_messages.map((m) => `${m.role}: ${m.content}`).join('\n')}`
            : ''
        ].filter(Boolean).join('\n\n')
      : ''

    const systemPrompt = `${(targetAgent.system_prompt ?? '')
      .replace(/{agent_name}/g, s.agent_name ?? 'AtendenteAI')
      .replace(/{company_name}/g, s.company_name ?? 'AttendentAI')
      .replace(/{agent_tone}/g, s.agent_tone ?? 'humanizado, claro e consultivo')
      .replace(/{lead_name}/g, `[playground: ${phone}]`)
      .replace(/{current_date}/g, new Date().toLocaleDateString('pt-BR'))}

${sourceContext}`

    let result: Awaited<ReturnType<typeof runPlaygroundAgent>>
    try {
      result = await runPlaygroundAgent(
        {
          message: body.message,
          phone,
          history: body.history,
          systemPrompt,
          model: targetAgent.model ?? 'gpt-4o-mini',
          temperature: targetAgent.temperature ?? 0.3,
          maxTokens: targetAgent.max_tokens ?? 800,
          apiKeyOverride: s.openai_api_key || undefined,
          baseUrlOverride: s.openai_base_url || undefined
        },
        request.log
      )
    } catch (err) {
      request.log.warn({ err, agentId: targetAgent.id }, 'playground pipeline failed')
      return reply.code(502).send({ error: 'LLM pipeline failed', code: 'LLM_ERROR' })
    }

    // Broadcast para o feed /conversations em tempo real
    broadcast({
      type: 'new_message',
      phone,
      name: `[Playground] ${phone}`,
      message: body.message,
      response: result.response,
      agent: targetAgent.id,
      intent: result.classification.intent,
      timestamp: new Date().toISOString()
    })

    return {
      response: result.response,
      phone,
      debug: {
        classification: result.classification,
        agents_called: result.agentsCalled,
        tokens_by_agent: result.tokensByAgent,
        total_tokens: result.totalTokens,
        total_ms: result.totalMs,
        system_prompt: systemPrompt,
        agent: {
          id: targetAgent.id,
          name: targetAgent.name,
          model: targetAgent.model,
          temperature: targetAgent.temperature
        }
      }
    }
  })
}
