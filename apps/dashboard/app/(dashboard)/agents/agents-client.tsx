'use client'
// agents-client.tsx — Lista de agentes com toggle, IDs visíveis e estado de erro explícito
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertCircle, Bot, Check, Copy, Edit3, Route, ToggleLeft } from 'lucide-react'
import { Badge } from '../../../components/ui/badge'
import { useToast } from '../../../components/ui/toast-provider'
import type { Agent, Skill } from '../../../lib/api'
import { useUiStore } from '../../../lib/ui-store'

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || '/api/backend')

const TYPE_LABEL: Record<string, string> = {
  orchestrator: 'Orquestrador',
  classifier: 'Classificador',
  responder: 'Respondedor',
  memory: 'Memória',
  identifier: 'Identificador',
  internal: 'Interno',
  custom: 'Custom'
}

function typeBadge(type: string | null): 'accent' | 'cyan' | 'success' | 'muted' | 'default' {
  switch (type) {
    case 'orchestrator': return 'accent'
    case 'classifier': return 'cyan'
    case 'responder': return 'success'
    case 'memory': return 'muted'
    case 'identifier': return 'default'
    case 'internal': return 'accent'
    default: return 'muted'
  }
}

interface AgentsClientProps {
  initialAgents: Agent[]
  allSkills: Skill[]
  apiError?: boolean
}

/**
 * Lista de agentes com toggle de ativo/inativo, IDs copiáveis e link para editor.
 * @param props Agentes iniciais, skills e flag de erro de API.
 * @returns Tabela/cards de agentes operacional.
 */
export function AgentsClient({ initialAgents, apiError }: AgentsClientProps): JSX.Element {
  const router = useRouter()
  const { toast } = useToast()
  const debugMode = useUiStore((state) => state.debugMode)
  const [agents, setAgents] = useState(initialAgents)
  const [toggling, setToggling] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  useEffect(() => {
    setAgents(initialAgents)
  }, [initialAgents])

  /** Copia ID para o clipboard */
  async function copyId(id: string) {
    try {
      await navigator.clipboard.writeText(id)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1500)
      toast({ title: `ID "${id}" copiado`, variant: 'success' })
    } catch {
      toast({ title: 'Não foi possível copiar', variant: 'danger' })
    }
  }

  /** Ativa/desativa agente via PUT */
  async function toggleAgent(agent: Agent) {
    setToggling(agent.id)
    const newActive = !agent.is_active
    try {
      const res = await fetch(`${API_BASE}/api/agents/${encodeURIComponent(agent.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: newActive })
      })
      if (!res.ok) throw new Error()
      const updated = await res.json() as Agent
      setAgents(prev => prev.map(a => a.id === agent.id ? updated : a))
      toast({ title: `Agente ${newActive ? 'ativado' : 'desativado'}`, variant: 'success' })
      router.refresh()
    } catch {
      toast({ title: 'Erro ao alterar status — API online?', variant: 'danger' })
    } finally {
      setToggling(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-accent">Pipeline</div>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Agentes</h2>
          <p className="mt-1.5 text-sm text-muted">
            {agents.length > 0
              ? `${agents.length} agentes configurados · ${agents.filter(a => a.is_active).length} ativos`
              : 'Nenhum agente carregado'}
          </p>
        </div>
      </div>

      {/* Banner de erro de API */}
      {apiError && (
        <div className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/8 px-5 py-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={1.8} />
          <div>
            <p className="text-sm font-semibold text-danger">API inacessível em {API_BASE}</p>
            <p className="mt-0.5 text-xs text-muted">
              Suba a API com <code className="font-mono bg-canvas px-1 rounded">bun run dev</code> em{' '}
              <code className="font-mono bg-canvas px-1 rounded">apps/api</code>, depois rode o seed:{' '}
              <code className="font-mono bg-canvas px-1 rounded">bun run src/db/seed.ts</code>
            </p>
          </div>
        </div>
      )}

      {/* Sem agentes mas API ok — precisa do seed */}
      {!apiError && agents.length === 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-accent/30 bg-accent/8 px-5 py-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={1.8} />
          <div>
            <p className="text-sm font-semibold text-accent">Banco vazio — rode o seed</p>
            <p className="mt-0.5 text-xs text-muted">
              Execute em <code className="font-mono bg-canvas px-1 rounded">apps/api</code>:{' '}
              <code className="font-mono bg-canvas px-1 rounded">bun run src/db/seed.ts</code>
            </p>
          </div>
        </div>
      )}

      {/* Grid de cards */}
      {agents.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {agents.map(agent => (
            <div key={agent.id} className="surface rounded-2xl p-5 transition hover:border-accent/30">
              {/* Cabeçalho */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border ${
                    agent.is_active
                      ? 'bg-accent/10 border-accent/30 text-accent'
                      : 'bg-elevated border-line text-muted'
                  }`}>
                    <Bot className="h-4 w-4" strokeWidth={1.8} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink">{agent.name}</div>
                    <div className="mt-0.5 text-xs text-muted truncate">{agent.description ?? '—'}</div>
                  </div>
                </div>

                {/* Toggle ativo/inativo */}
                <button
                  onClick={() => toggleAgent(agent)}
                  disabled={toggling === agent.id}
                  aria-label={agent.is_active ? 'Desativar agente' : 'Ativar agente'}
                  data-compact="true"
                  className={`relative h-6 w-11 shrink-0 rounded-full border transition ${
                    agent.is_active ? 'bg-success/20 border-success/40' : 'bg-canvas border-line'
                  } disabled:opacity-50`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${
                    agent.is_active ? 'left-5 bg-success' : 'left-0.5 bg-muted/40'
                  }`} />
                </button>
              </div>

              {/* ID copiável — principal fix pedido pelo user */}
              {debugMode && <div className="mt-3 flex items-center gap-2 rounded-md bg-canvas border border-line px-3 py-2">
                <Copy className="h-3.5 w-3.5 shrink-0 text-muted/50" strokeWidth={1.8} />
                <span className="flex-1 font-mono text-[11px] text-muted truncate">{agent.id}</span>
                <button
                  onClick={() => copyId(agent.id)}
                  className="focus-ring shrink-0 rounded px-2 py-0.5 text-[10px] font-mono transition hover:bg-elevated text-muted hover:text-ink"
                >
                  {copiedId === agent.id ? 'copiado' : 'copiar'}
                </button>
              </div>}

              {/* Dados técnicos */}
              {debugMode && <div className="mt-3 grid grid-cols-1 gap-3 border-t border-line pt-3 sm:grid-cols-3">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted/60 mb-1">Tipo</div>
                  <Badge variant={typeBadge(agent.type)}>
                    {TYPE_LABEL[agent.type ?? ''] ?? agent.type ?? '—'}
                  </Badge>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted/60 mb-1">Modelo</div>
                  <span className="font-mono text-xs text-muted">{agent.model ?? '—'}</span>
                </div>
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted/60 mb-1">Chamadas</div>
                  <span className="font-mono text-xs tabular-nums text-muted">
                    {(agent.total_calls ?? 0).toLocaleString('pt-BR')}
                  </span>
                </div>
              </div>}

              {/* Botão editar — link direto com o ID */}
              <div className="mt-4 flex gap-2">
                <Link
                  href={`/agents/${encodeURIComponent(agent.id)}`}
                  className="focus-ring flex flex-1 items-center justify-center gap-2 h-9 rounded-md border border-line bg-elevated text-sm text-muted hover:text-ink hover:border-muted transition"
                >
                  <Edit3 className="h-3.5 w-3.5" strokeWidth={1.8} />
                  Editar agente
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Diagrama do pipeline — sempre visível */}
      {debugMode && <div className="surface rounded-2xl p-5">
        <div className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted">
          <Route className="h-4 w-4" strokeWidth={1.8} />
          Fluxo de execução
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {[
            { step: '01', id: 'classifier', label: 'Classifier' },
            { step: '02', id: 'identifier', label: 'Identifier' },
            { step: '03', id: 'memory-agent', label: 'Memory' },
            { step: '04', id: 'responder', label: 'Responder' }
          ].map((item, i, arr) => {
            const agent = agents.find(a => a.id === item.id)
            return (
              <div key={item.step} className="flex items-center gap-2 shrink-0">
                <Link
                  href={`/agents/${encodeURIComponent(item.id)}`}
                  className={`rounded-lg border px-4 py-2.5 text-center transition hover:border-accent/40 ${
                    agent?.is_active !== false ? 'border-line bg-canvas' : 'border-line/40 bg-canvas opacity-50'
                  }`}
                >
                  <div className="font-mono text-[10px] text-accent mb-0.5">{item.step}</div>
                  <div className="text-xs font-medium text-ink">{item.label}</div>
                  <div className="font-mono text-[9px] text-muted/50 mt-0.5">{item.id}</div>
                </Link>
                {i < arr.length - 1 && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted/30">
                    <path d="m9 18 6-6-6-6"/>
                  </svg>
                )}
              </div>
            )
          })}
        </div>
        <p className="mt-3 text-xs text-muted/50">Clique em qualquer agente para abrir o editor.</p>
      </div>}
    </div>
  )
}
