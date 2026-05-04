// index.ts — Servidor MCP mock interno para validar engine de tools
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

const toolArgsSchema = z.object({
  arguments: z.record(z.unknown()).default({})
})

const mockTools = [
  {
    name: 'echo',
    description: 'Retorna os argumentos recebidos para teste.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Texto para ecoar.' }
      }
    }
  },
  {
    name: 'timestamp',
    description: 'Retorna o timestamp atual do servidor.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
]

/**
 * Registra servidor MCP mock em /mcp-mock.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerMockMcpServer(app: FastifyInstance): Promise<void> {
  app.get('/mcp-mock/tools', async () => ({ tools: mockTools }))

  app.post('/mcp-mock/tools/echo', async (request) => {
    const body = toolArgsSchema.parse(request.body)
    return { echoed: body.arguments }
  })

  app.post('/mcp-mock/tools/timestamp', async () => ({
    timestamp: new Date().toISOString()
  }))
}
