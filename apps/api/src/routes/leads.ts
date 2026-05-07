// leads.ts — Expõe endpoints CRUD básicos para leads
import { and, count, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { env } from '../config/env'
import { db } from '../db/client'
import { conversations, leadMemoryMeta, leads, messageEvents, messages, settings, type LeadStatus } from '../db/schema'
import { VaultManager } from '../vault-manager/manager'

const leadParamsSchema = z.object({ phone: z.string().min(1) })
const transcriptQuerySchema = z.object({
  tenant_id: z.string().min(1).default('default'),
  limit: z.coerce.number().int().min(1).max(200).default(50)
})
const leadBodySchema = z.object({
  phone: z.string().min(1),
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  status: z.enum(['novo', 'ativo', 'lead_quente', 'convertido', 'inativo']).optional(),
  tags: z.array(z.string()).optional(),
  custom_data: z.record(z.unknown()).optional(),
  vault_path: z.string().nullable().optional()
})
const inactiveAfterMs = 48 * 60 * 60 * 1000

function deriveVisibleStatus(status: LeadStatus | null, lastMessageAt: Date | null): LeadStatus {
  if (status === 'convertido' || status === 'lead_quente') {
    return status
  }

  if (lastMessageAt && Date.now() - lastMessageAt.getTime() > inactiveAfterMs) {
    return 'inativo'
  }

  return status ?? 'novo'
}

function parseContactList(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    }
  } catch {
    // Também aceita lista simples por vírgula, linha ou ponto e vírgula.
  }
  return trimmed.split(/[\n,;]/).map((item) => item.trim()).filter(Boolean)
}

async function loadAdminPhones(): Promise<Set<string>> {
  const [setting] = await db.select().from(settings).where(eq(settings.key, 'internal_assistant_contacts')).limit(1)
  return new Set(parseContactList(setting?.value ?? ''))
}

/**
 * Registra endpoints de /api/leads.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerLeadRoutes(app: FastifyInstance): Promise<void> {
  const vault = new VaultManager(env.VAULT_PATH)

  app.get('/api/leads', async () => {
    const rows = await db.select().from(leads)
    const adminPhones = await loadAdminPhones()
    return rows.map((lead) => ({
      ...lead,
      status: deriveVisibleStatus(lead.status, lead.last_message_at),
      tags: adminPhones.has(lead.phone) ? [...new Set([...(lead.tags ?? []), 'admin'])] : lead.tags
    }))
  })

  app.get('/api/leads/:phone/memory-stats', async (request) => {
    const { phone } = leadParamsSchema.parse(request.params)
    const [messageCount] = await db
      .select({ total_messages: count() })
      .from(messages)
      .where(eq(messages.lead_phone, phone))
    const [meta] = await db.select().from(leadMemoryMeta).where(eq(leadMemoryMeta.phone, phone)).limit(1)
    const vaultFiles = await vault.listFiles(phone)

    return {
      total_messages: messageCount?.total_messages ?? 0,
      last_compaction_at: meta?.last_compaction_at ?? null,
      total_compactions: meta?.total_compactions ?? 0,
      vault_files: vaultFiles
    }
  })

  app.get('/api/leads/:phone/transcript', async (request) => {
    const { phone } = leadParamsSchema.parse(request.params)
    const query = transcriptQuerySchema.parse(request.query)
    const rows = await db
      .select()
      .from(messageEvents)
      .where(and(eq(messageEvents.tenant_id, query.tenant_id), eq(messageEvents.lead_phone, phone)))
      .orderBy(desc(messageEvents.whatsapp_timestamp), desc(messageEvents.created_at))
      .limit(query.limit)

    return {
      tenant_id: query.tenant_id,
      phone,
      messages: rows.reverse()
    }
  })

  app.get('/api/leads/:phone/vault', async (request) => {
    const { phone } = leadParamsSchema.parse(request.params)
    const [memoria, historico, notas] = await Promise.all([
      vault.read(phone, 'memoria.md'),
      vault.read(phone, 'historico.md'),
      vault.read(phone, 'notas.md')
    ])

    return {
      phone,
      files: {
        'memoria.md': memoria,
        'historico.md': historico,
        'notas.md': notas
      }
    }
  })

  app.get('/api/leads/:phone', async (request, reply) => {
    const params = leadParamsSchema.parse(request.params)
    const [lead] = await db.select().from(leads).where(eq(leads.phone, params.phone)).limit(1)
    return lead
      ? { ...lead, status: deriveVisibleStatus(lead.status, lead.last_message_at) }
      : reply.code(404).send({ error: 'Lead not found', code: 'LEAD_NOT_FOUND' })
  })

  app.post('/api/leads', async (request, reply) => {
    const body = leadBodySchema.parse(request.body)
    await db.insert(leads).values(body)
    return reply.code(201).send(body)
  })

  app.put('/api/leads/:phone', async (request) => {
    const params = leadParamsSchema.parse(request.params)
    const body = leadBodySchema.omit({ phone: true }).partial().parse(request.body)
    await db.update(leads).set({ ...body, updated_at: new Date() }).where(eq(leads.phone, params.phone))
    const [lead] = await db.select().from(leads).where(eq(leads.phone, params.phone)).limit(1)
    return lead
  })

  // Apaga apenas o histórico de mensagens — mantém perfil e vault (notas/memoria)
  app.delete('/api/leads/:phone/history', async (request) => {
    const { phone } = leadParamsSchema.parse(request.params)
    await db.delete(messages).where(eq(messages.lead_phone, phone))
    await db.delete(conversations).where(eq(conversations.lead_phone, phone))
    await db
      .update(leadMemoryMeta)
      .set({ last_compaction_at: null, total_compactions: 0, total_messages_summarized: 0 })
      .where(eq(leadMemoryMeta.phone, phone))
    await db
      .update(leads)
      .set({ total_messages: 0, last_message_at: null, updated_at: new Date() })
      .where(eq(leads.phone, phone))
    // Limpa historico.md mas preserva outros arquivos do vault
    try {
      await vault.deleteHistory(phone)
    } catch (error) {
      // Vault pode não existir — não bloqueia a resposta, mas registra para auditoria.
      request.log.warn({ err: error, phone }, 'lead vault history deletion failed')
    }
    request.log.info({ phone }, 'lead history deleted')
    return { success: true }
  })

  // Remove lead completamente, incluindo mensagens e pasta do vault
  app.delete('/api/leads/:phone', async (request) => {
    const { phone } = leadParamsSchema.parse(request.params)
    await db.delete(messages).where(eq(messages.lead_phone, phone))
    await db.delete(conversations).where(eq(conversations.lead_phone, phone))
    await db.delete(leadMemoryMeta).where(eq(leadMemoryMeta.phone, phone))
    await db.delete(leads).where(eq(leads.phone, phone))
    try {
      await vault.delete(phone)
    } catch (error) {
      // Vault pode não existir — não bloqueia a resposta, mas registra para auditoria.
      request.log.warn({ err: error, phone }, 'lead vault deletion failed')
    }
    request.log.info({ phone }, 'lead deleted')
    return { success: true }
  })
}
