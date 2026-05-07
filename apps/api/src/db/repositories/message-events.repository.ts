// message-events.repository.ts — Persiste e consulta o transcript multi-tenant de conversas reais
import { createHash } from 'node:crypto'
import { and, desc, eq, gte } from 'drizzle-orm'
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import { db } from '../client'
import {
  messageEvents,
  type MessageEventDeliveryStatus,
  type MessageEventDirection,
  type MessageEventSource
} from '../schema'

export type MessageEvent = InferSelectModel<typeof messageEvents>
export type NewMessageEvent = Omit<
  InferInsertModel<typeof messageEvents>,
  'id' | 'content_hash' | 'created_at' | 'updated_at'
> & {
  id?: string
  content_hash?: string
  created_at?: Date
  updated_at?: Date
}

const messageEventSources = new Set<string>(['evolution', 'wacli', 'dashboard', 'internal', 'n8n_legacy'])
const messageEventDirections = new Set<string>(['inbound', 'outbound'])
const deliveryStatuses = new Set<string>(['received', 'intended', 'sent', 'failed', 'ignored', 'unknown'])
const crockfordBase32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * Insere e consulta eventos de mensagem com isolamento por tenant.
 */
export class MessageEventsRepository {
  /**
   * Insere um evento de mensagem e retorna o registro persistido.
   * @param event Evento normalizado de mensagem.
   * @returns Evento persistido.
   */
  async insert(event: NewMessageEvent): Promise<MessageEvent> {
    const id = event.id ?? createUlid()
    const now = new Date()
    const contentHash = event.content_hash ?? hashContent(event.content)

    await db.insert(messageEvents).values({
      ...event,
      id,
      content_hash: contentHash,
      created_at: event.created_at ?? now,
      updated_at: event.updated_at ?? now
    })

    return this.findById(id)
  }

  /**
   * Busca eventos recentes de um telefone dentro de um tenant.
   * @param tenantId Tenant isolado.
   * @param phone Telefone do lead.
   * @param limit Limite máximo de eventos.
   * @returns Eventos em ordem cronológica.
   */
  async findByPhone(tenantId: string, phone: string, limit: number): Promise<MessageEvent[]> {
    const rows = await db
      .select()
      .from(messageEvents)
      .where(and(eq(messageEvents.tenant_id, tenantId), eq(messageEvents.lead_phone, phone)))
      .orderBy(desc(messageEvents.whatsapp_timestamp), desc(messageEvents.created_at))
      .limit(limit)

    return rows.reverse()
  }

  /**
   * Busca um evento por id externo dentro da origem e tenant.
   * @param tenantId Tenant isolado.
   * @param source Origem externa.
   * @param externalId Id da mensagem na origem.
   * @returns Evento encontrado ou null.
   */
  async findByExternalId(tenantId: string, source: string, externalId: string): Promise<MessageEvent | null> {
    if (!isMessageEventSource(source)) {
      return null
    }

    const [event] = await db
      .select()
      .from(messageEvents)
      .where(and(
        eq(messageEvents.tenant_id, tenantId),
        eq(messageEvents.source, source),
        eq(messageEvents.external_message_id, externalId)
      ))
      .limit(1)

    return event ?? null
  }

  /**
   * Busca duplicata por hash dentro de uma janela de tempo e tenant.
   * @param tenantId Tenant isolado.
   * @param phone Telefone do lead.
   * @param direction Direção da mensagem.
   * @param contentHash Hash sha256 do conteúdo.
   * @param windowMs Janela em milissegundos.
   * @returns Evento duplicado ou null.
   */
  async findByDedupe(
    tenantId: string,
    phone: string,
    direction: string,
    contentHash: string,
    windowMs: number
  ): Promise<MessageEvent | null> {
    if (!isMessageEventDirection(direction)) {
      return null
    }

    const windowStart = new Date(Date.now() - windowMs)
    const [event] = await db
      .select()
      .from(messageEvents)
      .where(and(
        eq(messageEvents.tenant_id, tenantId),
        eq(messageEvents.lead_phone, phone),
        eq(messageEvents.direction, direction),
        eq(messageEvents.content_hash, contentHash),
        gte(messageEvents.created_at, windowStart)
      ))
      .orderBy(desc(messageEvents.created_at))
      .limit(1)

    return event ?? null
  }

  /**
   * Atualiza o status de entrega de um evento.
   * @param id Id interno do evento.
   * @param status Novo status de entrega.
   * @param externalMessageId Id externo retornado pelo provedor, quando existir.
   * @returns Nada.
   */
  async updateDeliveryStatus(id: string, status: string, externalMessageId?: string): Promise<void> {
    if (!isDeliveryStatus(status)) {
      throw new Error(`Invalid delivery status: ${status}`)
    }

    await db
      .update(messageEvents)
      .set({
        delivery_status: status,
        ...(externalMessageId ? { external_message_id: externalMessageId } : {}),
        updated_at: new Date()
      })
      .where(eq(messageEvents.id, id))
  }

  private async findById(id: string): Promise<MessageEvent> {
    const [event] = await db.select().from(messageEvents).where(eq(messageEvents.id, id)).limit(1)
    if (!event) {
      throw new Error(`Message event not found after insert: ${id}`)
    }

    return event
  }
}

/**
 * Gera hash sha256 estável para dedupe de conteúdo.
 * @param content Conteúdo textual final da mensagem.
 * @returns Hash sha256 hexadecimal.
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function createUlid(): string {
  const now = Date.now()
  let timestamp = ''
  let value = now
  for (let index = 0; index < 10; index += 1) {
    timestamp = crockfordBase32[value % 32] + timestamp
    value = Math.floor(value / 32)
  }

  let randomness = ''
  for (let index = 0; index < 16; index += 1) {
    randomness += crockfordBase32[Math.floor(Math.random() * 32)]
  }

  return timestamp + randomness
}

function isMessageEventSource(source: string): source is MessageEventSource {
  return messageEventSources.has(source)
}

function isMessageEventDirection(direction: string): direction is MessageEventDirection {
  return messageEventDirections.has(direction)
}

function isDeliveryStatus(status: string): status is MessageEventDeliveryStatus {
  return deliveryStatuses.has(status)
}
