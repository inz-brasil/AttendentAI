// persistent.ts — Gerencia memória persistente de leads no banco e vault
import { and, desc, eq } from 'drizzle-orm'
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

const summarizingPhones = new Set<string>()

function vaultFor(tenantId: string): VaultManager {
  return VaultManager.forTenant(env.VAULT_PATH, tenantId)
}
const log = pino({ name: 'attendentai-memory' })
const hotIntentSet = new Set(['scheduling'])

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

async function ensureLeadMemoryMeta(phone: string, tenantId = 'default'): Promise<void> {
  const [meta] = await db
    .select({ phone: leadMemoryMeta.phone })
    .from(leadMemoryMeta)
    .where(and(eq(leadMemoryMeta.tenant_id, tenantId), eq(leadMemoryMeta.phone, phone)))
    .limit(1)
  if (!meta) {
    await db.insert(leadMemoryMeta).values({ phone, tenant_id: tenantId })
  }
}

/**
 * Busca ou cria um lead e sua pasta no vault.
 * @param phone Telefone do lead.
 * @param name Nome do lead.
 * @param contactInfo Dados extras enviados pelo webhook.
 * @param tenantId Tenant isolado (default: 'default').
 * @returns Lead persistido.
 */
export async function getOrCreateLead(phone: string, name: string, contactInfo?: ContactInfo, tenantId = 'default') {
  const [existingLead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.tenant_id, tenantId), eq(leads.phone, phone)))
    .limit(1)
  if (existingLead) {
    return existingLead
  }

  const vaultPath = await vaultFor(tenantId).ensureLeadFolder(phone, name || 'Sem Nome')
  const newLead = {
    phone,
    tenant_id: tenantId,
    name,
    email: contactInfo?.email ?? null,
    city: contactInfo?.city ?? null,
    custom_data: contactInfo ?? {},
    vault_path: vaultPath
  }

  await db.insert(leads).values(newLead)
  const [createdLead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.tenant_id, tenantId), eq(leads.phone, phone)))
    .limit(1)
  return createdLead
}

/**
 * Carrega memória resumida do lead.
 * @param phone Telefone do lead.
 * @param tenantId Tenant isolado (default: 'default').
 * @returns Snapshot com resumo, últimas mensagens e histórico do vault.
 */
export async function loadMemory(phone: string, tenantId = 'default'): Promise<MemorySnapshot> {
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.tenant_id, tenantId), eq(leads.phone, phone)))
    .limit(1)
  const recentMessages = await db
    .select({
      role: messages.role,
      content: messages.content,
      created_at: messages.created_at
    })
    .from(messages)
    .where(and(eq(messages.tenant_id, tenantId), eq(messages.lead_phone, phone)))
    .orderBy(desc(messages.created_at))
    .limit(10)

  const tenantVault = vaultFor(tenantId)
  const memoryFile = await tenantVault.read(phone, 'memoria.md')
  const [historyFile, notesFile] = await Promise.all([
    tenantVault.read(phone, 'historico.md'),
    tenantVault.read(phone, 'notas.md')
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
 * @param tenantId Tenant isolado (default: 'default').
 * @returns Nada.
 */
export async function updateLead(phone: string, fields: LeadUpdateInput, tenantId = 'default'): Promise<void> {
  if (Object.keys(fields).length === 0) {
    return
  }

  await db
    .update(leads)
    .set({
      ...fields,
      updated_at: new Date()
    })
    .where(and(eq(leads.tenant_id, tenantId), eq(leads.phone, phone)))
}

/**
 * Salva um resumo curto do estado atual da conversa no historico.md.
 * @param phone Telefone do lead.
 * @param name Nome conhecido do lead.
 * @param summary Resumo operacional curto.
 * @param tenantId Tenant isolado (default: 'default').
 * @returns Nada.
 */
export async function saveConversationSummary(phone: string, name: string, summary: string, tenantId = 'default'): Promise<void> {
  const content = `# Histórico de Conversas — ${name || phone}

## Resumo
${summary.trim() || 'Sem resumo operacional ainda.'}
`
  await vaultFor(tenantId).write(phone, 'historico.md', content)
}

/**
 * Salva uma mensagem e cria conversa se necessário.
 * @param phone Telefone do lead.
 * @param role Papel da mensagem.
 * @param content Conteúdo textual.
 * @param metadata Metadados de processamento.
 * @param tenantId Tenant isolado (default: 'default').
 * @returns Nada.
 */
export async function saveMessage(
  phone: string,
  role: MessageRole,
  content: string,
  metadata: MessageMetadata = {},
  tenantId = 'default'
): Promise<void> {
  await ensureLeadMemoryMeta(phone, tenantId)

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.tenant_id, tenantId), eq(conversations.lead_phone, phone)))
    .orderBy(desc(conversations.started_at))
    .limit(1)

  const conversationId = conversation?.id ?? crypto.randomUUID()
  if (!conversation) {
    await db.insert(conversations).values({
      id: conversationId,
      tenant_id: tenantId,
      lead_phone: phone,
      total_messages: 0,
      total_tokens: 0
    })
  }

  await db.insert(messages).values({
    conversation_id: conversationId,
    tenant_id: tenantId,
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

  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.tenant_id, tenantId), eq(leads.phone, phone)))
    .limit(1)
  const nextStatus = resolveNextLeadStatus(lead?.status ?? null, role, metadata.intent)
  await db
    .update(leads)
    .set({
      total_messages: (lead?.total_messages ?? 0) + 1,
      ...(nextStatus ? { status: nextStatus } : {}),
      last_message_at: new Date(),
      updated_at: new Date()
    })
    .where(and(eq(leads.tenant_id, tenantId), eq(leads.phone, phone)))

  await db
    .update(conversations)
    .set({
      total_messages: (conversation?.total_messages ?? 0) + 1,
      total_tokens: (conversation?.total_tokens ?? 0) + (metadata.tokens_used ?? 0)
    })
    .where(eq(conversations.id, conversationId))

  await triggerSummarizationIfNeeded(phone, tenantId)
}

/**
 * Atualiza status comercial do lead sem sobrescrever conversão manual.
 * @param phone Telefone do lead.
 * @param status Novo status.
 * @param tenantId Tenant isolado (default: 'default').
 * @returns Nada.
 */
export async function setLeadStatus(phone: string, status: LeadStatus, tenantId = 'default'): Promise<void> {
  const [lead] = await db
    .select({ status: leads.status })
    .from(leads)
    .where(and(eq(leads.tenant_id, tenantId), eq(leads.phone, phone)))
    .limit(1)
  if (lead?.status === 'convertido') {
    return
  }

  await db
    .update(leads)
    .set({ status, updated_at: new Date() })
    .where(and(eq(leads.tenant_id, tenantId), eq(leads.phone, phone)))
}

function resolveNextLeadStatus(
  currentStatus: LeadStatus | null,
  role: MessageRole,
  intent: string | undefined
): LeadStatus | null {
  if (currentStatus === 'convertido' || currentStatus === 'lead_quente') {
    return null
  }

  if (role === 'user') {
    return hotIntentSet.has(intent ?? '') ? 'lead_quente' : 'ativo'
  }

  return null
}

async function triggerSummarizationIfNeeded(phone: string, tenantId = 'default'): Promise<void> {
  const key = `${tenantId}:${phone}`
  if (summarizingPhones.has(key)) {
    return
  }

  const summarizer = new Summarizer(vaultFor(tenantId))
  if (!(await summarizer.shouldSummarize(phone, tenantId))) {
    return
  }

  summarizingPhones.add(key)
  void summarizer
    .summarize(phone, tenantId)
    .catch((error: unknown) => {
      log.error({ err: error, phone, tenantId }, 'failed to summarize memory')
    })
    .finally(() => {
      summarizingPhones.delete(key)
    })
}
