// presence-simulator.ts — Simula estados composing/recording na Evolution sem bloquear delivery
import pino from 'pino'
import { env } from '../config/env'

export type PresenceState = 'composing' | 'recording' | 'paused'

export interface PresenceSessionOptions {
  tenantId: string
  phone: string
  remoteJid?: string | null
  instance: string
  evolutionUrl?: string | null
  evolutionLocalUrl?: string | null
  apiKey?: string | null
}

export interface PresenceSimulatorOptions {
  resendMs?: number
}

export interface PresenceSession {
  switch(presence: Exclude<PresenceState, 'paused'>): Promise<void>
  stop(): Promise<void>
}

const log = pino({ name: 'presence-simulator' })

/**
 * Envia presence para Evolution em modo tolerante a falhas.
 */
export class PresenceSimulator {
  private readonly resendMs: number

  constructor(options: PresenceSimulatorOptions = {}) {
    this.resendMs = options.resendMs ?? 10_000
  }

  /**
   * Inicia presence e reenvia periodicamente enquanto o processamento continua.
   * @param input Dados do destino.
   * @param presence Estado inicial.
   * @returns Sessão controlável para switch/stop.
   */
  start(input: PresenceSessionOptions, presence: Exclude<PresenceState, 'paused'>): PresenceSession {
    const session = new EvolutionPresenceSession(input, presence, this.resendMs)
    session.start()
    return session
  }
}

class EvolutionPresenceSession implements PresenceSession {
  private interval: ReturnType<typeof setInterval> | null = null
  private currentPresence: Exclude<PresenceState, 'paused'>
  private stopped = false

  constructor(
    private readonly input: PresenceSessionOptions,
    presence: Exclude<PresenceState, 'paused'>,
    private readonly resendMs: number
  ) {
    this.currentPresence = presence
  }

  start(): void {
    void this.send(this.currentPresence)
    this.interval = setInterval(() => {
      void this.send(this.currentPresence)
    }, this.resendMs)
    this.interval.unref?.()
  }

  /**
   * Muda o estado ativo de presença.
   * @param presence Novo estado composing ou recording.
   * @returns Nada.
   */
  async switch(presence: Exclude<PresenceState, 'paused'>): Promise<void> {
    if (this.stopped) return
    this.currentPresence = presence
    await this.send(presence)
  }

  /**
   * Para a simulação com presence paused e limpa reenvios.
   * @returns Nada.
   */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
    await this.send('paused')
  }

  private async send(presence: PresenceState): Promise<void> {
    const config = resolvePresenceConfig(this.input)
    if (!config) return

    try {
      await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/sendPresence/${encodeURIComponent(config.instance)}`, {
        method: 'POST',
        headers: {
          apikey: config.apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          number: this.input.remoteJid?.trim() || buildRemoteJid(this.input.phone),
          presence
        })
      })
    } catch (error) {
      log.debug({
        err: error,
        tenant_id: this.input.tenantId,
        phone: this.input.phone,
        presence
      }, 'presence send failed')
    }
  }
}

function resolvePresenceConfig(input: PresenceSessionOptions): { baseUrl: string; apiKey: string; instance: string } | null {
  const baseUrl = input.evolutionLocalUrl?.trim() || env.EVOLUTION_LOCAL_URL || input.evolutionUrl?.trim() || env.EVOLUTION_API_URL
  const apiKey = input.apiKey?.trim() || env.EVOLUTION_API_KEY
  const instance = input.instance.trim()

  if (!baseUrl || !apiKey || !instance) {
    log.debug({
      tenant_id: input.tenantId,
      phone: input.phone,
      has_base_url: Boolean(baseUrl),
      has_api_key: Boolean(apiKey),
      has_instance: Boolean(instance)
    }, 'presence skipped due missing config')
    return null
  }

  return { baseUrl, apiKey, instance }
}

function buildRemoteJid(phone: string): string {
  return phone.includes('@') ? phone : `${phone.replace(/\D/g, '')}@s.whatsapp.net`
}

export const presenceSimulator = new PresenceSimulator()
