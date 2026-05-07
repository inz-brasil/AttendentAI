// mapper.ts — Converte eventos normalizados em registros message_events tipados
import type {
  MessageEventDeliveryStatus,
  MessageEventDirection,
  MessageEventProcessedType,
  MessageEventSenderType,
  MessageEventSource,
  MessageRole
} from '../db/schema'
import type { NewMessageEvent } from '../db/repositories/message-events.repository'
import { hashContent } from '../db/repositories/message-events.repository'
import type { NormalizedWhatsappEvent } from '../webhook/evolution-normalizer'

export interface TranscriptClassification {
  direction: MessageEventDirection
  senderType: MessageEventSenderType
  role: MessageRole
  deliveryStatus: MessageEventDeliveryStatus
  nextAction: 'enqueue' | 'activate_pause' | 'update_existing' | 'record_only'
}

export interface TranscriptMapperInput {
  tenantId: string
  source: MessageEventSource
  event: NormalizedWhatsappEvent
  classification: TranscriptClassification
  batchId?: string | null
  errorMessage?: string | null
}

/**
 * Monta o registro message_events a partir do evento normalizado e classificação.
 * @param input Dados normalizados e classificação.
 * @returns Registro pronto para insert.
 */
export function mapNormalizedEventToMessageEvent(input: TranscriptMapperInput): NewMessageEvent {
  const content = input.event.text

  return {
    tenant_id: input.tenantId,
    conversation_id: null,
    lead_phone: input.event.phone,
    external_message_id: input.event.externalMessageId || null,
    source: input.source,
    source_event: input.event.event,
    direction: input.classification.direction,
    from_me: input.event.fromMe,
    sender_type: input.classification.senderType,
    role: input.classification.role,
    content,
    content_hash: hashContent(content),
    message_type: input.event.messageType,
    processed_type: input.event.processedType as MessageEventProcessedType,
    media_url: input.event.mediaUrl,
    quoted_external_message_id: input.event.quotedMessageId,
    quoted_content: input.event.quotedContent,
    remote_jid: input.event.remoteJid,
    instance: input.event.instance,
    instance_id: input.event.instanceId,
    chatwoot_conversation_id: input.event.chatwoot.conversationId,
    chatwoot_inbox_id: input.event.chatwoot.inboxId,
    chatwoot_message_id: input.event.chatwoot.messageId,
    delivery_status: input.classification.deliveryStatus,
    batch_id: input.batchId ?? null,
    error_message: input.errorMessage ?? null,
    raw_payload: toJsonRecord(input.event.raw),
    whatsapp_timestamp: input.event.timestamp
  }
}

/**
 * Classificação padrão antes da confirmação de bot/humano.
 * @param event Evento normalizado.
 * @returns Classificação inicial.
 */
export function classifyBaseEvent(event: NormalizedWhatsappEvent): TranscriptClassification {
  if (event.isGroup) {
    return {
      direction: event.fromMe ? 'outbound' : 'inbound',
      senderType: event.fromMe ? 'unknown' : 'customer',
      role: event.fromMe ? 'assistant' : 'user',
      deliveryStatus: 'ignored',
      nextAction: 'record_only'
    }
  }

  if (!event.fromMe) {
    return {
      direction: 'inbound',
      senderType: 'customer',
      role: 'user',
      deliveryStatus: 'received',
      nextAction: 'enqueue'
    }
  }

  return {
    direction: 'outbound',
    senderType: 'human_agent',
    role: 'human_agent',
    deliveryStatus: 'sent',
    nextAction: 'activate_pause'
  }
}

function toJsonRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { value }
}
