'use client'
// index.tsx — Painel de tools MCP habilitadas por agente
import { useEffect, useMemo, useState } from 'react'
import { Wrench } from 'lucide-react'
import { Badge } from '../ui/badge'
import { useToast } from '../ui/toast-provider'
import type { AgentMcpServerRow, McpServer } from '../../lib/api'

const API_BASE = '/api/backend'

interface ToolsPanelProps {
  agentId: string
}

function formatDate(value: string | null): string {
  if (!value) return 'Nunca'
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers
    },
    cache: 'no-store'
  })
  if (!response.ok) throw new Error('Falha na API')
  return response.json() as Promise<T>
}

/**
 * Renderiza MCPs disponíveis e salva quais o agente pode usar.
 * @param props ID do agente.
 * @returns Painel de ferramentas do agente.
 */
export function ToolsPanel({ agentId }: ToolsPanelProps): JSX.Element {
  const { toast } = useToast()
  const [servers, setServers] = useState<McpServer[]>([])
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const [serverRows, agentRows] = await Promise.all([
          readJson<McpServer[]>('/api/mcp/servers'),
          readJson<AgentMcpServerRow[]>(`/api/agents/${encodeURIComponent(agentId)}/mcp`)
        ])
        if (!active) return
        setServers(serverRows)
        setEnabledIds(new Set(agentRows.filter((row) => row.enabled).map((row) => row.mcp_server_id).filter(Boolean) as string[]))
      } catch {
        toast({ title: 'Erro ao carregar ferramentas', variant: 'danger' })
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [agentId, toast])

  const enabledCount = useMemo(() => enabledIds.size, [enabledIds])

  function toggle(serverId: string): void {
    setEnabledIds((current) => {
      const next = new Set(current)
      if (next.has(serverId)) next.delete(serverId)
      else next.add(serverId)
      return next
    })
  }

  async function save(): Promise<void> {
    setSaving(true)
    try {
      await readJson<{ success: boolean; count: number }>(`/api/agents/${encodeURIComponent(agentId)}/mcp`, {
        method: 'PUT',
        body: JSON.stringify({
          servers: Array.from(enabledIds).map((id) => ({ mcp_server_id: id, enabled: true }))
        })
      })
      toast({ title: `${enabledIds.size} MCPs salvos no agente`, variant: 'success' })
    } catch {
      toast({ title: 'Erro ao salvar MCPs do agente', variant: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="rounded-xl border border-line bg-panel p-6 text-sm text-muted shadow-panel">Carregando ferramentas…</div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted">{enabledCount} de {servers.length} servidores MCP habilitados para este agente.</p>
        <button onClick={save} disabled={saving} className="save-btn">
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
      </div>

      <div className="grid gap-3">
        {servers.map((server) => {
          const enabled = enabledIds.has(server.id)
          const connected = Boolean(server.is_active)
          const tools = server.tools_cache ?? []
          const expanded = expandedId === server.id
          return (
            <div key={server.id} className="rounded-xl border border-line bg-panel shadow-panel">
              <div className="flex items-center gap-4 p-4">
                <button
                  onClick={() => setExpandedId(expanded ? null : server.id)}
                  className="focus-ring grid h-8 w-8 place-items-center rounded-md border border-line bg-canvas text-muted transition hover:text-ink"
                  aria-label={expanded ? 'Recolher tools' : 'Expandir tools'}
                >
                  <span className={`transition ${expanded ? 'rotate-90' : ''}`}>›</span>
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-ink">{server.name}</h3>
                    <Badge variant={connected ? 'success' : 'muted'}>{connected ? 'conectado' : 'não configurado'}</Badge>
                    <Badge variant="muted">{server.transport}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {tools.length} tools · última sync {formatDate(server.tools_cached_at)}
                  </p>
                </div>
                <button
                  onClick={() => toggle(server.id)}
                  data-compact="true"
                  className={`relative h-6 w-11 rounded-full border transition ${enabled ? 'border-success/40 bg-success/20' : 'border-line bg-canvas'}`}
                  aria-label={enabled ? 'Desabilitar servidor' : 'Habilitar servidor'}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${enabled ? 'left-5 bg-success' : 'left-0.5 bg-muted/40'}`} />
                </button>
              </div>

              {expanded && (
                <div className="border-t border-line px-4 py-3">
                  {tools.length === 0 ? (
                    <p className="text-xs text-muted">Nenhuma tool em cache. Teste a conexão na página MCP para sincronizar.</p>
                  ) : (
                    <div className="grid gap-2">
                      {tools.map((tool) => (
                        <div key={tool.name} className="flex gap-3 rounded-md bg-canvas p-3">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded bg-elevated text-cyan">
                            <Wrench className="h-3.5 w-3.5" strokeWidth={1.8} />
                          </span>
                          <div className="min-w-0">
                            <div className="font-mono text-xs text-ink">{tool.name}</div>
                            <p className="mt-1 text-xs text-muted">{tool.description ?? 'Sem descrição'}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
