// internal-assistant.ts — Agente interno para operar e consultar a própria plataforma
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool
} from 'openai/resources/chat/completions'
import { z } from 'zod'
import { env } from '../config/env'
import { WHATSAPP_FORMATTING_RULES, normalizeWhatsAppFormatting } from '../config/whatsapp-formatting'
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { leads, mcpCredentials, mcpServers } from '../db/schema'
import { loadMemory, saveMessage } from '../memory/persistent'
import {
  executeRegisteredTool,
  evolutionSendToolDefinition,
  httpRequestToolDefinition,
  leadLookupToolDefinition,
  platformEditorToolDefinition,
  platformStatsToolDefinition,
  systemControlToolDefinition,
  vaultReadToolDefinition,
  wacliToolDefinition
} from '../tools'
import { BaseAgent, type AgentInput, type AgentRunMetadata, type AgentToolTrace } from './base-agent'
import { SchedulingAgent } from './scheduling-agent'

const internalSystemPrompt = `Você é o assistente interno do AttendentAI.
Você atende apenas operadores autorizados e ajuda a consultar leads, métricas, histórico resumido e executar automações via webhook.
Use tools sempre que a pergunta envolver números, leads, vault, agenda, histórico, notas ou envio externo. Nunca invente métricas.
Para perguntas como "quantos atendimentos hoje", use platform_stats com period="today" e responda usando atendimentos_unicos.
Para buscar dados de leads, use lead_lookup. Para ler memória, histórico ou notas, use vault_read.
Para criar, remarcar, cancelar ou consultar reunião de um lead, use scheduling_action.
Quando scheduling_action retornar user_message, você pode enviar para outro número usando evolution_send se o operador pedir.
Para envio ativo pelo WhatsApp, chame evolution_send com recipients e messages. Nunca diga que foi enviado antes da tool retornar sucesso.
Não confunda histórico registrado com mensagem entregue: delivery_status=registered_only não significa envio externo.
Para ligar/desligar o agente, configurar horário automático ou pausar/liberar leads, use system_control.
Para consultar histórico WhatsApp sincronizado, listar grupos ou enviar aviso via WhatsApp CLI a pedido explícito do admin, use wacli. Para grupos, primeiro use action="list_groups" para achar o chat_jid @g.us; depois use action="send_text" com chat_jid.
Se wacli retornar success=false, não diga que vai tentar novamente sem chamar uma nova tool na mesma execução. Informe o erro real e peça confirmação para nova tentativa se necessário.
Para melhorar atendimento, comparar conversa real com vault, ajustar prompts, atualizar skills ou registrar aprendizados no vault, use platform_editor.
Antes de alterar agentes ou skills, leia o alvo com platform_editor. Se o operador pedir diagnóstico, simule com apply=false. Se ele pedir para corrigir/aplicar/salvar, use apply=true com rationale claro.
Nunca use platform_editor para apagar conhecimento sem pedido explícito. Prefira anexar aprendizados em arquivos globais ou melhorar instruções de forma incremental.

${WHATSAPP_FORMATTING_RULES}`

export interface InternalAssistantInput extends AgentInput {
  phone: string
  system_prompt: string
  message: string
  operator_name: string
  current_time: string
  recent_messages?: Array<{ role: string | null; content: string | null }> | undefined
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
          `Pedido atual do operador:\n${input.message}`,
          this.formatRecentContext(input.recent_messages ?? [])
        ].join('\n')
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
      httpRequestToolDefinition,
      systemControlToolDefinition,
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
      arguments: args,
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
    const lead = await this.loadLead(parsed.lead_phone)
    if (!lead) {
      return { success: false, error: 'Lead não encontrado', delivery_status: 'not_sent' }
    }

    const server = await this.loadConnectedCalendarServer()
    if (!server) {
      return { success: false, error: 'Google Calendar não conectado ou inativo', delivery_status: 'not_sent' }
    }

    const result = await this.runSchedulingForLead(parsed.instruction, input, lead, server)
    const deliveryStatus = await this.registerUserMessageIfRequested(parsed.notify_user, lead.phone, result)
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

  private async loadLead(phone: string): Promise<LeadRow | null> {
    const [lead] = await db.select().from(leads).where(eq(leads.phone, phone)).limit(1)
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
    server: McpServerRow
  ) {
    const memory = await loadMemory(lead.phone)
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
    result: Awaited<ReturnType<SchedulingAgent['run']>>
  ): Promise<'not_sent' | 'registered_only'> {
    if (notifyUser && result.user_message) {
      await saveMessage(phone, 'assistant', result.user_message, {
        message_type: 'text',
        intent: 'scheduling',
        tokens_used: result.tokens_used,
        agent_used: 'scheduling-agent',
        processing_ms: result.duration_ms
      })
      return 'registered_only'
    }

    return 'not_sent'
  }
}
