// evolution-sender.ts — Envia texto e áudio para a Evolution API com retry exponencial
import pino from 'pino'

export interface EvolutionSenderConfig {
  baseUrl: string
  apiKey: string
  instance: string
}

export interface EvolutionSendResult {
  externalMessageId: string | null
  raw: unknown
}

export interface EvolutionTextInput {
  remoteJid: string
  text: string
}

export interface EvolutionAudioInput {
  remoteJid: string
  audio: Buffer
}

const log = pino({ name: 'evolution-sender' })
const retryConfig = { attempts: 3, delay: 1000 }

/**
 * Cliente mínimo da Evolution API usado somente pela camada de delivery.
 */
export class EvolutionSender {
  constructor(private readonly config: EvolutionSenderConfig) {}

  /**
   * Envia texto para um JID/telefone via Evolution.
   * @param input Destino e texto.
   * @returns Id externo retornado pela Evolution quando disponível.
   */
  async sendText(input: EvolutionTextInput): Promise<EvolutionSendResult> {
    return this.requestWithRetry(`/message/sendText/${encodeURIComponent(this.config.instance)}`, {
      number: input.remoteJid,
      text: input.text
    })
  }

  /**
   * Envia áudio MP3/base64 para um JID/telefone via Evolution.
   * @param input Destino e áudio.
   * @returns Id externo retornado pela Evolution quando disponível.
   */
  async sendAudio(input: EvolutionAudioInput): Promise<EvolutionSendResult> {
    return this.requestWithRetry(`/message/sendAudio/${encodeURIComponent(this.config.instance)}`, {
      number: input.remoteJid,
      audio: input.audio.toString('base64'),
      delay: 2000,
      encoding: true
    })
  }

  private async requestWithRetry(endpoint: string, body: Record<string, unknown>): Promise<EvolutionSendResult> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= retryConfig.attempts; attempt += 1) {
      try {
        const raw = await this.request(endpoint, body)
        return { externalMessageId: extractEvolutionMessageId(raw), raw }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        log.warn({
          err: lastError,
          attempt,
          endpoint,
          instance: this.config.instance
        }, 'evolution send attempt failed')

        if (attempt < retryConfig.attempts) {
          await sleep(retryConfig.delay * 2 ** (attempt - 1))
        }
      }
    }

    throw lastError ?? new Error('Evolution send failed')
  }

  private async request(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}${endpoint}`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: this.config.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
    const contentType = response.headers.get('content-type') ?? ''
    const payload = contentType.includes('application/json') ? await response.json() : await response.text()

    if (!response.ok) {
      throw new Error(`Evolution HTTP ${response.status}: ${stringifyPayload(payload).slice(0, 500)}`)
    }

    return payload
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function extractEvolutionMessageId(payload: unknown): string | null {
  const record = toRecord(payload)
  const key = toRecord(record?.key)
  const nestedKey = toRecord(toRecord(record?.message)?.key)
  const id =
    readString(key, 'id') ??
    readString(nestedKey, 'id') ??
    readString(record, 'id') ??
    readString(record, 'messageId')

  return id ?? null
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

function stringifyPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload
  try {
    return JSON.stringify(payload)
  } catch {
    return String(payload)
  }
}
