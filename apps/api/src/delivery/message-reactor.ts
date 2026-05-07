// message-reactor.ts — Envia reações pontuais solicitadas pelo agente com intervalo e allowlist
import pino from 'pino'
import {
  REACTIONS_ALLOWED_EMOJIS,
  REACTIONS_ENABLED,
  REACTIONS_MIN_INTERVAL_MINUTES
} from '../config/constants'
import { env } from '../config/env'

export interface ReactionRequested {
  emoji: string
  targetMessageId: string
}

export interface MessageReactionInput {
  tenantId: string
  phone: string
  remoteJid?: string | null
  instance?: string | null
  evolutionUrl?: string | null
  evolutionLocalUrl?: string | null
  apiKey?: string | null
  reactionRequested?: ReactionRequested | null
}

export interface MessageReactionResult {
  sent: boolean
  reason: 'sent' | 'not_requested' | 'disabled' | 'emoji_not_allowed' | 'interval_blocked' | 'missing_config' | 'failed'
}

export interface MessageReactorOptions {
  enabled?: boolean
  minIntervalMinutes?: number
  allowedEmojis?: string[]
  now?: () => number
}

const log = pino({ name: 'message-reactor' })
const lastReactionAtByLead = new Map<string, number>()

/**
 * Envia reação WhatsApp somente quando o agente solicitar explicitamente.
 */
export class MessageReactor {
  private readonly enabled: boolean
  private readonly minIntervalMs: number
  private readonly allowedEmojis: Set<string>
  private readonly now: () => number

  constructor(options: MessageReactorOptions = {}) {
    this.enabled = options.enabled ?? REACTIONS_ENABLED
    this.minIntervalMs = (options.minIntervalMinutes ?? REACTIONS_MIN_INTERVAL_MINUTES) * 60_000
    this.allowedEmojis = new Set(options.allowedEmojis ?? parseAllowedEmojis(REACTIONS_ALLOWED_EMOJIS))
    this.now = options.now ?? Date.now
  }

  /**
   * Envia uma reação solicitada sem bloquear o fluxo principal.
   * @param input Dados do destino e reação.
   * @returns Resultado resumido.
   */
  async react(input: MessageReactionInput): Promise<MessageReactionResult> {
    const requested = input.reactionRequested
    if (!requested) return { sent: false, reason: 'not_requested' }
    if (!this.enabled) return { sent: false, reason: 'disabled' }
    if (!this.allowedEmojis.has(requested.emoji)) return { sent: false, reason: 'emoji_not_allowed' }
    if (this.isIntervalBlocked(input.tenantId, input.phone)) return { sent: false, reason: 'interval_blocked' }

    const config = resolveReactionConfig(input)
    if (!config) return { sent: false, reason: 'missing_config' }

    try {
      const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/message/sendReaction/${encodeURIComponent(config.instance)}`, {
        method: 'POST',
        headers: {
          apikey: config.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          number: input.remoteJid?.trim() || buildRemoteJid(input.phone),
          key: { id: requested.targetMessageId },
          reaction: requested.emoji
        })
      })

      if (!response.ok) {
        log.debug({
          tenant_id: input.tenantId,
          phone: input.phone,
          status: response.status
        }, 'reaction request returned non-2xx')
        return { sent: false, reason: 'failed' }
      }

      lastReactionAtByLead.set(buildLeadKey(input.tenantId, input.phone), this.now())
      return { sent: true, reason: 'sent' }
    } catch (error) {
      log.debug({ err: error, tenant_id: input.tenantId, phone: input.phone }, 'reaction send failed')
      return { sent: false, reason: 'failed' }
    }
  }

  private isIntervalBlocked(tenantId: string, phone: string): boolean {
    const lastReactionAt = lastReactionAtByLead.get(buildLeadKey(tenantId, phone))
    return lastReactionAt !== undefined && this.now() - lastReactionAt < this.minIntervalMs
  }
}

function parseAllowedEmojis(value: string): string[] {
  return value.split(',').map((emoji) => emoji.trim()).filter(Boolean)
}

function resolveReactionConfig(input: MessageReactionInput): { baseUrl: string; apiKey: string; instance: string } | null {
  const baseUrl = input.evolutionLocalUrl?.trim() || env.EVOLUTION_LOCAL_URL || input.evolutionUrl?.trim() || env.EVOLUTION_API_URL
  const apiKey = input.apiKey?.trim() || env.EVOLUTION_API_KEY
  const instance = input.instance?.trim()

  if (!baseUrl || !apiKey || !instance) {
    return null
  }

  return { baseUrl, apiKey, instance }
}

function buildRemoteJid(phone: string): string {
  return phone.includes('@') ? phone : `${phone.replace(/\D/g, '')}@s.whatsapp.net`
}

function buildLeadKey(tenantId: string, phone: string): string {
  return `${tenantId}:${phone}`
}
