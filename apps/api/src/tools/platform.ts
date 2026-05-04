// platform.ts — Tools internas para consultar dados operacionais do AttendentAI
import { desc, gte, like } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { leads, messages } from '../db/schema'

const leadLookupSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(5)
})

/**
 * Consulta métricas básicas de atendimento por período.
 * @param rawInput Argumentos opcionais da tool.
 * @returns Contagens de leads e mensagens.
 */
export async function executePlatformStatsTool(rawInput: unknown): Promise<Record<string, unknown>> {
  void rawInput
  const now = new Date()
  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - 7)
  const monthStart = new Date(now)
  monthStart.setDate(now.getDate() - 30)

  const [allLeads, dayMessages, weekMessages, monthMessages] = await Promise.all([
    db.select().from(leads),
    db.select().from(messages).where(gte(messages.created_at, dayStart)),
    db.select().from(messages).where(gte(messages.created_at, weekStart)),
    db.select().from(messages).where(gte(messages.created_at, monthStart))
  ])

  return {
    total_leads: allLeads.length,
    active_leads: allLeads.filter((lead) => lead.status === 'ativo' || lead.status === 'lead_quente').length,
    messages_today: dayMessages.length,
    messages_last_7_days: weekMessages.length,
    messages_last_30_days: monthMessages.length
  }
}

/**
 * Busca leads por telefone ou nome e devolve dados resumidos.
 * @param rawInput Query textual e limite.
 * @returns Leads encontrados.
 */
export async function executeLeadLookupTool(rawInput: unknown): Promise<Record<string, unknown>> {
  const input = leadLookupSchema.parse(rawInput)
  const rows = await db
    .select()
    .from(leads)
    .where(input.query.match(/^\d+$/) ? like(leads.phone, `%${input.query}%`) : like(leads.name, `%${input.query}%`))
    .orderBy(desc(leads.updated_at))
    .limit(input.limit)

  return {
    leads: rows.map((lead) => ({
      phone: lead.phone,
      name: lead.name,
      city: lead.city,
      status: lead.status,
      tags: lead.tags,
      total_messages: lead.total_messages,
      last_message_at: lead.last_message_at
    }))
  }
}
