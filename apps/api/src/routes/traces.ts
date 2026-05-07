// traces.ts — Expõe rastros de tools, etapas dos agentes e stream SSE para debug
import { and, desc, eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client'
import { agentTraces, traceEvents } from '../db/schema'
import { traceEmitter, type TraceEvent } from '../observability/trace-emitter'

const phoneParamsSchema = z.object({ phone: z.string().min(1) })
const traceStreamQuerySchema = z.object({ tenant_id: z.string().min(1) })
const tracesQuerySchema = z.object({
  batch_id: z.string().min(1).optional(),
  tenant_id: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100)
})

function formatSseEvent(event: TraceEvent): string {
  return `event: trace\ndata: ${JSON.stringify(event)}\n\n`
}

/**
 * Registra endpoints de rastreio dos agentes.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerTraceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/traces/contacts', async () => {
    const traces = await db.select().from(agentTraces).orderBy(desc(agentTraces.created_at)).limit(1000)
    const contacts = new Map<string, {
      phone: string
      lead_name: string | null
      last_message: string | null
      last_response: string | null
      last_at: Date | null
      run_count: number
      event_count: number
    }>()
    const runIdsByPhone = new Map<string, Set<string>>()

    for (const trace of traces) {
      const phone = trace.phone ?? 'sem telefone'
      const existing = contacts.get(phone) ?? {
        phone,
        lead_name: null,
        last_message: null,
        last_response: null,
        last_at: trace.created_at,
        run_count: 0,
        event_count: 0
      }
      const data = trace.data ?? {}
      existing.event_count += 1
      existing.last_at = existing.last_at && trace.created_at && existing.last_at > trace.created_at
        ? existing.last_at
        : trace.created_at
      if (!existing.lead_name && typeof data.name === 'string') existing.lead_name = data.name
      if (!existing.last_message && typeof data.message_preview === 'string') existing.last_message = data.message_preview
      if (!existing.last_response && typeof data.response_preview === 'string') existing.last_response = data.response_preview

      const runIds = runIdsByPhone.get(phone) ?? new Set<string>()
      if (trace.run_id) runIds.add(trace.run_id)
      runIdsByPhone.set(phone, runIds)
      contacts.set(phone, existing)
    }

    return {
      contacts: Array.from(contacts.values())
        .map((contact) => ({
          ...contact,
          run_count: runIdsByPhone.get(contact.phone)?.size ?? 0
        }))
        .sort((a, b) => (b.last_at?.getTime() ?? 0) - (a.last_at?.getTime() ?? 0))
    }
  })

  app.get('/api/traces', async (request) => {
    const query = tracesQuerySchema.parse(request.query)
    if (query.batch_id) {
      const filters = [
        eq(traceEvents.batch_id, query.batch_id),
        ...(query.tenant_id ? [eq(traceEvents.tenant_id, query.tenant_id)] : [])
      ]
      const rows = await db
        .select()
        .from(traceEvents)
        .where(and(...filters))
        .orderBy(desc(traceEvents.created_at))
        .limit(query.limit)

      return {
        batch_id: query.batch_id,
        tenant_id: query.tenant_id ?? null,
        traces: rows.reverse()
      }
    }

    const traces = await db.select().from(agentTraces).orderBy(desc(agentTraces.created_at)).limit(100)
    return { traces }
  })

  app.get('/api/traces/stream', async (request, reply) => {
    const { tenant_id: tenantId } = traceStreamQuerySchema.parse(request.query)

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    reply.raw.write(`event: ready\ndata: ${JSON.stringify({ tenant_id: tenantId })}\n\n`)

    const unsubscribe = traceEmitter.subscribe(tenantId, (event) => {
      reply.raw.write(formatSseEvent(event))
    })
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n')
    }, 25_000)
    heartbeat.unref?.()

    request.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
      reply.raw.end()
    })

    return reply
  })

  app.get('/api/traces/:phone/runs', async (request) => {
    const { phone } = phoneParamsSchema.parse(request.params)
    const traces = await db
      .select()
      .from(agentTraces)
      .where(eq(agentTraces.phone, phone))
      .orderBy(desc(agentTraces.created_at))
      .limit(500)

    const grouped = new Map<string, typeof traces>()
    for (const trace of traces) {
      const runId = trace.run_id ?? trace.id
      const events = grouped.get(runId) ?? []
      events.push(trace)
      grouped.set(runId, events)
    }

    return {
      runs: Array.from(grouped.entries()).map(([runId, events]) => {
        const ordered = events.sort((a, b) => (a.created_at?.getTime() ?? 0) - (b.created_at?.getTime() ?? 0))
        const start = ordered[0]
        const end = ordered[ordered.length - 1]
        const startData = start?.data ?? {}
        const responseEvent = ordered.find((event) => event.event_type === 'agent_output' && event.agent === 'responder') ??
          [...ordered].reverse().find((event) => event.event_type === 'agent_output')
        const responseData = responseEvent?.data ?? {}
        return {
          run_id: runId,
          phone,
          started_at: start?.created_at ?? null,
          ended_at: end?.created_at ?? null,
          message_preview: typeof startData.message_preview === 'string' ? startData.message_preview : null,
          response_preview: typeof responseData.response_preview === 'string' ? responseData.response_preview : null,
          status: ordered.some((event) => event.event_type === 'pipeline_error') ? 'error' : 'success',
          events: ordered
        }
      })
    }
  })

  app.get('/api/traces/:phone', async (request) => {
    const { phone } = phoneParamsSchema.parse(request.params)
    const traces = await db
      .select()
      .from(agentTraces)
      .where(eq(agentTraces.phone, phone))
      .orderBy(desc(agentTraces.created_at))
      .limit(100)
    return { traces }
  })
}
