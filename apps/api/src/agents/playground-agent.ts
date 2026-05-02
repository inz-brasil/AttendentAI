// playground-agent.ts — Agente de teste do pipeline: classifica e responde sem persistir dados
import OpenAI from 'openai'
import type { ChatCompletion, ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { env } from '../config/env'

export interface PlaygroundClassification {
  intent: string
  sentiment: string
  urgency: string
}

export interface PlaygroundAgentInput {
  message: string
  phone: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  systemPrompt: string
  model: string
  temperature: number
  maxTokens: number
  /** API key do banco tem prioridade sobre env para permitir troca sem restart */
  apiKeyOverride: string | undefined
  baseUrlOverride: string | undefined
}

export interface PlaygroundAgentOutput {
  response: string
  classification: PlaygroundClassification
  agentsCalled: string[]
  tokensByAgent: Record<string, number>
  totalTokens: number
  totalMs: number
}

/** Delay com backoff exponencial para retry */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Chama a OpenAI com retry 3x e backoff exponencial */
async function callWithRetry(
  client: OpenAI,
  params: Parameters<OpenAI['chat']['completions']['create']>[0] & { stream?: false }
): Promise<ChatCompletion> {
  const maxAttempts = 3
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await client.chat.completions.create({ ...params, stream: false })
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('OpenAI error')
      if (attempt < maxAttempts) await sleep(2 ** attempt * 500)
    }
  }

  throw lastError ?? new Error('PlaygroundAgent: max retries exceeded')
}

/**
 * Executa o pipeline de playground: classifica + responde via LLM.
 * Usa key do banco como override para não exigir restart da API.
 * @param input Parâmetros do teste incluindo histórico e configurações do agente.
 * @param log Logger Pino (passado pela rota para manter contexto do request).
 * @returns Resultado com resposta, debug e tokens consumidos.
 */
export async function runPlaygroundAgent(
  input: PlaygroundAgentInput,
  log: { info: (obj: Record<string, unknown>, msg: string) => void; warn: (obj: Record<string, unknown>, msg: string) => void }
): Promise<PlaygroundAgentOutput> {
  const start = Date.now()
  const apiKey = input.apiKeyOverride || env.OPENAI_API_KEY
  const baseURL = input.baseUrlOverride || env.OPENAI_BASE_URL

  // Cliente com key dinâmica (pode vir do banco sem restart da API)
  const client = new OpenAI({ apiKey, baseURL })

  const agentsCalled: string[] = []
  const tokensByAgent: Record<string, number> = {}
  let totalTokens = 0

  // ---- 1. Classificação ----
  agentsCalled.push('classifier')
  const classifyStart = Date.now()
  let classification: PlaygroundClassification = { intent: 'unknown', sentiment: 'neutro', urgency: 'baixa' }

  const classifyMessages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: 'Classifique a mensagem em JSON com os campos: intent (string), sentiment (positivo|negativo|neutro), urgency (alta|média|baixa). Responda APENAS com JSON válido.'
    },
    { role: 'user', content: input.message }
  ]

  const classifyRes = await callWithRetry(client, {
    model: 'gpt-4o-mini',
    temperature: 0.1,
    max_tokens: 150,
    messages: classifyMessages
  })

  const classifyTokens = classifyRes.usage?.total_tokens ?? 0
  tokensByAgent.classifier = classifyTokens
  totalTokens += classifyTokens

  log.info({
    agent: 'classifier',
    model: 'gpt-4o-mini',
    tokens_used: classifyTokens,
    duration_ms: Date.now() - classifyStart,
    phone: input.phone
  }, 'playground classifier call')

  try {
    classification = JSON.parse(classifyRes.choices[0]?.message?.content ?? '{}') as PlaygroundClassification
  } catch {
    // JSON inválido — mantém default acima
  }

  // ---- 2. Resposta do agente selecionado ----
  agentsCalled.push('responder')
  const respondStart = Date.now()

  const respondMessages: ChatCompletionMessageParam[] = [
    { role: 'system', content: input.systemPrompt },
    ...input.history.map(h => ({ role: h.role, content: h.content }) as ChatCompletionMessageParam),
    { role: 'user', content: input.message }
  ]

  const respondRes = await callWithRetry(client, {
    model: input.model,
    temperature: input.temperature,
    max_tokens: input.maxTokens,
    messages: respondMessages
  })

  const respondTokens = respondRes.usage?.total_tokens ?? 0
  tokensByAgent.responder = respondTokens
  totalTokens += respondTokens

  log.info({
    agent: 'responder',
    model: input.model,
    tokens_used: respondTokens,
    duration_ms: Date.now() - respondStart,
    phone: input.phone
  }, 'playground responder call')

  const response = respondRes.choices[0]?.message?.content ?? 'Sem resposta do modelo.'

  return {
    response,
    classification,
    agentsCalled,
    tokensByAgent,
    totalTokens,
    totalMs: Date.now() - start
  }
}
