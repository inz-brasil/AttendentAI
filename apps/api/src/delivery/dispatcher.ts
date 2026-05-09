// dispatcher.ts — Orquestra envio de respostas pela Evolution com tracking e política de áudio
import pino from 'pino'
import { env } from '../config/env'
import type { MessageEventSenderType } from '../db/schema'
import { AudioPolicy } from './audio-policy'
import { DeliveryTracker } from './delivery-tracker'
import { EvolutionSender, type EvolutionSenderConfig } from './evolution-sender'
import { MessageReactor, type ReactionRequested } from './message-reactor'
import { splitWhatsAppParagraphs } from './paragraph-splitter'
import type { PresenceSession } from './presence-simulator'
import { ElevenLabsTtsAdapter, prepareTextForTts, type TtsAdapter } from './tts-adapter'

export interface DispatchResponseInput {
  tenantId: string
  batchId: string | null
  phone: string
  remoteJid?: string | null
  instance?: string | null
  instanceId?: string | null
  evolutionUrl?: string | null
  evolutionLocalUrl?: string | null
  apiKey?: string | null
  text: string
  audioRequested: boolean
  senderType?: MessageEventSenderType
  sourceEvent?: string
  presenceSession?: PresenceSession | null
  reactionRequested?: ReactionRequested | null
}

export interface DispatchResponseResult {
  intendedEventId: string
  status: 'sent' | 'failed'
  mode: 'text' | 'audio'
  blocksSent: number
  externalMessageId: string | null
  errorMessage: string | null
}

const log = pino({ name: 'response-dispatcher' })

/**
 * Envia respostas finais e mantém message_events como rastreador de delivery.
 */
export class ResponseDispatcher {
  constructor(
    private readonly tracker = new DeliveryTracker(),
    private readonly audioPolicy = new AudioPolicy(),
    private readonly ttsAdapter: TtsAdapter = new ElevenLabsTtsAdapter(),
    private readonly reactor = new MessageReactor()
  ) {}

  /**
   * Registra intended, envia via Evolution e atualiza status final.
   * @param input Resposta e metadados de destino.
   * @returns Resultado de envio.
   */
  async dispatch(input: DispatchResponseInput): Promise<DispatchResponseResult> {
    const config = resolveEvolutionConfig(input)
    const remoteJid = input.remoteJid?.trim() || `${input.phone}@s.whatsapp.net`
    const event = await this.tracker.createIntended({
      tenantId: input.tenantId,
      batchId: input.batchId,
      phone: input.phone,
      remoteJid,
      instance: config.instance,
      instanceId: input.instanceId ?? null,
      content: input.text,
      senderType: input.senderType ?? 'bot',
      sourceEvent: input.sourceEvent ?? 'delivery.dispatch',
      rawPayload: {
        audio_requested: input.audioRequested,
        evolution_url: config.baseUrl,
        remote_jid: remoteJid
      }
    })

    try {
      const sender = new EvolutionSender(config)
      const audioDecision = this.audioPolicy.decide({ text: input.text, audioRequested: input.audioRequested })
      await this.preparePresenceBeforeSend(input.presenceSession ?? null, audioDecision.allowed)
      const result = audioDecision.allowed
        ? await this.sendAudio(sender, remoteJid, input.text)
        : await this.sendText(sender, remoteJid, input.text, config)

      await this.tracker.markSent(event, result.externalMessageId)
      await this.reactor.react({
        tenantId: input.tenantId,
        phone: input.phone,
        remoteJid,
        instance: config.instance,
        evolutionUrl: input.evolutionUrl ?? null,
        evolutionLocalUrl: input.evolutionLocalUrl ?? null,
        apiKey: input.apiKey ?? null,
        reactionRequested: input.reactionRequested ?? null
      })
      log.info({
        tenant_id: input.tenantId,
        phone: input.phone,
        event_id: event.id,
        mode: result.mode,
        blocks_sent: result.blocksSent,
        audio_blocked_reason: audioDecision.reason
      }, 'response dispatched')

      return {
        intendedEventId: event.id,
        status: 'sent',
        mode: result.mode,
        blocksSent: result.blocksSent,
        externalMessageId: result.externalMessageId,
        errorMessage: null
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await this.tracker.markFailed(event, errorMessage)
      await input.presenceSession?.stop()
      return {
        intendedEventId: event.id,
        status: 'failed',
        mode: 'text',
        blocksSent: 0,
        externalMessageId: null,
        errorMessage
      }
    }
  }

  private async sendText(
    sender: EvolutionSender,
    remoteJid: string,
    text: string,
    presenceConfig?: EvolutionSenderConfig
  ): Promise<{ mode: 'text'; blocksSent: number; externalMessageId: string | null }> {
    const blocks = splitWhatsAppParagraphs(text)
    if (blocks.length === 0) {
      throw new Error('Texto vazio após separação de parágrafos')
    }

    let externalMessageId: string | null = null

    for (const [index, block] of blocks.entries()) {
      if (index > 0 && presenceConfig) {
        const delayMs = humanizedBlockDelay(block, index)
        await sendComposingPresence(remoteJid, presenceConfig)
        await sleep(delayMs)
        await sendPausedPresence(remoteJid, presenceConfig)
      }
      const result = await sender.sendText({ remoteJid, text: block })
      externalMessageId = result.externalMessageId ?? externalMessageId
    }

    return { mode: 'text', blocksSent: blocks.length, externalMessageId }
  }

  private async preparePresenceBeforeSend(presenceSession: PresenceSession | null, willSendAudio: boolean): Promise<void> {
    if (!presenceSession) return
    if (willSendAudio) {
      await presenceSession.switch('recording')
      await sleep(randomRecordingDelayMs())
    }

    await presenceSession.stop()
  }

  private async sendAudio(
    sender: EvolutionSender,
    remoteJid: string,
    text: string
  ): Promise<{ mode: 'audio'; blocksSent: number; externalMessageId: string | null }> {
    const prepared = prepareTextForTts(text)
    if (!prepared.textForAudio) {
      throw new Error('Texto sem conteúdo falado após preparação TTS')
    }

    const audio = await this.ttsAdapter.synthesize(prepared.textForAudio)
    const audioResult = await sender.sendAudio({ remoteJid, audio })
    let blocksSent = 1
    let externalMessageId = audioResult.externalMessageId

    for (const link of prepared.links) {
      const linkResult = await sender.sendText({ remoteJid, text: link })
      blocksSent += 1
      externalMessageId = linkResult.externalMessageId ?? externalMessageId
    }

    return { mode: 'audio', blocksSent, externalMessageId }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function randomRecordingDelayMs(): number {
  return 1000 + Math.floor(Math.random() * 2001)
}

/**
 * Calcula delay humanizado entre blocos de texto proporcionalmente ao tamanho do próximo bloco.
 * @param nextBlock Texto do próximo bloco.
 * @param index Posição do bloco na sequência (aumenta levemente o delay).
 * @returns Milissegundos a aguardar antes de enviar o bloco.
 */
function humanizedBlockDelay(nextBlock: string, index: number): number {
  const chars = nextBlock.trim().length
  let base: number
  if (chars <= 30) base = 700
  else if (chars <= 80) base = 1400
  else if (chars <= 180) base = 2200
  else base = 3000
  const jitter = Math.floor((Math.random() - 0.5) * base * 0.3)
  return Math.max(500, Math.min(4500, base + jitter + index * 150))
}

async function sendComposingPresence(remoteJid: string, config: EvolutionSenderConfig): Promise<void> {
  try {
    await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/sendPresence/${encodeURIComponent(config.instance)}`, {
      method: 'POST',
      headers: { apikey: config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: remoteJid, presence: 'composing' })
    })
  } catch {
    // falha silenciosa — presença é best-effort
  }
}

async function sendPausedPresence(remoteJid: string, config: EvolutionSenderConfig): Promise<void> {
  try {
    await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/sendPresence/${encodeURIComponent(config.instance)}`, {
      method: 'POST',
      headers: { apikey: config.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: remoteJid, presence: 'paused' })
    })
  } catch {
    // falha silenciosa — presença é best-effort
  }
}

function resolveEvolutionConfig(input: DispatchResponseInput): EvolutionSenderConfig {
  const baseUrl = input.evolutionLocalUrl?.trim() || env.EVOLUTION_LOCAL_URL || input.evolutionUrl?.trim() || env.EVOLUTION_API_URL
  const apiKey = input.apiKey?.trim() || env.EVOLUTION_API_KEY
  const instance = input.instance?.trim()

  if (!baseUrl) {
    throw new Error('Evolution API URL não configurada')
  }

  if (!apiKey) {
    throw new Error('Evolution API key não configurada')
  }

  if (!instance) {
    throw new Error('Instância Evolution não informada')
  }

  return { baseUrl, apiKey, instance }
}
