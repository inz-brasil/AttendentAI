// context-sync.ts — Sincroniza contexto recente do WhatsApp real via WACLI sem usar IA
import { getSettingValue } from '../automation/control'
import { env } from '../config/env'
import { db } from '../db/client'
import { messages } from '../db/schema'
import { VaultManager } from '../vault-manager/manager'
import { desc, eq } from 'drizzle-orm'

interface WacliMessageRow {
  Timestamp?: string
  FromMe?: boolean
  Text?: string
  DisplayText?: string
  ChatName?: string
}

interface WacliMessagesBody {
  success?: boolean
  data?: {
    messages?: WacliMessageRow[]
  }
}

interface StoredMessageRow {
  role: string | null
  content: string | null
  agent_used: string | null
  created_at: Date | null
}

export interface WacliContextSnapshot {
  available: boolean
  chat_jid: string | null
  chat_name: string | null
  context: string
  prompt_context: string
  messages_count: number
}

/**
 * Carrega mensagens reais recentes do WhatsApp e atualiza historico.md de forma determinística.
 * @param phone Telefone associado ao chat.
 * @param remoteJid JID do chat no WhatsApp.
 * @param leadName Nome exibido.
 * @returns Snapshot textual pronto para prompt.
 */
export async function syncWacliChatContext(
  phone: string,
  remoteJid: string | null | undefined,
  leadName: string
): Promise<WacliContextSnapshot> {
  const chatJid = resolveChatJid(phone, remoteJid)

  const enabled = (await getSettingValue('wacli_enabled', 'false')).trim().toLowerCase() === 'true'
  if (!enabled) {
    return emptySnapshot(chatJid)
  }

  const command = (await getSettingValue('wacli_command', '/usr/local/bin/wacli')).trim() || '/usr/local/bin/wacli'
  const store = (await getSettingValue('wacli_store', '/data/wacli')).trim() || '/data/wacli'
  await runWacliBackfill(command, store, chatJid)

  const result = await runWacliMessagesList(command, store, chatJid)
  const wacliMessages = normalizeMessages(result)
  const storedMessages = await loadStoredMessages(phone)
  const chatName = wacliMessages.find((message) => message.ChatName)?.ChatName ?? null
  const context = formatCombinedContext(storedMessages, wacliMessages)
  const promptContext = formatPromptContext(wacliMessages, storedMessages)

  if (context) {
    const vault = new VaultManager(env.VAULT_PATH)
    await vault.write(phone, 'historico.md', [
      `# Histórico de Conversas — ${leadName || phone}`,
      '',
      '## Histórico real sincronizado',
      '',
      context
    ].join('\n'))
  }

  return {
    available: context.length > 0,
    chat_jid: chatJid,
    chat_name: chatName,
    context,
    prompt_context: promptContext,
    messages_count: storedMessages.length + wacliMessages.length
  }
}

function resolveChatJid(phone: string, remoteJid: string | null | undefined): string {
  const candidate = remoteJid?.trim()
  if (candidate && candidate.includes('@')) return candidate
  const digits = (candidate || phone).replace(/\D/g, '')
  return digits ? `${digits}@s.whatsapp.net` : String(candidate || phone)
}

function emptySnapshot(remoteJid: string | null): WacliContextSnapshot {
  return {
    available: false,
    chat_jid: remoteJid,
    chat_name: null,
    context: '',
    prompt_context: '',
    messages_count: 0
  }
}

async function runWacliMessagesList(command: string, store: string, chatJid: string): Promise<unknown> {
  const proc = Bun.spawn([
    command,
    '--store',
    store,
    'messages',
    'list',
    '--chat',
    chatJid,
    '--limit',
    '50',
    '--json'
  ], {
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const timeout = setTimeout(() => proc.kill(), 10_000)

  try {
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited
    ])
    if (exitCode !== 0) return null
    return JSON.parse(stdout) as unknown
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function runWacliBackfill(command: string, store: string, chatJid: string): Promise<void> {
  const proc = Bun.spawn([
    command,
    '--store',
    store,
    'history',
    'backfill',
    '--chat',
    chatJid,
    '--requests',
    '1',
    '--count',
    '20',
    '--json'
  ], {
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const timeout = setTimeout(() => proc.kill(), 18_000)

  try {
    await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited
    ])
  } catch {
    // Backfill é oportunista: o histórico do banco local ainda mantém o atendimento funcionando.
  } finally {
    clearTimeout(timeout)
  }
}

async function loadStoredMessages(phone: string): Promise<StoredMessageRow[]> {
  const rows = await db
    .select({
      role: messages.role,
      content: messages.content,
      agent_used: messages.agent_used,
      created_at: messages.created_at
    })
    .from(messages)
    .where(eq(messages.lead_phone, phone))
    .orderBy(desc(messages.created_at))
    .limit(40)

  return rows
    .filter((message) => Boolean((message.content ?? '').trim()))
    .sort((a, b) => (a.created_at?.getTime() ?? 0) - (b.created_at?.getTime() ?? 0))
}

function normalizeMessages(raw: unknown): WacliMessageRow[] {
  const body = raw as WacliMessagesBody | null
  const rows = body?.success === true && Array.isArray(body.data?.messages) ? body.data.messages : []
  return rows
    .filter((message) => Boolean((message.Text ?? message.DisplayText ?? '').trim()))
    .sort((a, b) => new Date(a.Timestamp ?? 0).getTime() - new Date(b.Timestamp ?? 0).getTime())
}

function formatMessages(messages: WacliMessageRow[]): string {
  return messages
    .map((message) => {
      const role = message.FromMe ? 'Atendente/assistente' : 'Contato'
      const time = message.Timestamp ? new Date(message.Timestamp).toISOString() : 'sem-data'
      const text = (message.Text || message.DisplayText || '').trim()
      return `- ${time} — ${role}: ${text}`
    })
    .join('\n')
    .slice(-8000)
}

function formatCombinedContext(storedMessages: StoredMessageRow[], wacliMessages: WacliMessageRow[]): string {
  const storedContext = formatStoredMessages(storedMessages)
  const wacliOnlyContext = formatWacliOnlyMessages(wacliMessages, storedMessages)
  return [
    storedContext ? '### Mensagens registradas pelo AttendentAI\n\n' + storedContext : '',
    wacliOnlyContext ? '### Mensagens adicionais do WhatsApp\n\n' + wacliOnlyContext : ''
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(-10000)
}

function formatPromptContext(wacliMessages: WacliMessageRow[], storedMessages: StoredMessageRow[]): string {
  const wacliOnlyContext = formatWacliOnlyMessages(wacliMessages, storedMessages)
  return wacliOnlyContext
    ? `Mensagens adicionais do WhatsApp fora do histórico principal:\n${wacliOnlyContext}`.slice(-3500)
    : ''
}

function formatStoredMessages(rows: StoredMessageRow[]): string {
  return rows
    .map((message) => {
      const role = formatStoredRole(message.role, message.agent_used)
      const time = message.created_at?.toISOString() ?? 'sem-data'
      const content = (message.content ?? '').trim()
      return `- ${time} — ${role}: ${content}`
    })
    .join('\n')
}

function formatWacliOnlyMessages(wacliMessages: WacliMessageRow[], storedMessages: StoredMessageRow[]): string {
  const storedTexts = new Set(storedMessages.map((message) => normalizeText(message.content ?? '')))
  const uniqueMessages = wacliMessages.filter((message) => {
    const text = normalizeText(message.Text || message.DisplayText || '')
    return text && !storedTexts.has(text)
  })
  return formatMessages(uniqueMessages)
}

function formatStoredRole(role: string | null, agentUsed: string | null): string {
  if (role === 'user') return 'Lead/admin'
  if (role === 'human_agent') return 'Atendente humano'
  if (role === 'assistant' && agentUsed === 'internal-assistant') return 'Assistente interno'
  if (role === 'assistant') return 'Assistente'
  return 'Sistema'
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}
