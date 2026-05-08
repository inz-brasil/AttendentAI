// evolution-normalizer.ts — Normaliza payload bruto da Evolution API para evento WhatsApp tipado
import { z } from 'zod'

export type NormalizedProcessedType = 'text' | 'audio' | 'image' | 'video' | 'document' | 'sticker' | 'reaction' | 'unknown'

export interface NormalizedWhatsappEvent {
  phone: string
  remoteJid: string
  instance: string
  instanceId: string | null
  event: string
  externalMessageId: string
  fromMe: boolean
  isGroup: boolean
  groupParticipant: string | null
  pushName: string
  messageType: string
  processedType: NormalizedProcessedType
  text: string
  quotedMessageId: string | null
  quotedContent: string | null
  mediaUrl: string | null
  timestamp: number
  evolutionUrl: string
  evolutionLocalUrl: string | null
  apiKeyRef: string
  chatwoot: { conversationId: number | null; inboxId: number | null; messageId: number | null }
  raw: unknown
}

const unknownRecordSchema = z.record(z.string(), z.unknown())

const evolutionKeySchema = z.object({
  remoteJid: z.string().min(1),
  fromMe: z.boolean(),
  id: z.string().min(1),
  participant: z.string().optional()
}).passthrough()

const evolutionDataSchema = z.object({
  key: evolutionKeySchema,
  message: unknownRecordSchema.optional().default({}),
  messageTimestamp: z.union([z.number(), z.string()]),
  messageType: z.string().optional(),
  pushName: z.string().optional(),
  contextInfo: unknownRecordSchema.optional(),
  instanceId: z.string().optional(),
  chatwootConversationId: z.number().nullable().optional(),
  chatwootInboxId: z.number().nullable().optional(),
  chatwootMessageId: z.number().nullable().optional()
}).passthrough()

const rawEvolutionPayloadBodySchema = z.object({
  event: z.string().min(1),
  instance: z.string().min(1),
  data: evolutionDataSchema,
  server_url: z.string().optional().default(''),
  apikey: z.string().optional().default(''),
  evolutionLocalUrl: z.string().nullable().optional(),
  url_evolution_local: z.string().nullable().optional()
}).passthrough()

export const rawEvolutionPayloadSchema = z.preprocess((value) => {
  const record = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
  return record && record.body ? record.body : value
}, rawEvolutionPayloadBodySchema)

export type RawEvolutionPayload = z.infer<typeof rawEvolutionPayloadSchema>

/**
 * Normaliza o payload bruto da Evolution API.
 * @param payload Payload validado pelo schema rawEvolutionPayloadSchema.
 * @returns Evento WhatsApp normalizado.
 */
export function normalizeEvolutionRawPayload(payload: RawEvolutionPayload): NormalizedWhatsappEvent {
  const message = payload.data.message
  const remoteJid = payload.data.key.remoteJid
  const quotedInfo = extractQuotedInfo(message, payload.data.contextInfo)

  return {
    phone: normalizePhone(remoteJid),
    remoteJid,
    instance: payload.instance,
    instanceId: payload.data.instanceId ?? null,
    event: payload.event,
    externalMessageId: payload.data.key.id,
    fromMe: payload.data.key.fromMe,
    isGroup: remoteJid.endsWith('@g.us'),
    groupParticipant: payload.data.key.participant ? normalizePhone(payload.data.key.participant) : null,
    pushName: payload.data.pushName ?? '',
    messageType: payload.data.messageType ?? inferMessageType(message),
    processedType: inferProcessedType(message),
    text: extractMainText(message),
    quotedMessageId: quotedInfo.id,
    quotedContent: quotedInfo.content,
    mediaUrl: extractMediaUrl(message),
    timestamp: Number(payload.data.messageTimestamp),
    evolutionUrl: payload.server_url,
    evolutionLocalUrl: payload.evolutionLocalUrl ?? payload.url_evolution_local ?? null,
    apiKeyRef: payload.apikey,
    chatwoot: {
      conversationId: payload.data.chatwootConversationId ?? null,
      inboxId: payload.data.chatwootInboxId ?? null,
      messageId: payload.data.chatwootMessageId ?? null
    },
    raw: payload
  }
}

/**
 * Converte um evento normalizado para o payload legado aceito pelo pipeline atual.
 * @param event Evento normalizado.
 * @returns Payload compatível com POST /api/webhook/evolution.
 */
export function toLegacyEvolutionWebhookPayload(event: NormalizedWhatsappEvent): {
  phone: string
  name: string
  message: string
  message_type: 'text' | 'audio' | 'image'
  timestamp: number
  session_id: string
  current_time: string
  timezone: string
  event: Record<string, unknown>
  contact_info: Record<string, unknown>
} {
  const legacyMessageType = toLegacyMessageType(event.processedType)

  return {
    phone: event.phone,
    name: event.pushName,
    message: event.text,
    message_type: legacyMessageType,
    timestamp: event.timestamp,
    session_id: event.remoteJid,
    current_time: new Date().toISOString(),
    timezone: 'America/Sao_Paulo',
    event: {
      source: 'evolution',
      sender_type: event.fromMe ? 'outbound_unknown' : 'customer',
      from_me: event.fromMe,
      message_id: event.externalMessageId,
      quoted_message_id: event.quotedMessageId,
      remote_jid: event.remoteJid,
      instance: event.instance,
      instance_id: event.instanceId,
      raw_message_type: event.messageType,
      processed_type: event.processedType,
      media_url: event.mediaUrl,
      chatwoot_conversation_id: event.chatwoot.conversationId,
      chatwoot_inbox_id: event.chatwoot.inboxId,
      chatwoot_message_id: event.chatwoot.messageId
    },
    contact_info: {
      remoteJid: event.remoteJid,
      instancia: event.instance,
      instance_id: event.instanceId,
      chatwoot_conversation_id: event.chatwoot.conversationId,
      chatwoot_inbox_id: event.chatwoot.inboxId,
      chatwoot_message_id: event.chatwoot.messageId,
      url_evolution: event.evolutionUrl,
      url_evolution_local: event.evolutionLocalUrl,
      from_me: event.fromMe,
      sender_type: event.fromMe ? 'outbound_unknown' : 'customer',
      quoted_message_id: event.quotedMessageId,
      quoted_content: event.quotedContent,
      group_participant: event.groupParticipant,
      is_group: event.isGroup
    }
  }
}

function normalizePhone(remoteJid: string): string {
  return remoteJid.split('@')[0]?.replace(/\D/g, '') ?? remoteJid
}

function inferProcessedType(message: Record<string, unknown>): NormalizedProcessedType {
  if (hasRecord(message, 'audioMessage')) return 'audio'
  if (hasRecord(message, 'imageMessage')) return 'image'
  if (hasRecord(message, 'videoMessage')) return 'video'
  if (hasRecord(message, 'documentMessage')) return 'document'
  if (hasRecord(message, 'stickerMessage')) return 'sticker'
  if (hasRecord(message, 'reactionMessage')) return 'reaction'
  if (extractMainText(message).trim()) return 'text'
  return 'unknown'
}

function inferMessageType(message: Record<string, unknown>): string {
  const knownTypes = ['conversation', 'extendedTextMessage', 'audioMessage', 'imageMessage', 'videoMessage', 'documentMessage', 'stickerMessage', 'reactionMessage']
  return knownTypes.find((key) => key in message) ?? 'unknown'
}

function extractMainText(message: Record<string, unknown>): string {
  // Texto direto / mensagens de texto
  const textContent =
    readString(message, 'conversation') ??
    readString(getRecord(message, 'extendedTextMessage'), 'text') ??
    readString(getRecord(getRecord(message, 'ephemeralMessage'), 'message'), 'conversation') ??
    readString(getRecord(getRecord(getRecord(message, 'ephemeralMessage'), 'message'), 'extendedTextMessage'), 'text') ??
    readString(getRecord(message, 'imageMessage'), 'caption') ??
    readString(getRecord(message, 'videoMessage'), 'caption') ??
    readString(getRecord(message, 'documentMessage'), 'caption')

  if (textContent != null) return textContent

  // Reação de emoji a uma mensagem
  const reactionMsg = getRecord(message, 'reactionMessage')
  if (reactionMsg != null) {
    const emoji = readString(reactionMsg, 'text') ?? '?'
    const targetKey = getRecord(reactionMsg, 'key')
    // fromMe=true → reação a mensagem do bot; false → reação a mensagem do próprio usuário
    const targetFromMe = targetKey?.fromMe === true
    const targetDesc = targetFromMe ? 'mensagem do bot' : 'mensagem enviada'
    return `[Reação: ${emoji} à ${targetDesc}]`
  }

  // Figurinha
  if (hasRecord(message, 'stickerMessage')) return '[Figurinha]'

  // GIF (videoMessage com gifPlayback=true)
  const videoMsg = getRecord(message, 'videoMessage')
  if (videoMsg != null) {
    return videoMsg.gifPlayback === true ? '[GIF animado]' : '[Vídeo]'
  }

  // Áudio
  if (hasRecord(message, 'audioMessage')) return '[Áudio]'

  // Imagem sem legenda
  if (hasRecord(message, 'imageMessage')) return '[Imagem]'

  // Documento
  if (hasRecord(message, 'documentMessage')) {
    const fileName = readString(getRecord(message, 'documentMessage'), 'fileName')
    return fileName ? `[Documento: ${fileName}]` : '[Documento]'
  }

  return ''
}

function extractQuotedInfo(
  message: Record<string, unknown>,
  dataContext: Record<string, unknown> | undefined
): { id: string | null; content: string | null } {
  const contexts = [
    getRecord(getRecord(message, 'extendedTextMessage'), 'contextInfo'),
    dataContext,
    getRecord(message, 'contextInfo'),
    getRecord(getRecord(getRecord(getRecord(message, 'ephemeralMessage'), 'message'), 'extendedTextMessage'), 'contextInfo')
  ]

  for (const context of contexts) {
    const quoted = getRecord(context, 'quotedMessage')
    const content = quoted ? extractMainText(quoted) : ''
    if (content) {
      return { id: readString(context, 'stanzaId') ?? null, content }
    }
  }

  return { id: null, content: null }
}

function extractMediaUrl(message: Record<string, unknown>): string | null {
  return (
    readString(getRecord(message, 'audioMessage'), 'url') ??
    readString(getRecord(message, 'imageMessage'), 'url') ??
    readString(getRecord(message, 'videoMessage'), 'url') ??
    readString(getRecord(message, 'documentMessage'), 'url') ??
    null
  )
}

function toLegacyMessageType(processedType: NormalizedProcessedType): 'text' | 'audio' | 'image' {
  if (processedType === 'audio') return 'audio'
  if (processedType === 'image') return 'image'
  return 'text'  // reaction, sticker, video, document, unknown → text (legado)
}

function getRecord(source: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = source?.[key]
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function hasRecord(source: Record<string, unknown>, key: string): boolean {
  return getRecord(source, key) !== undefined
}

function readString(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key]
  return typeof value === 'string' ? value : undefined
}
