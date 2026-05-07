// trace-emitter.ts — Persiste traces transversais e transmite eventos em tempo real por tenant
import { count, lt } from 'drizzle-orm'
import pino from 'pino'
import { env } from '../config/env'
import { db } from '../db/client'
import { traceEvents, type TraceEventStatus } from '../db/schema'

export type TraceEventName =
  | 'webhook_received'
  | 'webhook_rejected'
  | 'transcript_ingested'
  | 'transcript_deduped'
  | 'automation_decision'
  | 'media_processing_started'
  | 'media_processing_done'
  | 'media_processing_failed'
  | 'batch_created'
  | 'batch_processed'
  | 'context_assembled'
  | 'agent_called'
  | 'agent_responded'
  | 'delivery_intended'
  | 'delivery_sent'
  | 'delivery_failed'
  | 'human_takeover_activated'
  | 'human_takeover_expired'
  | 'vault_compacted'

export interface TraceEvent {
  id: string
  tenant_id: string
  batch_id: string | null
  phone: string | null
  event: TraceEventName
  status: TraceEventStatus
  data: Record<string, unknown>
  duration_ms: number | null
  created_at: Date
}

export interface TracePayload {
  tenant_id: string
  batch_id?: string | null
  phone?: string | null
  status?: TraceEventStatus
  data?: Record<string, unknown>
  duration_ms?: number | null
  [key: string]: unknown
}

export interface TraceTimer {
  elapsed(): number
}

type TraceSubscriber = (event: TraceEvent) => void

const log = pino({ name: 'trace-emitter' })
const subscribers = new Map<string, Set<TraceSubscriber>>()
const crockfordBase32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/**
 * Emite traces multi-tenant com persistência em SQLite e broadcast SSE.
 */
export class TraceEmitter {
  private purgeInterval: ReturnType<typeof setInterval> | null = null

  /**
   * Persiste um trace e envia para assinantes SSE do mesmo tenant.
   * @param event Nome tipado do evento.
   * @param payload Dados e metadados do trace.
   * @param durationMs Duração opcional da operação em ms.
   * @returns Nada.
   */
  async emit(event: TraceEventName, payload: TracePayload, durationMs?: number | null): Promise<void> {
    try {
      const trace = this.buildTrace(event, payload, durationMs)

      await db.insert(traceEvents).values({
        id: trace.id,
        tenant_id: trace.tenant_id,
        batch_id: trace.batch_id,
        phone: trace.phone,
        event: trace.event,
        status: trace.status,
        data: trace.data,
        duration_ms: trace.duration_ms,
        created_at: trace.created_at
      })

      this.broadcast(trace)
    } catch (error) {
      // Trace é observabilidade: falha não pode quebrar webhook, agente ou envio.
      log.warn({ err: error, event, tenant_id: payload.tenant_id }, 'failed to emit trace')
    }
  }

  /**
   * Cria um timer simples para medir duração de operações.
   * @returns Timer com método elapsed.
   */
  startTimer(): TraceTimer {
    const startedAt = performance.now()
    return {
      elapsed: () => Math.round(performance.now() - startedAt)
    }
  }

  /**
   * Assina traces em tempo real de um tenant.
   * @param tenantId Tenant a observar.
   * @param subscriber Callback chamado a cada trace.
   * @returns Função de unsubscribe.
   */
  subscribe(tenantId: string, subscriber: TraceSubscriber): () => void {
    const tenantSubscribers = subscribers.get(tenantId) ?? new Set<TraceSubscriber>()
    tenantSubscribers.add(subscriber)
    subscribers.set(tenantId, tenantSubscribers)

    return () => {
      tenantSubscribers.delete(subscriber)
      if (tenantSubscribers.size === 0) {
        subscribers.delete(tenantId)
      }
    }
  }

  /**
   * Remove traces mais antigos que o período configurado.
   * @param retentionDays Dias de retenção.
   * @returns Quantidade de registros removidos.
   */
  async purgeOldTraces(retentionDays = env.TRACE_RETENTION_DAYS): Promise<number> {
    try {
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
      const [countRow] = await db
        .select({ total: count() })
        .from(traceEvents)
        .where(lt(traceEvents.created_at, cutoff))
      await db.delete(traceEvents).where(lt(traceEvents.created_at, cutoff))
      return countRow?.total ?? 0
    } catch (error) {
      log.warn({ err: error, retentionDays }, 'failed to purge old traces')
      return 0
    }
  }

  /**
   * Agenda purge periódico de traces antigos.
   * @param retentionDays Dias de retenção.
   * @returns Nada.
   */
  startAutoPurge(retentionDays = env.TRACE_RETENTION_DAYS): void {
    if (this.purgeInterval) {
      return
    }

    this.purgeInterval = setInterval(() => {
      void this.purgeOldTraces(retentionDays)
    }, 60 * 60 * 1000)
    this.purgeInterval.unref?.()
    void this.purgeOldTraces(retentionDays)
  }

  private buildTrace(event: TraceEventName, payload: TracePayload, durationMs?: number | null): TraceEvent {
    const {
      tenant_id: tenantId,
      batch_id: batchId = null,
      phone = null,
      status = 'ok',
      data,
      duration_ms: payloadDurationMs,
      ...rest
    } = payload

    return {
      id: createUlid(),
      tenant_id: tenantId,
      batch_id: batchId,
      phone,
      event,
      status,
      data: data ?? rest,
      duration_ms: durationMs ?? payloadDurationMs ?? null,
      created_at: new Date()
    }
  }

  private broadcast(trace: TraceEvent): void {
    const tenantSubscribers = subscribers.get(trace.tenant_id)
    if (!tenantSubscribers) {
      return
    }

    for (const subscriber of tenantSubscribers) {
      try {
        subscriber(trace)
      } catch (error) {
        log.warn({ err: error, tenant_id: trace.tenant_id }, 'failed to notify trace subscriber')
      }
    }
  }
}

export const traceEmitter = new TraceEmitter()

function createUlid(): string {
  const now = Date.now()
  let timestamp = ''
  let value = now
  for (let index = 0; index < 10; index += 1) {
    timestamp = crockfordBase32[value % 32] + timestamp
    value = Math.floor(value / 32)
  }

  let randomness = ''
  for (let index = 0; index < 16; index += 1) {
    randomness += crockfordBase32[Math.floor(Math.random() * 32)]
  }

  return timestamp + randomness
}
