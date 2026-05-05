'use client'
// page.tsx — Gerenciamento de servidores MCP disponíveis no AttendentAI
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '../../../components/ui/badge'
import { ConfirmDialog } from '../../../components/ui/confirm-dialog'
import { useToast } from '../../../components/ui/toast-provider'
import type { McpServer, NewMcpServerInput } from '../../../lib/api'

const API_BASE = '/api/backend'

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
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
 * Página administrativa para cadastrar, testar e remover servidores MCP.
 * @returns Tela de gerenciamento MCP.
 */
export default function McpPage(): JSX.Element {
  const { toast } = useToast()
  const [servers, setServers] = useState<McpServer[]>([])
  const [loading, setLoading] = useState(true)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [removing, setRemoving] = useState<McpServer | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<NewMcpServerInput>({
    name: '',
    slug: '',
    transport: 'http',
    url: '',
    command: '',
    auth_type: 'none'
  })

  const toolCount = useMemo(
    () => servers.reduce((total, server) => total + (server.tools_cache?.length ?? 0), 0),
    [servers]
  )

  async function load(): Promise<void> {
    setLoading(true)
    try {
      setServers(await readJson<McpServer[]>('/api/mcp/servers'))
    } catch {
      toast({ title: 'Erro ao carregar MCPs', variant: 'danger' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function testServer(serverId: string): Promise<boolean> {
    setTestingId(serverId)
    try {
      const result = await readJson<{ status: string; tools: string[] }>(`/api/mcp/servers/${encodeURIComponent(serverId)}/test`, {
        method: 'POST'
      })
      await load()
      const ok = result.status === 'ok'
      toast({ title: ok ? `${result.tools.length} tools encontradas` : 'Conexão MCP falhou', variant: ok ? 'success' : 'danger' })
      return ok
    } catch {
      toast({ title: 'Erro ao testar conexão MCP', variant: 'danger' })
      return false
    } finally {
      setTestingId(null)
    }
  }

  async function removeServer(server: McpServer): Promise<void> {
    try {
      await readJson<{ success: boolean }>(`/api/mcp/servers/${encodeURIComponent(server.id)}`, { method: 'DELETE' })
      setServers((current) => current.filter((item) => item.id !== server.id))
      toast({ title: 'Servidor MCP removido', variant: 'success' })
    } catch {
      toast({ title: 'Erro ao remover MCP', variant: 'danger' })
    } finally {
      setRemoving(null)
    }
  }

  async function saveAndTest(): Promise<void> {
    const slug = form.slug || slugify(form.name)
    if (!form.name || !slug) {
      toast({ title: 'Informe nome e slug', variant: 'danger' })
      return
    }

    if (form.transport === 'http' && !form.url) {
      toast({ title: 'Informe a URL do servidor HTTP', variant: 'danger' })
      return
    }

    setSaving(true)
    try {
      const created = await readJson<McpServer>('/api/mcp/servers', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          slug,
          url: form.transport === 'http' ? form.url : null,
          command: form.transport === 'stdio' ? form.command : null
        })
      })
      const ok = await testServer(created.id)
      if (!ok) {
        await readJson<{ success: boolean }>(`/api/mcp/servers/${encodeURIComponent(created.id)}`, { method: 'DELETE' })
        toast({ title: 'Servidor não foi salvo porque o teste falhou', variant: 'danger' })
        return
      }

      setForm({ name: '', slug: '', transport: 'http', url: '', command: '', auth_type: 'none' })
      toast({ title: 'Servidor MCP salvo e testado', variant: 'success' })
    } catch {
      toast({ title: 'Erro ao salvar servidor MCP', variant: 'danger' })
    } finally {
      setSaving(false)
      await load()
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.22em] text-accent">Integrações</div>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">MCP</h2>
          <p className="mt-1.5 text-sm text-muted">{servers.length} servidores registrados · {toolCount} tools em cache</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          {loading ? (
            <div className="rounded-xl border border-line bg-panel p-6 text-sm text-muted shadow-panel">Carregando servidores…</div>
          ) : servers.length === 0 ? (
            <div className="rounded-xl border border-line bg-panel p-8 text-center text-sm text-muted shadow-panel">Nenhum servidor MCP cadastrado.</div>
          ) : (
            servers.map((server) => {
              const connected = Boolean(server.is_active)
              return (
                <div key={server.id} className="rounded-xl border border-line bg-panel p-5 shadow-panel">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={connected ? 'text-success' : 'text-muted'}>{connected ? '●' : '○'}</span>
                        <h3 className="truncate font-semibold text-ink">{server.name}</h3>
                        <Badge variant="muted">{server.transport}</Badge>
                        <Badge variant={connected ? 'success' : 'muted'}>{connected ? 'conectado' : 'não configurado'}</Badge>
                      </div>
                      <div className="mt-2 grid gap-1 text-xs text-muted sm:grid-cols-3">
                        <span>{server.tools_cache?.length ?? 0} tools</span>
                        <span>sync {formatDate(server.tools_cached_at)}</span>
                        <span className="truncate">{server.url ?? server.command ?? 'sem endpoint'}</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void testServer(server.id)}
                        disabled={testingId === server.id}
                        className="focus-ring h-8 rounded-md border border-line bg-elevated px-3 text-xs text-muted transition hover:text-ink disabled:opacity-60"
                      >
                        {testingId === server.id ? 'Testando…' : 'Testar conexão'}
                      </button>
                      <button
                        onClick={() => setRemoving(server)}
                        className="focus-ring h-8 rounded-md border border-danger/40 bg-danger/10 px-3 text-xs text-danger transition hover:bg-danger/20"
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div className="rounded-xl border border-line bg-panel p-5 shadow-panel">
          <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted">Adicionar servidor</div>
          <div className="mt-4 space-y-4">
            <Field label="Nome">
              <input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value, slug: current.slug || slugify(event.target.value) }))}
                className="field-input"
                placeholder="Servidor MCP"
              />
            </Field>
            <Field label="Slug">
              <input
                value={form.slug}
                onChange={(event) => setForm((current) => ({ ...current, slug: slugify(event.target.value) }))}
                className="field-input font-mono text-xs"
                placeholder="servidor-mcp"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Transporte">
                <select value={form.transport} onChange={(event) => setForm((current) => ({ ...current, transport: event.target.value as 'http' | 'stdio' }))} className="field-input">
                  <option value="http">HTTP</option>
                  <option value="stdio">stdio</option>
                </select>
              </Field>
              <Field label="Auth">
                <select value={form.auth_type} onChange={(event) => setForm((current) => ({ ...current, auth_type: event.target.value as 'none' | 'oauth2' | 'api_key' }))} className="field-input">
                  <option value="none">none</option>
                  <option value="oauth2">oauth2</option>
                  <option value="api_key">api_key</option>
                </select>
              </Field>
            </div>
            {form.transport === 'http' ? (
              <Field label="URL">
                <input
                  value={form.url ?? ''}
                  onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))}
                  className="field-input font-mono text-xs"
                  placeholder="http://localhost:3001/mcp/google-calendar"
                />
              </Field>
            ) : (
              <Field label="Comando">
                <input
                  value={form.command ?? ''}
                  onChange={(event) => setForm((current) => ({ ...current, command: event.target.value }))}
                  className="field-input font-mono text-xs"
                  placeholder="node server.js"
                />
              </Field>
            )}
            <button onClick={saveAndTest} disabled={saving} className="save-btn w-full">
              {saving ? 'Salvando…' : 'Salvar e Testar'}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => { if (!open) setRemoving(null) }}
        title="Remover servidor MCP"
        description={`Remover ${removing?.name ?? 'este servidor'} também remove vínculos com agentes.`}
        confirmLabel="Remover"
        onConfirm={() => { if (removing) void removeServer(removing) }}
      />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-1.5">
      <label className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{label}</label>
      {children}
    </div>
  )
}
