// repository.ts — Consultas específicas do transcript sobre message_events
import { and, asc, desc, eq, gte, inArray, isNull } from 'drizzle-orm'
import { db } from '../db/client'
import {
  messageEvents,
  type MessageEventDeliveryStatus,
  type MessageEventDirection,
  type MessageEventSource
} from '../db/schema'
import {
  MessageEventsRepository,
  type MessageEvent,
  type NewMessageEvent
} from '../db/repositories/message-events.repository'

/**
 * Encapsula persistência e buscas necessárias para ingestão do transcript.
 */
export class TranscriptRepository {
  private readonly baseRepository = new MessageEventsRepository()

  /**
   * Insere um evento no transcript.
   * @param event Evento pronto para persistência.
   * @returns Evento persistido.
   */
  async insert(event: NewMessageEvent): Promise<MessageEvent> {
    return this.baseRepository.insert(event)
  }

  /**
   * Busca por id externo respeitando source.
   * @param tenantId Tenant isolado.
   * @param source Origem.
   * @param externalId Id externo.
   * @returns Evento ou null.
   */
  async findByExternalId(
    tenantId: string,
    source: MessageEventSource,
    externalId: string
  ): Promise<MessageEvent | null> {
    return this.baseRepository.findByExternalId(tenantId, source, externalId)
  }

  /**
   * Busca por id externo em qualquer source, usado para backfill WACLI.
   * @param tenantId Tenant isolado.
   * @param externalId Id externo.
   * @returns Evento ou null.
   */
  async findByExternalIdAnySource(tenantId: string, externalId: string): Promise<MessageEvent | null> {
    const [event] = await db
      .select()
      .from(messageEvents)
      .where(and(
        eq(messageEvents.tenant_id, tenantId),
        eq(messageEvents.external_message_id, externalId)
      ))
      .orderBy(desc(messageEvents.created_at))
      .limit(1)

    return event ?? null
  }

  /**
   * Busca duplicata por hash dentro de uma janela.
   * @param tenantId Tenant isolado.
   * @param phone Telefone do lead.
   * @param direction Direção.
   * @param contentHash Hash sha256.
   * @param windowMs Janela em milissegundos.
   * @returns Evento ou null.
   */
  async findByDedupe(
    tenantId: string,
    phone: string,
    direction: MessageEventDirection,
    contentHash: string,
    windowMs: number
  ): Promise<MessageEvent | null> {
    return this.baseRepository.findByDedupe(tenantId, phone, direction, contentHash, windowMs)
  }

  /**
   * Busca evento intended de bot que corresponde à confirmação do provedor.
   * @param tenantId Tenant isolado.
   * @param phone Telefone do lead.
   * @param contentHash Hash do conteúdo enviado.
   * @param externalMessageId Id externo, quando já conhecido.
   * @param windowMs Janela em milissegundos.
   * @returns Evento intended do bot ou null.
   */
  async findRecentBotIntended(
    tenantId: string,
    phone: string,
    contentHash: string,
    externalMessageId: string | null,
    windowMs: number
  ): Promise<MessageEvent | null> {
    const windowStart = new Date(Date.now() - windowMs)
    const candidates = await db
      .select()
      .from(messageEvents)
      .where(and(
        eq(messageEvents.tenant_id, tenantId),
        eq(messageEvents.lead_phone, phone),
        eq(messageEvents.direction, 'outbound'),
        eq(messageEvents.sender_type, 'bot'),
        eq(messageEvents.delivery_status, 'intended'),
        gte(messageEvents.created_at, windowStart)
      ))
      .orderBy(desc(messageEvents.created_at))
      .limit(20)

    return candidates.find((event) => {
      const externalMatch = Boolean(externalMessageId && event.external_message_id === externalMessageId)
      return externalMatch || event.content_hash === contentHash
    }) ?? null
  }

  /**
   * Atualiza status de entrega de um evento.
   * @param id Id interno.
   * @param status Novo status.
   * @param externalMessageId Id externo opcional.
   * @returns Nada.
   */
  async updateDeliveryStatus(
    id: string,
    status: MessageEventDeliveryStatus,
    externalMessageId?: string
  ): Promise<void> {
    await this.baseRepository.updateDeliveryStatus(id, status, externalMessageId)
  }

  /**
   * Busca mensagens recebidas ainda sem batch para um telefone.
   * @param tenantId Tenant isolado.
   * @param phone Telefone do lead.
   * @param limit Limite máximo de mensagens.
   * @returns Eventos pendentes em ordem cronológica.
   */
  async findPendingReceivedBatch(tenantId: string, phone: string, limit: number): Promise<MessageEvent[]> {
    return db
      .select()
      .from(messageEvents)
      .where(and(
        eq(messageEvents.tenant_id, tenantId),
        eq(messageEvents.lead_phone, phone),
        eq(messageEvents.delivery_status, 'received'),
        isNull(messageEvents.batch_id)
      ))
      .orderBy(asc(messageEvents.whatsapp_timestamp), asc(messageEvents.created_at))
      .limit(limit)
  }

  /**
   * Atribui o mesmo batch_id aos eventos selecionados.
   * @param eventIds Ids internos dos eventos.
   * @param batchId Id do batch.
   * @returns Nada.
   */
  async assignBatchId(eventIds: string[], batchId: string): Promise<void> {
    if (eventIds.length === 0) {
      return
    }

    await db
      .update(messageEvents)
      .set({ batch_id: batchId, updated_at: new Date() })
      .where(inArray(messageEvents.id, eventIds))
  }
}
