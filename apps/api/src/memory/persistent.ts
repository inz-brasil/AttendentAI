// persistent.ts — Gerencia memória persistente de leads no banco e vault
import { desc, eq } from 'drizzle-orm'
import pino from 'pino'
import { env } from '../config/env'
import { MEMORY_CONFIG } from '../config/memory'
import { db } from '../db/client'
import { conversations, leadMemoryMeta, leads, messages, type LeadStatus, type MessageRole, type MessageType } from '../db/schema'
import { VaultManager } from '../vault-manager/manager'
import { Summarizer } from './summarizer'

export interface ContactInfo {
  email?: string | undefined
  city?: string | undefined
  [key: string]: unknown
}

export interface MemorySnapshot {
  lead_summary: string
  recent_messages: Array<{
    role: MessageRole | null
    content: string | null
    created_at: Date | null
  }>
  history_summary: string
  notes_summary: string
}

export interface MessageMetadata {
  message_type?: MessageType
  audio_requested?: boolean
  intent?: string
  tokens_used?: number
  agent_used?: string
  processing_ms?: number
}

export interface LeadUpdateInput {
  name?: string | undefined
  email?: string | undefined
  city?: string | undefined
  status?: LeadStatus | undefined
  tags?: string[] | undefined
}

const vault = new VaultManager(env.VAULT_PATH)
const summarizer = new Summarizer(vault)
const summarizingPhones = new Set<string>()
const log = pino({ name: 'attendentai-memory' })

function maxMemoryChars(): number {
  return MEMORY_CONFIG.MAX_MEMORY_TOKENS * 4
}

function truncateText(value: string, maxChars: number): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxChars) {
    return trimmed
  }

  return trimmed.slice(0, Math.max(0, maxChars - 25)).trimEnd() + '\n[conteúdo truncado]'
}

function splitVaultMemoryBudget(historyFile: string, notesFile: string): { history: string; notes: string } {
  const totalChars = maxMemoryChars()
  const historyBudget = Math.min(historyFile.trim().length, Math.floor(totalChars * 0.7))
  const notesBudget = Math.max(0, totalChars - historyBudget)
  return {
    history: truncateText(historyFile, historyBudget),
    notes: truncateText(notesFile, notesBudget)
  }
}

async function ensureLeadMemoryMeta(phone: string): Promise<void> {
  const [meta] = await db.select({ phone: leadMemoryMeta.phone }).from(leadMemoryMeta).where(eq(leadMemoryMeta.phone, phone)).limit(1)
  if (!meta) {
    await db.insert(leadMemoryMeta).values({ phone })
  }
}

/**
 * Busca ou cria um lead e sua pasta no vault.
 * @param phone Telefone do lead.
 * @param name Nome do lead.
 * @param contactInfo Dados extras enviados pelo webhook.
 * @returns Lead persistido.
 */
export async function getOrCreateLead(phone: string, name: string, contactInfo?: ContactInfo) {
  const [existingLead] = await db.select().from(leads).where(eq(leads.phone, phone)).limit(1)
  if (existingLead) {
    return existingLead
  }

  const vaultPath = await vault.ensureLeadFolder(phone, name || 'Sem Nome')
  const newLead = {
    phone,
    name,
    email: contactInfo?.email ?? null,
    city: contactInfo?.city ?? null,
    custom_data: contactInfo ?? {},
    vault_path: vaultPath
  }

  await db.insert(leads).values(newLead)
  const [createdLead] = await db.select().from(leads).where(eq(leads.phone, phone)).limit(1)
  return createdLead
}

/**
 * Carrega memória resumida do lead.
 * @param phone Telefone do lead.
 * @returns Snapshot com resumo, últimas mensagens e histórico do vault.
 */
export async function loadMemory(phone: string): Promise<MemorySnapshot> {
  const [lead] = await db.select().from(leads).where(eq(leads.phone, phone)).limit(1)
  const recentMessages = await db
    .select({
      role: messages.role,
      content: messages.content,
      created_at: messages.created_at
    })
    .from(messages)
    .where(eq(messages.lead_phone, phone))
    .orderBy(desc(messages.created_at))
    .limit(10)

  const memoryFile = await vault.read(phone, 'memoria.md')
  const [historyFile, notesFile] = await Promise.all([
    vault.read(phone, 'historico.md'),
    vault.read(phone, 'notas.md')
  ])
  const vaultMemory = splitVaultMemoryBudget(historyFile, notesFile)
  const leadSummary = [
    lead?.name ? `Nome: ${lead.name}` : null,
    lead?.city ? `Cidade: ${lead.city}` : null,
    memoryFile.trim()
  ]
    .filter((item): item is string => Boolean(item))
    .join('\n')

  return {
    lead_summary: [leadSummary, vaultMemory.history ? `Histórico sumarizado:\n${vaultMemory.history}` : null]
      .filter((item): item is string => Boolean(item))
      .join('\n\n'),
    recent_messages: recentMessages.reverse(),
    history_summary: vaultMemory.history,
    notes_summary: vaultMemory.notes
  }
}

/**
 * Atualiza dados explícitos do lead.
 * @param phone Telefone do lead.
 * @param fields Campos confirmados pelo identificador.
 * @returns Nada.
 */
export async function updateLead(phone: string, fields: LeadUpdateInput): Promise<void> {
  if (Object.keys(fields).length === 0) {
    return
  }

  await db
    .update(leads)
    .set({
      ...fields,
      updated_at: new Date()
    })
    .where(eq(leads.phone, phone))
}

/**
 * Salva um resumo curto do estado atual da conversa no historico.md.
 * @param phone Telefone do lead.
 * @param name Nome conhecido do lead.
 * @param summary Resumo operacional curto.
 * @returns Nada.
 */
export async function saveConversationSummary(phone: string, name: string, summary: string): Promise<void> {
  const content = `# Histórico de Conversas — ${name || phone}

## Resumo
${summary.trim() || 'Sem resumo operacional ainda.'}
`
  await vault.write(phone, 'historico.md', content)
}

/**
 * Salva uma mensagem e cria conversa se necessário.
 * @param phone Telefone do lead.
 * @param role Papel da mensagem.
 * @param content Conteúdo textual.
 * @param metadata Metadados de processamento.
 * @returns Nada.
 */
export async function saveMessage(
  phone: string,
  role: MessageRole,
  content: string,
  metadata: MessageMetadata = {}
): Promise<void> {
  await ensureLeadMemoryMeta(phone)

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.lead_phone, phone))
    .orderBy(desc(conversations.started_at))
    .limit(1)

  const conversationId = conversation?.id ?? crypto.randomUUID()
  if (!conversation) {
    await db.insert(conversations).values({
      id: conversationId,
      lead_phone: phone,
      total_messages: 0,
      total_tokens: 0
    })
  }

  await db.insert(messages).values({
    conversation_id: conversationId,
    lead_phone: phone,
    role,
    content,
    message_type: metadata.message_type ?? 'text',
    audio_requested: metadata.audio_requested ?? false,
    intent: metadata.intent,
    tokens_used: metadata.tokens_used ?? 0,
    agent_used: metadata.agent_used,
    processing_ms: metadata.processing_ms
  })

  const [lead] = await db.select().from(leads).where(eq(leads.phone, phone)).limit(1)
  await db
    .update(leads)
    .set({
      total_messages: (lead?.total_messages ?? 0) + 1,
      last_message_at: new Date(),
      updated_at: new Date()
    })
    .where(eq(leads.phone, phone))

  await db
    .update(conversations)
    .set({
      total_messages: (conversation?.total_messages ?? 0) + 1,
      total_tokens: (conversation?.total_tokens ?? 0) + (metadata.tokens_used ?? 0)
    })
    .where(eq(conversations.id, conversationId))

  await triggerSummarizationIfNeeded(phone)
}

async function triggerSummarizationIfNeeded(phone: string): Promise<void> {
  if (summarizingPhones.has(phone)) {
    return
  }

  if (!(await summarizer.shouldSummarize(phone))) {
    return
  }

  summarizingPhones.add(phone)
  void summarizer
    .summarize(phone)
    .catch((error: unknown) => {
      log.error({ err: error, phone }, 'failed to summarize memory')
    })
    .finally(() => {
      summarizingPhones.delete(phone)
    })
}
