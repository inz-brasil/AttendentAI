'use client'
// conversations-client.tsx — Feed ao vivo de conversas com WebSocket
import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useWebSocket } from '../../../lib/ws'
import { Badge } from '../../../components/ui/badge'
import type { LiveEvent } from '../../../lib/ws'
import type { ConversationMessage } from '../../../lib/api'

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || '/api/backend')

interface LiveMessage {
  phone: string
  name: string | null
  message: string
  response: string
  agent: string
  intent?: string
  timestamp: string
}

interface ConvEntry {
  phone: string
  name: string | null
  lastMessage: string
  lastResponse: string
  agent: string
  intent: string | undefined   // undefined explícito para exactOptionalPropertyTypes
  timestamp: string
  isNew: boolean          // pulsa brevemente quando chega em tempo real
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  created_at: string
  intent?: string
}

const AGENT_BADGE: Record<string, 'accent' | 'cyan' | 'success' | 'muted'> = {
  responder: 'success',
  classifier: 'cyan',
  identifier: 'muted',
}

function relTime(ts: string): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}min`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  return `${Math.floor(diff / 86400)}d`
}

function isLiveMessage(event: LiveEvent): event is LiveEvent & LiveMessage {
  return event.type === 'new_message' &&
    typeof event.phone === 'string' &&
    typeof event.message === 'string' &&
    typeof event.response === 'string' &&
    typeof event.agent === 'string' &&
    typeof event.timestamp === 'string'
}

interface ConversationsClientProps {
  initialMessages: ConversationMessage[]
}

function buildInitialFeed(messages: ConversationMessage[]): ConvEntry[] {
  const byPhone = new Map<string, ConversationMessage[]>()
  for (const message of messages) {
    if (!message.lead_phone) continue
    byPhone.set(message.lead_phone, [...(byPhone.get(message.lead_phone) ?? []), message])
  }

  return [...byPhone.entries()].map(([phone, rows]) => {
    const sorted = [...rows].sort((a, b) =>
      new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()
    )
    const latest = sorted.at(-1)
    const lastUser = [...sorted].reverse().find(message => message.role === 'user')
    const lastAssistant = [...sorted].reverse().find(message => message.role === 'assistant')

    return {
      phone,
      name: latest?.lead_name ?? null,
      lastMessage: lastUser?.content ?? latest?.content ?? '',
      lastResponse: lastAssistant?.content ?? '',
      agent: latest?.agent_used ?? 'responder',
      intent: latest?.intent ?? undefined,
      timestamp: latest?.created_at ?? new Date().toISOString(),
      isNew: false
    }
  }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
}

/**
 * Feed ao vivo de conversas com WebSocket para atualizações em tempo real.
 * @param props Mensagens iniciais do RSC.
 * @returns Feed de conversas com filtros e expansão de chat.
 */
export function ConversationsClient({ initialMessages }: ConversationsClientProps): JSX.Element {
  const { status: wsStatus, lastEvent } = useWebSocket('/ws')

  const [feed, setFeed] = useState<ConvEntry[]>(() => buildInitialFeed(initialMessages))

  useEffect(() => {
    setFeed(buildInitialFeed(initialMessages))
  }, [initialMessages])

  // Conversa expandida e suas mensagens
  const [expandedPhone, setExpandedPhone] = useState<string | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [loadingChat, setLoadingChat] = useState(false)

  // Filtros
  const [filterAgent, setFilterAgent] = useState('')
  const [filterIntent, setFilterIntent] = useState('')

  // Timer para remover o flash "isNew"
  const newTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  /** Aplica evento WS recebido ao feed */
  const applyLiveEvent = useCallback((msg: LiveMessage) => {
    const entry: ConvEntry = {
      phone: msg.phone,
      name: msg.name,
      lastMessage: msg.message,
      lastResponse: msg.response,
      agent: msg.agent,
      intent: msg.intent,
      timestamp: msg.timestamp,
      isNew: true
    }

    setFeed(prev => {
      const idx = prev.findIndex(e => e.phone === msg.phone)
      const next = idx >= 0
        ? [entry, ...prev.filter((_, i) => i !== idx)] // move para o topo
        : [entry, ...prev]
      return next
    })

    // Remove flag isNew após 2s
    const existing = newTimers.current.get(msg.phone)
    if (existing) clearTimeout(existing)
    const t = setTimeout(() => {
      setFeed(prev => prev.map(e => e.phone === msg.phone ? { ...e, isNew: false } : e))
    }, 2000)
    newTimers.current.set(msg.phone, t)
  }, [])

  // Consome eventos WS
  useEffect(() => {
    if (!lastEvent) return
    if (isLiveMessage(lastEvent)) {
      applyLiveEvent({
        phone: lastEvent.phone,
        name: typeof lastEvent.name === 'string' ? lastEvent.name : null,
        message: lastEvent.message,
        response: lastEvent.response,
        agent: lastEvent.agent,
        intent: typeof lastEvent.intent === 'string' ? lastEvent.intent : undefined,
        timestamp: lastEvent.timestamp
      })
    }
  }, [lastEvent, applyLiveEvent])

  // Carrega mensagens de um lead ao expandir
  const expandLead = useCallback(async (phone: string) => {
    if (expandedPhone === phone) {
      setExpandedPhone(null)
      return
    }
    setExpandedPhone(phone)
    setLoadingChat(true)
    try {
      const res = await fetch(`${API_BASE}/api/conversations/${encodeURIComponent(phone)}`, { cache: 'no-store' })
      if (!res.ok) throw new Error()
      const data = await res.json() as { messages: ChatMessage[] }
      // API retorna { messages: [...] }, não array direto
      setChatMessages(Array.isArray(data) ? data : (data.messages ?? []))
    } catch {
      setChatMessages([])
    } finally {
      setLoadingChat(false)
    }
  }, [expandedPhone])

  // Filtra o feed
  const filtered = feed.filter(e => {
    if (filterAgent && e.agent !== filterAgent) return false
    if (filterIntent && !e.intent?.toLowerCase().includes(filterIntent.toLowerCase())) return false
    return true
  })

  // Agentes únicos no feed para o filtro
  const agents = [...new Set(feed.map(e => e.agent).filter(Boolean))]

  const wsColors: Record<string, string> = {
    open: 'bg-success',
    connecting: 'bg-accent animate-pulse',
    closed: 'bg-muted/40',
    error: 'bg-danger',
    idle: 'bg-muted/40'
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.22em] text-accent">Tempo real</div>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Conversas</h2>
          <p className="mt-1.5 text-sm text-muted">{filtered.length} leads ativos no feed</p>
        </div>

        {/* Status WS */}
        <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2">
          <span className={`h-2 w-2 rounded-full ${wsColors[wsStatus]}`} />
          <span className="font-mono text-xs text-muted">
            WebSocket · <span className={wsStatus === 'open' ? 'text-success' : 'text-muted'}>{wsStatus}</span>
          </span>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          value={filterAgent}
          onChange={e => setFilterAgent(e.target.value)}
          className="h-8 rounded-md border border-line bg-panel px-3 text-xs text-muted outline-none focus:border-cyan transition"
        >
          <option value="">Todos os agentes</option>
          {agents.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input
          type="text"
          value={filterIntent}
          onChange={e => setFilterIntent(e.target.value)}
          placeholder="Ex: sales, scheduling, internal"
          className="h-8 w-full rounded-md border border-line bg-panel px-3 text-xs text-ink placeholder:text-muted outline-none transition focus:border-cyan sm:w-56"
        />
        {(filterAgent || filterIntent) && (
          <button
            onClick={() => { setFilterAgent(''); setFilterIntent('') }}
            className="h-8 w-full rounded-md border border-line bg-elevated px-3 text-xs text-muted transition hover:text-ink sm:w-auto"
          >
            Limpar
          </button>
        )}
      </div>

      {/* Feed */}
      <div className="rounded-xl border border-line overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center text-muted gap-3">
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="opacity-30">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <div>
              <p className="text-sm">Nenhuma conversa no feed.</p>
              <p className="text-xs text-muted/60 mt-1">Mensagens chegam em tempo real via WebSocket.</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {filtered.map(entry => (
              <div key={entry.phone}>
                {/* Linha do lead */}
                <button
                  onClick={() => expandLead(entry.phone)}
                  className={`w-full flex items-start gap-3 px-3 py-3.5 text-left transition sm:items-center sm:gap-4 sm:px-4 ${
                    expandedPhone === entry.phone ? 'bg-elevated' : 'bg-canvas hover:bg-elevated/50'
                  } ${entry.isNew ? 'animate-pulse-once' : ''}`}
                >
                  {/* Avatar */}
                  <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border font-mono text-xs ${
                    entry.isNew ? 'bg-accent/20 border-accent/40 text-accent' : 'bg-elevated border-line text-muted'
                  }`}>
                    {(entry.name ?? entry.phone).slice(0, 2).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                      <span className="truncate text-sm font-medium text-ink">{entry.name ?? 'Sem nome'}</span>
                      <span className="truncate font-mono text-[10px] text-muted/60">{entry.phone}</span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted truncate max-w-lg">
                      {entry.lastMessage || <span className="italic text-muted/50">Sem mensagens recentes</span>}
                    </p>
                  </div>

                  {/* Meta */}
                  <div className="flex max-w-[34%] shrink-0 flex-wrap items-center justify-end gap-1.5 sm:max-w-none sm:gap-2">
                    {entry.intent && <Badge variant="muted">{entry.intent}</Badge>}
                    <Badge variant={AGENT_BADGE[entry.agent] ?? 'muted'}>{entry.agent}</Badge>
                    <span className="font-mono text-[10px] text-muted tabular-nums">{relTime(entry.timestamp)}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                      className={`text-muted/30 transition-transform ${expandedPhone === entry.phone ? 'rotate-180' : ''}`}>
                      <path d="m6 9 6 6 6-6"/>
                    </svg>
                  </div>
                </button>

                {/* Chat expandido */}
                {expandedPhone === entry.phone && (
                  <div className="bg-canvas border-t border-line px-4 py-4">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-xs font-semibold text-ink">Histórico de mensagens</span>
                      <Link
                        href={`/leads/${encodeURIComponent(entry.phone)}`}
                        className="focus-ring h-7 rounded-md border border-line bg-elevated px-3 text-xs text-muted hover:text-ink transition"
                      >
                        Ver perfil completo →
                      </Link>
                    </div>

                    {loadingChat ? (
                      <div className="flex items-center gap-2 py-6 text-muted text-sm">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                          <path d="M21 12a9 9 0 1 1-9-9"/>
                        </svg>
                        Carregando conversa…
                      </div>
                    ) : chatMessages.length === 0 ? (
                      <p className="py-6 text-center text-xs text-muted/60">Sem mensagens registradas.</p>
                    ) : (
                      <div className="space-y-3 max-h-80 overflow-y-auto">
                        {chatMessages.map((msg, i) => (
                          <div key={i} className={`flex gap-2.5 ${msg.role === 'assistant' ? 'flex-row-reverse' : ''}`}>
                            <div className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9px] font-mono ${
                              msg.role === 'user' ? 'bg-elevated border border-line text-muted' : 'bg-accent/20 border border-accent/30 text-accent'
                            }`}>
                              {msg.role === 'user' ? 'U' : 'AI'}
                            </div>
                            <div className={`max-w-[80%] ${msg.role === 'assistant' ? 'items-end' : ''}`}>
                              <div className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
                                msg.role === 'user'
                                  ? 'bg-panel border border-line text-ink'
                                  : 'bg-accent/10 border border-accent/20 text-ink'
                              }`}>
                                {msg.content}
                              </div>
                              <div className="mt-1 flex items-center gap-2">
                                <span className="font-mono text-[9px] text-muted/60">
                                  {new Date(msg.created_at).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}
                                </span>
                                {msg.intent && <Badge variant="muted">{msg.intent}</Badge>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
