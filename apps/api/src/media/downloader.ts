// downloader.ts — Baixa mídia da Evolution API e entrega buffer para processadores
import { env } from '../config/env'
import type { NormalizedWhatsappEvent } from '../webhook/evolution-normalizer'

export interface DownloadedMedia {
  buffer: Buffer
  mimeType: string
}

export interface MediaDownloader {
  download(event: NormalizedWhatsappEvent): Promise<DownloadedMedia>
}

export interface MediaDownloaderOptions {
  fetcher?: typeof fetch
}

interface EvolutionMediaResponse {
  base64?: string
  mimetype?: string
  mimeType?: string
}

/**
 * Baixa mídia da Evolution API usando o id da mensagem.
 */
export class EvolutionMediaDownloader implements MediaDownloader {
  private readonly fetcher: typeof fetch

  constructor(options: MediaDownloaderOptions = {}) {
    this.fetcher = options.fetcher ?? fetch
  }

  /**
   * Baixa mídia relacionada ao evento normalizado.
   * @param event Evento WhatsApp normalizado.
   * @returns Buffer e mime type.
   */
  async download(event: NormalizedWhatsappEvent): Promise<DownloadedMedia> {
    const baseUrl = this.resolveBaseUrl(event)
    const response = await this.fetcher(`${baseUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(event.instance)}`, {
      method: 'POST',
      headers: {
        apikey: event.apiKeyRef,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: { key: { id: event.externalMessageId } } })
    })

    if (!response.ok) {
      throw new Error(`Evolution media download failed: HTTP ${response.status}`)
    }

    const payload = await parseMediaResponse(response)
    if (!payload.base64) {
      throw new Error('Evolution media download returned empty base64')
    }

    return {
      buffer: Buffer.from(payload.base64, 'base64'),
      mimeType: payload.mimetype ?? payload.mimeType ?? inferMimeType(event.processedType)
    }
  }

  private resolveBaseUrl(event: NormalizedWhatsappEvent): string {
    // Prefer internal Docker URL to avoid external DNS resolution failures inside containers
    const baseUrl = event.evolutionLocalUrl || env.EVOLUTION_LOCAL_URL || event.evolutionUrl || env.EVOLUTION_API_URL
    if (!baseUrl) {
      throw new Error('Evolution URL is missing for media download')
    }

    return baseUrl.replace(/\/$/, '')
  }
}

async function parseMediaResponse(response: Response): Promise<EvolutionMediaResponse> {
  const body: unknown = await response.json()
  if (body !== null && typeof body === 'object' && !Array.isArray(body)) {
    return body as EvolutionMediaResponse
  }

  return {}
}

function inferMimeType(type: string): string {
  if (type === 'audio') return 'audio/ogg'
  if (type === 'image') return 'image/jpeg'
  if (type === 'video') return 'video/mp4'
  return 'application/octet-stream'
}
