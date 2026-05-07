// dedupe.ts — Resolve duplicatas e confirmações de envio no transcript
import type { MessageEventDirection, MessageEventSource } from '../db/schema'
import type { MessageEvent } from '../db/repositories/message-events.repository'
import { hashContent } from '../db/repositories/message-events.repository'
import type { NormalizedWhatsappEvent } from '../webhook/evolution-normalizer'
import { TranscriptRepository } from './repository'

export interface TranscriptDedupeInput {
  tenantId: string
  source: MessageEventSource
  event: NormalizedWhatsappEvent
}

export interface TranscriptDedupeResult {
  duplicate: MessageEvent | null
  botIntendedMatch: MessageEvent | null
  contentHash: string
}

const DEDUPE_WINDOW_MS = 60_000
const BOT_INTENDED_WINDOW_MS = 5 * 60_000

/**
 * Aplica regras de dedupe e busca match de bot intended.
 */
export class TranscriptDedupe {
  constructor(private readonly repository = new TranscriptRepository()) {}

  /**
   * Resolve duplicata ou confirmação de bot para o evento normalizado.
   * @param input Dados do evento.
   * @returns Resultado de dedupe.
   */
  async resolve(input: TranscriptDedupeInput): Promise<TranscriptDedupeResult> {
    const contentHash = hashContent(input.event.text)
    const botIntendedMatch = input.event.fromMe && !input.event.isGroup
      ? await this.repository.findRecentBotIntended(
          input.tenantId,
          input.event.phone,
          contentHash,
          input.event.externalMessageId || null,
          BOT_INTENDED_WINDOW_MS
        )
      : null

    if (botIntendedMatch) {
      return { duplicate: null, botIntendedMatch, contentHash }
    }

    const externalDuplicate = input.event.externalMessageId
      ? await this.findExternalDuplicate(input)
      : null
    if (externalDuplicate) {
      return { duplicate: externalDuplicate, botIntendedMatch: null, contentHash }
    }

    const direction: MessageEventDirection = input.event.fromMe ? 'outbound' : 'inbound'
    const hashDuplicate = await this.repository.findByDedupe(
      input.tenantId,
      input.event.phone,
      direction,
      contentHash,
      DEDUPE_WINDOW_MS
    )

    return { duplicate: hashDuplicate, botIntendedMatch: null, contentHash }
  }

  private async findExternalDuplicate(input: TranscriptDedupeInput): Promise<MessageEvent | null> {
    if (input.source === 'wacli' || input.event.fromMe) {
      // WACLI e echoes fromMe são fallback/cross-source: external id igual nunca deve duplicar.
      return this.repository.findByExternalIdAnySource(input.tenantId, input.event.externalMessageId)
    }

    return this.repository.findByExternalId(input.tenantId, input.source, input.event.externalMessageId)
  }
}
