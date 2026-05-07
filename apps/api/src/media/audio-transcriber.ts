// audio-transcriber.ts — Define adapters plugáveis de transcrição de áudio
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import OpenAI, { toFile } from 'openai'
import pino from 'pino'
import { env } from '../config/env'

export interface TranscriptionAdapter {
  transcribe(audioBuffer: Buffer, mimeType: string): Promise<string>
}

const log = pino({ name: 'media-audio-transcriber' })

/**
 * Adapter padrão para transcrição via OpenAI Whisper.
 */
export class OpenAIWhisperAdapter implements TranscriptionAdapter {
  private readonly client: OpenAI
  private readonly model: string

  constructor(client = new OpenAI({ apiKey: env.OPENAI_API_KEY, baseURL: env.OPENAI_BASE_URL }), model = 'whisper-1') {
    this.client = client
    this.model = model
  }

  /**
   * Transcreve um buffer de áudio usando a API de transcriptions.
   * @param audioBuffer Conteúdo binário do áudio.
   * @param mimeType Mime type recebido da Evolution.
   * @returns Texto transcrito.
   */
  async transcribe(audioBuffer: Buffer, mimeType: string): Promise<string> {
    const startedAt = Date.now()
    const tempPath = await writeTempAudioFile(audioBuffer, mimeType)

    try {
      const response = await this.client.audio.transcriptions.create({
        file: await toFile(await readFile(tempPath), tempPath, { type: mimeType }),
        model: this.model,
        language: 'pt'
      })

      log.info({ model: this.model, duration_ms: Date.now() - startedAt }, 'audio transcribed')
      return response.text.trim()
    } finally {
      await unlink(tempPath).catch((error: unknown) => {
        log.warn({ err: error, tempPath }, 'failed to remove temp audio file')
      })
    }
  }
}

/**
 * Stub para transcrição local futura.
 */
export class LocalWhisperAdapter implements TranscriptionAdapter {
  /**
   * Stub sem implementação para uso futuro.
   * @param _audioBuffer Conteúdo binário do áudio.
   * @param _mimeType Mime type recebido.
   * @returns Nunca retorna enquanto não implementado.
   */
  async transcribe(_audioBuffer: Buffer, _mimeType: string): Promise<string> {
    throw new Error('LocalWhisperAdapter is not implemented')
  }
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3'
  if (mimeType.includes('wav')) return 'wav'
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('webm')) return 'webm'
  return 'ogg'
}

async function writeTempAudioFile(audioBuffer: Buffer, mimeType: string): Promise<string> {
  const tempPath = join(tmpdir(), `attendentai-audio-${randomUUID()}.${extensionForMime(mimeType)}`)
  await writeFile(tempPath, audioBuffer)
  return tempPath
}
