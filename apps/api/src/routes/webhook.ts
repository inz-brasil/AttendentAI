// webhook.ts — Recebe webhooks do n8n e valida payloads do WhatsApp
import { and, desc, eq, gte } from 'drizzle-orm'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  activateAutomationBlacklist,
  canReplyAutomatically,
  getSettingValue
} from '../automation/control'
import { WEBHOOK_PHONE_RATE_LIMIT_PER_MINUTE } from '../config/constants'
import { env } from '../config/env'
import { db } from '../db/client'
import { messages } from '../db/schema'
import { getOrCreateLead, saveMessage } from '../memory/persistent'
import { enforcePhoneRateLimit } from '../rate-limit'
import { enqueueMessage } from '../queue/message-queue'
import { PhoneLockedError, QueryEngine } from '../orchestrator'
import { recordTrace } from '../monitoring/trace-recorder'
import { traceEmitter } from '../observability/trace-emitter'
import { AutomationDecisionEngine } from '../automation/decision-engine'
import { MediaProcessor } from '../media/media-processor'
import { TranscriptIngestor } from '../transcript/ingestor'
import {
  normalizeEvolutionRawPayload,
  rawEvolutionPayloadSchema,
  toLegacyEvolutionWebhookPayload,
  type NormalizedWhatsappEvent
} from '../webhook/evolution-normalizer'

const webhookPayloadSchema = z.object({
  phone: z.string().min(1),
  name: z.string(),
  message: z.string().min(1),
  message_type: z.enum(['text', 'audio', 'image']),
  timestamp: z.number().int(),
  session_id: z.string().optional(),
  current_time: z.string().optional(),
  timezone: z.string().optional(),
  contact_info: z
    .object({
      email: z.string().optional(),
      city: z.string().optional(),
      timezone: z.string().optional()
    })
    .catchall(z.unknown())
    .optional()
})

const webhookQuerySchema = z.object({
  sync: z.enum(['true', 'false']).optional()
})

const evolutionPayloadSchema = webhookPayloadSchema.extend({
  event: z
    .object({
      source: z.string().optional(),
      sender_type: z.string().optional(),
      from_me: z.boolean().optional(),
      message_id: z.string().nullable().optional(),
      quoted_message_id: z.string().nullable().optional(),
      remote_jid: z.string().nullable().optional(),
      instance: z.string().nullable().optional(),
      instance_id: z.string().nullable().optional(),
      raw_message_type: z.string().nullable().optional(),
      processed_type: z.string().nullable().optional(),
      media_url: z.string().nullable().optional(),
      chatwoot_conversation_id: z.number().nullable().optional(),
      chatwoot_inbox_id: z.number().nullable().optional(),
      chatwoot_message_id: z.number().nullable().optional()
    })
    .catchall(z.unknown())
    .optional()
})

type WebhookPayload = z.infer<typeof webhookPayloadSchema>
type EvolutionPayload = z.infer<typeof evolutionPayloadSchema>
type WebhookRouteReply = FastifyReply

function validateAuth(request: FastifyRequest): boolean {
  return request.headers.authorization === `Bearer ${env.WEBHOOK_SECRET}`
}

function resolveTenantId(request: FastifyRequest): string {
  const header = request.headers['x-tenant-id']
  if (typeof header === 'string' && header.trim()) {
    return header.trim()
  }

  const body = toRecord(request.body)
  const bodyTenantId = body ? body.tenant_id : undefined
  return typeof bodyTenantId === 'string' && bodyTenantId.trim() ? bodyTenantId.trim() : 'default'
}

async function emitWebhookReceivedTrace(tenantId: string, rawPayload: unknown): Promise<void> {
  const raw = toRecord(rawPayload)
  await traceEmitter.emit('webhook_received', {
    tenant_id: tenantId,
    data: {
      instance: readString(raw, 'instance'),
      event_type: readString(raw, 'event'),
      raw_size: estimatePayloadSize(rawPayload)
    }
  })
}

async function emitWebhookRejectedTrace(
  tenantId: string,
  event: NormalizedWhatsappEvent,
  reason: string
): Promise<void> {
  await traceEmitter.emit('webhook_rejected', {
    tenant_id: tenantId,
    phone: event.phone,
    status: 'ignored',
    data: {
      event_type: event.event,
      instance: event.instance,
      message_id: event.externalMessageId,
      reason
    }
  })
}

async function emitRejectedTraceForDecision(
  tenantId: string,
  event: NormalizedWhatsappEvent,
  reason: string
): Promise<void> {
  if (reason !== 'group_ignored' && reason !== 'unsupported_event') {
    return
  }

  await emitWebhookRejectedTrace(tenantId, event, reason)
}

function estimatePayloadSize(payload: unknown): number {
  try {
    return JSON.stringify(payload).length
  } catch {
    return 0
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key]
  return typeof value === 'string' ? value : null
}

/**
 * Registra a rota POST /api/webhook.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  const queryEngine = new QueryEngine()
  const transcriptIngestor = new TranscriptIngestor()
  const automationDecisionEngine = new AutomationDecisionEngine()
  const mediaProcessor = new MediaProcessor()

  app.post('/api/webhook', async (request, reply) => {
    if (!validateAuth(request)) {
      return reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    }

    const parsed = webhookPayloadSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid webhook payload',
        code: 'INVALID_PAYLOAD',
        details: parsed.error.issues
      })
    }

    const payload: WebhookPayload = parsed.data
    const allowed = await enforcePhoneRateLimit(request, reply, payload.phone, WEBHOOK_PHONE_RATE_LIMIT_PER_MINUTE)
    if (!allowed) {
      return reply
    }

    request.log.info({ phone: payload.phone, timestamp: payload.timestamp }, 'webhook received')

    const query = webhookQuerySchema.parse(request.query)
    const sync = query.sync === 'true'

    if (!sync) {
      const job = await enqueueMessage(payload)
      request.log.info({ jobId: job.id, phone: payload.phone }, 'webhook enqueued')
      return reply.code(202).send({ success: true, job_id: job.id, status: 'queued' })
    }

    try {
      const response = await queryEngine.process(payload)
      request.log.info(response.metadata, 'webhook processed')
      return response
    } catch (error) {
      if (error instanceof PhoneLockedError) {
        return reply.code(429).send({ error: 'Mensagem anterior ainda processando', code: 'PHONE_LOCKED' })
      }

      await recordTrace({
        phone: payload.phone,
        agent: 'orchestrator',
        eventType: 'pipeline_error',
        title: 'Erro no processamento do webhook',
        data: {
          message: error instanceof Error ? error.message : 'Unknown error',
          name: error instanceof Error ? error.name : 'UnknownError'
        }
      })

      throw error
    }
  })

  app.post('/api/webhook/evolution/raw', async (request, reply) => {
    const tenantId = resolveTenantId(request)
    await emitWebhookReceivedTrace(tenantId, request.body)

    if (!validateAuth(request)) {
      return reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    }

    const parsed = rawEvolutionPayloadSchema.safeParse(request.body)
    if (!parsed.success) {
      await traceEmitter.emit('webhook_rejected', {
        tenant_id: tenantId,
        status: 'error',
        data: {
          reason: 'invalid_payload',
          issues: parsed.error.issues
        }
      })
      return reply.code(400).send({
        error: 'Invalid Evolution raw payload',
        code: 'INVALID_PAYLOAD',
        details: parsed.error.issues
      })
    }

    const normalized = normalizeEvolutionRawPayload(parsed.data)
    if (normalized.event !== 'messages.upsert') {
      await emitWebhookRejectedTrace(tenantId, normalized, 'unsupported_event')
      const decision = await automationDecisionEngine.decide({ tenantId, event: normalized, transcript: null })
      return reply.code(200).send({
        success: true,
        action: 'ignored',
        reason: decision.reason,
        event: normalized.event
      })
    }

    const transcript = await transcriptIngestor.ingest({ tenantId, event: normalized, source: 'evolution' })
    if (shouldProcessMedia(normalized.processedType) && transcript.status === 'ingested') {
      mediaProcessor.processInBackground({ tenantId, event: normalized, messageEvent: transcript.event })
    }

    const decision = await automationDecisionEngine.decide({ tenantId, event: normalized, transcript })
    if (!decision.shouldReply) {
      await emitRejectedTraceForDecision(tenantId, normalized, decision.reason)
      return reply.code(200).send({
        success: true,
        should_reply: false,
        action: 'record_only',
        reason: decision.reason,
        transcript_event_id: transcript.event.id,
        delivery_status: transcript.event.delivery_status,
        pause_expires_at: decision.pauseExpiresAt,
        message: ''
      })
    }

    if (shouldProcessMedia(normalized.processedType)) {
      return reply.code(202).send({
        success: true,
        should_reply: false,
        action: 'media_processing',
        reason: 'media_processing_async',
        transcript_event_id: transcript.event.id,
        delivery_status: transcript.event.delivery_status,
        message: ''
      })
    }

    if (!decision.shouldProcess || transcript.nextAction !== 'enqueue') {
      return reply.code(200).send({
        success: true,
        should_reply: false,
        action: 'record_only',
        reason: transcript.status,
        transcript_event_id: transcript.event.id,
        message: ''
      })
    }

    const allowed = await enforcePhoneRateLimit(request, reply, normalized.phone, WEBHOOK_PHONE_RATE_LIMIT_PER_MINUTE)
    if (!allowed) {
      return reply
    }

    const legacyPayload = toLegacyEvolutionWebhookPayload(normalized)
    return processRawAllowedPayload(legacyPayload, reply, queryEngine, decision.reason)
  })

  app.post('/api/webhook/evolution', async (request, reply) => {
    if (!validateAuth(request)) {
      return reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    }

    const parsed = evolutionPayloadSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Invalid webhook payload',
        code: 'INVALID_PAYLOAD',
        details: parsed.error.issues
      })
    }

    const payload = normalizeEvolutionPayload(parsed.data)
    return processEvolutionPayload(payload, request, reply, queryEngine)
  })
}

function shouldProcessMedia(processedType: string): boolean {
  return processedType !== 'text' && processedType !== 'unknown'
}

async function processRawAllowedPayload(
  payload: EvolutionPayload,
  reply: WebhookRouteReply,
  queryEngine: QueryEngine,
  reason: string
): Promise<Record<string, unknown> | WebhookRouteReply> {
  try {
    const response = await queryEngine.process(payload)
    return {
      ...response,
      should_reply: Boolean(response.message),
      action: 'reply',
      reason
    }
  } catch (error) {
    if (error instanceof PhoneLockedError) {
      return reply.code(429).send({ error: 'Mensagem anterior ainda processando', code: 'PHONE_LOCKED' })
    }

    throw error
  }
}

async function processEvolutionPayload(
  payload: EvolutionPayload,
  request: FastifyRequest,
  reply: WebhookRouteReply,
  queryEngine: QueryEngine
): Promise<Record<string, unknown> | WebhookRouteReply> {
  const allowed = await enforcePhoneRateLimit(request, reply, payload.phone, WEBHOOK_PHONE_RATE_LIMIT_PER_MINUTE)
  if (!allowed) {
    return reply
  }

  if (payload.event?.from_me === true || payload.contact_info?.from_me === true) {
    return handleOutboundEvolutionEvent(payload)
  }

  return processInboundEvolutionPayload(payload, reply, queryEngine)
}

async function processInboundEvolutionPayload(
  payload: EvolutionPayload,
  reply: WebhookRouteReply,
  queryEngine: QueryEngine
): Promise<Record<string, unknown> | WebhookRouteReply> {
  if (await isLikelyWacliSelfEcho(payload)) {
    return handleWacliSelfEcho(payload)
  }

  if (await isInternalAssistantContact(payload)) {
    return processInternalAssistantEvolutionPayload(payload, reply, queryEngine)
  }

  const decision = await canReplyAutomatically(payload.phone)
  if (!decision.allowed) {
    return handleAutomationBlocked(payload, decision)
  }

  return processAllowedEvolutionPayload(payload, reply, queryEngine, decision)
}

async function handleWacliSelfEcho(payload: EvolutionPayload): Promise<Record<string, unknown>> {
  await recordTrace({
    phone: payload.phone,
    agent: 'automation-control',
    eventType: 'wacli_self_echo_ignored',
    title: 'Eco de envio WACLI ignorado',
    data: {
      message_preview: payload.message.slice(0, 300),
      remote_jid: payload.event?.remote_jid ?? payload.contact_info?.remoteJid
    }
  })

  return {
    success: true,
    should_reply: false,
    action: 'record_only',
    reason: 'wacli_self_echo',
    message: ''
  }
}

async function processInternalAssistantEvolutionPayload(
  payload: EvolutionPayload,
  reply: WebhookRouteReply,
  queryEngine: QueryEngine
): Promise<Record<string, unknown> | WebhookRouteReply> {
  try {
    const response = await queryEngine.process(payload)
    return {
      ...response,
      should_reply: Boolean(response.message),
      action: 'reply',
      reason: 'internal_assistant'
    }
  } catch (error) {
    if (error instanceof PhoneLockedError) {
      return reply.code(429).send({ error: 'Mensagem anterior ainda processando', code: 'PHONE_LOCKED' })
    }

    throw error
  }
}

async function handleAutomationBlocked(
  payload: EvolutionPayload,
  decision: Awaited<ReturnType<typeof canReplyAutomatically>>
): Promise<Record<string, unknown>> {
  await getOrCreateLead(payload.phone, payload.name, payload.contact_info)
  await saveMessage(payload.phone, 'user', payload.message, {
    message_type: payload.message_type,
    intent: decision.reason,
    agent_used: 'automation-control'
  })
  await recordTrace({
    phone: payload.phone,
    agent: 'automation-control',
    eventType: 'auto_reply_blocked',
    title: 'Mensagem registrada sem resposta automática',
    data: {
      reason: decision.reason,
      schedule: decision.schedule,
      blacklist: decision.blacklist,
      message_preview: payload.message.slice(0, 300)
    }
  })

  return {
    success: true,
    should_reply: false,
    action: 'record_only',
    reason: decision.reason,
    message: '',
    audio_requested: false,
    blacklist: decision.blacklist,
    schedule: decision.schedule,
    metadata: {
      lead_id: payload.phone,
      agent_used: 'automation-control',
      tokens_used: 0,
      processing_ms: 0
    }
  }
}

async function processAllowedEvolutionPayload(
  payload: EvolutionPayload,
  reply: WebhookRouteReply,
  queryEngine: QueryEngine,
  decision: Awaited<ReturnType<typeof canReplyAutomatically>>
): Promise<Record<string, unknown> | WebhookRouteReply> {
  try {
    const response = await queryEngine.process(payload)
    return {
      ...response,
      should_reply: Boolean(response.message),
      action: 'reply',
      reason: 'allowed',
      blacklist: decision.blacklist,
      schedule: decision.schedule
    }
  } catch (error) {
    if (error instanceof PhoneLockedError) {
      return reply.code(429).send({ error: 'Mensagem anterior ainda processando', code: 'PHONE_LOCKED' })
    }

    throw error
  }
}

async function handleOutboundEvolutionEvent(payload: EvolutionPayload): Promise<Record<string, unknown>> {
  await getOrCreateLead(payload.phone, payload.name, payload.contact_info)
  const source = await inferOutboundSource(payload)

  if (source === 'bot') {
    await recordTrace({
      phone: payload.phone,
      agent: 'automation-control',
      eventType: 'outbound_bot_seen',
      title: 'Mensagem enviada pelo bot registrada pela Evolution',
      data: {
        message_id: payload.event?.message_id,
        message_preview: payload.message.slice(0, 300)
      }
    })
    return {
      success: true,
      should_reply: false,
      action: 'record_only',
      reason: 'bot_outbound_seen',
      message: ''
    }
  }

  await saveMessage(payload.phone, 'human_agent', payload.message, {
    message_type: payload.message_type,
    intent: 'human_takeover',
    agent_used: 'human-agent'
  })
  const blacklist = await activateAutomationBlacklist(payload.phone, 'human_takeover', 'evolution')
  await recordTrace({
    phone: payload.phone,
    agent: 'automation-control',
    eventType: 'human_takeover_detected',
    title: 'Atendimento humano detectado',
    data: {
      message_id: payload.event?.message_id,
      message_preview: payload.message.slice(0, 300),
      blacklist_expires_at: blacklist.expires_at
    }
  })

  return {
    success: true,
    should_reply: false,
    action: 'record_only',
    reason: 'human_takeover',
    message: '',
    blacklist: {
      active: true,
      reason: 'human_takeover',
      expires_at: blacklist.expires_at
    }
  }
}

function normalizeEvolutionPayload(payload: EvolutionPayload): EvolutionPayload {
  const phone = payload.phone.replace(/\D/g, '') || payload.phone
  return {
    ...payload,
    phone,
    contact_info: {
      ...(payload.contact_info ?? {}),
      from_me: payload.event?.from_me ?? payload.contact_info?.from_me,
      sender_type: payload.event?.sender_type ?? payload.contact_info?.sender_type,
      remoteJid: payload.event?.remote_jid ?? payload.contact_info?.remoteJid,
      instancia: payload.event?.instance ?? payload.contact_info?.instancia,
      instance_id: payload.event?.instance_id ?? payload.contact_info?.instance_id,
      chatwoot_conversation_id: payload.event?.chatwoot_conversation_id ?? payload.contact_info?.chatwoot_conversation_id,
      chatwoot_inbox_id: payload.event?.chatwoot_inbox_id ?? payload.contact_info?.chatwoot_inbox_id,
      chatwoot_message_id: payload.event?.chatwoot_message_id ?? payload.contact_info?.chatwoot_message_id
    }
  }
}

async function inferOutboundSource(payload: EvolutionPayload): Promise<'bot' | 'human_agent'> {
  const senderType = payload.event?.sender_type ?? String(payload.contact_info?.sender_type ?? '')
  if (senderType === 'bot') return 'bot'
  if (senderType === 'human_agent') return 'human_agent'

  const recentWindow = new Date(Date.now() - 10 * 60_000)
  const recentAssistantMessages = await db
    .select({ content: messages.content })
    .from(messages)
    .where(and(eq(messages.lead_phone, payload.phone), eq(messages.role, 'assistant'), gte(messages.created_at, recentWindow)))
    .orderBy(desc(messages.created_at))
    .limit(10)
  const normalizedPayload = normalizeText(payload.message)
  const matchedBotMessage = recentAssistantMessages.some((message) => normalizeText(message.content ?? '') === normalizedPayload)
  return matchedBotMessage ? 'bot' : 'human_agent'
}

async function isLikelyWacliSelfEcho(payload: EvolutionPayload): Promise<boolean> {
  if (!(await isInternalAssistantContact(payload))) {
    return false
  }

  const recentWindow = new Date(Date.now() - 10 * 60_000)
  const recentWacliMessages = await db
    .select({ content: messages.content })
    .from(messages)
    .where(and(
      eq(messages.lead_phone, payload.phone),
      eq(messages.role, 'assistant'),
      eq(messages.agent_used, 'internal-assistant-wacli'),
      gte(messages.created_at, recentWindow)
    ))
    .orderBy(desc(messages.created_at))
    .limit(10)

  const normalizedPayload = normalizeText(payload.message)
  return recentWacliMessages.some((message) => normalizeText(message.content ?? '') === normalizedPayload)
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

async function isInternalAssistantContact(payload: EvolutionPayload): Promise<boolean> {
  const raw = await getSettingValue('internal_assistant_contacts', '')
  const contacts = parseContactList(raw)
  if (contacts.length === 0) return false

  const identifiers = [
    payload.phone,
    payload.session_id,
    String(payload.contact_info?.remoteJid ?? ''),
    String(payload.contact_info?.jid ?? ''),
    String(payload.event?.remote_jid ?? '')
  ].filter((item): item is string => typeof item === 'string' && item.length > 0)

  return identifiers.some((identifier) => contacts.includes(identifier))
}

function parseContactList(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    }
  } catch {
    // Também aceita lista simples.
  }

  return trimmed.split(/[\n,;]/).map((item) => item.trim()).filter(Boolean)
}
