// trace-recorder.ts — Persiste eventos de execução do pipeline para auditoria no dashboard
import pino from 'pino'
import { db } from '../db/client'
import { agentTraces } from '../db/schema'

const log = pino({ name: 'attendentai-traces' })

export interface TraceEventInput {
  phone: string | null
  runId?: string
  agent: string
  eventType: string
  title: string
  data?: Record<string, unknown>
}

/**
 * Registra uma etapa do pipeline sem bloquear o atendimento.
 * @param input Dados resumidos do evento.
 * @returns Nada.
 */
export async function recordTrace(input: TraceEventInput): Promise<void> {
  try {
    await db.insert(agentTraces).values({
      phone: input.phone,
      run_id: input.runId,
      agent: input.agent,
      event_type: input.eventType,
      title: input.title,
      data: input.data ?? {}
    })
  } catch (error) {
    log.warn({ err: error, phone: input.phone, eventType: input.eventType }, 'failed to record trace')
  }
}

/**
 * Cria uma versão curta de texto para uso seguro nos traces.
 * @param value Texto original.
 * @param maxLength Limite máximo de caracteres.
 * @returns Texto truncado.
 */
export function truncateTraceText(value: string, maxLength = 1200): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}
