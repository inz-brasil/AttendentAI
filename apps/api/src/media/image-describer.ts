// image-describer.ts — Descreve imagens recebidas no WhatsApp usando visão
import OpenAI from 'openai'
import pino from 'pino'
import { env } from '../config/env'

const log = pino({ name: 'media-image-describer' })

export interface ImageDescriptionAdapter {
  describe(imageBuffer: Buffer, mimeType: string): Promise<string>
}

/**
 * Descreve imagens com modelo de visão compatível com OpenAI.
 */
export class OpenAIImageDescriber implements ImageDescriptionAdapter {
  private readonly client: OpenAI
  private readonly model: string

  constructor(client = new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL }), model = 'gpt-4o') {
    this.client = client
    this.model = model
  }

  /**
   * Gera descrição em português para uma imagem.
   * @param imageBuffer Conteúdo binário da imagem.
   * @param mimeType Mime type da imagem.
   * @returns Descrição textual.
   */
  async describe(imageBuffer: Buffer, mimeType: string): Promise<string> {
    const startedAt = Date.now()
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Descreva detalhadamente o conteúdo desta imagem em português. Se for um documento, transcreva o texto visível.' },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBuffer.toString('base64')}` } }
        ]
      }],
      max_tokens: 500
    })

    log.info({ model: this.model, duration_ms: Date.now() - startedAt }, 'image described')
    return response.choices[0]?.message.content?.trim() ?? ''
  }
}
