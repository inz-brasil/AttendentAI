// ingestor.ts — Persiste eventos WhatsApp normalizados com dedupe e classificação de origem
import { eq } from 'drizzle-orm'
import { activateHumanTakeoverPause } from '../automation/human-takeover'
import { db } from '../db/client'
import type {
  MessageEventDeliveryStatus,
  MessageEventSenderType,
  MessageEventSource,
  MessageRole
} from '../db/schema'
import { leads } from '../db/schema'
import type { MessageEvent } from '../db/repositories/message-events.repository'
import { traceEmitter } from '../observability/trace-emitter'
import type { NormalizedWhatsappEvent } from '../webhook/evolution-normalizer'
import { TranscriptDedupe } from './dedupe'
import { classifyBaseEvent, mapNormalizedEventToMessageEvent, type TranscriptClassification } from './mapper'
import { TranscriptRepository } from './repository'
import type { TranscriptDedupeResult } from './dedupe'

export interface TranscriptIngestInput {
  tenantId: string
  event: NormalizedWhatsappEvent
  source?: MessageEventSource
}

export interface TranscriptIngestResult {
  status: 'ingested' | 'deduped' | 'updated'
  event: MessageEvent
  classification: TranscriptClassification
  nextAction: TranscriptClassification['nextAction']
  humanTakeoverActivated: boolean
}

/**
 * Ingere eventos normalizados no transcript canônico message_events.
 */
export class TranscriptIngestor {
  constructor(
    private readonly repository = new TranscriptRepository(),
    private readonly dedupe = new TranscriptDedupe(repository)
  ) {}

  /**
   * Persiste evento normalizado sem cruzar tenants e sem criar duplicatas.
   * @param input Tenant, origem e evento normalizado.
   * @returns Resultado da ingestão.
   */
  async ingest(input: TranscriptIngestInput): Promise<TranscriptIngestResult> {
    const source = input.source ?? 'evolution'
    const dedupe = await this.dedupe.resolve({ tenantId: input.tenantId, source, event: input.event })
    const baseClassification = classifyBaseEvent(input.event)

    if (dedupe.botIntendedMatch) {
      return this.confirmBotDelivery(input, dedupe)
    }

    if (dedupe.duplicate) {
      return this.returnDuplicate(input, dedupe.duplicate, baseClassification)
    }

    return this.insertNewEvent(input, source, baseClassification)
  }

  private async insertNewEvent(
    input: TranscriptIngestInput,
    source: MessageEventSource,
    baseClassification: TranscriptClassification
  ): Promise<TranscriptIngestResult> {
    const inserted = await this.repository.insert(mapNormalizedEventToMessageEvent({
      tenantId: input.tenantId,
      source,
      event: input.event,
      classification: baseClassification
    }))
    const humanTakeoverActivated = baseClassification.nextAction === 'activate_pause'

    if (humanTakeoverActivated) {
      await this.ensureLeadExists(input.event)
      await activateHumanTakeoverPause(input.event.phone, source)
      await traceEmitter.emit('human_takeover_activated', {
        tenant_id: input.tenantId,
        phone: input.event.phone,
        data: {
          source,
          external_message_id: input.event.externalMessageId,
          message_preview: input.event.text.slice(0, 300)
        }
      })
    }

    await this.emitIngestedTrace(input.tenantId, input.event, inserted, baseClassification, 'new_event')

    return {
      status: 'ingested',
      event: inserted,
      classification: baseClassification,
      nextAction: baseClassification.nextAction,
      humanTakeoverActivated
    }
  }

  private async confirmBotDelivery(
    input: TranscriptIngestInput,
    dedupe: TranscriptDedupeResult
  ): Promise<TranscriptIngestResult> {
    const intended = dedupe.botIntendedMatch
    if (!intended) {
      throw new Error('Bot intended match missing')
    }

    await this.repository.updateDeliveryStatus(
      intended.id,
      'sent',
      input.event.externalMessageId || undefined
    )
    const updated = await this.repository.findByExternalIdAnySource(
      input.tenantId,
      input.event.externalMessageId || intended.external_message_id || ''
    ) ?? intended
    const classification = this.botSentClassification()
    await this.emitIngestedTrace(input.tenantId, input.event, updated, classification, 'bot_intended_confirmed')

    return {
      status: 'updated',
      event: updated,
      classification,
      nextAction: classification.nextAction,
      humanTakeoverActivated: false
    }
  }

  private async returnDuplicate(
    input: TranscriptIngestInput,
    duplicate: MessageEvent,
    baseClassification: TranscriptClassification
  ): Promise<TranscriptIngestResult> {
    await this.emitDedupedTrace(input.tenantId, input.event, duplicate, 'duplicate_detected')

    return {
      status: 'deduped',
      event: duplicate,
      classification: baseClassification,
      nextAction: 'record_only',
      humanTakeoverActivated: false
    }
  }

  private botSentClassification(): TranscriptClassification {
    return {
      direction: 'outbound',
      senderType: 'bot',
      role: 'assistant',
      deliveryStatus: 'sent',
      nextAction: 'update_existing'
    }
  }

  private async ensureLeadExists(event: NormalizedWhatsappEvent): Promise<void> {
    const [lead] = await db.select({ phone: leads.phone }).from(leads).where(eq(leads.phone, event.phone)).limit(1)
    if (lead) {
      return
    }

    await db.insert(leads).values({
      phone: event.phone,
      name: event.pushName,
      custom_data: {
        remoteJid: event.remoteJid,
        instance: event.instance,
        instance_id: event.instanceId
      }
    })
  }

  private async emitIngestedTrace(
    tenantId: string,
    event: NormalizedWhatsappEvent,
    persisted: MessageEvent,
    classification: TranscriptClassification,
    reason: string
  ): Promise<void> {
    await traceEmitter.emit('transcript_ingested', {
      tenant_id: tenantId,
      phone: event.phone,
      data: this.buildTraceData(event, persisted, classification, reason)
    })
  }

  private async emitDedupedTrace(
    tenantId: string,
    event: NormalizedWhatsappEvent,
    duplicate: MessageEvent,
    reason: string
  ): Promise<void> {
    await traceEmitter.emit('transcript_deduped', {
      tenant_id: tenantId,
      phone: event.phone,
      status: 'ignored',
      data: {
        reason,
        duplicate_event_id: duplicate.id,
        external_message_id: event.externalMessageId,
        source_event: event.event,
        message_preview: event.text.slice(0, 300)
      }
    })
  }

  private buildTraceData(
    event: NormalizedWhatsappEvent,
    persisted: MessageEvent,
    classification: {
      senderType: MessageEventSenderType
      role: MessageRole
      deliveryStatus: MessageEventDeliveryStatus
      nextAction: string
    },
    reason: string
  ): Record<string, unknown> {
    return {
      reason,
      message_event_id: persisted.id,
      external_message_id: event.externalMessageId,
      source_event: event.event,
      sender_type: classification.senderType,
      role: classification.role,
      delivery_status: classification.deliveryStatus,
      next_action: classification.nextAction,
      is_group: event.isGroup,
      from_me: event.fromMe,
      message_preview: event.text.slice(0, 300)
    }
  }
}
