// delivery-tracker.ts — Registra intenção, sucesso e falha de envio em message_events
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { MessageEventsRepository, type MessageEvent } from '../db/repositories/message-events.repository'
import { messageEvents, type MessageEventSenderType } from '../db/schema'
import { traceEmitter } from '../observability/trace-emitter'

export interface DeliveryIntentInput {
  tenantId: string
  batchId: string | null
  phone: string
  remoteJid: string
  instance: string
  instanceId: string | null
  content: string
  senderType: MessageEventSenderType
  sourceEvent: string
  rawPayload?: Record<string, unknown>
}

/**
 * Controla o ciclo de vida de entrega outbound.
 */
export class DeliveryTracker {
  constructor(private readonly repository = new MessageEventsRepository()) {}

  /**
   * Cria o evento outbound em estado intended.
   * @param input Dados do destino e conteúdo.
   * @returns Evento criado.
   */
  async createIntended(input: DeliveryIntentInput): Promise<MessageEvent> {
    const event = await this.repository.insert({
      tenant_id: input.tenantId,
      conversation_id: null,
      lead_phone: input.phone,
      external_message_id: null,
      source: 'evolution',
      source_event: input.sourceEvent,
      direction: 'outbound',
      from_me: true,
      sender_type: input.senderType,
      role: input.senderType === 'human_agent' ? 'human_agent' : 'assistant',
      content: input.content,
      message_type: 'conversation',
      processed_type: 'text',
      media_url: null,
      quoted_external_message_id: null,
      quoted_content: null,
      remote_jid: input.remoteJid,
      instance: input.instance,
      instance_id: input.instanceId,
      chatwoot_conversation_id: null,
      chatwoot_inbox_id: null,
      chatwoot_message_id: null,
      delivery_status: 'intended',
      batch_id: input.batchId,
      error_message: null,
      raw_payload: input.rawPayload ?? {},
      whatsapp_timestamp: Math.floor(Date.now() / 1000)
    })

    await traceEmitter.emit('delivery_intended', {
      tenant_id: input.tenantId,
      batch_id: input.batchId,
      phone: input.phone,
      data: {
        message_event_id: event.id,
        instance: input.instance,
        remote_jid: input.remoteJid,
        sender_type: input.senderType,
        content_chars: input.content.length
      }
    })

    return event
  }

  /**
   * Marca um evento intended como enviado.
   * @param event Evento intended.
   * @param externalMessageId Id externo retornado pela Evolution.
   * @returns Nada.
   */
  async markSent(event: MessageEvent, externalMessageId: string | null): Promise<void> {
    await this.repository.updateDeliveryStatus(event.id, 'sent', externalMessageId ?? undefined)
    await traceEmitter.emit('delivery_sent', {
      tenant_id: event.tenant_id,
      batch_id: event.batch_id,
      phone: event.lead_phone,
      data: {
        message_event_id: event.id,
        external_message_id: externalMessageId,
        instance: event.instance,
        remote_jid: event.remote_jid
      }
    })
  }

  /**
   * Marca um evento intended como falha de envio.
   * @param event Evento intended.
   * @param errorMessage Erro resumido.
   * @returns Nada.
   */
  async markFailed(event: MessageEvent, errorMessage: string): Promise<void> {
    await db
      .update(messageEvents)
      .set({
        delivery_status: 'failed',
        error_message: errorMessage,
        updated_at: new Date()
      })
      .where(eq(messageEvents.id, event.id))

    await traceEmitter.emit('delivery_failed', {
      tenant_id: event.tenant_id,
      batch_id: event.batch_id,
      phone: event.lead_phone,
      status: 'error',
      data: {
        message_event_id: event.id,
        error_message: errorMessage,
        instance: event.instance,
        remote_jid: event.remote_jid
      }
    })
  }
}
