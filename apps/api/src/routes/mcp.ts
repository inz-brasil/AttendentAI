// mcp.ts — Endpoints administrativos para servidores MCP e vínculos com agentes
import { eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { env } from '../config/env'
import { db } from '../db/client'
import { agentMcpServers, mcpServers } from '../db/schema'
import { MCPClient } from '../mcp/client'

const idParamsSchema = z.object({ id: z.string().min(1) })
const serverBodySchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  transport: z.enum(['http', 'stdio']),
  url: z.string().url().nullable().optional(),
  command: z.string().nullable().optional(),
  auth_type: z.enum(['none', 'oauth2', 'api_key']).default('none'),
  is_active: z.boolean().optional()
})
const agentMcpBodySchema = z.object({
  servers: z.array(z.object({
    mcp_server_id: z.string().min(1),
    enabled: z.boolean().default(true)
  }))
})

function isAuthorized(request: FastifyRequest): boolean {
  return request.headers.authorization === `Bearer ${env.WEBHOOK_SECRET}`
}

/**
 * Registra endpoints administrativos de MCP.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/mcp/servers', async (request, reply) => {
    if (!isAuthorized(request)) return reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    return db.select().from(mcpServers)
  })

  app.post('/api/mcp/servers', async (request, reply) => {
    if (!isAuthorized(request)) return reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    const body = serverBodySchema.parse(request.body)
    const values = { id: crypto.randomUUID(), is_active: true, ...body }
    await db.insert(mcpServers).values(values)
    return reply.code(201).send(values)
  })

  app.put('/api/mcp/servers/:id', async (request, reply) => {
    if (!isAuthorized(request)) return reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    const { id } = idParamsSchema.parse(request.params)
    const body = serverBodySchema.partial().parse(request.body)
    await db.update(mcpServers).set({ ...body, tools_cache: null, tools_cached_at: null }).where(eq(mcpServers.id, id))
    const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, id)).limit(1)
    return server
  })

  app.delete('/api/mcp/servers/:id', async (request, reply) => {
    if (!isAuthorized(request)) return reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    const { id } = idParamsSchema.parse(request.params)
    await db.delete(agentMcpServers).where(eq(agentMcpServers.mcp_server_id, id))
    await db.delete(mcpServers).where(eq(mcpServers.id, id))
    return { success: true }
  })

  app.post('/api/mcp/servers/:id/test', async (request, reply) => {
    if (!isAuthorized(request)) return reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    const { id } = idParamsSchema.parse(request.params)
    const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, id)).limit(1)
    if (!server) return { status: 'not_found', tools: [] }
    const tools = await new MCPClient(server).listTools()
    return { status: tools.length > 0 ? 'ok' : 'error', tools: tools.map((tool) => tool.name) }
  })

  app.put('/api/agents/:id/mcp', async (request, reply) => {
    if (!isAuthorized(request)) return reply.code(401).send({ error: 'Unauthorized', code: 'UNAUTHORIZED' })
    const { id } = idParamsSchema.parse(request.params)
    const body = agentMcpBodySchema.parse(request.body)
    await db.delete(agentMcpServers).where(eq(agentMcpServers.agent_id, id))
    if (body.servers.length > 0) {
      await db.insert(agentMcpServers).values(body.servers.map((server) => ({
        agent_id: id,
        mcp_server_id: server.mcp_server_id,
        enabled: server.enabled
      })))
    }
    return { success: true, count: body.servers.length }
  })
}
