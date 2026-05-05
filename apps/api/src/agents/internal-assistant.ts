// internal-assistant.ts — Agente interno para operar e consultar a própria plataforma
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool
} from 'openai/resources/chat/completions'
import { z } from 'zod'
import { env } from '../config/env'
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { leads, mcpCredentials, mcpServers } from '../db/schema'
import { loadMemory, saveMessage } from '../memory/persistent'
import {
  executeRegisteredTool,
  httpRequestToolDefinition,
  leadLookupToolDefinition,
  platformStatsToolDefinition
} from '../tools'
import { BaseAgent, type AgentInput, type AgentRunMetadata, type AgentToolTrace } from './base-agent'
import { SchedulingAgent } from './scheduling-agent'

const internalSystemPrompt = `Você é o assistente interno do AttendentAI.
Você atende apenas operadores autorizados e ajuda a consultar leads, métricas, histórico resumido e executar automações via webhook.
Use tools quando precisar buscar dados reais, gerenciar agendamentos ou enviar dados para n8n.
Para criar, remarcar, cancelar ou consultar reunião de um lead, use scheduling_action.
Quando scheduling_action retornar user_message, você pode enviar para outro número usando http_request se o operador pedir ou se houver webhook configurado na instrução.
Para envio ativo, chame http_request com JSON contendo pelo menos phone e message. Nunca diga que foi enviado pelo WhatsApp antes do http_request retornar sucesso.
Não confunda histórico registrado com mensagem entregue: delivery_status=registered_only não significa envio externo.`

export interface InternalAssistantInput extends AgentInput {
  phone: string
  system_prompt: string
  message: string
  operator_name: string
  current_time: string
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

export class InternalAssistantAgent extends BaseAgent<InternalAssistantInput, InternalAssistantOutput> {
  private readonly schedulingAgent = new SchedulingAgent()

  constructor() {
    super({
      name: 'internal-assistant',
      systemPrompt: internalSystemPrompt,
      model: env.MODEL_RESPONDER || 'gpt-4o-mini',
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
    return [
      {
        role: 'system',
        content: input.system_prompt || this.systemPrompt
      },
      {
        role: 'user',
        content: [
          `Operador: ${input.operator_name || input.phone}`,
          `Identificador: ${input.phone}`,
          `Data/hora atual: ${input.current_time}`,
          `Mensagem interna: ${input.message}`
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
    return [platformStatsToolDefinition, leadLookupToolDefinition, schedulingActionToolDefinition, httpRequestToolDefinition]
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
      text: text.trim(),
      ...metadata
    }
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
