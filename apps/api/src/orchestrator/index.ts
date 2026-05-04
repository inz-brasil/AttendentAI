// index.ts — QueryEngine orquestra agentes com contexto isolado e resposta final
import { eq } from 'drizzle-orm'
import pino from 'pino'
import { ClassifierAgent } from '../agents/classifier'
import { IdentifierAgent, type LeadFieldsToUpdate } from '../agents/identifier'
import { InternalAssistantAgent } from '../agents/internal-assistant'
import { MemoryAgent } from '../agents/memory-agent'
import { ResponderAgent } from '../agents/responder'
import { db } from '../db/client'
import { agents, leads, settings } from '../db/schema'
import {
  getOrCreateLead,
  loadMemory,
  saveMessage,
  updateLead,
  type ContactInfo,
  type LeadUpdateInput
} from '../memory/persistent'
import { markMessageProcessed } from '../monitoring/status'
import { recordTrace, truncateTraceText } from '../monitoring/trace-recorder'
import { acquirePhoneLock, releasePhoneLock, waitForPhoneLockRelease } from '../queue/redis'
import { broadcast } from '../websocket/server'
import { PromptBuilder } from './prompt-builder'

export interface WebhookPayload {
  phone: string
  name: string
  message: string
  message_type: 'text' | 'audio' | 'image'
  timestamp: number
  session_id?: string | undefined
  current_time?: string | undefined
  timezone?: string | undefined
  contact_info?: ContactInfo | undefined
}

export interface WebhookResponse {
  success: boolean
  message: string
  audio_requested: boolean
  metadata: {
    lead_id: string
    agent_used: string
    tokens_used: number
    processing_ms: number
  }
}

export interface QueryEngineOptions {
  skipLock?: boolean
}

export class PhoneLockedError extends Error {
  constructor(phone: string) {
    super(`Mensagem anterior ainda processando para ${phone}`)
    this.name = 'PhoneLockedError'
  }
}

const log = pino({ name: 'attendentai-orchestrator' })

export class QueryEngine {
  private readonly classifier = new ClassifierAgent()
  private readonly identifier = new IdentifierAgent()
  private readonly internalAssistant = new InternalAssistantAgent()
  private readonly memoryAgent = new MemoryAgent()
  private readonly promptBuilder = new PromptBuilder()
  private readonly responder = new ResponderAgent()

  /**
   * Processa um payload de webhook e retorna a resposta final.
   * @param payload Dados recebidos do n8n.
   * @returns Resposta para o webhook.
   */
  async process(payload: WebhookPayload, options: QueryEngineOptions = {}): Promise<WebhookResponse> {
    if (options.skipLock) {
      return this.processUnlocked(payload)
    }

    const token = crypto.randomUUID()
    const acquired = await acquirePhoneLock(payload.phone, token, 30)
    if (!acquired) {
      const released = await waitForPhoneLockRelease(payload.phone, 10000)
      if (!released) {
        throw new PhoneLockedError(payload.phone)
      }

      const acquiredAfterWait = await acquirePhoneLock(payload.phone, token, 30)
      if (!acquiredAfterWait) {
        throw new PhoneLockedError(payload.phone)
      }
    }

    try {
      return await this.processUnlocked(payload)
    } finally {
      await releasePhoneLock(payload.phone, token)
    }
  }

  private async processUnlocked(payload: WebhookPayload): Promise<WebhookResponse> {
    const startedAt = Date.now()
    await recordTrace({
      phone: payload.phone,
      agent: 'orchestrator',
      eventType: 'pipeline_start',
      title: 'Webhook recebido',
      data: {
        message_type: payload.message_type,
        message_preview: truncateTraceText(payload.message, 300),
        name: payload.name,
        session_id: payload.session_id,
        remoteJid: this.getStringContactField(payload.contact_info, 'remoteJid')
      }
    })
    const runtimeContext = this.resolveRuntimeContext(payload)
    if (await this.isInternalAssistantContact(payload)) {
      return this.processInternalAssistant(payload, runtimeContext, startedAt)
    }

    const lead = await getOrCreateLead(payload.phone, payload.name, payload.contact_info)
    const memory = await loadMemory(payload.phone)
    await recordTrace({
      phone: payload.phone,
      agent: 'memory',
      eventType: 'memory_loaded',
      title: 'Memória carregada',
      data: {
        lead_found: Boolean(lead),
        lead_name: lead?.name ?? null,
        recent_messages: memory.recent_messages.length,
        history_chars: memory.history_summary.length
      }
    })

    const classification = await this.classifier.run({
      phone: payload.phone,
      message: payload.message,
      history_summary: memory.history_summary
    })
    await recordTrace({
      phone: payload.phone,
      agent: 'classifier',
      eventType: 'agent_output',
      title: 'Classificação concluída',
      data: classification
    })

    const identification = await this.identifier.run({
      phone: payload.phone,
      message: payload.message,
      current_lead: {
        name: lead?.name ?? null,
        email: lead?.email ?? null,
        city: lead?.city ?? null,
        status: lead?.status ?? null,
        tags: lead?.tags ?? null
      }
    })
    await recordTrace({
      phone: payload.phone,
      agent: 'identifier',
      eventType: 'agent_output',
      title: 'Identificação concluída',
      data: identification
    })

    const leadUpdates = this.normalizeLeadUpdates(identification.fields_to_update)
    const hasLeadUpdates = Object.keys(leadUpdates).length > 0
    if (hasLeadUpdates) {
      await updateLead(payload.phone, leadUpdates)
      await recordTrace({
        phone: payload.phone,
        agent: 'identifier',
        eventType: 'lead_updated',
        title: 'Lead atualizado',
        data: { ...leadUpdates }
      })
    }

    const refreshedLead = await this.loadLeadForResponse(payload.phone)
    if (hasLeadUpdates && refreshedLead) {
      await this.memoryAgent.updateLeadMemory(payload.phone, {
        phone: refreshedLead.phone,
        name: refreshedLead.name,
        email: refreshedLead.email,
        city: refreshedLead.city,
        status: refreshedLead.status,
        tags: refreshedLead.tags
      })
    }
    const refreshedMemory = await loadMemory(payload.phone)
    const vaultContext = await this.memoryAgent.fetchRelevant(payload.phone, classification.intent)
    await recordTrace({
      phone: payload.phone,
      agent: 'memory-agent',
      eventType: 'vault_context',
      title: 'Contexto do vault carregado',
      data: {
        intent: classification.intent,
        context_chars: vaultContext.length,
        context_preview: truncateTraceText(vaultContext, 800)
      }
    })
    const memorySummary = this.buildMemorySummary(
      refreshedMemory.lead_summary,
      refreshedMemory.history_summary,
      refreshedMemory.recent_messages
    )
    const promptBuild = await this.promptBuilder.buildDetailed({
      responderId: 'responder',
      lead: {
        phone: payload.phone,
        name: refreshedLead?.name ?? null,
        city: refreshedLead?.city ?? null,
        status: refreshedLead?.status ?? null,
        tags: refreshedLead?.tags ?? null,
        currentTime: runtimeContext.currentTime,
        timezone: runtimeContext.timezone
      },
      memory: refreshedMemory,
      vaultContext
    })
    const systemPrompt = promptBuild.prompt
    await recordTrace({
      phone: payload.phone,
      agent: 'prompt-builder',
      eventType: 'prompt_built',
      title: 'Prompt montado',
      data: {
        prompt_chars: promptBuild.promptChars,
        skills: promptBuild.skills,
        global_vault_files: promptBuild.globalFiles,
        tools_enabled: await this.isHttpToolEnabled()
      }
    })

    await saveMessage(payload.phone, 'user', payload.message, {
      message_type: payload.message_type,
      intent: classification.intent
    })
    await recordTrace({
      phone: payload.phone,
      agent: 'memory',
      eventType: 'message_saved',
      title: 'Mensagem do usuário salva',
      data: {
        role: 'user',
        intent: classification.intent
      }
    })

    const response = await this.responder.run({
      phone: payload.phone,
      system_prompt: systemPrompt,
      message: payload.message,
      lead_name: refreshedLead?.name ?? payload.name,
      memory_summary: memorySummary,
      vault_context: vaultContext,
      classification,
      tools_enabled: await this.isHttpToolEnabled()
    })
    await recordTrace({
      phone: payload.phone,
      agent: 'responder',
      eventType: 'agent_output',
      title: 'Resposta gerada',
      data: {
        response_preview: truncateTraceText(response.text, 800),
        audio_requested: response.audio_requested,
        tokens_used: response.tokens_used,
        duration_ms: response.duration_ms,
        model: response.model,
        tools_used: response.tool_trace.map((trace) => trace.tool)
      }
    })

    await saveMessage(payload.phone, 'assistant', response.text, {
      message_type: 'text',
      audio_requested: response.audio_requested,
      intent: classification.intent,
      tokens_used: response.tokens_used,
      agent_used: 'responder',
      processing_ms: response.duration_ms
    })
    await recordTrace({
      phone: payload.phone,
      agent: 'memory',
      eventType: 'message_saved',
      title: 'Resposta salva',
      data: {
        role: 'assistant',
        tokens_used: response.tokens_used
      }
    })

    broadcast({
      type: 'new_message',
      phone: payload.phone,
      name: refreshedLead?.name ?? payload.name,
      message: payload.message,
      response: response.text,
      agent: 'responder',
      intent: classification.intent,
      timestamp: new Date().toISOString()
    })
    markMessageProcessed()
    await recordTrace({
      phone: payload.phone,
      agent: 'orchestrator',
      eventType: 'pipeline_end',
      title: 'Webhook processado',
      data: {
        processing_ms: Date.now() - startedAt,
        tokens_used: response.tokens_used,
        agent_used: 'responder'
      }
    })

    void this.memoryAgent
      .saveNote(
        payload.phone,
        [
          `Lead: ${refreshedLead?.name ?? payload.name} (${payload.phone})`,
          `Intenção: ${classification.intent}`,
          `Usuário: ${payload.message}`,
          `Assistente: ${response.text}`
        ].join('\n')
      )
      .catch((error: unknown) => {
        log.error({ err: error, phone: payload.phone }, 'failed to save memory note')
      })

    return {
      success: true,
      message: response.text,
      audio_requested: response.audio_requested,
      metadata: {
        lead_id: payload.phone,
        agent_used: 'responder',
        tokens_used: response.tokens_used,
        processing_ms: Date.now() - startedAt
      }
    }
  }

  private normalizeLeadUpdates(fields: LeadFieldsToUpdate): LeadUpdateInput {
    return fields
  }

  private async processInternalAssistant(
    payload: WebhookPayload,
    runtimeContext: { currentTime: string; timezone: string },
    startedAt: number
  ): Promise<WebhookResponse> {
    const systemPrompt = await this.getInternalAssistantPrompt()
    const response = await this.internalAssistant.run({
      phone: payload.phone,
      system_prompt: systemPrompt,
      message: payload.message,
      operator_name: payload.name,
      current_time: runtimeContext.currentTime
    })

    broadcast({
      type: 'new_message',
      phone: payload.phone,
      name: payload.name,
      message: payload.message,
      response: response.text,
      agent: 'internal-assistant',
      intent: 'internal',
      timestamp: new Date().toISOString()
    })
    markMessageProcessed()

    return {
      success: true,
      message: response.text,
      audio_requested: false,
      metadata: {
        lead_id: payload.phone,
        agent_used: 'internal-assistant',
        tokens_used: response.tokens_used,
        processing_ms: Date.now() - startedAt
      }
    }
  }

  private async isInternalAssistantContact(payload: WebhookPayload): Promise<boolean> {
    const raw = await this.getSettingValue('internal_assistant_contacts')
    const contacts = this.parseContactList(raw)
    if (contacts.length === 0) {
      return false
    }

    const identifiers = [
      payload.phone,
      payload.session_id,
      this.getStringContactField(payload.contact_info, 'jid'),
      this.getStringContactField(payload.contact_info, 'remoteJid'),
      this.getStringContactField(payload.contact_info, 'groupJid'),
      this.getStringContactField(payload.contact_info, 'group_jid')
    ].filter((item): item is string => Boolean(item))

    return identifiers.some((identifier) => contacts.includes(identifier))
  }

  private async getInternalAssistantPrompt(): Promise<string> {
    const [agent] = await db.select().from(agents).where(eq(agents.id, 'internal-assistant')).limit(1)
    return agent?.system_prompt ?? ''
  }

  private async getSettingValue(key: string): Promise<string> {
    const [setting] = await db.select().from(settings).where(eq(settings.key, key)).limit(1)
    return setting?.value ?? ''
  }

  private async isHttpToolEnabled(): Promise<boolean> {
    return (await this.getSettingValue('tool_http_enabled')).trim().toLowerCase() === 'true'
  }

  private parseContactList(raw: string): string[] {
    const trimmed = raw.trim()
    if (!trimmed) {
      return []
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      }
    } catch {
      // Configuração pode ser lista simples separada por vírgula ou linha.
    }

    return trimmed
      .split(/[\n,;]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }

  private resolveRuntimeContext(payload: WebhookPayload): { currentTime: string; timezone: string } {
    const timezone = payload.timezone ?? this.getStringContactField(payload.contact_info, 'timezone') ?? 'America/Sao_Paulo'
    const currentTime =
      payload.current_time ??
      new Intl.DateTimeFormat('pt-BR', {
        timeZone: timezone,
        dateStyle: 'full',
        timeStyle: 'short'
      }).format(new Date())

    return { currentTime, timezone }
  }

  private getStringContactField(contactInfo: ContactInfo | undefined, key: string): string | undefined {
    const value = contactInfo?.[key]
    return typeof value === 'string' && value.trim() ? value : undefined
  }

  private async loadLeadForResponse(phone: string) {
    const [lead] = await db.select().from(leads).where(eq(leads.phone, phone)).limit(1)
    return lead
  }

  private buildMemorySummary(
    leadSummary: string,
    historySummary: string,
    recentMessages: Array<{ role: string | null; content: string | null }>
  ): string {
    const recent = recentMessages
      .slice(-5)
      .map((message) => `${message.role ?? 'unknown'}: ${message.content ?? ''}`)
      .join('\n')

    return [
      leadSummary ? `Memória do lead:\n${leadSummary}` : null,
      historySummary ? `Histórico do vault:\n${historySummary}` : null,
      recent ? `Mensagens recentes:\n${recent}` : null
    ]
      .filter((item): item is string => Boolean(item))
      .join('\n\n')
  }
}
