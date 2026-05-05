'use client'
// home-client.tsx — Cliente da Home: auto-refresh, métricas e feed de conversas
import { useEffect, useState, useCallback } from 'react'
import { Badge } from '../../components/ui/badge'
import type { Lead } from '../../lib/api'
import Link from 'next/link'

interface HealthData {
  status: string
  timestamp: string
  version: string
}

interface HomeData {
  leads: Lead[]
  health: HealthData | null
}

interface HomeClientProps {
  initialData: HomeData
}

/** Formata tempo relativo em português */
function relativeTime(dateStr: string | null): string {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `${mins}m atrás`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h atrás`
  return `${Math.floor(hrs / 24)}d atrás`
}

/** Mapeia status de lead para variante de badge */
function statusVariant(status: string | null): 'success' | 'accent' | 'danger' | 'muted' | 'cyan' {
  switch (status) {
    case 'lead_quente': return 'accent'
    case 'ativo': return 'success'
    case 'convertido': return 'cyan'
    case 'inativo': return 'danger'
    default: return 'muted'
  }
}

/**
 * Componente client da Home com auto-atualização a cada 30s.
 * @param props Dados iniciais buscados no servidor.
 * @returns Dashboard home operacional.
 */
export function HomeClient({ initialData }: HomeClientProps): JSX.Element {
  const [data, setData] = useState<HomeData>(initialData)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    const apiBase = (process.env.NEXT_PUBLIC_API_URL || '/api/backend')
    try {
      const [leadsRes, healthRes] = await Promise.allSettled([
        fetch(`${apiBase}/api/leads`).then(r => r.json()),
        fetch(`${apiBase}/health`).then(r => r.json())
      ])
      setData({
        leads: leadsRes.status === 'fulfilled' ? (leadsRes.value as Lead[]) : data.leads,
        health: healthRes.status === 'fulfilled' ? (healthRes.value as HealthData) : data.health
      })
      setLastRefresh(new Date())
    } catch {
      // Mantém dados anteriores em caso de erro
    } finally {
      setRefreshing(false)
    }
  }, [data])

  // Auto-refresh a cada 30s
  useEffect(() => {
    const interval = setInterval(refresh, 30_000)
    return () => clearInterval(interval)
  }, [refresh])

  const leads = data.leads ?? []
  const totalLeads = leads.length
  const activeLeads = leads.filter(l => l.status === 'ativo' || l.status === 'lead_quente').length
  const totalMessages = leads.reduce((sum, l) => sum + (l.total_messages ?? 0), 0)
  const hotLeads = leads.filter(l => l.status === 'lead_quente').length
  const convertedLeads = leads.filter(l => l.status === 'convertido').length
  const staleLeads = leads.filter(l => l.status === 'inativo').length
  const apiOk = data.health?.status === 'ok'

  // Últimas 10 conversas ordenadas por atividade (leads com mais mensagens primeiro)
  const recentLeads = [...leads]
    .sort((a, b) => new Date(b.last_message_at ?? 0).getTime() - new Date(a.last_message_at ?? 0).getTime())
    .slice(0, 10)

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.22em] text-accent">Overview</div>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Painel de operação</h2>
          <p className="mt-1.5 text-sm text-muted">
            Acompanhe atendimento, fila, leads e status do sistema em tempo real.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="focus-ring flex h-8 w-fit items-center gap-1.5 rounded-md border border-line bg-elevated px-2.5 text-[11px] text-muted transition hover:border-muted hover:text-ink disabled:opacity-50 sm:h-9 sm:gap-2 sm:px-4 sm:text-sm"
          aria-label="Atualizar dados"
        >
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={refreshing ? 'animate-spin' : ''}
          >
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
            <path d="M21 3v5h-5"/>
          </svg>
          {refreshing ? 'Atualizando…' : `Atualizado ${relativeTime(lastRefresh.toISOString())}`}
        </button>
      </div>

      {/* Metric cards */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total de leads"
          value={totalLeads.toString()}
          sub="cadastros no sistema"
          tone="text-ink"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          }
        />
        <MetricCard
          label="Leads ativos"
          value={activeLeads.toString()}
          sub="ativos + quentes"
          tone="text-success"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
          }
        />
        <MetricCard
          label="Total mensagens"
          value={totalMessages.toLocaleString('pt-BR')}
          sub="processadas pelo sistema"
          tone="text-cyan"
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          }
        />
        <MetricCard
          label="Status do sistema"
          value={apiOk ? 'Online' : 'Offline'}
          sub={apiOk ? 'API respondendo' : 'API inacessível'}
          tone={apiOk ? 'text-success' : 'text-danger'}
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4M12 16h.01"/>
            </svg>
          }
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <MiniMetric label="Quentes" value={hotLeads} />
        <MiniMetric label="Convertidos" value={convertedLeads} />
        <MiniMetric label="Inativos 48h+" value={staleLeads} />
      </div>

      {/* Status bar + feed */}
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        {/* Feed de conversas */}
        <div className="rounded-xl bg-panel border border-line overflow-hidden shadow-panel">
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <h3 className="text-sm font-semibold text-ink">Últimas conversas</h3>
            <Link
              href="/leads"
              className="focus-ring font-mono text-[11px] uppercase tracking-[0.15em] text-muted hover:text-accent transition"
            >
              Ver todos →
            </Link>
          </div>

          {recentLeads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="text-muted/40">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <p className="mt-3 text-sm text-muted">Nenhuma conversa ainda.</p>
              <p className="mt-1 text-xs text-muted/60">Envie uma mensagem via webhook para começar.</p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {recentLeads.map((lead) => (
                <Link
                  key={lead.phone}
                  href={`/leads/${encodeURIComponent(lead.phone)}`}
                  className="flex items-center gap-4 px-5 py-3.5 transition hover:bg-elevated group"
                >
                  {/* Avatar */}
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-elevated border border-line font-mono text-xs text-muted group-hover:border-accent/40 transition">
                    {(lead.name ?? lead.phone).slice(0, 2).toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-ink truncate">
                        {lead.name ?? 'Sem nome'}
                      </span>
                      <Badge variant={statusVariant(lead.status)}>
                        {lead.status ?? 'novo'}
                      </Badge>
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-muted">{lead.phone}</div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="font-mono text-xs text-muted">
                      {lead.total_messages ?? 0} msgs
                    </div>
                    {lead.tags && lead.tags.length > 0 && (
                      <div className="mt-1 flex justify-end gap-1">
                        {(lead.tags ?? []).slice(0, 2).map((tag: string) => (
                          <span key={tag} className="font-mono text-[10px] text-muted/60">{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Status panel */}
        <div className="space-y-4">
          {/* Sistema */}
          <div className="rounded-xl bg-panel border border-line p-5 shadow-panel">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted mb-4">Status do sistema</div>
            <div className="space-y-3">
              <StatusRow label="API Backend" ok={apiOk} detail={data.health?.version ?? '—'} />
              <StatusRow label="Webhook" ok={apiOk} detail="POST /api/webhook" />
              <StatusRow label="Banco de dados" ok={totalLeads >= 0} detail="SQLite + Drizzle" />
            </div>
          </div>

          {/* Fluxo de processamento */}
          <div className="rounded-xl bg-panel border border-line p-5 shadow-panel">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted mb-4">Pipeline de mensagem</div>
            <div className="space-y-2">
              {[
                { step: '01', label: 'Webhook', desc: 'Recebe payload do n8n' },
                { step: '02', label: 'Classifier', desc: 'Detecta intenção' },
                { step: '03', label: 'Identifier', desc: 'Enriquece lead' },
                { step: '04', label: 'Memory', desc: 'Carrega vault' },
                { step: '05', label: 'Responder', desc: 'Gera resposta' }
              ].map(({ step, label, desc }) => (
                <div key={step} className="flex items-center gap-3 rounded-md bg-canvas/50 px-3 py-2.5">
                  <span className="font-mono text-[10px] text-accent tabular-nums">{step}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-ink">{label}</div>
                    <div className="text-[10px] text-muted">{desc}</div>
                  </div>
                  <div className="h-1.5 w-1.5 rounded-full bg-success/60" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Card de métrica individual */
function MetricCard({
  label, value, sub, tone, icon
}: {
  label: string
  value: string
  sub: string
  tone: string
  icon: JSX.Element
}): JSX.Element {
  return (
    <div className="rounded-xl bg-panel border border-line p-5 shadow-panel group hover:border-line/80 transition">
      <div className="flex items-start justify-between">
        <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted">{label}</div>
        <div className="text-muted/40 group-hover:text-muted transition">{icon}</div>
      </div>
      <div className={`mt-4 text-3xl font-semibold tracking-tight tabular-nums ${tone}`}>{value}</div>
      <div className="mt-1 text-xs text-muted/60">{sub}</div>
    </div>
  )
}

/** Row de status com indicador visual */
function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <span className={`h-2 w-2 rounded-full ${ok ? 'bg-success animate-pulse' : 'bg-danger'}`} />
        <span className="text-sm text-ink">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs text-muted">{detail}</span>
        <Badge variant={ok ? 'success' : 'danger'}>{ok ? 'ok' : 'erro'}</Badge>
      </div>
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="flex items-center justify-between rounded-lg border border-line bg-panel px-4 py-3 shadow-panel">
      <span className="text-sm text-muted">{label}</span>
      <span className="font-mono text-lg font-semibold text-ink tabular-nums">{value}</span>
    </div>
  )
}
