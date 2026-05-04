// registry.ts — Resolve servidores MCP habilitados e formata tools para OpenAI
import { and, eq } from 'drizzle-orm'
import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import { db } from '../db/client'
import { agentMcpServers, mcpServers, type MCPTool } from '../db/schema'
import { MCPClient } from './client'

export interface MCPToolWithServer extends MCPTool {
  serverId: string
  serverName: string
}

export interface ParsedMCPToolName {
  serverId: string
  toolName: string
}

export class MCPRegistry {
  /**
   * Retorna todas as tools MCP habilitadas para um agente.
   * @param agentId ID do agente.
   * @returns Tools com metadados do servidor.
   */
  async getToolsForAgent(agentId: string): Promise<MCPToolWithServer[]> {
    const rows = await db
      .select({ server: mcpServers })
      .from(agentMcpServers)
      .innerJoin(mcpServers, eq(agentMcpServers.mcp_server_id, mcpServers.id))
      .where(and(
        eq(agentMcpServers.agent_id, agentId),
        eq(agentMcpServers.enabled, true),
        eq(mcpServers.is_active, true)
      ))

    const tools: MCPToolWithServer[] = []
    for (const row of rows) {
      const serverTools = await new MCPClient(row.server).listTools()
      tools.push(...serverTools.map((tool) => ({
        ...tool,
        serverId: row.server.id,
        serverName: row.server.name
      })))
    }
    return tools
  }

  /**
   * Converte tools MCP para o formato tools[] da OpenAI.
   * @param tools Tools MCP com servidor.
   * @returns Definições OpenAI com nomes únicos.
   */
  formatForOpenAI(tools: MCPToolWithServer[]): ChatCompletionTool[] {
    const used = new Set<string>()
    return tools.flatMap((tool) => {
      const name = `mcp__${tool.serverId}__${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, '_')
      if (used.has(name)) return []
      used.add(name)
      return [{
        type: 'function' as const,
        function: {
          name,
          description: tool.description ?? `Tool MCP ${tool.name} de ${tool.serverName}`,
          parameters: tool.inputSchema
        }
      }]
    })
  }

  /**
   * Extrai serverId e toolName de um nome namespaced.
   * @param toolName Nome no formato mcp__serverId__tool.
   * @returns Partes extraídas ou null.
   */
  parseToolCall(toolName: string): ParsedMCPToolName | null {
    const match = /^mcp__(.+?)__(.+)$/.exec(toolName)
    if (!match) return null
    const [, serverId, parsedToolName] = match
    if (!serverId || !parsedToolName) return null
    return { serverId, toolName: parsedToolName }
  }
}
