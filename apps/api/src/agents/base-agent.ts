// base-agent.ts — Define a classe base para agentes LLM do AttendentAI
import OpenAI from 'openai'
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool
} from 'openai/resources/chat/completions'
import pino from 'pino'
import { env } from '../config/env'
import { db } from '../db/client'
import { agentTraces, tokenUsage } from '../db/schema'

export type AgentInput = Record<string, unknown>

export interface AgentToolTrace {
  tool: string
  arguments: Record<string, unknown>
  result: unknown
  duration_ms: number
}

export interface AgentRunMetadata {
  tokens_used: number
  duration_ms: number
  model: string
  tool_trace: AgentToolTrace[]
}

const log = pino({ name: 'attendentai-agents' })

const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  baseURL: env.OPENAI_BASE_URL
})

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export abstract class BaseAgent<TInput extends AgentInput, TOutput> {
  protected readonly name: string
  protected readonly systemPrompt: string
  protected readonly model: string
  protected readonly maxTokens: number
  protected readonly temperature: number

  constructor(params: {
    name: string
    systemPrompt: string
    model: string
    maxTokens: number
    temperature: number
  }) {
    this.name = params.name
    this.systemPrompt = params.systemPrompt
    this.model = params.model
    this.maxTokens = params.maxTokens
    this.temperature = params.temperature
  }

  /**
   * Executa o agente com retry e registra uso de tokens.
   * @param input Entrada contextual do agente.
   * @returns Saída estruturada do agente.
   */
  async run(input: TInput): Promise<TOutput> {
    const maxAttempts = 3
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const start = Date.now()
      const messages = this.buildMessages(input)
      const tools = this.getTools(input)
      const toolTrace: AgentToolTrace[] = []
      let tokensUsed = 0
      let promptTokens = 0
      let completionTokens = 0

      try {
        for (let toolRound = 0; toolRound < 4; toolRound += 1) {
          const response = await openai.chat.completions.create({
            model: this.model,
            messages,
            max_tokens: this.maxTokens,
            temperature: this.temperature,
            ...(tools.length > 0 ? { tools, tool_choice: 'auto' as const } : {})
          })

          tokensUsed += response.usage?.total_tokens ?? 0
          promptTokens += response.usage?.prompt_tokens ?? 0
          completionTokens += response.usage?.completion_tokens ?? 0

          const message = response.choices[0]?.message
          if (message?.tool_calls && message.tool_calls.length > 0) {
            messages.push({
              role: 'assistant',
              content: message.content ?? null,
              tool_calls: message.tool_calls
            })

            for (const toolCall of message.tool_calls) {
              const trace = await this.executeToolCall(toolCall, input)
              toolTrace.push(trace)
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(trace.result)
              })
            }
            continue
          }

          const text = message?.content ?? ''
          const durationMs = Date.now() - start

          await this.saveTokenUsage(tokensUsed, promptTokens, completionTokens)
          await this.saveToolTrace(input, toolTrace)
          log.info({
            agent: this.name,
            model: this.model,
            tokens_used: tokensUsed,
            duration_ms: durationMs,
            phone: typeof input.phone === 'string' ? input.phone : undefined,
            tools_used: toolTrace.map((trace) => trace.tool)
          })

          return this.parseOutput(text, {
            tokens_used: tokensUsed,
            duration_ms: durationMs,
            model: this.model,
            tool_trace: toolTrace
          })
        }

        throw new Error('Agent exceeded maximum tool rounds')
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown OpenAI error')
        log.info({
          agent: this.name,
          model: this.model,
          tokens_used: tokensUsed,
          duration_ms: Date.now() - start,
          phone: typeof input.phone === 'string' ? input.phone : undefined
        })
        log.warn({ agent: this.name, attempt, err: lastError }, 'agent call failed')

        if (attempt < maxAttempts) {
          await sleep(2 ** attempt * 500)
        }
      }
    }

    throw lastError ?? new Error('Agent failed without error details')
  }

  /**
   * Monta mensagens no formato esperado pela API de chat.
   * @param input Entrada contextual do agente.
   * @returns Lista de mensagens para a OpenAI API.
   */
  protected buildMessages(input: TInput): ChatCompletionMessageParam[] {
    return [
      { role: 'system', content: this.systemPrompt },
      { role: 'user', content: String(input.message ?? '') }
    ]
  }

  /**
   * Lista tools que este agente pode acionar.
   * @param input Entrada contextual do agente.
   * @returns Definições de tools no formato OpenAI.
   */
  protected getTools(input: TInput): ChatCompletionTool[] {
    void input
    return []
  }

  /**
   * Executa uma chamada de tool solicitada pelo modelo.
   * @param toolCall Chamada de tool retornada pela OpenAI.
   * @param input Entrada contextual original.
   * @returns Registro resumido da execução.
   */
  protected async executeToolCall(toolCall: ChatCompletionMessageToolCall, input: TInput): Promise<AgentToolTrace> {
    void input
    throw new Error(`Agent ${this.name} does not support tool ${toolCall.function.name}`)
  }

  /**
   * Converte o texto bruto do LLM para o formato de saída do agente.
   * @param text Texto retornado pelo modelo.
   * @param metadata Métricas da chamada.
   * @returns Saída do agente.
   */
  protected abstract parseOutput(text: string, metadata: AgentRunMetadata): TOutput

  private async saveTokenUsage(totalTokens: number, promptTokens: number, completionTokens: number): Promise<void> {
    await db.insert(tokenUsage).values({
      date: today(),
      model: this.model,
      agent_type: this.name,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      estimated_cost_usd: 0
    })
  }

  private async saveToolTrace(input: TInput, trace: AgentToolTrace[]): Promise<void> {
    if (trace.length === 0) {
      return
    }

    const phone = typeof input.phone === 'string' ? input.phone : null
    const runId = typeof input.run_id === 'string' ? input.run_id : null
    await db.insert(agentTraces).values(
      trace.map((item) => ({
        phone,
        run_id: runId,
        agent: this.name,
        event_type: 'tool_call',
        title: item.tool,
        data: {
          arguments: item.arguments,
          result: item.result,
          duration_ms: item.duration_ms
        }
      }))
    )
  }
}
