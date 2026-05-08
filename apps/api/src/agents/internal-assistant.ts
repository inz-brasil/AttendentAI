// internal-assistant.ts — Agente interno para operar e consultar a própria plataforma
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool
} from 'openai/resources/chat/completions'
import { z } from 'zod'
import { env } from '../config/env'
import { WHATSAPP_FORMATTING_RULES, normalizeWhatsAppFormatting } from '../config/whatsapp-formatting'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/client'
import { leads, mcpCredentials, mcpServers } from '../db/schema'
import { loadMemory, saveMessage } from '../memory/persistent'
import {
  executeRegisteredTool,
  evolutionReactionToolDefinition,
  evolutionSendToolDefinition,
  httpRequestToolDefinition,
  leadLookupToolDefinition,
  platformEditorToolDefinition,
  platformStatsToolDefinition,
  systemControlToolDefinition,
  taskManagerToolDefinition,
  vaultReadToolDefinition,
  wacliToolDefinition,
  webSearchToolDefinition
} from '../tools'
import { BaseAgent, type AgentInput, type AgentRunMetadata, type AgentToolTrace } from './base-agent'
import { SchedulingAgent } from './scheduling-agent'

const internalSystemPrompt = `Você é o assistente pessoal interno — inteligente, direto e com personalidade real, como o J.A.R.V.I.S. do Iron Man. Atende operadores com acesso total à plataforma.

PERSONALIDADE — COMO VOCÊ É:
Pense como um colega de trabalho muito capaz, não como um assistente servil. Você fala de igual para igual, com confiança e um leve humor quando o clima pede. Você não fica oferecendo ajuda o tempo todo — você já está ajudando.

TOM E ESTILO:
- Mensagens curtas. Nunca termine com "Estou aqui para ajudar" ou "é só me avisar" ou qualquer variante disso. Essas frases são proibidas.
- Nunca use o mesmo emoji duas vezes seguidas. Prefira não usar a usar repetido.
- Quando alguém fala "Eae", "oi", "olá", "tudo bem" — responda naturalmente ("Eae!", "Oi!", "Tudo!") e pare. Não ofereça serviços logo de cara.
- Quando alguém fala algo casual ("beleza", "ok", "blz", "boa") — reconheça e pronto. Não ofereça nada. Só responda se houver pergunta ou pedido.
- Quando alguém manda algo engraçado ("kkkk", "uai akakak", piada) — ria junto, use humor, reaja com emoji se quiser. Não seja robótico.
- Quando receber [Reação: 👍] ou similar — use evolution_reaction para reagir de volta com um emoji adequado. Pode adicionar uma resposta curta ou não. Nunca trate reação como pergunta.
- Quando receber [Figurinha] — reaja naturalmente com uma palavra ou emoji. Não ofereça ajuda a não ser que faça sentido.

QUANDO OFERECER AJUDA:
Só ofereça algo proativamente se houver dado concreto relevante (ex: "Tem 3 leads sem resposta desde ontem"). Nunca pergunte genericamente "posso ajudar com algo?". Se não há tarefa, responda o que foi dito e pare.

MEMÓRIA E CONTEXTO:
- Se já perguntou algo e não obteve resposta, não repita a mesma pergunta.
- Leia o histórico antes de agir. Use o que sabe do operador.
- Se passou horas desde a última mensagem, pode retomar naturalmente.

TOOLS — QUANDO USAR:
- Métricas/estatísticas → platform_stats
- Buscar/consultar leads → lead_lookup
- Ler vault/memória/notas → vault_read
- Agenda/reuniões de leads → scheduling_action
- Envio ativo WhatsApp → evolution_send (só confirme após tool retornar sucesso)
- Reagir com emoji a mensagem → evolution_reaction (use incoming_message_id e incoming_remote_jid do contexto — SEMPRE disponíveis)
- Tarefas e checklists → task_manager (persistente entre conversas)
- Ligar/desligar bot, horários, blacklist → system_control
- Fatos atuais, documentação → web_search (cite fontes brevemente)
- Histórico WhatsApp, grupos → wacli
- Editar prompts, skills, vault → platform_editor (leia antes de alterar; apply=false simula, apply=true salva)

TAREFAS:
- Use task_manager para checklists quando pedirem para acompanhar algo.
- Ao adicionar: confirme sem listar tudo de novo.
- Quando disserem "feito", "ok", "concluído" sobre uma tarefa: marque como concluída.
- Só consulte tarefas pendentes proativamente se houver tarefas pendentes e o operador ficou um tempo sem aparecer.

REAÇÕES COM EVOLUTION_REACTION:
- Você DEVE usar evolution_reaction quando:
  * Receber uma reação de emoji ([Reação: X])
  * Receber algo engraçado, aprovação, conquista
  * Quiser confirmar silenciosamente que recebeu algo
- Combine reação + texto quando fizer sentido. Nunca substitua texto por reação sozinha se houver algo a dizer.

REGRAS ABSOLUTAS:
- Nunca invente métricas, nomes, datas ou eventos.
- Nunca confirme envio antes de evolution_send retornar sucesso.
- Nunca apague vault sem pedido explícito.
- delivery_status=registered_only ≠ mensagem enviada externamente.
- Para grupos no wacli: list_groups primeiro para achar o chat_jid @g.us.

${WHATSAPP_FORMATTING_RULES}`

export interface InternalAssistantInput extends AgentInput {
  phone: string
  system_prompt: string
  message: string
  operator_name: string
  current_time: string
  recent_messages?: Array<{ role: string | null; content: string | null }> | undefined
  /** ID da mensagem recebida — permite reações via evolution_reaction */
  incoming_message_id?: string | undefined
  /** JID completo do remetente — necessário para reações */
  incoming_remote_jid?: string | undefined
}

const schedulingActionToolDefinition: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'scheduling_action',
    description: 'Chama o agente especialista para criar, remarcar, cancelar ou consultar reunião de um lead.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        lead_phone: {
          type: 'string',
          description: 'Telefone/WhatsApp exato do lead.'
        },
        instruction: {
          type: 'string',
          description: 'Pedido operacional completo do admin, incluindo dia, horário, duração e ação desejada.'
        },
        notify_user: {
          type: 'boolean',
          description: 'Se true, registra a mensagem ao lead no histórico. Envio real para WhatsApp deve ser feito separadamente com http_request.'
        }
      },
      required: ['lead_phone', 'instruction']
    }
  }
}

const schedulingActionArgsSchema = z.object({
  lead_phone: z.string().min(1),
  instruction: z.string().min(1),
  notify_user: z.boolean().default(false)
})

type LeadRow = typeof leads.$inferSelect
type McpServerRow = typeof mcpServers.$inferSelect

export interface InternalAssistantOutput extends AgentRunMetadata {
  text: string
}

export interface InternalAssistantDebugContext {
  system_prompt_final: string
  user_prompt_final: string
  tools_available: Array<{ name: string; description: string | null }>
}

export class InternalAssistantAgent extends BaseAgent<InternalAssistantInput, InternalAssistantOutput> {
  private readonly schedulingAgent = new SchedulingAgent()

  constructor() {
    super({
      name: 'internal-assistant',
      systemPrompt: internalSystemPrompt,
      model: 'gpt-4o',
      maxTokens: env.MAX_TOKENS_RESPONSE,
      temperature: 0.2
    })
  }

  /**
   * Monta mensagens com contexto de operador e instruções de plataforma.
   * @param input Mensagem interna recebida.
   * @returns Lista de mensagens para o modelo.
   */
  protected override buildMessages(input: InternalAssistantInput): ChatCompletionMessageParam[] {
    const customPrompt = input.system_prompt.trim()
    return [
      {
        role: 'system',
        content: customPrompt
          ? `${this.systemPrompt}\n\nPreferências configuradas pelo admin, sem sobrescrever as regras acima:\n${customPrompt}`
          : this.systemPrompt
      },
      {
        role: 'user',
        content: [
          `Operador: ${input.operator_name || input.phone}`,
          `Identificador: ${input.phone}`,
          `Data/hora atual: ${input.current_time}`,
          input.incoming_message_id ? `incoming_message_id: ${input.incoming_message_id}` : null,
          input.incoming_remote_jid ? `incoming_remote_jid: ${input.incoming_remote_jid}` : null,
          `Mensagem atual do operador:\n${input.message}`,
          this.formatRecentContext(input.recent_messages ?? [])
        ].filter(Boolean).join('\n')
      }
    ]
  }

  /**
   * Disponibiliza tools internas e HTTP para operação da plataforma.
   * @param input Entrada contextual.
   * @returns Tools disponíveis.
   */
  protected override getTools(input: InternalAssistantInput): ChatCompletionTool[] {
    void input
    return [
      platformStatsToolDefinition,
      leadLookupToolDefinition,
      vaultReadToolDefinition,
      schedulingActionToolDefinition,
      evolutionSendToolDefinition,
      evolutionReactionToolDefinition,
      taskManagerToolDefinition,
      httpRequestToolDefinition,
      systemControlToolDefinition,
      webSearchToolDefinition,
      wacliToolDefinition,
      platformEditorToolDefinition
    ]
  }

  /**
   * Monta uma versão auditável do prompt e das tools disponíveis para debug.
   * @param input Entrada que será enviada ao agente.
   * @returns Prompt final e lista resumida de tools.
   */
  public buildDebugContext(input: InternalAssistantInput): InternalAssistantDebugContext {
    const messages = this.buildMessages(input)
    const tools = this.getTools(input)
    const systemMessage = messages.find((message) => message.role === 'system')
    const userMessage = messages.find((message) => message.role === 'user')

    return {
      system_prompt_final: typeof systemMessage?.content === 'string' ? systemMessage.content : '',
      user_prompt_final: typeof userMessage?.content === 'string' ? userMessage.content : '',
      tools_available: tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description ?? null
      }))
    }
  }

  /**
   * Executa tool calls do assistente interno.
   * @param toolCall Chamada do modelo.
   * @param input Entrada original.
   * @returns Trace de execução.
   */
  protected override async executeToolCall(
    toolCall: ChatCompletionMessageToolCall,
    input: InternalAssistantInput
  ): Promise<AgentToolTrace> {
    const startedAt = Date.now()
    const args = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>
    const result = toolCall.function.name === 'scheduling_action'
      ? await this.executeSchedulingAction(args, input)
      : await executeRegisteredTool(toolCall.function.name, args)
    return {
      tool: toolCall.function.name,
      arguments: sanitizeToolArguments(toolCall.function.name, args),
      result,
      duration_ms: Date.now() - startedAt
    }
  }

  /**
   * Devolve resposta textual para o operador interno.
   * @param text Texto bruto do modelo.
   * @param metadata Métricas e tools usadas.
   * @returns Saída estruturada.
   */
  protected override parseOutput(text: string, metadata: AgentRunMetadata): InternalAssistantOutput {
    return {
      text: normalizeWhatsAppFormatting(text),
      ...metadata
    }
  }

  private formatRecentContext(messages: Array<{ role: string | null; content: string | null }>): string {
    const recent = messages
      .slice(-6)
      .map((message) => {
        if (message.role === 'system') return this.truncateContextBlock(message.content ?? '', 1800)
        const role = message.role === 'assistant' ? 'Assistente interno' : 'Operador'
        return `${role}: ${this.truncateContextBlock(message.content ?? '', 700)}`.trim()
      })
      .filter((line) => line.length > 0)

    return recent.length > 0
      ? `Contexto recente da conversa interna:\n${recent.join('\n')}`
      : 'Contexto recente da conversa interna: sem histórico recente salvo.'
  }

  private truncateContextBlock(value: string, maxLength: number): string {
    const normalized = value.replace(/\n{3,}/g, '\n\n').trim()
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized
  }

  private async executeSchedulingAction(args: unknown, input: InternalAssistantInput): Promise<unknown> {
    const parsed = schedulingActionArgsSchema.parse(args)
    const tenantId = input.tenant_id ?? 'default'
    const lead = await this.loadLead(parsed.lead_phone, tenantId)
    if (!lead) {
      return { success: false, error: 'Lead não encontrado', delivery_status: 'not_sent' }
    }

    const server = await this.loadConnectedCalendarServer()
    if (!server) {
      return { success: false, error: 'Google Calendar não conectado ou inativo', delivery_status: 'not_sent' }
    }

    const result = await this.runSchedulingForLead(parsed.instruction, input, lead, server, tenantId)
    const deliveryStatus = await this.registerUserMessageIfRequested(parsed.notify_user, lead.phone, result, tenantId)
    return {
      success: result.status !== 'failed',
      delivery_status: deliveryStatus,
      scheduling: {
        status: result.status,
        action: result.action,
        event_id: result.event_id,
        scheduled_for: result.scheduled_for,
        missing_fields: result.missing_fields,
        user_message: result.user_message,
        admin_message: result.admin_message,
        message_to_responder: result.message_to_responder
      }
    }
  }

  private async loadLead(phone: string, tenantId = 'default'): Promise<LeadRow | null> {
    const [lead] = await db.select().from(leads).where(and(eq(leads.tenant_id, tenantId), eq(leads.phone, phone))).limit(1)
    return lead ?? null
  }

  private async loadConnectedCalendarServer(): Promise<McpServerRow | null> {
    const [server] = await db.select().from(mcpServers).where(eq(mcpServers.slug, 'google-calendar')).limit(1)
    if (!server?.is_active) return null

    const [credential] = await db
      .select()
      .from(mcpCredentials)
      .where(eq(mcpCredentials.mcp_server_id, server.id))
      .limit(1)
    return credential?.refresh_token_encrypted ? server : null
  }

  private async runSchedulingForLead(
    instruction: string,
    input: InternalAssistantInput,
    lead: LeadRow,
    server: McpServerRow,
    tenantId = 'default'
  ) {
    const memory = await loadMemory(lead.phone, tenantId)
    return this.schedulingAgent.run({
      phone: lead.phone,
      run_id: typeof input.run_id === 'string' ? input.run_id : crypto.randomUUID(),
      caller_type: 'internal',
      message: instruction,
      lead_name: lead.name ?? lead.phone,
      lead_email: lead.email,
      current_time: input.current_time,
      timezone: 'America/Sao_Paulo',
      history_summary: memory.lead_summary,
      recent_messages: memory.recent_messages,
      mcp_server_id: server.id
    })
  }

  private async registerUserMessageIfRequested(
    notifyUser: boolean,
    phone: string,
    result: Awaited<ReturnType<SchedulingAgent['run']>>,
    tenantId = 'default'
  ): Promise<'not_sent' | 'registered_only'> {
    if (notifyUser && result.user_message) {
      await saveMessage(phone, 'assistant', result.user_message, {
        message_type: 'text',
        intent: 'scheduling',
        tokens_used: result.tokens_used,
        agent_used: 'scheduling-agent',
        processing_ms: result.duration_ms
      }, tenantId)
      return 'registered_only'
    }

    return 'not_sent'
  }
}

function sanitizeToolArguments(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  if (toolName !== 'web_search') {
    return args
  }

  return {
    ...args,
    query: '[redacted]'
  }
}
