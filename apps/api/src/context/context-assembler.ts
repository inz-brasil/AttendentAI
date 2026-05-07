// context-assembler.ts — Monta contexto determinístico do agente com orçamento de tokens
import { and, desc, eq } from 'drizzle-orm'
import { getHumanTakeoverState } from '../automation/human-takeover'
import { db } from '../db/client'
import { leads, messageEvents, type MessageEventSenderType } from '../db/schema'
import { traceEmitter } from '../observability/trace-emitter'

export interface AgentContextPackage {
  currentTurn: { message: string; quotedText: string | null; currentTime: string; timezone: string }
  leadState: {
    phone: string
    name: string | null
    status: string
    automationPaused: boolean
    lastInteraction: Date | null
  }
  recentTranscript: Array<{
    role: 'user' | 'assistant' | 'human_agent'
    content: string
    timestamp: number
    senderType: string
  }>
  relevantMemory: string
  selectedSkills: string
  toolsContext: string
  debug: { estimatedTokens: number; sources: string[]; droppedItems: string[] }
}

export interface ContextAssemblerInput {
  tenantId: string
  phone: string
  currentMessage: string
  quotedText?: string | null
  currentTime: string
  timezone: string
  relevantMemory: string
  selectedSkills: string
  toolsContext: string
  batchId?: string | null
}

interface TranscriptItem {
  role: 'user' | 'assistant' | 'human_agent'
  content: string
  timestamp: number
  senderType: string
  sourceId: string
}

const TOKEN_BUDGET = {
  total: 8000,
  staticInstructions: 1500,
  currentTurn: 500,
  leadState: 500,
  recentTranscript: 3000,
  relevantMemory: 1500,
  skills: 1000
} as const

const TRANSCRIPT_LOOKBACK = 50

/**
 * Monta pacote de contexto do agente sem misturar transcript, vault e WACLI solto.
 */
export class ContextAssembler {
  /**
   * Monta contexto dentro do orçamento de tokens e emite trace de debug.
   * @param input Dados atuais da conversa e blocos semânticos já selecionados.
   * @returns Pacote de contexto para o agente.
   */
  async assemble(input: ContextAssemblerInput): Promise<AgentContextPackage> {
    const leadState = await this.loadLeadState(input.phone)
    const transcript = await this.loadRecentTranscript(input.tenantId, input.phone, input.currentMessage, input.batchId ?? null)
    const droppedItems: string[] = []
    const recentTranscript = fitTranscriptBudget(transcript, TOKEN_BUDGET.recentTranscript, droppedItems)
    const relevantMemory = truncateToTokenBudget(input.relevantMemory, TOKEN_BUDGET.relevantMemory, 'relevantMemory', droppedItems)
    const selectedSkills = truncateToTokenBudget(input.selectedSkills, TOKEN_BUDGET.skills, 'selectedSkills', droppedItems)
    const currentTurn = {
      message: truncateToTokenBudget(input.currentMessage, TOKEN_BUDGET.currentTurn, 'currentTurn.message', droppedItems),
      quotedText: input.quotedText
        ? truncateToTokenBudget(input.quotedText, Math.floor(TOKEN_BUDGET.currentTurn / 2), 'currentTurn.quotedText', droppedItems)
        : null,
      currentTime: input.currentTime,
      timezone: input.timezone
    }
    const sources = buildSources(input, recentTranscript, relevantMemory, selectedSkills)
    const estimatedTokens = Math.min(TOKEN_BUDGET.total, estimatePackageTokens({
      currentTurn,
      leadState,
      recentTranscript,
      relevantMemory,
      selectedSkills,
      toolsContext: input.toolsContext
    }))
    const contextPackage: AgentContextPackage = {
      currentTurn,
      leadState,
      recentTranscript,
      relevantMemory,
      selectedSkills,
      toolsContext: input.toolsContext,
      debug: { estimatedTokens, sources, droppedItems }
    }

    await traceEmitter.emit('context_assembled', {
      tenant_id: input.tenantId,
      batch_id: input.batchId ?? null,
      phone: input.phone,
      data: {
        estimated_tokens: estimatedTokens,
        sources,
        dropped_items: droppedItems,
        recent_transcript_count: recentTranscript.length,
        budget: TOKEN_BUDGET
      }
    })

    return contextPackage
  }

  private async loadLeadState(phone: string): Promise<AgentContextPackage['leadState']> {
    const [lead] = await db.select().from(leads).where(eq(leads.phone, phone)).limit(1)
    const pause = await getHumanTakeoverState(phone)

    return {
      phone,
      name: lead?.name ?? null,
      status: lead?.status ?? 'novo',
      automationPaused: pause.active,
      lastInteraction: lead?.last_message_at ?? null
    }
  }

  private async loadRecentTranscript(
    tenantId: string,
    phone: string,
    currentMessage: string,
    currentBatchId: string | null
  ): Promise<TranscriptItem[]> {
    const currentLines = new Set(currentMessage.split('\n').map(normalizeComparableText).filter(Boolean))
    const rows = await db
      .select()
      .from(messageEvents)
      .where(and(eq(messageEvents.tenant_id, tenantId), eq(messageEvents.lead_phone, phone)))
      .orderBy(desc(messageEvents.whatsapp_timestamp), desc(messageEvents.created_at))
      .limit(TRANSCRIPT_LOOKBACK)

    return rows
      .reverse()
      .filter((event) => event.batch_id !== currentBatchId)
      .map((event): TranscriptItem | null => {
        const role = mapTranscriptRole(event.role, event.sender_type)
        if (!role || !event.content.trim()) {
          return null
        }

        if (currentLines.has(normalizeComparableText(event.content))) {
          return null
        }

        return {
          role,
          content: event.content,
          timestamp: event.whatsapp_timestamp,
          senderType: event.sender_type,
          sourceId: event.id
        }
      })
      .filter((item): item is TranscriptItem => item !== null)
  }
}

function mapTranscriptRole(
  role: string,
  senderType: MessageEventSenderType
): 'user' | 'assistant' | 'human_agent' | null {
  if (role === 'user') return 'user'
  if (role === 'assistant') return 'assistant'
  if (role === 'human_agent') return 'human_agent'
  if (senderType === 'customer') return 'user'
  if (senderType === 'bot' || senderType === 'internal_assistant') return 'assistant'
  if (senderType === 'human_agent') return 'human_agent'
  return null
}

function fitTranscriptBudget(items: TranscriptItem[], budget: number, droppedItems: string[]): AgentContextPackage['recentTranscript'] {
  const selected: TranscriptItem[] = []
  let used = 0

  for (const item of [...items].reverse()) {
    const tokens = estimateTokens(`${item.role}: ${item.content}`)
    if (used + tokens > budget) {
      droppedItems.push(`recentTranscript:${item.sourceId}`)
      continue
    }

    selected.push(item)
    used += tokens
  }

  return selected.reverse().map((item) => ({
    role: item.role,
    content: item.content,
    timestamp: item.timestamp,
    senderType: item.senderType
  }))
}

function truncateToTokenBudget(value: string, budget: number, source: string, droppedItems: string[]): string {
  const normalized = value.replace(/\n{3,}/g, '\n\n').trim()
  if (estimateTokens(normalized) <= budget) {
    return normalized
  }

  const maxChars = Math.max(0, budget * 4 - 24)
  droppedItems.push(`${source}:truncated`)
  return `${normalized.slice(0, maxChars).trimEnd()}\n[conteúdo truncado]`
}

function estimatePackageTokens(input: Omit<AgentContextPackage, 'debug'>): number {
  return (
    TOKEN_BUDGET.staticInstructions +
    estimateTokens(JSON.stringify(input.currentTurn)) +
    estimateTokens(JSON.stringify(input.leadState)) +
    estimateTokens(input.recentTranscript.map((item) => `${item.role}: ${item.content}`).join('\n')) +
    estimateTokens(input.relevantMemory) +
    estimateTokens(input.selectedSkills) +
    estimateTokens(input.toolsContext)
  )
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4)
}

function normalizeComparableText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase()
}

function buildSources(
  input: ContextAssemblerInput,
  recentTranscript: AgentContextPackage['recentTranscript'],
  relevantMemory: string,
  selectedSkills: string
): string[] {
  return [
    'current_turn',
    'lead_state',
    recentTranscript.length > 0 ? 'message_events' : null,
    relevantMemory ? 'vault_semantic_memory' : null,
    selectedSkills ? 'selected_skills' : null,
    input.toolsContext ? 'tools_context' : null
  ].filter((item): item is string => Boolean(item))
}
