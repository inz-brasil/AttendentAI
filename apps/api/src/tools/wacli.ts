// wacli.ts — Tool controlada para consultar e operar WhatsApp via wacli
import { z } from 'zod'
import { getSettingValue } from '../automation/control'
import { MessageEventsRepository } from '../db/repositories/message-events.repository'
import { saveMessage } from '../memory/persistent'
import { WacliSyncService } from '../wacli/sync-service'

const wacliSchema = z.object({
  action: z.enum(['doctor', 'search_messages', 'send_text', 'backfill', 'list_groups', 'group_info']),
  query: z.string().optional(),
  phone: z.string().optional(),
  chat_jid: z.string().optional(),
  message: z.string().optional(),
  limit: z.number().int().min(1).max(50).default(10),
  requests: z.number().int().min(1).max(20).default(5),
  count: z.number().int().min(1).max(200).default(50)
})

/**
 * Executa wacli com subcomandos permitidos para o assistente interno.
 * @param rawInput Argumentos da tool.
 * @returns Saída do processo.
 */
export async function executeWacliTool(rawInput: unknown): Promise<Record<string, unknown>> {
  const enabled = (await getSettingValue('wacli_enabled', 'false')).trim().toLowerCase() === 'true'
  if (!enabled) {
    return {
      success: false,
      error: 'wacli está desabilitado. Ative wacli_enabled=true nas configurações antes de usar.'
    }
  }

  const input = wacliSchema.parse(rawInput ?? {})
  if (input.action === 'backfill') {
    return executeBackfill(input)
  }

  const command = (await getSettingValue('wacli_command', 'wacli')).trim() || 'wacli'
  const store = (await getSettingValue('wacli_store', '')).trim()
  const args = buildWacliArgs(input, store)
  const result = await runCommand(command, args, input.action === 'send_text' ? 120_000 : 30_000)
  await registerSuccessfulIndividualSend(input, result)
  return result
}

async function executeBackfill(input: z.infer<typeof wacliSchema>): Promise<Record<string, unknown>> {
  if (!input.phone && !input.chat_jid) {
    throw new Error('chat_jid ou phone é obrigatório para backfill')
  }

  const service = new WacliSyncService()
  const phone = input.phone?.replace(/\D/g, '') ?? ''
  const result = await service.sync({
    tenantId: 'default',
    phone: phone || input.chat_jid || '',
    remoteJid: input.chat_jid ?? null,
    requests: input.requests,
    count: input.count
  })

  return {
    success: result.error === null,
    action: 'backfill',
    ...result
  }
}

function buildWacliArgs(input: z.infer<typeof wacliSchema>, store: string): string[] {
  const prefix = store ? ['--store', store] : []

  if (input.action === 'doctor') {
    return [...prefix, 'doctor', '--json']
  }

  if (input.action === 'search_messages') {
    if (!input.query) throw new Error('query é obrigatório para search_messages')
    return [...prefix, 'messages', 'search', input.query, '--limit', String(input.limit), '--json']
  }

  if (input.action === 'send_text') {
    const target = input.chat_jid ?? input.phone
    if (!target) throw new Error('phone ou chat_jid é obrigatório para send_text')
    if (!input.message) throw new Error('message é obrigatório para send_text')
    return [...prefix, 'send', 'text', '--to', target, '--message', input.message, '--json']
  }

  if (input.action === 'backfill') {
    const chat = input.chat_jid ?? (input.phone ? `${input.phone.replace(/\D/g, '')}@s.whatsapp.net` : '')
    if (!chat) throw new Error('chat_jid ou phone é obrigatório para backfill')
    return [
      ...prefix,
      'history',
      'backfill',
      '--chat',
      chat,
      '--requests',
      String(input.requests),
      '--count',
      String(input.count),
      '--json'
    ]
  }

  if (input.action === 'list_groups') {
    return [
      ...prefix,
      'groups',
      'list',
      '--limit',
      String(input.limit),
      ...(input.query ? ['--query', input.query] : []),
      '--json'
    ]
  }

  if (input.action === 'group_info') {
    if (!input.chat_jid) throw new Error('chat_jid é obrigatório para group_info')
    return [...prefix, 'groups', 'info', input.chat_jid, '--json']
  }

  return [...prefix, 'doctor', '--json']
}

async function runCommand(command: string, args: string[], timeoutMs: number): Promise<Record<string, unknown>> {
  const proc = Bun.spawn([command, ...args], {
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const timeout = setTimeout(() => proc.kill(), timeoutMs)

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited
    ])

    return {
      success: exitCode === 0,
      command,
      args,
      exit_code: exitCode,
      stdout: parseMaybeJson(stdout),
      stderr: stderr.slice(0, 4000),
      timeout_ms: timeoutMs,
      error: exitCode === 143 ? 'wacli atingiu timeout local antes de confirmar o envio' : null
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function registerSuccessfulIndividualSend(
  input: z.infer<typeof wacliSchema>,
  result: Record<string, unknown>
): Promise<void> {
  if (input.action !== 'send_text' || result.success !== true || !input.message) {
    return
  }

  const target = input.phone ?? input.chat_jid ?? ''
  const phone = target.endsWith('@g.us') ? target.replace('@g.us', '') : target.replace(/\D/g, '') || target
  await new MessageEventsRepository().insert({
    tenant_id: 'default',
    conversation_id: null,
    lead_phone: phone,
    external_message_id: extractExternalMessageId(result) ?? buildWacliSendFallbackId(phone, input.message),
    source: 'wacli',
    source_event: 'wacli.send_text',
    direction: 'outbound',
    from_me: true,
    sender_type: 'internal_assistant',
    role: 'assistant',
    content: input.message,
    message_type: 'conversation',
    processed_type: 'text',
    media_url: null,
    quoted_external_message_id: null,
    quoted_content: null,
    remote_jid: input.chat_jid ?? `${phone}@s.whatsapp.net`,
    instance: null,
    instance_id: null,
    chatwoot_conversation_id: null,
    chatwoot_inbox_id: null,
    chatwoot_message_id: null,
    delivery_status: 'intended',
    batch_id: null,
    error_message: null,
    raw_payload: result,
    whatsapp_timestamp: Math.floor(Date.now() / 1000)
  })

  await saveMessage(phone, 'assistant', input.message, {
    message_type: 'text',
    intent: 'internal_wacli_send',
    agent_used: 'internal-assistant-wacli'
  })
}

function extractExternalMessageId(result: Record<string, unknown>): string | null {
  const stdout = toRecord(result.stdout)
  const data = toRecord(stdout?.data)
  const key = toRecord(data?.key) ?? toRecord(stdout?.key)
  return readString(key, 'id') ?? readString(data, 'id') ?? readString(stdout, 'id')
}

function buildWacliSendFallbackId(phone: string, message: string): string {
  return `wacli-send:${phone}:${Date.now()}:${message.slice(0, 80)}`
}

function parseMaybeJson(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ''

  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed.slice(0, 8000)
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}
