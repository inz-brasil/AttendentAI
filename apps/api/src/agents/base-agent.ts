// base-agent.ts — Define a classe base para agentes LLM do AttendentAI
import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import pino from 'pino'
import { env } from '../config/env'
import { db } from '../db/client'
import { tokenUsage } from '../db/schema'

export type AgentInput = Record<string, unknown>

export interface AgentRunMetadata {
  tokens_used: number
  duration_ms: number
  model: string
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

      try {
        const response = await openai.chat.completions.create({
          model: this.model,
          messages: this.buildMessages(input),
          max_tokens: this.maxTokens,
          temperature: this.temperature
        })

        const text = response.choices[0]?.message.content ?? ''
        const durationMs = Date.now() - start
        const tokensUsed = response.usage?.total_tokens ?? 0
        const promptTokens = response.usage?.prompt_tokens ?? 0
        const completionTokens = response.usage?.completion_tokens ?? 0

        await this.saveTokenUsage(tokensUsed, promptTokens, completionTokens)
        log.info({
          agent: this.name,
          model: this.model,
          tokens_used: tokensUsed,
          duration_ms: durationMs,
          phone: typeof input.phone === 'string' ? input.phone : undefined
        })

        return this.parseOutput(text, {
          tokens_used: tokensUsed,
          duration_ms: durationMs,
          model: this.model
        })
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown OpenAI error')
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
}
