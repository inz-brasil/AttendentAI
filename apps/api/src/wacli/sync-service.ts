// sync-service.ts — Executa backfill WACLI e persiste histórico em message_events
import { getSettingValue } from '../automation/control'
import { WacliBackfillIngestor, type WacliBackfillMessage } from './backfill-ingestor'

export interface WacliSyncInput {
  tenantId: string
  phone: string
  remoteJid?: string | null
  requests?: number
  count?: number
  instance?: string | null
}

export interface WacliSyncResult {
  enabled: boolean
  chatJid: string
  fetched: number
  ingested: number
  deduped: number
  updated: number
  error: string | null
}

interface WacliCommandConfig {
  command: string
  store: string
}

/**
 * Sincroniza histórico real do WhatsApp para message_events via WACLI.
 */
export class WacliSyncService {
  constructor(private readonly ingestor = new WacliBackfillIngestor()) {}

  /**
   * Executa backfill e ingere mensagens no transcript canônico.
   * @param input Chat e limites de backfill.
   * @returns Resultado da sincronização.
   */
  async sync(input: WacliSyncInput): Promise<WacliSyncResult> {
    const chatJid = resolveChatJid(input.phone, input.remoteJid)
    const enabled = (await getSettingValue('wacli_enabled', 'false')).trim().toLowerCase() === 'true'
    if (!enabled) {
      return emptyResult(false, chatJid, null)
    }

    const config = await getWacliConfig()
    await runWacliBackfill(config, chatJid, input.requests ?? 1, input.count ?? 50)
    const messages = await runWacliMessagesList(config, chatJid, input.count ?? 50)
    const result = await this.ingestor.ingest({
      tenantId: input.tenantId,
      phone: input.phone,
      chatJid,
      instance: input.instance ?? null,
      messages
    })

    return {
      enabled: true,
      chatJid,
      fetched: messages.length,
      ingested: result.ingested,
      deduped: result.deduped,
      updated: result.updated,
      error: null
    }
  }
}

async function getWacliConfig(): Promise<WacliCommandConfig> {
  const command = (await getSettingValue('wacli_command', '/usr/local/bin/wacli')).trim() || '/usr/local/bin/wacli'
  const store = (await getSettingValue('wacli_store', '/data/wacli')).trim() || '/data/wacli'
  return { command, store }
}

async function runWacliBackfill(config: WacliCommandConfig, chatJid: string, requests: number, count: number): Promise<void> {
  await runCommand(config, [
    'history',
    'backfill',
    '--chat',
    chatJid,
    '--requests',
    String(requests),
    '--count',
    String(count),
    '--json'
  ], 30_000)
}

async function runWacliMessagesList(config: WacliCommandConfig, chatJid: string, limit: number): Promise<WacliBackfillMessage[]> {
  const raw = await runCommand(config, [
    'messages',
    'list',
    '--chat',
    chatJid,
    '--limit',
    String(limit),
    '--json'
  ], 15_000)
  return extractMessages(raw)
}

async function runCommand(config: WacliCommandConfig, args: string[], timeoutMs: number): Promise<unknown> {
  const proc = Bun.spawn([config.command, '--store', config.store, ...args], {
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const timer = setTimeout(() => proc.kill(), timeoutMs)

  try {
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited
    ])
    if (exitCode !== 0) return null
    return parseMaybeJson(stdout)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function extractMessages(raw: unknown): WacliBackfillMessage[] {
  const record = toRecord(raw)
  const data = toRecord(record?.data)
  const directMessages = readArray(record?.messages)
  const dataMessages = readArray(data?.messages)
  const rows = dataMessages ?? directMessages ?? []
  return rows.filter(isRecord).map((row) => row)
}

function resolveChatJid(phone: string, remoteJid: string | null | undefined): string {
  const candidate = remoteJid?.trim()
  if (candidate && candidate.includes('@')) return candidate
  const digits = (candidate || phone).replace(/\D/g, '')
  return digits ? `${digits}@s.whatsapp.net` : String(candidate || phone)
}

function emptyResult(enabled: boolean, chatJid: string, error: string | null): WacliSyncResult {
  return { enabled, chatJid, fetched: 0, ingested: 0, deduped: 0, updated: 0, error }
}

function parseMaybeJson(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null
}

function isRecord(value: unknown): value is WacliBackfillMessage {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
