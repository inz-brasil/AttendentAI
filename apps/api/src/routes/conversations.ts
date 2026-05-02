// conversations.ts — Expõe endpoints de histórico de conversas e mensagens
import { desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client'
import { conversations, leads, messages } from '../db/schema'

const phoneParamsSchema = z.object({ phone: z.string().min(1) })

/**
 * Registra endpoints de /api/conversations.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerConversationRoutes(app: FastifyInstance): Promise<void> {
  // Feed geral: últimas 50 mensagens de todos os leads (para a home)
  app.get('/api/conversations', async () => {
    const rows = await db
      .select()
      .from(messages)
      .orderBy(desc(messages.created_at))
      .limit(50)
    return { messages: rows }
  })

  // Histórico de mensagens de um lead específico (para o perfil)
  app.get('/api/conversations/:phone', async (request, reply) => {
    const { phone } = phoneParamsSchema.parse(request.params)
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.lead_phone, phone))
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
    await db.delete(messages)
    await db.delete(conversations)
    await db.update(leads).set({ total_messages: 0, last_message_at: null, updated_at: new Date() })
    request.log.warn('all conversation history deleted')
    return { success: true }
  })
}
