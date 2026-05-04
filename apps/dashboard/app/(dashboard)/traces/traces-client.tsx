'use client'
// traces-client.tsx — Cliente de logs com filtro por telefone e JSON expandível
import { useMemo, useState } from 'react'
import { Badge } from '../../../components/ui/badge'
import { useToast } from '../../../components/ui/toast-provider'
import type { AgentTrace } from '../../../lib/api'

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || '/api/backend')

const EVENT_VARIANT: Record<string, 'accent' | 'cyan' | 'success' | 'danger' | 'muted'> = {
  pipeline_start: 'cyan',
  pipeline_end: 'success',
  pipeline_error: 'danger',
  agent_output: 'accent',
  prompt_built: 'cyan',
  tool_call: 'accent',
  memory_loaded: 'muted',
  message_saved: 'success',
  vault_context: 'muted',
  lead_updated: 'success'
}

interface TracesClientProps {
  initialTraces: AgentTrace[]
}

function formatDate(value: string | null): string {
  if (!value) return 'sem data'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(date)
}

function stringifyData(data: Record<string, unknown> | null): string {
  return JSON.stringify(data ?? {}, null, 2)
}

/**
 * Timeline operacional para debugar o fluxo completo de uma mensagem.
 * @param props Eventos iniciais vindos da API.
 * @returns Interface de logs com filtro e detalhes.
 */
export function TracesClient({ initialTraces }: TracesClientProps): JSX.Element {
  const { toast } = useToast()
  const [traces, setTraces] = useState(initialTraces)
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const grouped = useMemo(() => {
    const map = new Map<string, AgentTrace[]>()
    for (const trace of traces) {
      const key = trace.phone ?? 'sem telefone'
      const current = map.get(key) ?? []
      current.push(trace)
      map.set(key, current)
    }
    return Array.from(map.entries())
  }, [traces])

  async function loadTraces(targetPhone?: string) {
    setLoading(true)
    try {
      const path = targetPhone?.trim()
        ? `/api/traces/${encodeURIComponent(targetPhone.trim())}`
        : '/api/traces'
      const res = await fetch(`${API_BASE}${path}`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Falha ao carregar logs')
      const data = await res.json() as { traces: AgentTrace[] }
      setTraces(data.traces ?? [])
      setExpanded(null)
    } catch {
      toast({ title: 'Erro ao carregar logs', variant: 'danger' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.22em] text-accent">Observabilidade</div>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Logs do Pipeline</h2>
          <p className="mt-1.5 text-sm text-muted">
            {traces.length} eventos recentes com agentes, skills, prompt, vault, mensagens e tools.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={phone}
            onChange={event => setPhone(event.target.value)}
            placeholder="Telefone/JID"
            className="focus-ring h-9 w-full rounded-md border border-line bg-panel px-3 font-mono text-xs text-ink outline-none placeholder:text-muted sm:w-72"
          />
          <button
            onClick={() => loadTraces(phone)}
            disabled={loading}
            className="focus-ring h-9 rounded-md bg-accent px-4 text-sm font-semibold text-canvas transition hover:bg-[#e7ef58] disabled:opacity-50"
          >
            {loading ? 'Carregando...' : 'Filtrar'}
          </button>
          <button
            onClick={() => { setPhone(''); void loadTraces() }}
            disabled={loading}
            className="focus-ring h-9 rounded-md border border-line bg-elevated px-4 text-sm text-muted transition hover:text-ink disabled:opacity-50"
          >
            Recentes
          </button>
        </div>
      </div>

      {traces.length === 0 ? (
        <div className="rounded-lg border border-line bg-panel p-10 text-center text-sm text-muted">
          Nenhum log encontrado. Envie uma mensagem pelo webhook para gerar a timeline.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([groupPhone, events]) => (
            <section key={groupPhone} className="rounded-lg border border-line bg-panel shadow-panel">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div>
                  <div className="font-mono text-xs text-accent">{groupPhone}</div>
                  <div className="mt-0.5 text-xs text-muted">{events.length} eventos</div>
                </div>
                <Badge variant="muted">{events[0]?.agent ?? 'pipeline'}</Badge>
              </div>

              <div className="divide-y divide-line">
                {events.map((trace) => {
                  const eventType = trace.event_type ?? 'unknown'
                  const isOpen = expanded === trace.id
                  return (
                    <article key={trace.id} className="px-4 py-3">
                      <button
                        onClick={() => setExpanded(isOpen ? null : trace.id)}
                        className="flex w-full items-start gap-3 text-left"
                      >
                        <span className="mt-1 h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_0_4px_rgba(220,235,74,0.08)]" />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-ink">{trace.title ?? eventType}</span>
                            <Badge variant={EVENT_VARIANT[eventType] ?? 'muted'}>{eventType}</Badge>
                            <span className="font-mono text-[11px] text-muted">{trace.agent ?? 'system'}</span>
                          </span>
                          <span className="mt-1 block font-mono text-[11px] text-muted/70">{formatDate(trace.created_at)}</span>
                        </span>
                        <span className="font-mono text-xs text-muted">{isOpen ? 'fechar' : 'json'}</span>
                      </button>

                      {isOpen && (
                        <pre className="mt-3 max-h-96 overflow-auto rounded-md border border-line bg-canvas p-3 font-mono text-[11px] leading-relaxed text-muted">
                          {stringifyData(trace.data)}
                        </pre>
                      )}
                    </article>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
