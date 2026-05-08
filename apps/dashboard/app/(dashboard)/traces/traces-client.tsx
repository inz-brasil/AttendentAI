'use client'
// traces-client.tsx — Logs por contato com runs completas e etapas do pipeline
import { useMemo, useState } from 'react'
import { Badge } from '../../../components/ui/badge'
import { useToast } from '../../../components/ui/toast-provider'
import type { AgentTrace, TraceContact, TraceRun } from '../../../lib/api'

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || '/api/backend')

const EVENT_LABEL: Record<string, string> = {
  pipeline_start: 'Webhook recebido',
  memory_loaded: 'Memória carregada',
  agent_output: 'Agente executado',
  lead_updated: 'Lead atualizado',
  vault_context: 'Vault carregado',
  prompt_built: 'Prompt montado',
  message_saved: 'Mensagem salva',
  response_guard: 'Revisão determinística',
  tool_call: 'Tool chamada',
  pipeline_end: 'Resposta enviada',
  pipeline_error: 'Erro'
}

const EVENT_VARIANT: Record<string, 'accent' | 'cyan' | 'success' | 'danger' | 'muted'> = {
  pipeline_start: 'cyan',
  pipeline_end: 'success',
  pipeline_error: 'danger',
  agent_output: 'accent',
  prompt_built: 'cyan',
  response_guard: 'accent',
  tool_call: 'accent',
  memory_loaded: 'muted',
  message_saved: 'success',
  vault_context: 'muted',
  lead_updated: 'success'
}

interface TracesClientProps {
  initialContacts: TraceContact[]
  tenantId?: string
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

function getPrompt(data: Record<string, unknown> | null): string {
  const sections: string[] = []
  if (typeof data?.system_prompt_final === 'string') {
    sections.push(`SYSTEM PROMPT\n\n${data.system_prompt_final}`)
  }
  if (typeof data?.user_prompt_final === 'string') {
    sections.push(`USER PROMPT\n\n${data.user_prompt_final}`)
  }
  if (Array.isArray(data?.tools_available)) {
    sections.push(`TOOLS DISPONÍVEIS\n\n${JSON.stringify(data.tools_available, null, 2)}`)
  }
  return sections.join('\n\n────────────────────────\n\n')
}

/**
 * Console de runs por atendimento.
 * @param props Contatos iniciais ordenados por atividade recente.
 * @returns Lista de contatos e timeline de runs por mensagem.
 */
export function TracesClient({ initialContacts, tenantId = 'default' }: TracesClientProps): JSX.Element {
  const { toast } = useToast()
  const [contacts, setContacts] = useState(initialContacts)
  const [selectedPhone, setSelectedPhone] = useState(initialContacts[0]?.phone ?? '')
  const [runs, setRuns] = useState<TraceRun[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null)
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null)

  const selectedContact = useMemo(
    () => contacts.find(contact => contact.phone === selectedPhone) ?? null,
    [contacts, selectedPhone]
  )

  async function refreshContacts() {
    try {
      const res = await fetch(`${API_BASE}/api/traces/contacts`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Falha ao carregar contatos')
      const data = await res.json() as { contacts: TraceContact[] }
      setContacts(data.contacts ?? [])
    } catch {
      toast({ title: 'Erro ao atualizar atendimentos', variant: 'danger' })
    }
  }

  async function openContact(phone: string) {
    setSelectedPhone(phone)
    setLoading(true)
    setExpandedEvent(null)
    setExpandedPrompt(null)
    try {
      const res = await fetch(`${API_BASE}/api/traces/${encodeURIComponent(phone)}/runs`, { cache: 'no-store' })
      if (!res.ok) throw new Error('Falha ao carregar runs')
      const data = await res.json() as { runs: TraceRun[] }
      setRuns(data.runs ?? [])
    } catch {
      toast({ title: 'Erro ao carregar runs', variant: 'danger' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.22em] text-accent">Observabilidade</div>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Atendimentos</h2>
          <p className="mt-1.5 text-sm text-muted">
            Contatos recentes, runs por mensagem e cada etapa do pipeline em ordem.
          </p>
        </div>
        <button
          onClick={() => void refreshContacts()}
          className="focus-ring h-9 rounded-md border border-line bg-elevated px-4 text-sm text-muted transition hover:text-ink"
        >
          Atualizar
        </button>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="rounded-lg border border-line bg-panel shadow-panel">
          <div className="border-b border-line px-4 py-3">
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Contatos recentes</div>
          </div>
          <div className="max-h-[74vh] overflow-auto">
            {contacts.length === 0 ? (
              <div className="p-6 text-sm text-muted">Nenhum atendimento registrado ainda.</div>
            ) : contacts.map(contact => (
              <button
                key={contact.phone}
                onClick={() => void openContact(contact.phone)}
                className={`block w-full border-b border-line px-4 py-3 text-left transition hover:bg-elevated ${
                  selectedPhone === contact.phone ? 'bg-elevated' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">{contact.lead_name ?? contact.phone}</div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-muted">{contact.phone}</div>
                  </div>
                  <Badge variant="muted">{contact.run_count} runs</Badge>
                </div>
                <div className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted">
                  {contact.last_message ?? contact.last_response ?? 'Sem prévia'}
                </div>
                <div className="mt-2 font-mono text-[10px] text-muted/60">{formatDate(contact.last_at)}</div>
              </button>
            ))}
          </div>
        </aside>

        <section className="min-w-0 min-h-[70vh] rounded-lg border border-line bg-panel shadow-panel">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div>
              <div className="text-sm font-semibold text-ink">{selectedContact?.lead_name ?? (selectedPhone || 'Selecione um contato')}</div>
              <div className="mt-0.5 font-mono text-[11px] text-muted">{selectedPhone || 'sem telefone selecionado'}</div>
            </div>
            {selectedPhone && (
              <button
                onClick={() => void openContact(selectedPhone)}
                disabled={loading}
                className="focus-ring h-8 rounded-md bg-accent px-3 text-xs font-semibold text-canvas disabled:opacity-50"
              >
                {loading ? 'Carregando...' : 'Carregar runs'}
              </button>
            )}
          </div>

          {!selectedPhone ? (
            <div className="p-10 text-center text-sm text-muted">Selecione um contato para ver as runs.</div>
          ) : runs.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted">
              {loading ? 'Carregando runs...' : 'Clique em carregar runs para abrir a timeline deste contato.'}
            </div>
          ) : (
            <div className="min-w-0 space-y-4 p-4">
              {runs.map((run, index) => (
                <RunCard
                  key={run.run_id}
                  run={run}
                  index={index}
                  expandedEvent={expandedEvent}
                  expandedPrompt={expandedPrompt}
                  onToggleEvent={setExpandedEvent}
                  onTogglePrompt={setExpandedPrompt}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function RunCard({
  run,
  index,
  expandedEvent,
  expandedPrompt,
  onToggleEvent,
  onTogglePrompt
}: {
  run: TraceRun
  index: number
  expandedEvent: string | null
  expandedPrompt: string | null
  onToggleEvent: (id: string | null) => void
  onTogglePrompt: (id: string | null) => void
}): JSX.Element {
  return (
    <article className="min-w-0 rounded-lg border border-line bg-canvas">
      <div className="border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-accent">Run #{index + 1}</div>
            <div className="mt-1 text-sm text-ink">{run.message_preview ?? 'Mensagem sem prévia'}</div>
          </div>
          <Badge variant={run.status === 'error' ? 'danger' : 'success'}>{run.status}</Badge>
        </div>
        {run.response_preview && (
          <div className="mt-2 rounded-md border border-line bg-panel px-3 py-2 text-xs leading-relaxed text-muted">
            {run.response_preview}
          </div>
        )}
        <div className="mt-2 font-mono text-[10px] text-muted/60">
          {formatDate(run.started_at)} {'->'} {formatDate(run.ended_at)}
        </div>
      </div>

      <div className="min-w-0 space-y-0 p-3">
        {run.events.map((event, eventIndex) => (
          <TraceStep
            key={event.id}
            event={event}
            eventIndex={eventIndex}
            isOpen={expandedEvent === event.id}
            promptOpen={expandedPrompt === event.id}
            onToggleEvent={onToggleEvent}
            onTogglePrompt={onTogglePrompt}
          />
        ))}
      </div>
    </article>
  )
}

function TraceStep({
  event,
  eventIndex,
  isOpen,
  promptOpen,
  onToggleEvent,
  onTogglePrompt
}: {
  event: AgentTrace
  eventIndex: number
  isOpen: boolean
  promptOpen: boolean
  onToggleEvent: (id: string | null) => void
  onTogglePrompt: (id: string | null) => void
}): JSX.Element {
  const eventType = event.event_type ?? 'unknown'
  const prompt = getPrompt(event.data)
  return (
    <div className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)] gap-3">
      <div className="flex flex-col items-center">
        <div className="grid h-6 w-6 place-items-center rounded-full border border-line bg-panel font-mono text-[10px] text-muted">
          {eventIndex + 1}
        </div>
        <div className="h-full w-px bg-line" />
      </div>
      <div className="min-w-0 pb-4">
        <div className="rounded-md border border-line bg-panel px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-ink">{event.title ?? EVENT_LABEL[eventType] ?? eventType}</span>
              <Badge variant={EVENT_VARIANT[eventType] ?? 'muted'}>{eventType}</Badge>
              <span className="font-mono text-[11px] text-muted">{event.agent ?? 'system'}</span>
            </div>
            <div className="flex items-center gap-2">
              {prompt && (
                <button
                  onClick={() => onTogglePrompt(promptOpen ? null : event.id)}
                  className="font-mono text-[11px] text-accent hover:underline"
                >
                  prompt final
                </button>
              )}
              <button
                onClick={() => onToggleEvent(isOpen ? null : event.id)}
                className="font-mono text-[11px] text-muted hover:text-ink"
              >
                {isOpen ? 'fechar json' : 'json'}
              </button>
            </div>
          </div>
          <div className="mt-1 font-mono text-[10px] text-muted/60">{formatDate(event.created_at)}</div>
        </div>

        {promptOpen && (
          <pre className="mt-2 max-h-80 w-full max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-canvas p-3 font-mono text-[11px] leading-relaxed text-ink lg:max-h-[420px]">
            {prompt}
          </pre>
        )}

        {isOpen && (
          <pre className="mt-2 max-h-72 w-full max-w-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-canvas p-3 font-mono text-[11px] leading-relaxed text-muted lg:max-h-80">
            {stringifyData(event.data)}
          </pre>
        )}
      </div>
    </div>
  )
}
