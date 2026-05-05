// platform.ts — Tools internas para consultar dados operacionais do AttendentAI
import { desc, eq, gte, like } from 'drizzle-orm'
import { z } from 'zod'
import { env } from '../config/env'
import { db } from '../db/client'
import { leads, messages, settings } from '../db/schema'
import { VaultManager } from '../vault-manager/manager'

const leadLookupSchema = z.object({
  query: z.string().optional(),
  limit: z.number().int().min(1).max(20).default(5),
  include_vault: z.boolean().default(false)
})

const vaultReadSchema = z.object({
  phone: z.string().min(1),
  filename: z.enum(['memoria.md', 'historico.md', 'notas.md']).default('memoria.md'),
  max_chars: z.number().int().min(200).max(6000).default(2500)
})

const platformStatsSchema = z.object({
  period: z.enum(['today', 'last_24_hours', 'last_7_days', 'last_30_days']).default('today')
})

/**
 * Consulta métricas auditáveis de atendimento por período.
 * @param rawInput Argumentos opcionais da tool.
 * @returns Contagens de leads, mensagens e atendimentos únicos.
 */
export async function executePlatformStatsTool(rawInput: unknown): Promise<Record<string, unknown>> {
  const input = platformStatsSchema.parse(rawInput ?? {})
  const now = new Date()
  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  const start = resolvePeriodStart(input.period, now, dayStart)
  const internalContacts = await loadInternalContactSet()

  const [allLeads, periodMessages] = await Promise.all([
    db.select().from(leads),
    db.select().from(messages).where(gte(messages.created_at, start))
  ])
  const externalMessages = periodMessages.filter((message) => isExternalLeadPhone(message.lead_phone, internalContacts))
  const externalUserMessages = externalMessages.filter((message) => message.role === 'user')
  const attendedPhones = new Set(externalUserMessages.map((message) => message.lead_phone).filter(Boolean))
  const recentLeads = allLeads
    .filter((lead) => attendedPhones.has(lead.phone))
    .sort((a, b) => (b.last_message_at?.getTime() ?? 0) - (a.last_message_at?.getTime() ?? 0))
    .slice(0, 10)

  return {
    period: input.period,
    period_start: start.toISOString(),
    period_end: now.toISOString(),
    total_leads: allLeads.length,
    external_leads_total: allLeads.filter((lead) => isExternalLeadPhone(lead.phone, internalContacts)).length,
    active_external_leads: allLeads
      .filter((lead) => isExternalLeadPhone(lead.phone, internalContacts))
      .filter((lead) => lead.status === 'ativo' || lead.status === 'lead_quente').length,
    atendimentos_unicos: attendedPhones.size,
    mensagens_de_clientes: externalUserMessages.length,
    mensagens_totais_periodo: externalMessages.length,
    excluded_internal_contacts: internalContacts.size,
    regra_contagem:
      'atendimentos_unicos conta telefones externos distintos com pelo menos uma mensagem de cliente no período; exclui assistente interno, playground e probes técnicos.',
    leads_atendidos: recentLeads.map((lead) => ({
      phone: lead.phone,
      name: lead.name,
      status: lead.status,
      total_messages: lead.total_messages,
      last_message_at: lead.last_message_at
    }))
  }
}

/**
 * Busca leads por telefone ou nome e opcionalmente inclui memória do vault.
 * @param rawInput Query textual e limite.
 * @returns Leads encontrados.
 */
export async function executeLeadLookupTool(rawInput: unknown): Promise<Record<string, unknown>> {
  const input = leadLookupSchema.parse(rawInput)
  const query = input.query?.trim()
  const rows = query
    ? await db
        .select()
        .from(leads)
        .where(query.match(/^\d+$/) ? like(leads.phone, `%${query}%`) : like(leads.name, `%${query}%`))
        .orderBy(desc(leads.updated_at))
        .limit(input.limit)
    : await db.select().from(leads).orderBy(desc(leads.updated_at)).limit(input.limit)

  return {
    leads: await Promise.all(rows.map(async (lead) => ({
      phone: lead.phone,
      name: lead.name,
      city: lead.city,
      status: lead.status,
      tags: lead.tags,
      total_messages: lead.total_messages,
      last_message_at: lead.last_message_at,
      vault: input.include_vault ? await loadLeadVaultSummary(lead.phone) : undefined
    })))
  }
}

/**
 * Lê um arquivo permitido do vault de um lead.
 * @param rawInput Telefone, arquivo e limite de caracteres.
 * @returns Conteúdo truncado do arquivo solicitado.
 */
export async function executeVaultReadTool(rawInput: unknown): Promise<Record<string, unknown>> {
  const input = vaultReadSchema.parse(rawInput)
  const vault = new VaultManager(env.VAULT_PATH)
  const content = await vault.read(input.phone, input.filename)
  return {
    phone: input.phone,
    filename: input.filename,
    chars: content.length,
    truncated: content.length > input.max_chars,
    content: content.slice(0, input.max_chars)
  }
}

function resolvePeriodStart(period: z.infer<typeof platformStatsSchema>['period'], now: Date, dayStart: Date): Date {
  if (period === 'today') return dayStart
  const start = new Date(now)
  if (period === 'last_24_hours') start.setHours(now.getHours() - 24)
  if (period === 'last_7_days') start.setDate(now.getDate() - 7)
  if (period === 'last_30_days') start.setDate(now.getDate() - 30)
  return start
}

async function loadInternalContactSet(): Promise<Set<string>> {
  const [setting] = await db.select().from(settings).where(eq(settings.key, 'internal_assistant_contacts')).limit(1)
  return new Set(parseContactList(setting?.value ?? ''))
}

function parseContactList(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    }
  } catch {
    // A configuração também aceita lista por vírgula, ponto e vírgula ou linha.
  }

  return trimmed.split(/[\n,;]/).map((item) => item.trim()).filter(Boolean)
}

function isExternalLeadPhone(phone: string | null, internalContacts: Set<string>): phone is string {
  if (!phone) return false
  if (phone.startsWith('playground_') || phone.startsWith('vps_')) return false
  return !internalContacts.has(phone)
}

async function loadLeadVaultSummary(phone: string): Promise<Record<string, unknown>> {
  const vault = new VaultManager(env.VAULT_PATH)
  const [memory, notes] = await Promise.all([
    vault.read(phone, 'memoria.md'),
    vault.read(phone, 'notas.md')
  ])

  return {
    memoria_preview: memory.slice(0, 1200),
    notas_preview: notes.slice(0, 1200)
  }
}
