// summarizer.ts — Resume mensagens antigas e compacta o histórico do lead
import { asc, desc, eq, inArray } from 'drizzle-orm'
import OpenAI from 'openai'
import pino from 'pino'
import { env } from '../config/env'
import { db } from '../db/client'
import { messages, tokenUsage } from '../db/schema'
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

export class Summarizer {
  private readonly vault: VaultManager

  constructor(vault = new VaultManager(env.VAULT_PATH)) {
    this.vault = vault
  }

  /**
   * Verifica se o lead passou do limite de mensagens no banco.
   * @param phone Telefone do lead.
   * @returns True se deve sumarizar.
   */
  async shouldSummarize(phone: string): Promise<boolean> {
    const rows = await db.select({ id: messages.id }).from(messages).where(eq(messages.lead_phone, phone))
    return rows.length > 20
  }

  /**
   * Resume mensagens antigas, salva no vault e mantém só as últimas 10.
   * @param phone Telefone do lead.
   * @returns Nada.
   */
  async summarize(phone: string): Promise<void> {
    const latestMessages = await db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.lead_phone, phone))
      .orderBy(desc(messages.created_at))
      .limit(10)

    const latestIds = new Set(latestMessages.map((message) => message.id))
    const allMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.lead_phone, phone))
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
    log.info({ phone, summarized_messages: oldMessages.length, tokens_used: tokensUsed, duration_ms: durationMs })
  }
}
