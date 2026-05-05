// tool-executor.ts — Executa tool calls MCP em paralelo e devolve tool results
import type { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions'
import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { mcpServers } from '../db/schema'
import { MCPClient } from './client'
import { MCPRegistry } from './registry'

export interface OpenAIToolResult {
  role: 'tool'
  tool_call_id: string
  content: string
}

function parseArguments(raw: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(raw)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>
  }

  return {}
}

export class ToolExecutor {
  private readonly registry = new MCPRegistry()

  /**
   * Executa chamadas MCP em paralelo e retorna mensagens de resultado para OpenAI.
   * @param toolCalls Chamadas retornadas pelo modelo.
   * @returns Mensagens role=tool.
   */
  async execute(toolCalls: ChatCompletionMessageToolCall[]): Promise<OpenAIToolResult[]> {
    return Promise.all(toolCalls.map((toolCall) => this.executeOne(toolCall)))
  }

  private async executeOne(toolCall: ChatCompletionMessageToolCall): Promise<OpenAIToolResult> {
    const parsed = this.registry.parseToolCall(toolCall.function.name)
    if (!parsed) {
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: false, error: 'Invalid MCP tool namespace' })
      }
    }

    const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, parsed.serverId)).limit(1)
    if (!server) {
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: false, error: 'MCP server not found' })
      }
    }

    const args = parseArguments(toolCall.function.arguments)
    const result = await new MCPClient(server).callTool(parsed.toolName, args)
    return {
      role: 'tool',
      tool_call_id: toolCall.id,
      content: JSON.stringify(result)
    }
  }
}
