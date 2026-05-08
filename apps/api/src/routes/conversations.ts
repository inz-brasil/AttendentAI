// conversations.ts — Expõe endpoints de histórico de conversas e mensagens
import { and, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client'
import { conversations, leads, messages } from '../db/schema'

const phoneParamsSchema = z.object({ phone: z.string().min(1) })
const tenantQuerySchema = z.object({ tenant_id: z.string().min(1).default('default') })

/**
 * Registra endpoints de /api/conversations.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerConversationRoutes(app: FastifyInstance): Promise<void> {
  // Feed geral: últimas 50 mensagens de todos os leads (para a home)
  app.get('/api/conversations', async (request) => {
    const query = tenantQuerySchema.parse(request.query)
    const rows = await db
      .select({
        id: messages.id,
        conversation_id: messages.conversation_id,
        lead_phone: messages.lead_phone,
        lead_name: leads.name,
        role: messages.role,
        content: messages.content,
        message_type: messages.message_type,
        audio_requested: messages.audio_requested,
        intent: messages.intent,
        tokens_used: messages.tokens_used,
        agent_used: messages.agent_used,
        processing_ms: messages.processing_ms,
        created_at: messages.created_at
      })
      .from(messages)
      .leftJoin(leads, and(eq(messages.lead_phone, leads.phone), eq(leads.tenant_id, query.tenant_id)))
      .where(eq(messages.tenant_id, query.tenant_id))
      .orderBy(desc(messages.created_at))
      .limit(50)
    return { messages: rows }
  })

  // Histórico de mensagens de um lead específico (para o perfil)
  app.get('/api/conversations/:phone', async (request, reply) => {
    const { phone } = phoneParamsSchema.parse(request.params)
    const query = tenantQuerySchema.parse(request.query)
    const rows = await db
      .select()
      .from(messages)
      .where(and(eq(messages.tenant_id, query.tenant_id), eq(messages.lead_phone, phone)))
      .orderBy(desc(messages.created_at))
      .limit(100)

    if (rows.length === 0) {
      // Retorna lista vazia em vez de 404 — lead pode existir sem mensagens
      return { messages: [] }
    }

    // Retorna em ordem cronológica para a timeline
    return { messages: rows.reverse() }
  })

  app.delete('/api/conversations', async (request) => {
    const query = tenantQuerySchema.parse(request.query)
    await db.delete(messages).where(eq(messages.tenant_id, query.tenant_id))
    await db.delete(conversations).where(eq(conversations.tenant_id, query.tenant_id))
    await db
      .update(leads)
      .set({ total_messages: 0, last_message_at: null, updated_at: new Date() })
      .where(eq(leads.tenant_id, query.tenant_id))
    request.log.warn({ tenant_id: query.tenant_id }, 'all conversation history deleted for tenant')
    return { success: true }
  })
}
