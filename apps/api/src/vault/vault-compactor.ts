// vault-compactor.ts — Compacta transcript real em memória semântica incremental do lead
import { and, asc, eq, gt } from 'drizzle-orm'
import OpenAI from 'openai'
import pino from 'pino'
import { z } from 'zod'
import {
  VAULT_COMPACTION_DELAY_MS,
  VAULT_COMPACTION_MODEL,
  VAULT_CRON_SCHEDULE,
  VAULT_MAX_SUMMARY_TOKENS
} from '../config/constants'
import { env } from '../config/env'
import { db } from '../db/client'
import { leadMemoryMeta, leads, messageEvents, type MessageEventSenderType } from '../db/schema'
import type { MessageEvent } from '../db/repositories/message-events.repository'
import { traceEmitter } from '../observability/trace-emitter'
import { VaultManager } from '../vault-manager/manager'

export interface LeadVault {
  name: string | null
  interests: string[]
  objections: string[]
  appointments: Array<{ date: string; status: 'scheduled' | 'cancelled' | 'completed'; notes: string }>
  conversation_summary: string
  last_intent: string | null
  lead_temperature: 'cold' | 'warm' | 'hot' | null
  compacted_from_event_id: string
  compacted_at: Date
  version: number
}

export interface VaultCompactionRequest {
  tenantId: string
  phone: string
  batchId?: string | null
}

export interface VaultCompactionResult {
  compacted: boolean
  phone: string
  eventCount: number
  compactedFromEventId: string | null
  estimatedTokens: number
}

export interface VaultCompletionAdapter {
  compact(input: VaultCompletionInput): Promise<VaultCompletionOutput>
}

export interface VaultCompletionInput {
  phone: string
  previousVault: LeadVault | null
  transcript: string
  maxSummaryTokens: number
}

export interface VaultCompletionOutput {
  vault: Omit<LeadVault, 'compacted_from_event_id' | 'compacted_at' | 'version'>
  usage: { promptTokens: number; completionTokens: number; totalTokens: number }
}

const log = pino({ name: 'vault-compactor' })
const vaultSchema = z.object({
  name: z.string().nullable(),
  interests: z.array(z.string()).default([]),
  objections: z.array(z.string()).default([]),
  appointments: z.array(z.object({
    date: z.string(),
    status: z.enum(['scheduled', 'cancelled', 'completed']).default('scheduled'),
    notes: z.string().default('')
  })).default([]),
  conversation_summary: z.string(),
  last_intent: z.string().nullable(),
  lead_temperature: z.preprocess((v) => {
    if (v === 'frio' || v === 'cold') return 'cold'
    if (v === 'morno' || v === 'warm') return 'warm'
    if (v === 'quente' || v === 'hot') return 'hot'
    return v
  }, z.enum(['cold', 'warm', 'hot']).nullable())
})

const storedVaultSchema = vaultSchema.extend({
  compacted_from_event_id: z.string(),
  compacted_at: z.coerce.date(),
  version: z.number().int().positive()
})

const VAULT_JSON_START = '<!-- attendentai:vault-json'
const VAULT_JSON_END = '-->'

/**
 * Adapter OpenAI que destila transcript em fatos estruturados do vault.
 */
export class OpenAIVaultCompletionAdapter implements VaultCompletionAdapter {
  constructor(
    private readonly client = new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL }),
    private readonly model = VAULT_COMPACTION_MODEL
  ) {}

  /**
   * Compacta o delta da conversa preservando o vault anterior como contexto.
   * @param input Vault anterior, transcript incremental e limite de resumo.
   * @returns Vault sem metadados internos e uso de tokens.
   */
  async compact(input: VaultCompletionInput): Promise<VaultCompletionOutput> {
    const startedAt = Date.now()
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0.1,
      max_tokens: Math.max(700, input.maxSummaryTokens * 2),
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: [
            'Você atualiza a memória semântica de um lead a partir de transcript real de WhatsApp.',
            'Use apenas fatos explícitos. Não copie o transcript. Não invente dados.',
            `conversation_summary deve ter no máximo ${input.maxSummaryTokens} tokens.`,
            'Retorne somente JSON válido com: name, interests, objections, appointments, conversation_summary, last_intent, lead_temperature.'
          ].join('\n')
        },
        {
          role: 'user',
          content: JSON.stringify({
            previous_vault: input.previousVault ? serializeVault(input.previousVault) : null,
            transcript_delta: input.transcript
          })
        }
      ]
    })

    const raw = response.choices[0]?.message.content ?? '{}'
    const parsedJson = parseJsonRecord(raw)
    const vault = vaultSchema.parse(parsedJson)
    const usage = {
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0
    }

    log.info({
      agent: 'vault-compactor',
      model: this.model,
      tokens_used: usage.totalTokens,
      duration_ms: Date.now() - startedAt,
      phone: input.phone
    }, 'vault compaction llm completed')

    return { vault, usage }
  }
}

/**
 * Serviço de compactação assíncrona do vault sem bloquear atendimento.
 */
export class VaultCompactor {
  private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private cronTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly vault = new VaultManager(env.VAULT_PATH),
    private readonly adapter: VaultCompletionAdapter = new OpenAIVaultCompletionAdapter()
  ) {}

  /**
   * Agenda compactação atrasada após um batch processado.
   * @param request Tenant, telefone e batch opcional.
   * @returns Nada.
   */
  scheduleAfterBatch(request: VaultCompactionRequest): void {
    const key = `${request.tenantId}:${request.phone}`
    const existing = this.pendingTimers.get(key)
    if (existing) {
      clearTimeout(existing)
    }

    const timer = setTimeout(() => {
      this.pendingTimers.delete(key)
      void this.compact(request).catch((error) => {
        log.warn({ err: error, tenant_id: request.tenantId, phone: request.phone }, 'delayed vault compaction failed')
      })
    }, VAULT_COMPACTION_DELAY_MS)
    timer.unref?.()
    this.pendingTimers.set(key, timer)
  }

  /**
   * Inicia cron diário para leads com eventos ainda não compactados.
   * @returns Nada.
   */
  startDailyCron(): void {
    if (this.cronTimer) {
      return
    }

    const schedule = parseDailyCron(VAULT_CRON_SCHEDULE)
    this.cronTimer = setInterval(() => {
      const now = new Date()
      if (now.getHours() === schedule.hour && now.getMinutes() === schedule.minute) {
        void this.compactAllPending().catch((error) => {
          log.warn({ err: error }, 'daily vault compaction failed')
        })
      }
    }, 60 * 1000)
    this.cronTimer.unref?.()
  }

  /**
   * Executa compactação incremental de um lead.
   * @param request Tenant, telefone e batch opcional.
   * @returns Resultado resumido da compactação.
   */
  async compact(request: VaultCompactionRequest): Promise<VaultCompactionResult> {
    const timer = traceEmitter.startTimer()
    const previous = await this.readStoredVault(request.phone)
    const events = await this.loadUncompactedEvents(request.tenantId, request.phone, previous?.compacted_from_event_id ?? null)

    if (events.length === 0) {
      return {
        compacted: false,
        phone: request.phone,
        eventCount: 0,
        compactedFromEventId: previous?.compacted_from_event_id ?? null,
        estimatedTokens: 0
      }
    }

    const lastEvent = getLastEvent(events)
    const transcript = formatTranscript(events)
    const estimatedTokens = estimateTokens(transcript)
    const output = await this.adapter.compact({
      phone: request.phone,
      previousVault: previous,
      transcript,
      maxSummaryTokens: VAULT_MAX_SUMMARY_TOKENS
    })
    const nextVault: LeadVault = {
      ...output.vault,
      compacted_from_event_id: lastEvent.id,
      compacted_at: new Date(),
      version: (previous?.version ?? 0) + 1
    }

    await this.writeVault(request.phone, nextVault)
    await this.upsertMemoryMeta(request.phone, events.length)
    await traceEmitter.emit('vault_compacted', {
      tenant_id: request.tenantId,
      batch_id: request.batchId ?? null,
      phone: request.phone,
      data: {
        event_count: events.length,
        compacted_from_event_id: lastEvent.id,
        estimated_tokens: estimatedTokens,
        model: VAULT_COMPACTION_MODEL,
        prompt_tokens: output.usage.promptTokens,
        completion_tokens: output.usage.completionTokens,
        total_tokens: output.usage.totalTokens,
        vault_version: nextVault.version
      }
    }, timer.elapsed())

    return {
      compacted: true,
      phone: request.phone,
      eventCount: events.length,
      compactedFromEventId: lastEvent.id,
      estimatedTokens
    }
  }

  /**
   * Compacta todos os pares tenant/telefone com histórico no transcript.
   * @returns Quantidade de leads compactados.
   */
  async compactAllPending(): Promise<number> {
    const pairs = await db
      .selectDistinct({ tenantId: messageEvents.tenant_id, phone: messageEvents.lead_phone })
      .from(messageEvents)

    let compacted = 0
    for (const pair of pairs) {
      const result = await this.compact({ tenantId: pair.tenantId, phone: pair.phone })
      if (result.compacted) {
        compacted += 1
      }
    }

    return compacted
  }

  private async readStoredVault(phone: string): Promise<LeadVault | null> {
    const content = await this.vault.read(phone, 'memoria.md')
    const rawJson = extractStoredJson(content)
    if (!rawJson) {
      return null
    }

    try {
      return storedVaultSchema.parse(parseJsonRecord(rawJson))
    } catch (error) {
      log.warn({ err: error, phone }, 'failed to parse stored semantic vault')
      return null
    }
  }

  private async loadUncompactedEvents(tenantId: string, phone: string, previousEventId: string | null): Promise<MessageEvent[]> {
    const previousEvent = previousEventId
      ? await this.findEventById(tenantId, phone, previousEventId)
      : null

    const baseFilter = and(eq(messageEvents.tenant_id, tenantId), eq(messageEvents.lead_phone, phone))
    const incrementalFilter = previousEvent
      ? and(baseFilter, gt(messageEvents.id, previousEvent.id))
      : baseFilter

    return db
      .select()
      .from(messageEvents)
      .where(incrementalFilter)
      .orderBy(asc(messageEvents.id))
      .limit(100)
  }

  private async findEventById(tenantId: string, phone: string, eventId: string): Promise<MessageEvent | null> {
    const [event] = await db
      .select()
      .from(messageEvents)
      .where(and(
        eq(messageEvents.tenant_id, tenantId),
        eq(messageEvents.lead_phone, phone),
        eq(messageEvents.id, eventId)
      ))
      .limit(1)

    return event ?? null
  }

  private async writeVault(phone: string, vault: LeadVault): Promise<void> {
    await this.vault.write(phone, 'memoria.md', renderVaultMarkdown(phone, vault))
  }

  private async upsertMemoryMeta(phone: string, eventCount: number): Promise<void> {
    const [lead] = await db.select({ phone: leads.phone }).from(leads).where(eq(leads.phone, phone)).limit(1)
    if (!lead) {
      return
    }

    const [meta] = await db.select().from(leadMemoryMeta).where(eq(leadMemoryMeta.phone, phone)).limit(1)
    if (!meta) {
      await db.insert(leadMemoryMeta).values({
        phone,
        last_compaction_at: new Date(),
        total_compactions: 1,
        total_messages_summarized: eventCount
      })
      return
    }

    await db
      .update(leadMemoryMeta)
      .set({
        last_compaction_at: new Date(),
        total_compactions: (meta.total_compactions ?? 0) + 1,
        total_messages_summarized: (meta.total_messages_summarized ?? 0) + eventCount
      })
      .where(eq(leadMemoryMeta.phone, phone))
  }
}

export const vaultCompactor = new VaultCompactor()

function formatTranscript(events: MessageEvent[]): string {
  return events.map((event) => {
    const role = formatRole(event.sender_type, event.from_me)
    const timestamp = new Date(event.whatsapp_timestamp * 1000).toISOString()
    const quoted = event.quoted_content ? `\nMensagem marcada: ${event.quoted_content}` : ''
    return `[${timestamp}] ${role}: ${event.content}${quoted}`
  }).join('\n')
}

function formatRole(senderType: MessageEventSenderType, fromMe: boolean): string {
  if (senderType === 'customer') return 'Cliente'
  if (senderType === 'human_agent') return 'Humano'
  if (senderType === 'internal_assistant') return 'Assistente interno'
  if (senderType === 'bot') return 'Bot'
  return fromMe ? 'Atendente' : 'Usuário'
}

function renderVaultMarkdown(phone: string, vault: LeadVault): string {
  const stored = JSON.stringify(serializeVault(vault), null, 2)
  return `${VAULT_JSON_START}
${stored}
${VAULT_JSON_END}

# Vault semântico — ${phone}

## Resumo da conversa
${vault.conversation_summary || 'Sem resumo consolidado ainda.'}

## Dados estruturados
- Nome: ${vault.name ?? '(não informado)'}
- Temperatura: ${vault.lead_temperature ?? '(não definida)'}
- Última intenção: ${vault.last_intent ?? '(não definida)'}
- Compactado até o evento: ${vault.compacted_from_event_id}
- Atualizado em: ${vault.compacted_at.toISOString()}
- Versão: ${vault.version}

## Interesses
${formatList(vault.interests)}

## Objeções
${formatList(vault.objections)}

## Agendamentos
${vault.appointments.length > 0
  ? vault.appointments.map((item) => `- ${item.date} — ${item.status}: ${item.notes}`).join('\n')
  : '- (nenhum agendamento confirmado)'}
`
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.map((value) => `- ${value}`).join('\n') : '- (não informado)'
}

function extractStoredJson(content: string): string | null {
  const start = content.indexOf(VAULT_JSON_START)
  if (start < 0) {
    return null
  }

  const jsonStart = start + VAULT_JSON_START.length
  const end = content.indexOf(VAULT_JSON_END, jsonStart)
  if (end < 0) {
    return null
  }

  return content.slice(jsonStart, end).trim()
}

function parseJsonRecord(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected JSON object')
  }

  return parsed
}

function serializeVault(vault: LeadVault): Record<string, unknown> {
  return {
    name: vault.name,
    interests: vault.interests,
    objections: vault.objections,
    appointments: vault.appointments,
    conversation_summary: vault.conversation_summary,
    last_intent: vault.last_intent,
    lead_temperature: vault.lead_temperature,
    compacted_from_event_id: vault.compacted_from_event_id,
    compacted_at: vault.compacted_at.toISOString(),
    version: vault.version
  }
}

function getLastEvent(events: MessageEvent[]): MessageEvent {
  const event = events.at(-1)
  if (!event) {
    throw new Error('Cannot compact empty event list')
  }

  return event
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4)
}

function parseDailyCron(value: string): { minute: number; hour: number } {
  const [minuteRaw, hourRaw] = value.trim().split(/\s+/)
  const minute = Number(minuteRaw)
  const hour = Number(hourRaw)
  if (!Number.isInteger(minute) || !Number.isInteger(hour) || minute < 0 || minute > 59 || hour < 0 || hour > 23) {
    return { minute: 0, hour: 3 }
  }

  return { minute, hour }
}
