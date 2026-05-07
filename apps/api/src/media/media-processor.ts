// media-processor.ts — Atualiza message_events com transcrição/descrição de mídia sem bloquear webhook
import { eq } from 'drizzle-orm'
import pino from 'pino'
import { db } from '../db/client'
import { messageEvents } from '../db/schema'
import type { MessageEvent } from '../db/repositories/message-events.repository'
import { hashContent } from '../db/repositories/message-events.repository'
import { traceEmitter } from '../observability/trace-emitter'
import { enqueueInboundMessage } from '../queue/inbound-message-queue'
import type { NormalizedWhatsappEvent } from '../webhook/evolution-normalizer'
import { OpenAIWhisperAdapter, type TranscriptionAdapter } from './audio-transcriber'
import { EvolutionMediaDownloader, type DownloadedMedia, type MediaDownloader } from './downloader'
import { OpenAIImageDescriber, type ImageDescriptionAdapter } from './image-describer'

export interface MediaProcessorInput {
  tenantId: string
  event: NormalizedWhatsappEvent
  messageEvent: MessageEvent
}

export interface MediaProcessorResult {
  processed: boolean
  content: string
}

export interface MediaProcessorOptions {
  downloader?: MediaDownloader
  transcriptionAdapter?: TranscriptionAdapter
  imageDescriber?: ImageDescriptionAdapter
}

const log = pino({ name: 'media-processor' })

/**
 * Processa mídia de forma assíncrona e atualiza o transcript.
 */
export class MediaProcessor {
  private readonly downloader: MediaDownloader
  private readonly transcriptionAdapter: TranscriptionAdapter
  private readonly imageDescriber: ImageDescriptionAdapter

  constructor(options: MediaProcessorOptions = {}) {
    this.downloader = options.downloader ?? new EvolutionMediaDownloader()
    this.transcriptionAdapter = options.transcriptionAdapter ?? new OpenAIWhisperAdapter()
    this.imageDescriber = options.imageDescriber ?? new OpenAIImageDescriber()
  }

  /**
   * Inicia processamento em background sem bloquear o caller.
   * @param input Evento e registro persistido.
   * @returns Nada.
   */
  processInBackground(input: MediaProcessorInput): void {
    void this.process(input).catch((error: unknown) => {
      log.error({ err: error, message_event_id: input.messageEvent.id }, 'background media processing failed')
    })
  }

  /**
   * Processa mídia e atualiza content em message_events.
   * @param input Evento e registro persistido.
   * @returns Resultado do processamento.
   */
  async process(input: MediaProcessorInput): Promise<MediaProcessorResult> {
    if (input.event.processedType === 'text') {
      return { processed: false, content: input.messageEvent.content }
    }

    await this.emitStarted(input)

    try {
      const content = await this.resolveContent(input.event)
      await this.updateContent(input.messageEvent.id, content, null)
      await this.emitDone(input, content)
      await this.enqueueForBatch(input)
      return { processed: true, content }
    } catch (error) {
      await this.updateContent(input.messageEvent.id, input.messageEvent.content, getErrorMessage(error))
      await this.emitFailed(input, error)
      await this.enqueueForBatch(input)
      return { processed: false, content: input.messageEvent.content }
    }
  }

  private async resolveContent(event: NormalizedWhatsappEvent): Promise<string> {
    if (event.processedType === 'video' || event.processedType === 'document' || event.processedType === 'sticker') {
      return `[Arquivo recebido: ${event.processedType}]`
    }

    const media = await this.downloader.download(event)
    if (event.processedType === 'audio') {
      return this.processAudio(media)
    }

    if (event.processedType === 'image') {
      return this.processImage(media)
    }

    return event.text || '[Mensagem recebida]'
  }

  private async processAudio(media: DownloadedMedia): Promise<string> {
    const transcript = await this.transcriptionAdapter.transcribe(media.buffer, media.mimeType)
    return `[Áudio transcrito]: ${transcript}`
  }

  private async processImage(media: DownloadedMedia): Promise<string> {
    const description = await this.imageDescriber.describe(media.buffer, media.mimeType)
    return `[Imagem enviada]: ${description}`
  }

  private async updateContent(id: string, content: string, errorMessage: string | null): Promise<void> {
    await db
      .update(messageEvents)
      .set({
        content,
        content_hash: hashContent(content),
        error_message: errorMessage,
        updated_at: new Date()
      })
      .where(eq(messageEvents.id, id))
  }

  private async emitStarted(input: MediaProcessorInput): Promise<void> {
    await traceEmitter.emit('media_processing_started', {
      tenant_id: input.tenantId,
      phone: input.event.phone,
      data: this.traceBase(input)
    })
  }

  private async emitDone(input: MediaProcessorInput, content: string): Promise<void> {
    await traceEmitter.emit('media_processing_done', {
      tenant_id: input.tenantId,
      phone: input.event.phone,
      data: { ...this.traceBase(input), content_preview: content.slice(0, 300) }
    })
  }

  private async emitFailed(input: MediaProcessorInput, error: unknown): Promise<void> {
    await traceEmitter.emit('media_processing_failed', {
      tenant_id: input.tenantId,
      phone: input.event.phone,
      status: 'error',
      data: { ...this.traceBase(input), error: getErrorMessage(error) }
    })
  }

  private traceBase(input: MediaProcessorInput): Record<string, unknown> {
    return {
      message_event_id: input.messageEvent.id,
      external_message_id: input.event.externalMessageId,
      processed_type: input.event.processedType,
      media_url: input.event.mediaUrl,
      instance: input.event.instance
    }
  }

  private async enqueueForBatch(input: MediaProcessorInput): Promise<void> {
    await enqueueInboundMessage({
      tenantId: input.tenantId,
      phone: input.event.phone,
      instanceId: input.event.instanceId
    })
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
