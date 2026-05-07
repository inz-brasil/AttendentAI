// main.ts — Inicializa o servidor Fastify da API AttendentAI
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import websocket from '@fastify/websocket'
import Fastify from 'fastify'
import { ZodError } from 'zod'
import { API_RATE_LIMIT_PER_MINUTE } from './config/constants'
import { env } from './config/env'
import { closeDb } from './db/client'
import { registerAgentRoutes } from './routes/agents'
import { registerAgentSkillRoutes } from './routes/agent-skills'
import { registerConversationRoutes } from './routes/conversations'
import { registerAutomationRoutes } from './routes/automation'
import { registerHealthRoutes } from './routes/health'
import { registerLeadRoutes } from './routes/leads'
import { registerMcpRoutes } from './routes/mcp'
import { registerPlaygroundRoutes } from './routes/playground'
import { registerSettingRoutes } from './routes/settings'
import { registerSkillRoutes } from './routes/skills'
import { registerTraceRoutes } from './routes/traces'
import { registerVaultRoutes } from './routes/vault'
import { registerWacliRoutes } from './routes/wacli'
import { registerWebhookRoutes } from './routes/webhook'
import { registerGoogleCalendarMcpServer } from './mcp-servers/google-calendar'
import { registerMockMcpServer } from './mcp-servers/mock'
import { traceEmitter } from './observability/trace-emitter'
import { closeInboundWorker, startInboundWorker } from './queue/inbound-worker'
import { vaultCompactor } from './vault/vault-compactor'
import { registerWebSocketServer } from './websocket/server'

const requestStartTimes = new WeakMap<object, number>()

function getLlmStatus(error: Error): number | null {
  if ('status' in error && typeof error.status === 'number') {
    return error.status
  }

  return null
}

function getLlmCode(status: number): string {
  if (status === 401 || status === 403) {
    return 'LLM_AUTH_ERROR'
  }

  if (status === 429) {
    return 'LLM_RATE_LIMIT'
  }

  return 'LLM_ERROR'
}

/**
 * Cria e configura a instância Fastify.
 * @returns Servidor Fastify pronto para iniciar.
 */
export async function buildServer(): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({ logger: true })

  await app.register(cors, { origin: true })
  await app.register(rateLimit, {
    max: API_RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) => ({
      error: 'Rate limit exceeded',
      code: 'RATE_LIMIT_EXCEEDED',
      details: {
        limit: context.max,
        reset_seconds: Math.ceil(context.ttl / 1000)
      }
    })
  })
  await app.register(websocket)

  app.addHook('onRequest', async (request) => {
    requestStartTimes.set(request, performance.now())
  })

  app.addHook('onResponse', async (request, reply) => {
    const startedAt = requestStartTimes.get(request)
    const responseTime = startedAt ? Math.round(performance.now() - startedAt) : undefined
    request.log.info(
      { method: request.method, url: request.url, statusCode: reply.statusCode, responseTime },
      'request completed'
    )
  })

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      request.log.warn({ issues: error.issues }, 'validation error')
      return reply.code(400).send({
        error: 'Invalid request',
        code: 'VALIDATION_ERROR',
        details: error.issues
      })
    }

    request.log.error({ err: error }, 'request failed')
    const llmStatus = getLlmStatus(error)
    if (llmStatus !== null) {
      return reply.code(llmStatus === 429 ? 429 : 502).send({
        error: 'LLM provider error',
        code: getLlmCode(llmStatus),
        ...(process.env.NODE_ENV === 'production'
          ? {}
          : { details: { message: error.message, stack: error.stack } })
      })
    }

    return reply.code(500).send({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      ...(process.env.NODE_ENV === 'production'
        ? {}
        : { details: { message: error.message, stack: error.stack } })
    })
  })

  await registerHealthRoutes(app)
  await registerWebSocketServer(app)
  await registerWebhookRoutes(app)
  await registerAutomationRoutes(app)
  await registerLeadRoutes(app)
  await registerConversationRoutes(app)
  await registerAgentRoutes(app)
  await registerAgentSkillRoutes(app)
  await registerSkillRoutes(app)
  await registerSettingRoutes(app)
  await registerVaultRoutes(app)
  await registerTraceRoutes(app)
  await registerWacliRoutes(app)
  await registerPlaygroundRoutes(app)
  await registerMcpRoutes(app)
  await registerMockMcpServer(app)
  await registerGoogleCalendarMcpServer(app)
  traceEmitter.startAutoPurge()
  vaultCompactor.startDailyCron()
  startInboundWorker()

  return app
}

/**
 * Inicia a API HTTP na porta configurada.
 * @returns Nada.
 */
async function start(): Promise<void> {
  const app = await buildServer()

  try {
    await app.listen({ port: env.API_PORT, host: '0.0.0.0' })
  } catch (error) {
    app.log.error({ err: error }, 'server startup failed')
    closeDb()
    process.exit(1)
  }
}

async function shutdown(): Promise<void> {
  await closeInboundWorker()
  closeDb()
}

process.on('SIGINT', async () => {
  await shutdown()
  process.exit(0)
})

process.on('SIGTERM', async () => {
  await shutdown()
  process.exit(0)
})

await start()
