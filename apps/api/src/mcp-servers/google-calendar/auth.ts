// auth.ts — Registra fluxo OAuth 2.0 do Google Calendar para o MCP interno
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { env } from '../../config/env'
import { db } from '../../db/client'
import { mcpCredentials, mcpServers } from '../../db/schema'
import { redisConnection } from '../../queue/redis'
import { encryptToken, createGoogleOAuthClient } from './token-manager'

const csrfKeyPrefix = 'oauth:google-calendar:state:'
const calendarScope = 'https://www.googleapis.com/auth/calendar'

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1)
})

function requireGoogleOAuthEnv(): void {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REDIRECT_URI) {
    throw new Error('Google Calendar OAuth env vars não configuradas')
  }
}

function googleCalendarBaseUrl(): string {
  if (env.GOOGLE_REDIRECT_URI) {
    const redirectUrl = new URL(env.GOOGLE_REDIRECT_URI)
    return `${redirectUrl.origin}/mcp/google-calendar`
  }

  return `http://localhost:${env.API_PORT}/mcp/google-calendar`
}

/**
 * Garante que o servidor MCP Google Calendar existe no banco.
 * @returns Registro do servidor MCP.
 */
export async function ensureGoogleCalendarMcpServer(): Promise<typeof mcpServers.$inferSelect> {
  const [current] = await db.select().from(mcpServers).where(eq(mcpServers.slug, 'google-calendar')).limit(1)
  const values = {
    name: 'Google Calendar',
    slug: 'google-calendar',
    transport: 'http' as const,
    url: googleCalendarBaseUrl(),
    command: null,
    auth_type: 'oauth2' as const,
    is_active: true
  }

  if (current) {
    await db.update(mcpServers).set(values).where(eq(mcpServers.id, current.id))
    const [updated] = await db.select().from(mcpServers).where(eq(mcpServers.id, current.id)).limit(1)
    if (!updated) {
      throw new Error('Falha ao atualizar servidor MCP Google Calendar')
    }
    return updated
  }

  const created = { id: randomUUID(), ...values }
  await db.insert(mcpServers).values(created)
  const [server] = await db.select().from(mcpServers).where(eq(mcpServers.id, created.id)).limit(1)
  if (!server) {
    throw new Error('Falha ao criar servidor MCP Google Calendar')
  }
  return server
}

async function saveGoogleCredential(mcpServerId: string, tokens: {
  access_token?: string | null
  refresh_token?: string | null
  expiry_date?: number | null
}): Promise<void> {
  if (!tokens.access_token) {
    throw new Error('Google não retornou access_token')
  }

  const [current] = await db
    .select()
    .from(mcpCredentials)
    .where(eq(mcpCredentials.mcp_server_id, mcpServerId))
    .limit(1)

  const refreshToken = tokens.refresh_token
    ? encryptToken(tokens.refresh_token)
    : current?.refresh_token_encrypted

  if (!refreshToken) {
    throw new Error('Google não retornou refresh_token. Revogue o acesso e autorize novamente.')
  }

  const values = {
    mcp_server_id: mcpServerId,
    scope: 'system',
    access_token_encrypted: encryptToken(tokens.access_token),
    refresh_token_encrypted: refreshToken,
    token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
    granted_at: new Date(),
    updated_at: new Date()
  }

  if (current) {
    await db.update(mcpCredentials).set(values).where(eq(mcpCredentials.id, current.id))
    return
  }

  await db.insert(mcpCredentials).values({ id: randomUUID(), ...values })
}

/**
 * Registra rotas de autorização Google Calendar.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerGoogleCalendarAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/mcp/google-calendar/auth/start', async (_request, reply) => {
    requireGoogleOAuthEnv()
    const csrfToken = randomUUID()
    await redisConnection.set(`${csrfKeyPrefix}${csrfToken}`, '1', 'EX', 600)

    const client = createGoogleOAuthClient()
    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [calendarScope],
      state: csrfToken
    })

    return reply.redirect(authUrl)
  })

  app.get('/api/mcp/google-calendar/auth/callback', async (request, reply) => {
    requireGoogleOAuthEnv()
    const query = callbackQuerySchema.parse(request.query)
    const csrfKey = `${csrfKeyPrefix}${query.state}`
    const csrfExists = await redisConnection.get(csrfKey)

    if (!csrfExists) {
      return reply.code(400).send({ error: 'Invalid OAuth state', code: 'INVALID_OAUTH_STATE' })
    }

    await redisConnection.del(csrfKey)
    const client = createGoogleOAuthClient()
    const { tokens } = await client.getToken(query.code)
    const mcpServer = await ensureGoogleCalendarMcpServer()
    await saveGoogleCredential(mcpServer.id, tokens)

    return reply.redirect('/dashboard/settings?tab=integrations&status=connected')
  })
}
