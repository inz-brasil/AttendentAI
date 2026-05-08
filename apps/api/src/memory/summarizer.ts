// summarizer.ts — Resume mensagens antigas e compacta o histórico do lead
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import OpenAI from 'openai'
import pino from 'pino'
import { env } from '../config/env'
import { MEMORY_CONFIG } from '../config/memory'
import { db } from '../db/client'
import { leadMemoryMeta, messages, tokenUsage } from '../db/schema'
import { VaultManager } from '../vault-manager/manager'

const summarizerPrompt =
  'Resuma esta conversa em tópicos objetivos: o que o cliente discutiu, suas dúvidas, objeções levantadas, interesse demonstrado e status atual. Use bullet points curtos.'

const log = pino({ name: 'attendentai-summarizer' })

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  baseURL: env.OPENAI_BASE_URL
})

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

async function loadMemoryMeta(phone: string, tenantId = 'default') {
  const [meta] = await db
    .select()
    .from(leadMemoryMeta)
    .where(and(eq(leadMemoryMeta.tenant_id, tenantId), eq(leadMemoryMeta.phone, phone)))
    .limit(1)
  return meta
}

async function ensureMemoryMeta(phone: string, tenantId = 'default'): Promise<void> {
  const meta = await loadMemoryMeta(phone, tenantId)
  if (!meta) {
    await db.insert(leadMemoryMeta).values({ phone, tenant_id: tenantId })
  }
}

function canCompact(lastCompactionAt: Date | null, now: Date): boolean {
  if (!lastCompactionAt) {
    return true
  }

  return now.getTime() - lastCompactionAt.getTime() >= MEMORY_CONFIG.MIN_COMPACTION_INTERVAL_MS
}

function compactionMessageLimit(): number {
  return MEMORY_CONFIG.COMPACTION_THRESHOLD + MEMORY_CONFIG.MESSAGES_PRESERVED_AFTER_COMPACTION
}

export class Summarizer {
  private readonly vault: VaultManager

  constructor(vault = new VaultManager(env.VAULT_PATH)) {
    this.vault = vault
  }

  /**
   * Verifica se o lead passou do limite de mensagens no banco.
   * @param phone Telefone do lead.
   * @param tenantId Tenant isolado (default: 'default').
   * @returns True se deve sumarizar.
   */
  async shouldSummarize(phone: string, tenantId = 'default'): Promise<boolean> {
    await ensureMemoryMeta(phone, tenantId)
    const meta = await loadMemoryMeta(phone, tenantId)
    if (!canCompact(meta?.last_compaction_at ?? null, new Date())) {
      log.info({ phone }, 'memory compaction skipped by interval')
      return false
    }

    const rows = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.tenant_id, tenantId), eq(messages.lead_phone, phone)))
    return rows.length >= compactionMessageLimit()
  }

  /**
   * Resume mensagens antigas, salva no vault e mantém só as últimas 10.
   * @param phone Telefone do lead.
   * @param tenantId Tenant isolado (default: 'default').
   * @returns Nada.
   */
  async summarize(phone: string, tenantId = 'default'): Promise<void> {
    await ensureMemoryMeta(phone, tenantId)
    const now = new Date()
    const meta = await loadMemoryMeta(phone, tenantId)
    if (!canCompact(meta?.last_compaction_at ?? null, now)) {
      log.info({ phone }, 'memory compaction skipped by interval')
      return
    }

    const latestMessages = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.tenant_id, tenantId), eq(messages.lead_phone, phone)))
      .orderBy(desc(messages.created_at))
      .limit(MEMORY_CONFIG.MESSAGES_PRESERVED_AFTER_COMPACTION)

    const latestIds = new Set(latestMessages.map((message) => message.id))
    const allMessages = await db
      .select()
      .from(messages)
      .where(and(eq(messages.tenant_id, tenantId), eq(messages.lead_phone, phone)))
      .orderBy(asc(messages.created_at))

    const oldMessages = allMessages.filter((message) => !latestIds.has(message.id))
    if (oldMessages.length === 0) {
      return
    }

    const content = oldMessages
      .map((message) => {
        const timestamp = message.created_at?.toISOString() ?? 'sem data'
        return `[${timestamp}] ${message.role ?? 'unknown'}: ${message.content ?? ''}`
      })
      .join('\n')

    const start = Date.now()
    const response = await openai.chat.completions.create({
      model: env.MODEL_SUMMARIZER,
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        { role: 'system', content: summarizerPrompt },
        { role: 'user', content }
      ]
    })

    const summary = response.choices[0]?.message.content?.trim() ?? ''
    const tokensUsed = response.usage?.total_tokens ?? 0
    const durationMs = Date.now() - start

    await db.insert(tokenUsage).values({
      tenant_id: tenantId,
      date: today(),
      model: env.MODEL_SUMMARIZER,
      agent_type: 'summarizer',
      prompt_tokens: response.usage?.prompt_tokens ?? 0,
      completion_tokens: response.usage?.completion_tokens ?? 0,
      total_tokens: tokensUsed,
      estimated_cost_usd: 0
    })

    if (summary.length > 0) {
      await this.vault.append(phone, 'historico.md', `## Resumo automático — ${new Date().toISOString()}\n\n${summary}`)
    }

    await db.delete(messages).where(inArray(messages.id, oldMessages.map((message) => message.id)))
    await db
      .update(leadMemoryMeta)
      .set({
        last_compaction_at: now,
        total_compactions: (meta?.total_compactions ?? 0) + 1,
        total_messages_summarized: (meta?.total_messages_summarized ?? 0) + oldMessages.length
      })
      .where(and(eq(leadMemoryMeta.tenant_id, tenantId), eq(leadMemoryMeta.phone, phone)))

    log.info({ phone, summarized_messages: oldMessages.length, tokens_used: tokensUsed, duration_ms: durationMs })
  }
}
