// web-search.tool.ts — Tool de busca web via SearXNG local para o assistente interno
import { z } from 'zod'
import { env } from '../config/env'

export interface WebSearchInput {
  query: string
  language?: string
  categories?: string
  max_results?: number
}

export interface WebSearchResult {
  title: string
  url: string
  content: string
  engine: string | null
}

export interface WebSearchOutput {
  ok: boolean
  results: WebSearchResult[]
  elapsed_ms: number
}

const webSearchInputSchema = z.object({
  query: z.string().min(1).max(500),
  language: z.string().min(2).max(16).default('pt-BR'),
  categories: z.string().min(1).max(80).default('general'),
  max_results: z.number().int().min(1).max(10).default(5)
})

/**
 * Executa busca web no SearXNG local sem logar a query.
 * @param rawInput Entrada do tool call.
 * @returns Resultados resumidos da busca.
 */
export async function executeWebSearchTool(rawInput: unknown): Promise<WebSearchOutput> {
  const input = webSearchInputSchema.parse(rawInput)
  const startedAt = Date.now()
  const url = buildSearchUrl(input)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })

    if (!response.ok) {
      throw new Error(`SearXNG returned HTTP ${response.status}`)
    }

    const body = await response.json()
    const results = parseSearxngResults(body).slice(0, input.max_results)
    return {
      ok: true,
      results,
      elapsed_ms: Date.now() - startedAt
    }
  } finally {
    clearTimeout(timeout)
  }
}

function buildSearchUrl(input: Required<WebSearchInput>): string {
  const baseUrl = env.SEARXNG_URL.replace(/\/$/, '')
  const url = new URL(`${baseUrl}/search`)
  url.searchParams.set('q', input.query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('language', input.language)
  url.searchParams.set('categories', input.categories)
  return url.toString()
}

function parseSearxngResults(body: unknown): WebSearchResult[] {
  const root = toRecord(body)
  const rows = Array.isArray(root?.results) ? root.results : []
  return rows
    .map(parseResult)
    .filter((result): result is WebSearchResult => result !== null)
}

function parseResult(value: unknown): WebSearchResult | null {
  const row = toRecord(value)
  const title = readString(row, 'title')
  const url = readString(row, 'url')
  if (!title || !url) {
    return null
  }

  return {
    title,
    url,
    content: readString(row, 'content') ?? readString(row, 'snippet') ?? '',
    engine: readString(row, 'engine')
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(source: Record<string, unknown> | null, key: string): string | null {
  const value = source?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}
