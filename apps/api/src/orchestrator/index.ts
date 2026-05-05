// index.ts — QueryEngine orquestra agentes com contexto isolado e resposta final
import { eq } from 'drizzle-orm'
import pino from 'pino'
import { ClassifierAgent } from '../agents/classifier'
import { MCP_ENABLED } from '../config/constants'
import { env } from '../config/env'
import { IdentifierAgent, type LeadFieldsToUpdate } from '../agents/identifier'
import { InternalAssistantAgent } from '../agents/internal-assistant'
import { MemoryAgent } from '../agents/memory-agent'
import { ResponderAgent } from '../agents/responder'
import { SchedulingAgent, type SchedulingAgentOutput } from '../agents/scheduling-agent'
import { SkillRouterAgent, type SkillCandidate } from '../agents/skill-router'
import { db } from '../db/client'
import { agents, leads, mcpCredentials, mcpServers, settings } from '../db/schema'
import {
  getOrCreateLead,
  loadMemory,
  saveConversationSummary,
  saveMessage,
  updateLead,
  type ContactInfo,
  type LeadUpdateInput
} from '../memory/persistent'
import { markMessageProcessed } from '../monitoring/status'
import { recordTrace, truncateTraceText } from '../monitoring/trace-recorder'
import { MCPRegistry } from '../mcp/registry'
import { acquirePhoneLock, releasePhoneLock, waitForPhoneLockRelease } from '../queue/redis'
import { SkillsLoader } from '../skills/loader'
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
  private readonly schedulingAgent = new SchedulingAgent()
  private readonly skillRouter = new SkillRouterAgent()
  private readonly skillsLoader = new SkillsLoader()
  private readonly mcpRegistry = new MCPRegistry()

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
    const runId = crypto.randomUUID()
    await recordTrace({
      phone: payload.phone,
      runId,
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
      runId,
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
      runId,
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
      runId,
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
        runId,
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
    const liveSummary = this.buildLiveConversationSummary(payload, refreshedLead?.name ?? payload.name, refreshedMemory.recent_messages)
    await saveConversationSummary(payload.phone, refreshedLead?.name ?? payload.name, liveSummary)
    const vaultContext = await this.memoryAgent.fetchRelevant(payload.phone, classification.intent)
    await recordTrace({
      phone: payload.phone,
      runId,
      agent: 'memory-agent',
      eventType: 'vault_context',
      title: 'Contexto do vault carregado',
      data: {
        intent: classification.intent,
        context_chars: vaultContext.length,
        context_preview: truncateTraceText(vaultContext, 800)
      }
    })
    const skillCandidates = await this.loadSkillCandidates('responder')
    const routedSkills = await this.routeSkills({
      phone: payload.phone,
      runId,
      message: payload.message,
      liveSummary,
      classification,
      candidates: skillCandidates
    })
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
      memory: {
        ...refreshedMemory,
        history_summary: liveSummary
      },
      vaultContext,
      skillContext: routedSkills.contextSummary,
      selectedSkillIds: routedSkills.selectedSkillIds
    })
    const systemPrompt = promptBuild.prompt
    await recordTrace({
      phone: payload.phone,
      runId,
      agent: 'prompt-builder',
      eventType: 'prompt_built',
      title: 'Prompt montado',
      data: {
        prompt_chars: promptBuild.promptChars,
        system_prompt_final: promptBuild.prompt,
        live_summary: liveSummary,
        skills: promptBuild.skills,
        skill_router: routedSkills,
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
      runId,
      agent: 'memory',
      eventType: 'message_saved',
      title: 'Mensagem do usuário salva',
      data: {
        role: 'user',
        intent: classification.intent
      }
    })

    const mcpEnabled = await this.isMcpEnabled()
    const schedulingResult = mcpEnabled && this.shouldRunSchedulingAgent(classification.intent, payload.message)
      ? await this.runSchedulingAgent({
          phone: payload.phone,
          runId,
          message: payload.message,
          leadName: refreshedLead?.name ?? payload.name,
          leadEmail: refreshedLead?.email ?? null,
          currentTime: runtimeContext.currentTime,
          timezone: runtimeContext.timezone,
          historySummary: liveSummary,
          recentMessages: refreshedMemory.recent_messages
        })
      : null
    const mcpTools = mcpEnabled
      ? this.mcpRegistry.formatForOpenAI((await this.mcpRegistry.getToolsForAgent('responder'))
          .filter((tool) => tool.serverName !== 'Google Calendar'))
      : []
    if (mcpEnabled) {
      await recordTrace({
        phone: payload.phone,
        runId,
        agent: 'mcp-registry',
        eventType: 'mcp_tools_loaded',
        title: 'Tools MCP carregadas',
        data: {
          tools_count: mcpTools.length,
          tool_names: mcpTools.map((tool) => tool.function.name)
        }
      })
    }

    const response = await this.responder.run({
      phone: payload.phone,
      run_id: runId,
      system_prompt: systemPrompt,
      message: payload.message,
      lead_name: refreshedLead?.name ?? payload.name,
      model: await this.getResponderModel(),
      classification,
      tools_enabled: await this.isHttpToolEnabled(),
      mcp_enabled: mcpEnabled,
      mcp_tools: mcpTools,
      scheduling_result: schedulingResult,
      recent_messages: refreshedMemory.recent_messages
    })
    const guardedText = this.normalizeWhatsAppResponse(response.text)
    if (guardedText !== response.text) {
      await recordTrace({
        phone: payload.phone,
        runId,
        agent: 'response-guard',
        eventType: 'response_guard',
        title: 'Resposta ajustada por regra determinística',
        data: {
          original_preview: truncateTraceText(response.text, 800),
          final_preview: truncateTraceText(guardedText, 800),
          rules: ['replace_em_dash']
        }
      })
    }
    await recordTrace({
      phone: payload.phone,
      runId,
      agent: 'responder',
      eventType: 'agent_output',
      title: 'Resposta gerada',
      data: {
        response_preview: truncateTraceText(guardedText, 800),
        audio_requested: response.audio_requested,
        tokens_used: response.tokens_used,
        duration_ms: response.duration_ms,
        model: response.model,
        tools_used: response.tool_trace.map((trace) => trace.tool)
      }
    })

    await saveMessage(payload.phone, 'assistant', guardedText, {
      message_type: 'text',
      audio_requested: response.audio_requested,
      intent: classification.intent,
      tokens_used: response.tokens_used,
      agent_used: 'responder',
      processing_ms: response.duration_ms
    })
    await recordTrace({
      phone: payload.phone,
      runId,
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
      response: guardedText,
      agent: 'responder',
      intent: classification.intent,
      timestamp: new Date().toISOString()
    })
    markMessageProcessed()
    await recordTrace({
      phone: payload.phone,
      runId,
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
          `Assistente: ${guardedText}`
        ].join('\n')
      )
      .catch((error: unknown) => {
        log.error({ err: error, phone: payload.phone }, 'failed to save memory note')
      })

    return {
      success: true,
      message: guardedText,
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

  private normalizeWhatsAppResponse(text: string): string {
    return text.replace(/—/g, '-')
  }

  private async loadSkillCandidates(agentId: string): Promise<SkillCandidate[]> {
    const rows = await this.skillsLoader.loadSummariesForAgent(agentId)
    return rows.map((skill) => ({
      id: skill.id,
      slug: skill.slug,
      name: skill.name,
      description: skill.description,
      when_to_use: skill.when_to_use,
      priority: skill.priority,
      content_summary: skill.content_summary
    }))
  }

  private async routeSkills(input: {
    phone: string
    runId: string
    message: string
    liveSummary: string
    classification: Awaited<ReturnType<ClassifierAgent['run']>>
    candidates: SkillCandidate[]
  }): Promise<{ selectedSkillIds: string[]; contextSummary: string; reason: string; fallback: boolean }> {
    if (input.candidates.length === 0) {
      return { selectedSkillIds: [], contextSummary: '', reason: 'nenhuma_skill_associada', fallback: true }
    }

    const output = await this.skillRouter.run({
      phone: input.phone,
      message: input.message,
      history_summary: input.liveSummary,
      classification: input.classification,
      candidates: input.candidates
    })
    const validIds = new Set(input.candidates.map((skill) => skill.id))
    const selected = output.selected_skill_ids.filter((id) => validIds.has(id)).slice(0, 3)
    const fallback = selected.length === 0
    const selectedSkillIds = fallback ? this.fallbackSkillIds(input.classification.intent, input.candidates) : selected
    const contextSummary = fallback
      ? this.buildFallbackSkillContext(selectedSkillIds, input.candidates)
      : output.context_summary
    const result = {
      selectedSkillIds,
      contextSummary,
      reason: fallback ? `fallback: ${output.reason}` : output.reason,
      fallback
    }

    await recordTrace({
      phone: input.phone,
      runId: input.runId,
      agent: 'skill-router',
      eventType: 'skill_routed',
      title: 'Skills selecionadas',
      data: {
        selected_skill_ids: result.selectedSkillIds,
        context_summary_chars: result.contextSummary.length,
        selected_skills: input.candidates
          .filter((skill) => result.selectedSkillIds.includes(skill.id))
          .map((skill) => ({ id: skill.id, slug: skill.slug, name: skill.name })),
        reason: result.reason,
        fallback: result.fallback,
        candidates: input.candidates.map((skill) => ({
          id: skill.id,
          slug: skill.slug,
          name: skill.name,
          priority: skill.priority,
          when_to_use: skill.when_to_use
        }))
      }
    })

    return result
  }

  private shouldRunSchedulingAgent(intent: string, message: string): boolean {
    const normalized = message.toLowerCase()
    const schedulingTerms = [
      'agenda',
      'agendar',
      'marcar',
      'reunião',
      'reuniao',
      'horário',
      'horario',
      'remarcar',
      'cancelar',
      'disponibilidade'
    ]

    return intent === 'scheduling' || schedulingTerms.some((term) => normalized.includes(term))
  }

  private async runSchedulingAgent(input: {
    phone: string
    runId: string
    message: string
    leadName: string
    leadEmail: string | null
    currentTime: string
    timezone: string
    historySummary: string
    recentMessages: Array<{ role: 'user' | 'assistant' | null; content: string | null }>
  }): Promise<SchedulingAgentOutput | null> {
    const server = await this.loadConnectedGoogleCalendarServer()
    if (!server) {
      await recordTrace({
        phone: input.phone,
        runId: input.runId,
        agent: 'scheduling-agent',
        eventType: 'agent_skipped',
        title: 'Google Calendar não conectado',
        data: { reason: 'missing_google_calendar_credentials' }
      })
      return null
    }

    const result = await this.schedulingAgent.run({
      phone: input.phone,
      run_id: input.runId,
      message: input.message,
      lead_name: input.leadName,
      lead_email: input.leadEmail,
      current_time: input.currentTime,
      timezone: input.timezone,
      history_summary: input.historySummary,
      recent_messages: input.recentMessages,
      mcp_server_id: server.id
    })

    await recordTrace({
      phone: input.phone,
      runId: input.runId,
      agent: 'scheduling-agent',
      eventType: 'agent_output',
      title: 'Agendamento processado',
      data: {
        status: result.status,
        action: result.action,
        message_to_responder: result.message_to_responder,
        event_id: result.event_id,
        scheduled_for: result.scheduled_for,
        user_message: result.user_message,
        admin_message: result.admin_message,
        should_notify_user: result.should_notify_user,
        missing_fields: result.missing_fields,
        tools_used: result.tool_trace.map((trace) => trace.tool),
        tokens_used: result.tokens_used,
        duration_ms: result.duration_ms,
        model: result.model
      }
    })

    return result
  }

  private async loadConnectedGoogleCalendarServer(): Promise<typeof mcpServers.$inferSelect | null> {
    const [server] = await db.select().from(mcpServers).where(eq(mcpServers.slug, 'google-calendar')).limit(1)
    if (!server?.is_active) {
      return null
    }

    const [credential] = await db
      .select()
      .from(mcpCredentials)
      .where(eq(mcpCredentials.mcp_server_id, server.id))
      .limit(1)

    return credential?.refresh_token_encrypted ? server : null
  }

  private fallbackSkillIds(intent: string, candidates: SkillCandidate[]): string[] {
    const termsByIntent: Record<string, string[]> = {
      sales: ['venda', 'comercial', 'obje'],
      scheduling: ['agenda', 'reuni'],
      qualification: ['qualifica'],
      support: ['suporte'],
      complaint: ['suporte']
    }
    const terms = termsByIntent[intent] ?? ['atendimento']
    const matches = candidates
      .filter((skill) => {
        const source = `${skill.name} ${skill.slug ?? ''} ${skill.description ?? ''}`.toLowerCase()
        return terms.some((term) => source.includes(term))
      })
      .slice(0, 2)
      .map((skill) => skill.id)
    const general = candidates.find((skill) => {
      const source = `${skill.name} ${skill.slug ?? ''}`.toLowerCase()
      return source.includes('atendimento') || source.includes('geral')
    })

    return [...new Set([...matches, ...(general ? [general.id] : [])])].slice(0, 3)
  }

  private buildFallbackSkillContext(selectedSkillIds: string[], candidates: SkillCandidate[]): string {
    return candidates
      .filter((skill) => selectedSkillIds.includes(skill.id))
      .map((skill) => [
        `Skill: ${skill.name}`,
        skill.description ? `Objetivo: ${skill.description}` : null,
        skill.when_to_use ? `Quando usar: ${skill.when_to_use}` : null,
        skill.content_summary ? `Contexto resumido: ${skill.content_summary}` : null
      ].filter((item): item is string => Boolean(item)).join('\n'))
      .join('\n\n')
      .slice(0, 1200)
  }

  private buildLiveConversationSummary(
    payload: WebhookPayload,
    leadName: string,
    recentMessages: Array<{ role: string | null; content: string | null }>
  ): string {
    const previous = recentMessages
      .slice(-6)
      .map((message) => `${message.role === 'assistant' ? 'Assistente' : 'Lead'}: ${message.content ?? ''}`)
      .filter((line) => line.trim().length > 0)

    const currentMessage = payload.message.trim()
    const sourceHint = this.inferSourceHint(currentMessage, payload.contact_info)
    const knownName = leadName.trim() ? leadName : 'nome ainda não confirmado'
    const stage = previous.length === 0
      ? 'início da conversa'
      : 'conversa em andamento'

    return [
      `Estado atual: ${stage}. Lead identificado como ${knownName}.`,
      `Última mensagem do lead: "${truncateTraceText(currentMessage, 220)}".`,
      sourceHint,
      previous.length > 0 ? `Contexto recente:\n${previous.join('\n')}` : 'Ainda não há histórico anterior relevante.',
      'Próximo passo: responder de forma direta, evitar redundância e fazer no máximo uma pergunta objetiva.'
    ].join('\n')
  }

  private inferSourceHint(message: string, contactInfo: ContactInfo | undefined): string {
    const lower = message.toLowerCase()
    const campaign = this.getStringContactField(contactInfo, 'campaign') ?? this.getStringContactField(contactInfo, 'utm_campaign')
    if (campaign) {
      return `Origem provável: campanha/anúncio "${campaign}".`
    }

    if (lower.includes('anúncio') || lower.includes('anuncio') || lower.includes('saber mais')) {
      return 'Origem provável: lead veio de anúncio ou campanha e demonstrou interesse inicial.'
    }

    if (['oi', 'olá', 'ola', 'bom dia', 'boa tarde', 'boa noite'].includes(lower)) {
      return 'Origem provável: entrada genérica sem intenção declarada ainda.'
    }

    return 'Origem provável: não identificada pelos dados recebidos.'
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

  private async isMcpEnabled(): Promise<boolean> {
    return MCP_ENABLED || (await this.getSettingValue('mcp_enabled')).trim().toLowerCase() === 'true'
  }

  private async getResponderModel(): Promise<string> {
    const configuredModel = (await this.getSettingValue('model_responder')).trim()
    if (configuredModel) {
      return configuredModel
    }

    const [agent] = await db.select({ model: agents.model }).from(agents).where(eq(agents.id, 'responder')).limit(1)
    return agent?.model || env.MODEL_RESPONDER || 'gpt-4o-mini'
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

}
