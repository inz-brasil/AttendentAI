// backfill-ingestor.ts — Normaliza mensagens WACLI e ingere no transcript canônico
import { TranscriptIngestor } from '../transcript/ingestor'
import type { NormalizedWhatsappEvent, NormalizedProcessedType } from '../webhook/evolution-normalizer'

export interface WacliBackfillMessage {
  id?: string
  messageId?: string
  MessageID?: string
  ID?: string
  timestamp?: string | number
  Timestamp?: string | number
  fromMe?: boolean
  FromMe?: boolean
  text?: string
  Text?: string
  displayText?: string
  DisplayText?: string
  chatJid?: string
  ChatJID?: string
  ChatJid?: string
  chatName?: string
  ChatName?: string
  sender?: string
  Sender?: string
  messageType?: string
  MessageType?: string
}

export interface WacliBackfillIngestInput {
  tenantId: string
  phone: string
  chatJid: string
  instance?: string | null
  messages: WacliBackfillMessage[]
}

export interface WacliBackfillIngestResult {
  total: number
  ingested: number
  deduped: number
  updated: number
}

/**
 * Ingere histórico WACLI via TranscriptIngestor com source=wacli.
 */
export class WacliBackfillIngestor {
  constructor(private readonly transcriptIngestor = new TranscriptIngestor()) {}

  /**
   * Normaliza e persiste mensagens de backfill sem duplicar Evolution.
   * @param input Mensagens WACLI já obtidas do store/CLI.
   * @returns Contadores de ingestão.
   */
  async ingest(input: WacliBackfillIngestInput): Promise<WacliBackfillIngestResult> {
    const result = { total: input.messages.length, ingested: 0, deduped: 0, updated: 0 }

    for (const message of input.messages) {
      const event = normalizeWacliMessage(input, message)
      if (!event.text.trim()) {
        continue
      }

      const ingestResult = await this.transcriptIngestor.ingest({
        tenantId: input.tenantId,
        source: 'wacli',
        event
      })

      if (ingestResult.status === 'ingested') result.ingested += 1
      if (ingestResult.status === 'deduped') result.deduped += 1
      if (ingestResult.status === 'updated') result.updated += 1
    }

    return result
  }
}

function normalizeWacliMessage(input: WacliBackfillIngestInput, message: WacliBackfillMessage): NormalizedWhatsappEvent {
  const remoteJid = readString(message.chatJid, message.ChatJID, message.ChatJid) ?? input.chatJid
  const timestamp = normalizeTimestamp(readValue(message.timestamp, message.Timestamp))
  const text = readString(message.text, message.Text, message.displayText, message.DisplayText) ?? ''
  const messageType = readString(message.messageType, message.MessageType) ?? 'conversation'
  const processedType = inferProcessedType(messageType)

  return {
    phone: input.phone.replace(/\D/g, '') || input.phone,
    remoteJid,
    instance: input.instance ?? '',
    instanceId: null,
    event: 'wacli.backfill',
    externalMessageId: readString(message.id, message.messageId, message.MessageID, message.ID) ?? buildFallbackExternalId(remoteJid, timestamp, text),
    fromMe: Boolean(readValue(message.fromMe, message.FromMe)),
    isGroup: remoteJid.endsWith('@g.us'),
    groupParticipant: readString(message.sender, message.Sender),
    pushName: readString(message.chatName, message.ChatName) ?? '',
    messageType,
    processedType,
    text,
    quotedMessageId: null,
    quotedContent: null,
    mediaUrl: null,
    timestamp,
    evolutionUrl: '',
    evolutionLocalUrl: null,
    apiKeyRef: '',
    chatwoot: { conversationId: null, inboxId: null, messageId: null },
    raw: message
  }
}

function inferProcessedType(messageType: string): NormalizedProcessedType {
  const normalized = messageType.toLowerCase()
  if (normalized.includes('audio')) return 'audio'
  if (normalized.includes('image')) return 'image'
  if (normalized.includes('video')) return 'video'
  if (normalized.includes('document')) return 'document'
  if (normalized.includes('sticker')) return 'sticker'
  return 'text'
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value)
  }

  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) {
      return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric)
    }

    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) {
      return Math.floor(date.getTime() / 1000)
    }
  }

  return Math.floor(Date.now() / 1000)
}

function buildFallbackExternalId(remoteJid: string, timestamp: number, text: string): string {
  return `wacli:${remoteJid}:${timestamp}:${text.slice(0, 80)}`
}

function readValue(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null)
}

function readString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return null
}
