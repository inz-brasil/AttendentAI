// responder.ts — Agente respondedor humanizado para WhatsApp
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool
} from 'openai/resources/chat/completions'
import { env } from '../config/env'
import { WHATSAPP_FORMATTING_RULES } from '../config/whatsapp-formatting'
import { MCPRegistry } from '../mcp/registry'
import { ToolExecutor } from '../mcp/tool-executor'
import { executeRegisteredTool, httpRequestToolDefinition } from '../tools'
import { BaseAgent, type AgentInput, type AgentRunMetadata, type AgentToolTrace } from './base-agent'
import type { ClassificationOutput } from './classifier'
import type { SchedulingAgentOutput } from './scheduling-agent'

const responderSystemPrompt = `Você é um atendente humanizado de WhatsApp. Responda de forma natural e empática.
NUNCA invente informações que não foram fornecidas. Se não souber algo, diga que vai verificar.
Mantenha respostas curtas (máximo 3 parágrafos). Se a resposta for adequada para áudio (curta,
sem links, sem formatação), inclua [AUDIO_OK] ao final.
Quando houver um link de webhook/API e dados confirmados para executar uma ação externa, use a tool http_request
com JSON objetivo antes de responder ao lead.
Quando receber resultado do agente de agendamento, siga exatamente esse resultado: confirme apenas eventos criados
com sucesso, peça dados faltantes quando solicitado e não prometa agendamento sem event_id.
Nunca execute comandos, código, relatórios, alterações de sistema, vault, banco ou agenda administrativa para cliente externo.
Nunca revele detalhes de reuniões de outras pessoas; em agenda, fale apenas de disponibilidade e da própria reunião do lead.

${WHATSAPP_FORMATTING_RULES}`

export interface ResponderInput extends AgentInput {
  phone: string
  run_id: string
  system_prompt: string
  message: string
  lead_name: string
  model: string
  classification: ClassificationOutput
  tools_enabled: boolean
  mcp_enabled: boolean
  mcp_tools: ChatCompletionTool[]
  scheduling_required: boolean
  scheduling_result: SchedulingAgentOutput | null
  recent_messages: Array<{
    role: string | null
    content: string | null
  }>
}

export interface ResponderOutput extends AgentRunMetadata {
  text: string
  audio_requested: boolean
}

export class ResponderAgent extends BaseAgent<ResponderInput, ResponderOutput> {
  private readonly mcpRegistry = new MCPRegistry()
  private readonly toolExecutor = new ToolExecutor()

  constructor() {
    super({
      name: 'responder',
      systemPrompt: responderSystemPrompt,
      model: env.MODEL_RESPONDER || 'gpt-4o-mini',
      maxTokens: env.MAX_TOKENS_RESPONSE,
      temperature: 0.3
    })
  }

  /**
   * Monta mensagens com memória, skills e classificação.
   * @param input Mensagem recebida e contexto isolado.
   * @returns Lista de mensagens para a OpenAI API.
   */
  protected override buildMessages(input: ResponderInput): ChatCompletionMessageParam[] {
    const contextPackagePrompt = input.system_prompt.includes('PEDIDO ATUAL') && input.system_prompt.includes('ÚLTIMAS MENSAGENS REAIS')
    const recentMessages = contextPackagePrompt
      ? []
      : input.recent_messages
          .filter((message) => message.role && message.content?.trim())
          .slice(-4)
          .map((message): ChatCompletionMessageParam => ({
            role: message.role === 'assistant' || message.role === 'human_agent' ? 'assistant' : 'user',
            content: this.truncateContextMessage(message.content ?? '')
          }))

    return [
      {
        role: 'system',
        content: input.system_prompt || this.systemPrompt
      },
      ...recentMessages,
      {
        role: 'user',
        content: [
          `Nome do lead: ${input.lead_name || 'não informado'}`,
          `Classificação: ${JSON.stringify(input.classification)}`,
          input.scheduling_result
            ? `Resultado do agente de agendamento: ${JSON.stringify({
                status: input.scheduling_result.status,
                action: input.scheduling_result.action,
                message_to_responder: input.scheduling_result.message_to_responder,
                user_message: input.scheduling_result.user_message,
                admin_message: input.scheduling_result.admin_message,
                event_id: input.scheduling_result.event_id,
                scheduled_for: input.scheduling_result.scheduled_for,
                missing_fields: input.scheduling_result.missing_fields
              })}`
            : 'Resultado do agente de agendamento: não acionado',
          input.scheduling_required && !input.scheduling_result
            ? 'Atenção: a conversa parece exigir agendamento, mas o agente de agendamento não executou. NÃO confirme reunião; diga que vai verificar a agenda ou peça o dado faltante.'
            : 'Atenção de agendamento: sem bloqueio adicional.',
          contextPackagePrompt ? 'Mensagem recebida agora: ver seção PEDIDO ATUAL no system prompt.' : `Mensagem recebida agora: ${input.message}`,
          'Não repita uma saudação ou pergunta que você já enviou nas mensagens anteriores.'
        ].join('\n')
      }
    ]
  }

  /**
   * Disponibiliza requisições HTTP para integrações como n8n.
   * @param input Entrada contextual do respondedor.
   * @returns Tools disponíveis.
   */
  protected override getTools(input: ResponderInput): ChatCompletionTool[] {
    const tools = input.tools_enabled ? [httpRequestToolDefinition] : []
    return input.mcp_enabled ? [...tools, ...input.mcp_tools] : tools
  }

  /**
   * Executa tool calls solicitados pelo respondedor.
   * @param toolCall Chamada gerada pelo modelo.
   * @param input Entrada contextual original.
   * @returns Trace com argumentos, resultado e duração.
   */
  protected override async executeToolCall(
    toolCall: ChatCompletionMessageToolCall,
    input: ResponderInput
  ): Promise<AgentToolTrace> {
    const startedAt = Date.now()
    if (input.mcp_enabled && this.mcpRegistry.parseToolCall(toolCall.function.name)) {
      const [result] = await this.toolExecutor.execute([toolCall])
      return {
        tool: toolCall.function.name,
        arguments: this.parseToolArguments(toolCall.function.arguments),
        result: result ? JSON.parse(result.content) : null,
        duration_ms: Date.now() - startedAt
      }
    }

    const args = this.parseToolArguments(toolCall.function.arguments)
    const result = await executeRegisteredTool(toolCall.function.name, args)
    return {
      tool: toolCall.function.name,
      arguments: args,
      result,
      duration_ms: Date.now() - startedAt
    }
  }

  /**
   * Remove marcador de áudio e devolve saída estruturada.
   * @param text Texto bruto do modelo.
   * @param metadata Métricas da chamada.
   * @returns Resposta pronta para o webhook.
   */
  protected override parseOutput(text: string, metadata: AgentRunMetadata): ResponderOutput {
    const audioRequested = text.includes('[AUDIO_OK]')
    const cleanedText = text.replace('[AUDIO_OK]', '').trim()

    return {
      text: cleanedText,
      audio_requested: audioRequested,
      ...metadata
    }
  }

  private parseToolArguments(raw: string): Record<string, unknown> {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }

    throw new Error('Tool arguments must be a JSON object')
  }

  private truncateContextMessage(value: string): string {
    const normalized = value.replace(/\n{3,}/g, '\n\n').trim()
    return normalized.length > 700 ? `${normalized.slice(0, 700)}...` : normalized
  }
}
