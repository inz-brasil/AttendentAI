// http-request.ts — Tool controlada para agentes enviarem requisições HTTP externas
import pino from 'pino'
import { z } from 'zod'

const log = pino({ name: 'attendentai-tools-http' })

const httpToolInputSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
  headers: z.record(z.string()).optional(),
  body: z.unknown().optional(),
  timeout_ms: z.number().int().min(1000).max(30000).default(15000)
})

export interface HttpToolResult {
  ok: boolean
  status: number
  content_type: string
  body: unknown
}

/**
 * Executa uma requisição HTTP segura o suficiente para webhooks de automação.
 * @param rawInput Argumentos vindos do tool call do agente.
 * @returns Status HTTP e corpo resumido da resposta.
 */
export async function executeHttpRequestTool(rawInput: unknown): Promise<HttpToolResult> {
  const input = httpToolInputSchema.parse(rawInput)
  const parsedUrl = new URL(input.url)
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only http and https URLs are allowed')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), input.timeout_ms)
  const startedAt = Date.now()

  try {
    const response = await fetch(input.url, {
      method: input.method,
      headers: {
        ...(input.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(input.headers ?? {})
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: controller.signal
    })

    const contentType = response.headers.get('content-type') ?? ''
    const body = await parseResponseBody(response, contentType)
    log.info({
      tool: 'http_request',
      url: redactUrl(input.url),
      method: input.method,
      status: response.status,
      duration_ms: Date.now() - startedAt
    })

    return {
      ok: response.ok,
      status: response.status,
      content_type: contentType,
      body
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function parseResponseBody(response: Response, contentType: string): Promise<unknown> {
  if (contentType.includes('application/json')) {
    return response.json()
  }

  const text = await response.text()
  return text.length > 4000 ? `${text.slice(0, 4000)}...` : text
}

function redactUrl(url: string): string {
  const parsed = new URL(url)
  if (parsed.search) {
    parsed.search = '?redacted=true'
  }
  return parsed.toString()
}
