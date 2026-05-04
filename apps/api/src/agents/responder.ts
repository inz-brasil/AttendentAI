// responder.ts — Agente respondedor humanizado para WhatsApp
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool
} from 'openai/resources/chat/completions'
import { env } from '../config/env'
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
  memory_summary: string
  vault_context: string
  classification: ClassificationOutput
  tools_enabled: boolean
}

export interface ResponderOutput extends AgentRunMetadata {
  text: string
  audio_requested: boolean
}

export class ResponderAgent extends BaseAgent<ResponderInput, ResponderOutput> {
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
          `Memória/contexto complementar: ${input.memory_summary || 'sem memória relevante'}`,
          `Contexto do vault complementar: ${input.vault_context || 'sem contexto relevante'}`,
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
    if (!input.tools_enabled) {
      return []
    }

    return [httpRequestToolDefinition]
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
    void input
    const startedAt = Date.now()
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
    const parsed = JSON.parse(raw) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }

    throw new Error('Tool arguments must be a JSON object')
  }
}
