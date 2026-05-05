// scheduling-agent.ts — Agente especializado em agendamentos via Google Calendar
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool
} from 'openai/resources/chat/completions'
import { z } from 'zod'
import { env } from '../config/env'
import { executeGoogleCalendarTool, googleCalendarTools } from '../mcp-servers/google-calendar/tools'
import { BaseAgent, type AgentInput, type AgentRunMetadata, type AgentToolTrace } from './base-agent'

const schedulingSystemPrompt = `Você é o agente especialista em agendamentos do AttendentAI.
Sua função é interpretar a conversa, gerenciar agenda e devolver JSON estruturado para o respondedor.
Você sabe lidar com: consultar disponibilidade, sugerir horários, criar reunião, cancelar e orientar remarcação.
Use o horário atual e timezone recebidos. Converta datas relativas como "amanhã" para YYYY-MM-DD.
Nunca confirme reunião sem criar o evento com sucesso no Google Calendar.
Ao criar evento, envie descrição completa com Nome, WhatsApp, serviço de interesse, motivo da reunião e observações.
Se faltar dia, horário, duração ou intenção clara, não chame tool de criação; peça exatamente o dado faltante.
Responda APENAS JSON válido neste formato:
{
  "status": "created" | "needs_info" | "suggested_slots" | "cancelled" | "failed" | "not_scheduling",
  "action": "create" | "check_availability" | "list" | "cancel" | "reschedule" | "none",
  "message_to_responder": "instrução curta em português para o respondedor",
  "user_message": "mensagem pronta para enviar ao lead, ou null",
  "admin_message": "resumo operacional pronto para enviar ao admin, ou null",
  "should_notify_user": false,
  "event_id": null,
  "scheduled_for": null,
  "missing_fields": [],
  "tool_results": []
}`

const schedulingOutputSchema = z.object({
  status: z.enum(['created', 'needs_info', 'suggested_slots', 'cancelled', 'failed', 'not_scheduling']),
  action: z.enum(['create', 'check_availability', 'list', 'cancel', 'reschedule', 'none']),
  message_to_responder: z.string(),
  user_message: z.string().nullable().default(null),
  admin_message: z.string().nullable().default(null),
  should_notify_user: z.boolean().default(false),
  event_id: z.string().nullable().default(null),
  scheduled_for: z.string().nullable().default(null),
  missing_fields: z.array(z.string()).default([]),
  tool_results: z.array(z.unknown()).default([])
})

export interface SchedulingAgentInput extends AgentInput {
  phone: string
  run_id: string
  message: string
  lead_name: string
  lead_email: string | null
  current_time: string
  timezone: string
  history_summary: string
  recent_messages: Array<{
    role: 'user' | 'assistant' | null
    content: string | null
  }>
  mcp_server_id: string
}

export interface SchedulingAgentOutput extends AgentRunMetadata {
  status: z.infer<typeof schedulingOutputSchema>['status']
  action: z.infer<typeof schedulingOutputSchema>['action']
  message_to_responder: string
  user_message: string | null
  admin_message: string | null
  should_notify_user: boolean
  event_id: string | null
  scheduled_for: string | null
  missing_fields: string[]
  tool_results: unknown[]
}

export class SchedulingAgent extends BaseAgent<SchedulingAgentInput, SchedulingAgentOutput> {
  constructor() {
    super({
      name: 'scheduling-agent',
      systemPrompt: schedulingSystemPrompt,
      model: env.MODEL_CLASSIFIER || 'gpt-4o-mini',
      maxTokens: 900,
      temperature: 0.1
    })
  }

  /**
   * Monta contexto mínimo para decisão e execução de agendamento.
   * @param input Contexto do lead e conversa.
   * @returns Mensagens para o LLM.
   */
  protected override buildMessages(input: SchedulingAgentInput): ChatCompletionMessageParam[] {
    const recent = input.recent_messages
      .filter((message) => message.role && message.content?.trim())
      .slice(-10)
      .map((message) => `${message.role === 'assistant' ? 'Assistente' : 'Lead'}: ${message.content ?? ''}`)
      .join('\n')

    return [
      { role: 'system', content: this.systemPrompt },
      {
        role: 'user',
        content: [
          `Horário atual: ${input.current_time}`,
          `Timezone: ${input.timezone}`,
          `Lead: ${input.lead_name || 'não informado'}`,
          `WhatsApp: ${input.phone}`,
          `Email: ${input.lead_email ?? 'não informado'}`,
          `Resumo histórico: ${input.history_summary || 'sem histórico'}`,
          `Conversa recente:\n${recent || 'sem mensagens recentes'}`,
          `Mensagem atual do lead: ${input.message}`
        ].join('\n\n')
      }
    ]
  }

  /**
   * Expõe apenas tools do Google Calendar para este agente especializado.
   * @param input Entrada do agente.
   * @returns Tools OpenAI do Calendar.
   */
  protected override getTools(input: SchedulingAgentInput): ChatCompletionTool[] {
    void input
    return googleCalendarTools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema
      }
    }))
  }

  /**
   * Executa tools de calendário solicitadas pelo agente.
   * @param toolCall Chamada de tool.
   * @param input Entrada com servidor MCP Calendar.
   * @returns Trace da tool executada.
   */
  protected override async executeToolCall(
    toolCall: ChatCompletionMessageToolCall,
    input: SchedulingAgentInput
  ): Promise<AgentToolTrace> {
    const startedAt = Date.now()
    const args = this.parseToolArguments(toolCall.function.arguments)
    const result = await executeGoogleCalendarTool(toolCall.function.name, args, input.mcp_server_id)
    return {
      tool: toolCall.function.name,
      arguments: args,
      result,
      duration_ms: Date.now() - startedAt
    }
  }

  /**
   * Valida JSON final do agente de agendamento.
   * @param text Texto bruto do modelo.
   * @param metadata Métricas de execução.
   * @returns Resultado estruturado para o respondedor.
   */
  protected override parseOutput(text: string, metadata: AgentRunMetadata): SchedulingAgentOutput {
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      raw = null
    }

    const parsed = schedulingOutputSchema.safeParse(raw)
    if (!parsed.success) {
      return {
        status: 'failed',
        action: 'none',
        message_to_responder: 'Não consegui concluir o agendamento agora. Peça confirmação dos dados e diga que vai verificar.',
        user_message: null,
        admin_message: 'Falha ao interpretar o resultado do agente de agendamento.',
        should_notify_user: false,
        event_id: null,
        scheduled_for: null,
        missing_fields: [],
        tool_results: [],
        ...metadata
      }
    }

    return { ...parsed.data, ...metadata }
  }

  private parseToolArguments(raw: string): Record<string, unknown> {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }

    return {}
  }
}
