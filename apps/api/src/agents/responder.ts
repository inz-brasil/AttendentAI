// responder.ts — Agente respondedor humanizado para WhatsApp
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool
} from 'openai/resources/chat/completions'
import { MCP_ENABLED } from '../config/constants'
import { env } from '../config/env'
import { MCPRegistry } from '../mcp/registry'
import { ToolExecutor } from '../mcp/tool-executor'
import { executeRegisteredTool, httpRequestToolDefinition } from '../tools'
import { BaseAgent, type AgentInput, type AgentRunMetadata, type AgentToolTrace } from './base-agent'
import type { ClassificationOutput } from './classifier'

const responderSystemPrompt = `Você é um atendente humanizado de WhatsApp. Responda de forma natural e empática.
NUNCA invente informações que não foram fornecidas. Se não souber algo, diga que vai verificar.
Mantenha respostas curtas (máximo 3 parágrafos). Se a resposta for adequada para áudio (curta,
sem links, sem formatação), inclua [AUDIO_OK] ao final.
Quando houver um link de webhook/API e dados confirmados para executar uma ação externa, use a tool http_request
com JSON objetivo antes de responder ao lead.`

export interface ResponderInput extends AgentInput {
  phone: string
  run_id: string
  system_prompt: string
  message: string
  lead_name: string
  classification: ClassificationOutput
  tools_enabled: boolean
  mcp_tools: ChatCompletionTool[]
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
    return [
      {
        role: 'system',
        content: input.system_prompt || this.systemPrompt
      },
      {
        role: 'user',
        content: [
          `Nome do lead: ${input.lead_name || 'não informado'}`,
          `Classificação: ${JSON.stringify(input.classification)}`,
          `Mensagem recebida: ${input.message}`
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
    return MCP_ENABLED ? [...tools, ...input.mcp_tools] : tools
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
    if (MCP_ENABLED && this.mcpRegistry.parseToolCall(toolCall.function.name)) {
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
}
