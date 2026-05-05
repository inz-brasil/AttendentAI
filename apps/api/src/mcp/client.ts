// client.ts — Cliente HTTP para servidores MCP registrados no banco
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { mcpServers, type MCPTool } from '../db/schema'

export type McpServer = typeof mcpServers.$inferSelect

export interface MCPToolResult {
  success: boolean
  result?: unknown
  error?: string
}

const TOOLS_CACHE_TTL_MS = 5 * 60 * 1000

function isFresh(cachedAt: Date | null): boolean {
  return cachedAt !== null && Date.now() - cachedAt.getTime() < TOOLS_CACHE_TTL_MS
}

function normalizeTools(value: unknown): MCPTool[] {
  const rawTools = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { tools?: unknown }).tools)
      ? (value as { tools: unknown[] }).tools
      : []

  return rawTools
    .filter((tool): tool is Record<string, unknown> => Boolean(tool) && typeof tool === 'object')
    .filter((tool) => typeof tool.name === 'string')
    .map((tool) => ({
      name: String(tool.name),
      ...(typeof tool.description === 'string' ? { description: tool.description } : {}),
      inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object'
        ? tool.inputSchema as Record<string, unknown>
        : tool.parameters && typeof tool.parameters === 'object'
          ? tool.parameters as Record<string, unknown>
          : { type: 'object', properties: {} }
    }))
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    return response.json()
  } finally {
    clearTimeout(timeout)
  }
}

export class MCPClient {
  private readonly server: McpServer

  constructor(server: McpServer) {
    this.server = server
  }

  /**
   * Lista tools disponíveis no servidor MCP usando cache de 5 minutos.
   * @returns Lista de tools ou lista vazia se o servidor falhar.
   */
  async listTools(): Promise<MCPTool[]> {
    if (this.server.tools_cache && isFresh(this.server.tools_cached_at)) {
      return this.server.tools_cache
    }

    if (this.server.transport !== 'http' || !this.server.url) {
      return []
    }

    try {
      const payload = await fetchJson(`${this.server.url.replace(/\/$/, '')}/tools`, { method: 'GET' }, 5000)
      const tools = normalizeTools(payload)
      await db
        .update(mcpServers)
        .set({ tools_cache: tools, tools_cached_at: new Date() })
        .where(eq(mcpServers.id, this.server.id))
      return tools
    } catch {
      return []
    }
  }

  /**
   * Executa uma tool específica do servidor MCP.
   * @param name Nome da tool.
   * @param args Argumentos estruturados.
   * @returns Resultado estruturado sem lançar erro para o fluxo principal.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    if (this.server.transport !== 'http' || !this.server.url) {
      return { success: false, error: 'Unsupported MCP transport' }
    }

    try {
      const payload = await fetchJson(
        `${this.server.url.replace(/\/$/, '')}/tools/${encodeURIComponent(name)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ arguments: args })
        },
        10000
      )
      return { success: true, result: payload }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'MCP tool failed' }
    }
  }
}
