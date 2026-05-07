// audio-policy.ts — Decide deterministicamente quando uma resposta pode virar áudio
import { AUDIO_ENABLED, AUDIO_MAX_CHARS, AUDIO_RANDOM_CHANCE } from '../config/constants'

export interface AudioPolicyInput {
  text: string
  audioRequested: boolean
}

export interface AudioPolicyDecision {
  allowed: boolean
  reason: string | null
}

export interface AudioPolicyOptions {
  enabled?: boolean
  maxChars?: number
  randomChance?: number
  random?: () => number
}

/**
 * Aplica proteções para evitar áudio em conteúdos longos, estruturados ou com links.
 */
export class AudioPolicy {
  private readonly enabled: boolean
  private readonly maxChars: number
  private readonly randomChance: number
  private readonly random: () => number

  constructor(options: AudioPolicyOptions = {}) {
    this.enabled = options.enabled ?? AUDIO_ENABLED
    this.maxChars = options.maxChars ?? AUDIO_MAX_CHARS
    this.randomChance = options.randomChance ?? AUDIO_RANDOM_CHANCE
    this.random = options.random ?? Math.random
  }

  /**
   * Decide se o texto pode ser enviado como áudio.
   * @param input Texto e intenção de áudio sinalizada pelo agente.
   * @returns Decisão com motivo de bloqueio quando houver.
   */
  decide(input: AudioPolicyInput): AudioPolicyDecision {
    const text = input.text.trim()
    if (!input.audioRequested) return { allowed: false, reason: 'audio_not_requested' }
    if (!this.enabled) return { allowed: false, reason: 'audio_disabled' }
    if (!text) return { allowed: false, reason: 'empty_text' }
    if (text.length > this.maxChars) return { allowed: false, reason: 'too_long' }
    if (hasLink(text)) return { allowed: false, reason: 'contains_link' }
    if (hasLongList(text)) return { allowed: false, reason: 'long_list' }
    if (hasStructuredMarkdown(text)) return { allowed: false, reason: 'structured_markdown' }
    if (this.random() > this.randomChance) return { allowed: false, reason: 'random_chance_blocked' }

    return { allowed: true, reason: null }
  }
}

function hasLink(text: string): boolean {
  return /(https?:\/\/|www\.|\.com\b|\.br\b|\.net\b|\.org\b)/i.test(text)
}

function hasLongList(text: string): boolean {
  const listItems = text
    .split('\n')
    .filter((line) => /^(\s*[-*•]\s+|\s*\d+[.)]\s+)/.test(line.trim()))
  return listItems.length > 3
}

function hasStructuredMarkdown(text: string): boolean {
  return /\*\*.+\*\*/s.test(text) || /^#{1,6}\s+/m.test(text) || /```/.test(text) || /\|.+\|/.test(text)
}
