// internal-assistant.ts — Agente interno para operar e consultar a própria plataforma
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool
} from 'openai/resources/chat/completions'
import { env } from '../config/env'
import {
  executeRegisteredTool,
  httpRequestToolDefinition,
  leadLookupToolDefinition,
  platformStatsToolDefinition
} from '../tools'
import { BaseAgent, type AgentInput, type AgentRunMetadata, type AgentToolTrace } from './base-agent'

const internalSystemPrompt = `Você é o assistente interno do AttendentAI.
Você atende apenas operadores autorizados e ajuda a consultar leads, métricas, histórico resumido e executar automações via webhook.
Use tools quando precisar buscar dados reais ou enviar dados para n8n. Não invente métricas nem informações de leads.`

export interface InternalAssistantInput extends AgentInput {
  phone: string
  system_prompt: string
  message: string
  operator_name: string
  current_time: string
}

export interface InternalAssistantOutput extends AgentRunMetadata {
  text: string
}

export class InternalAssistantAgent extends BaseAgent<InternalAssistantInput, InternalAssistantOutput> {
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
    return [platformStatsToolDefinition, leadLookupToolDefinition, httpRequestToolDefinition]
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
    void input
    const startedAt = Date.now()
    const args = JSON.parse(toolCall.function.arguments || '{}') as Record<string, unknown>
    const result = await executeRegisteredTool(toolCall.function.name, args)
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
}
