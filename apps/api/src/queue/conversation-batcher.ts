// conversation-batcher.ts — Agrupa eventos recebidos e chama o orquestrador após segunda decisão
import { BATCH_MAX_MESSAGES } from '../config/constants'
import type { MessageEvent } from '../db/repositories/message-events.repository'
import { traceEmitter } from '../observability/trace-emitter'
import { AutomationDecisionEngine } from '../automation/decision-engine'
import { ResponseDispatcher } from '../delivery/dispatcher'
import { presenceSimulator, type PresenceSession, type PresenceSimulator } from '../delivery/presence-simulator'
import type { QueryEngineOptions, WebhookPayload, WebhookResponse } from '../orchestrator'
import { TranscriptRepository } from '../transcript/repository'
import { vaultCompactor, type VaultCompactor } from '../vault/vault-compactor'
import type { NormalizedWhatsappEvent } from '../webhook/evolution-normalizer'
import type { InboundQueueJob } from './inbound-message-queue'

interface OrchestratorClient {
  process(payload: WebhookPayload, options?: QueryEngineOptions): Promise<WebhookResponse>
}

export interface ConversationBatchResult {
  batchId: string | null
  processed: number
  shouldReply: boolean
  reason: string
  responseMessage: string | null
}

/**
 * Processa mensagens recebidas pendentes em um único batch por telefone.
 */
export class ConversationBatcher {
  constructor(
    private readonly repository = new TranscriptRepository(),
    private readonly decisionEngine = new AutomationDecisionEngine(),
    private readonly orchestrator: OrchestratorClient | null = null,
    private readonly dispatcher = new ResponseDispatcher(),
    private readonly presence: PresenceSimulator = presenceSimulator,
    private readonly compactor: VaultCompactor = vaultCompactor
  ) {}

  /**
   * Busca eventos pendentes, atribui batch_id e chama o orquestrador quando permitido.
   * @param job Dados do job BullMQ.
   * @returns Resultado resumido do processamento.
   */
  async process(job: InboundQueueJob): Promise<ConversationBatchResult> {
    const startedAt = performance.now()
    const events = await this.repository.findPendingReceivedBatch(job.tenantId, job.phone, BATCH_MAX_MESSAGES)

    if (events.length === 0) {
      await this.emitBatchProcessed(job, null, 0, 'ignored', { reason: 'empty_batch' }, startedAt)
      return { batchId: null, processed: 0, shouldReply: false, reason: 'empty_batch', responseMessage: null }
    }

    const firstEvent = getFirstEvent(events)
    const batchId = crypto.randomUUID()
    await this.repository.assignBatchId(events.map((event) => event.id), batchId)

    const compiledMessage = compileBatchMessage(events)
    const decisionEvent = buildDecisionEvent(job, firstEvent, compiledMessage)
    const decision = await this.decisionEngine.decide({
      tenantId: job.tenantId,
      event: decisionEvent,
      transcript: null
    })

    if (!decision.shouldReply) {
      await this.emitBatchProcessed(job, batchId, events.length, 'ignored', { reason: decision.reason }, startedAt)
      return { batchId, processed: events.length, shouldReply: false, reason: decision.reason, responseMessage: null }
    }

    const presenceSession = this.startPresence(job, firstEvent)

    try {
      await traceEmitter.emit('context_assembled', {
        tenant_id: job.tenantId,
        batch_id: batchId,
        phone: job.phone,
        data: {
          message_count: events.length,
          message_chars: compiledMessage.length
        }
      })

      const response = await this.callOrchestrator(job, firstEvent, compiledMessage, batchId)
      const delivery = await this.dispatchResponse(job, firstEvent, response, batchId, presenceSession)
      await this.emitBatchProcessed(job, batchId, events.length, 'ok', {
        reason: decision.reason,
        response_chars: response.message.length,
        delivery_status: delivery.status,
        delivery_mode: delivery.mode,
        delivery_event_id: delivery.intendedEventId,
        delivery_error: delivery.errorMessage
      }, startedAt)
      this.compactor.scheduleAfterBatch({ tenantId: job.tenantId, phone: job.phone, batchId })

      return { batchId, processed: events.length, shouldReply: true, reason: decision.reason, responseMessage: response.message }
    } catch (error) {
      await presenceSession?.stop()
      throw error
    }
  }

  private async callOrchestrator(
    job: InboundQueueJob,
    firstEvent: MessageEvent,
    compiledMessage: string,
    batchId: string
  ): Promise<WebhookResponse> {
    const payload = buildWebhookPayload(job, firstEvent, compiledMessage, batchId)
    await traceEmitter.emit('agent_called', {
      tenant_id: job.tenantId,
      batch_id: batchId,
      phone: job.phone,
      data: { agent: 'orchestrator', message_chars: compiledMessage.length }
    })

    const orchestrator = this.orchestrator ?? await createDefaultOrchestrator()
    const response = await orchestrator.process(payload, { skipLock: true })
    await traceEmitter.emit('agent_responded', {
      tenant_id: job.tenantId,
      batch_id: batchId,
      phone: job.phone,
      data: {
        agent: response.metadata.agent_used,
        tokens_used: response.metadata.tokens_used,
        processing_ms: response.metadata.processing_ms
      }
    })

    return response
  }

  private async dispatchResponse(
    job: InboundQueueJob,
    firstEvent: MessageEvent,
    response: WebhookResponse,
    batchId: string,
    presenceSession: PresenceSession | null
  ) {
    const raw = toRecord(firstEvent.raw_payload)
    return this.dispatcher.dispatch({
      tenantId: job.tenantId,
      batchId,
      phone: job.phone,
      remoteJid: firstEvent.remote_jid,
      instance: firstEvent.instance,
      instanceId: firstEvent.instance_id ?? job.instanceId,
      evolutionUrl: readString(raw, 'server_url') ?? readString(raw, 'evolutionUrl'),
      evolutionLocalUrl: readString(raw, 'url_evolution_local') ?? readString(raw, 'evolutionLocalUrl'),
      apiKey: readString(raw, 'apikey'),
      text: response.message,
      audioRequested: response.audio_requested,
      senderType: 'bot',
      sourceEvent: 'orchestrator.response',
      presenceSession,
      reactionRequested: response.reaction_requested ?? null
    })
  }

  private startPresence(job: InboundQueueJob, firstEvent: MessageEvent): PresenceSession | null {
    const instance = firstEvent.instance?.trim()
    if (!instance) {
      return null
    }

    const raw = toRecord(firstEvent.raw_payload)
    return this.presence.start({
      tenantId: job.tenantId,
      phone: job.phone,
      remoteJid: firstEvent.remote_jid,
      instance,
      evolutionUrl: readString(raw, 'server_url') ?? readString(raw, 'evolutionUrl'),
      evolutionLocalUrl: readString(raw, 'url_evolution_local') ?? readString(raw, 'evolutionLocalUrl'),
      apiKey: readString(raw, 'apikey')
    }, 'composing')
  }

  private async emitBatchProcessed(
    job: InboundQueueJob,
    batchId: string | null,
    processed: number,
    status: 'ok' | 'ignored' | 'error',
    data: Record<string, unknown>,
    startedAt: number
  ): Promise<void> {
    await traceEmitter.emit('batch_processed', {
      tenant_id: job.tenantId,
      batch_id: batchId,
      phone: job.phone,
      status,
      data: {
        ...data,
        processed,
        instance_id: job.instanceId,
        batch_max_messages: BATCH_MAX_MESSAGES
      }
    }, Math.round(performance.now() - startedAt))
  }
}

async function createDefaultOrchestrator(): Promise<OrchestratorClient> {
  const { QueryEngine } = await import('../orchestrator')
  return new QueryEngine()
}

function getFirstEvent(events: MessageEvent[]): MessageEvent {
  const [event] = events
  if (!event) {
    throw new Error('Cannot process empty conversation batch')
  }

  return event
}

/**
 * Junta mensagens do batch com uma mensagem por linha.
 * @param events Eventos do transcript.
 * @returns Texto compilado.
 */
export function compileBatchMessage(events: MessageEvent[]): string {
  return events.map((event) => event.content.trim()).filter(Boolean).join('\n')
}

function buildDecisionEvent(job: InboundQueueJob, firstEvent: MessageEvent, text: string): NormalizedWhatsappEvent {
  const remoteJid = firstEvent.remote_jid ?? `${job.phone}@s.whatsapp.net`

  return {
    phone: job.phone,
    remoteJid,
    instance: firstEvent.instance ?? '',
    instanceId: firstEvent.instance_id ?? job.instanceId,
    event: firstEvent.source_event ?? 'messages.upsert',
    externalMessageId: firstEvent.external_message_id ?? firstEvent.id,
    fromMe: firstEvent.from_me,
    isGroup: remoteJid.endsWith('@g.us'),
    groupParticipant: null,
    pushName: '',
    messageType: firstEvent.message_type,
    processedType: firstEvent.processed_type,
    text,
    quotedMessageId: firstEvent.quoted_external_message_id,
    quotedContent: firstEvent.quoted_content,
    mediaUrl: firstEvent.media_url,
    timestamp: firstEvent.whatsapp_timestamp,
    evolutionUrl: '',
    evolutionLocalUrl: null,
    apiKeyRef: '',
    chatwoot: {
      conversationId: firstEvent.chatwoot_conversation_id,
      inboxId: firstEvent.chatwoot_inbox_id,
      messageId: firstEvent.chatwoot_message_id
    },
    raw: firstEvent.raw_payload ?? {}
  }
}

function buildWebhookPayload(job: InboundQueueJob, firstEvent: MessageEvent, message: string, batchId: string): WebhookPayload {
  const timezone = 'America/Sao_Paulo'

  return {
    phone: job.phone,
    name: '',
    message,
    message_type: 'text',
    timestamp: firstEvent.whatsapp_timestamp,
    session_id: firstEvent.remote_jid ?? job.phone,
    current_time: new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      dateStyle: 'full',
      timeStyle: 'short'
    }).format(new Date()),
    timezone,
    contact_info: {
      remoteJid: firstEvent.remote_jid ?? undefined,
      instancia: firstEvent.instance ?? undefined,
      instance_id: firstEvent.instance_id ?? undefined,
      chatwoot_conversation_id: firstEvent.chatwoot_conversation_id ?? undefined,
      chatwoot_inbox_id: firstEvent.chatwoot_inbox_id ?? undefined,
      chatwoot_message_id: firstEvent.chatwoot_message_id ?? undefined,
      url_evolution: readString(toRecord(firstEvent.raw_payload), 'server_url') ?? undefined,
      url_evolution_local: readString(toRecord(firstEvent.raw_payload), 'url_evolution_local') ?? undefined,
      apikey: readString(toRecord(firstEvent.raw_payload), 'apikey') ?? undefined,
      batch_id: batchId,
      tenant_id: job.tenantId
    }
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}
