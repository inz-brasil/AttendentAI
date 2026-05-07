// tts-adapter.ts — Converte texto autorizado em áudio usando adapter plugável
import { env } from '../config/env'

export interface TtsAdapter {
  synthesize(text: string): Promise<Buffer>
}

export interface TtsPreparation {
  textForAudio: string
  links: string[]
}

const urlRegex = /(https?:\/\/[^\s]+)/g
const emojiRegex = /\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu

/**
 * Extrai links e limpa marcações que prejudicam leitura por voz.
 * @param text Texto final da resposta.
 * @returns Texto para TTS e links para envio separado.
 */
export function prepareTextForTts(text: string): TtsPreparation {
  const links = text.match(urlRegex) ?? []
  const textForAudio = text
    .replace(urlRegex, '')
    .replace(emojiRegex, '')
    .replace(/[*_~>#`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return { textForAudio, links }
}

/**
 * Adapter ElevenLabs para gerar áudio MP3.
 */
export class ElevenLabsTtsAdapter implements TtsAdapter {
  constructor(
    private readonly apiKey = env.ELEVENLABS_API_KEY ?? '',
    private readonly voiceId = env.ELEVENLABS_VOICE_ID ?? ''
  ) {}

  /**
   * Gera áudio MP3 a partir de texto.
   * @param text Texto já preparado para fala.
   * @returns Buffer MP3.
   */
  async synthesize(text: string): Promise<Buffer> {
    if (!this.apiKey || !this.voiceId) {
      throw new Error('ElevenLabs não configurado: ELEVENLABS_API_KEY e ELEVENLABS_VOICE_ID são obrigatórios para áudio')
    }

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
          style: 0.5
        }
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`ElevenLabs HTTP ${response.status}: ${errorText.slice(0, 300)}`)
    }

    return Buffer.from(await response.arrayBuffer())
  }
}
