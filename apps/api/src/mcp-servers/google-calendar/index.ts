// index.ts — Expõe Google Calendar como servidor MCP HTTP interno da API
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ensureGoogleCalendarMcpServer, registerGoogleCalendarAuthRoutes } from './auth'
import { executeGoogleCalendarTool, googleCalendarTools } from './tools'

const toolArgsSchema = z.object({
  arguments: z.record(z.unknown()).default({})
})

const toolParamsSchema = z.object({
  name: z.string().min(1)
})

/**
 * Registra o servidor MCP Google Calendar e suas rotas OAuth.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerGoogleCalendarMcpServer(app: FastifyInstance): Promise<void> {
  await ensureGoogleCalendarMcpServer()
  await registerGoogleCalendarAuthRoutes(app)

  app.get('/mcp/google-calendar/tools', async () => ({ tools: googleCalendarTools }))

  app.post('/mcp/google-calendar/tools/:name', async (request) => {
    const params = toolParamsSchema.parse(request.params)
    const body = toolArgsSchema.parse(request.body)
    const server = await ensureGoogleCalendarMcpServer()
    return executeGoogleCalendarTool(params.name, body.arguments, server.id)
  })
}
