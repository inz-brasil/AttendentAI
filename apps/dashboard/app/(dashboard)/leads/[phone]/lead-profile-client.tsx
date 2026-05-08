'use client'
// lead-profile-client.tsx — Perfil interativo do lead: edição, timeline e vault
import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import * as Tabs from '@radix-ui/react-tabs'
import { Badge } from '../../../../components/ui/badge'
import { ConfirmDialog } from '../../../../components/ui/confirm-dialog'
import { useToast } from '../../../../components/ui/toast-provider'
import type { Lead } from '../../../../lib/api'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
  intent?: string
  tokens_used?: number
}

interface LeadProfileClientProps {
  initialLead: Lead
  initialMessages: Message[]
  vaultFiles: string[]
  phone: string
  tenantId?: string
}

const STATUS_OPTIONS = ['novo', 'ativo', 'lead_quente', 'convertido', 'inativo'] as const

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || '/api/backend')

function statusVariant(s: string | null): 'success' | 'accent' | 'danger' | 'muted' | 'cyan' {
  switch (s) {
    case 'lead_quente': return 'accent'
    case 'ativo': return 'success'
    case 'convertido': return 'cyan'
    case 'inativo': return 'danger'
    default: return 'muted'
  }
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * Perfil completo do lead com edição inline, timeline de mensagens e abas do vault.
 * @param props Dados iniciais do lead, mensagens e arquivos do vault.
 * @returns Perfil operacional do lead.
 */
export function LeadProfileClient({
  initialLead,
  initialMessages,
  vaultFiles,
  phone,
  tenantId = 'default'
}: LeadProfileClientProps): JSX.Element {
  const router = useRouter()
  const { toast } = useToast()

  // Estado do perfil editável
  const [lead, setLead] = useState<Lead>(initialLead)
  const [editing, setEditing] = useState<boolean>(false)
  const [saving, setSaving] = useState<boolean>(false)
  const [draft, setDraft] = useState({
    name: initialLead.name ?? '',
    email: initialLead.email ?? '',
    city: initialLead.city ?? '',
    status: initialLead.status ?? 'novo',
    tags: (initialLead.tags ?? []).join(', ')
  })

  // Estado das mensagens
  const [messages, setMessages] = useState<Message[]>(initialMessages)

  // Estado do vault
  const [vaultContent, setVaultContent] = useState<Record<string, string>>({})
  const [loadingVault, setLoadingVault] = useState<Record<string, boolean>>({})
  const [savingVault, setSavingVault] = useState<Record<string, boolean>>({})

  // Dialogs
  const [confirmHistory, setConfirmHistory] = useState(false)
  const [confirmLead, setConfirmLead] = useState(false)

  /** Carrega arquivo do vault sob demanda */
  const loadVaultFile = useCallback(async (filename: string) => {
    if (vaultContent[filename] !== undefined) return
    setLoadingVault(prev => ({ ...prev, [filename]: true }))
    try {
      const res = await fetch(
        `${API_BASE}/api/vault/${encodeURIComponent(phone)}/files/${encodeURIComponent(filename)}?tenant_id=${encodeURIComponent(tenantId)}`,
        { cache: 'no-store' }
      )
      if (!res.ok) throw new Error('Erro ao carregar arquivo')
      const data = await res.json() as { content: string }
      setVaultContent(prev => ({ ...prev, [filename]: data.content }))
    } catch {
      setVaultContent(prev => ({ ...prev, [filename]: '' }))
      toast({ title: `Erro ao carregar ${filename}`, variant: 'danger' })
    } finally {
      setLoadingVault(prev => ({ ...prev, [filename]: false }))
    }
  }, [phone, vaultContent, toast])

  /** Salva arquivo editado no vault */
  const saveVaultFile = useCallback(async (filename: string) => {
    setSavingVault(prev => ({ ...prev, [filename]: true }))
    try {
      const res = await fetch(
        `${API_BASE}/api/vault/${encodeURIComponent(phone)}/files/${encodeURIComponent(filename)}?tenant_id=${encodeURIComponent(tenantId)}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: vaultContent[filename] ?? '' })
        }
      )
      if (!res.ok) throw new Error()
      toast({ title: `${filename} salvo`, variant: 'success' })
    } catch {
      toast({ title: `Erro ao salvar ${filename}`, variant: 'danger' })
    } finally {
      setSavingVault(prev => ({ ...prev, [filename]: false }))
    }
  }, [phone, vaultContent, toast])

  /** Salva edições do perfil */
  async function saveLead() {
    setSaving(true)
    try {
      const body = {
        name: draft.name || null,
        email: draft.email || null,
        city: draft.city || null,
        status: draft.status,
        tags: draft.tags.split(',').map((t: string) => t.trim()).filter(Boolean)
      }
      const res = await fetch(
        `${API_BASE}/api/leads/${encodeURIComponent(phone)}?tenant_id=${encodeURIComponent(tenantId)}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      )
      if (!res.ok) throw new Error()
      const updated = await res.json() as Lead
      setLead(updated)
      setEditing(false)
      router.refresh()
      toast({ title: 'Perfil atualizado', variant: 'success' })
    } catch {
      toast({ title: 'Erro ao salvar perfil', variant: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  /** Apaga histórico */
  async function deleteHistory() {
    try {
      const res = await fetch(`${API_BASE}/api/leads/${encodeURIComponent(phone)}/history?tenant_id=${encodeURIComponent(tenantId)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setMessages([])
      setLead(prev => ({ ...prev, total_messages: 0 }))
      toast({ title: 'Histórico apagado', variant: 'success' })
      router.refresh()
    } catch {
      toast({ title: 'Erro ao apagar histórico', variant: 'danger' })
    }
  }

  /** Remove lead */
  async function deleteLead() {
    try {
      const res = await fetch(`${API_BASE}/api/leads/${encodeURIComponent(phone)}?tenant_id=${encodeURIComponent(tenantId)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast({ title: 'Lead removido', variant: 'success' })
      router.push('/leads')
      router.refresh()
    } catch {
      toast({ title: 'Erro ao remover lead', variant: 'danger' })
    }
  }

  // Arquivos do vault para as abas (padrão + extras)
  const vaultTabs = vaultFiles.length > 0 ? vaultFiles : ['memoria.md', 'historico.md', 'notas.md']

  return (
    <div className="space-y-6">
      {/* Breadcrumb + ações destrutivas */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Link href="/leads" className="hover:text-accent transition">Leads</Link>
          <span>/</span>
          <span className="text-ink">{lead.name ?? lead.phone}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setConfirmHistory(true)}
            className="focus-ring h-8 rounded-md border border-line bg-elevated px-3 text-xs text-muted hover:text-ink transition"
          >
            Apagar histórico
          </button>
          <button
            onClick={() => setConfirmLead(true)}
            className="focus-ring h-8 rounded-md border border-danger/30 bg-danger/10 px-3 text-xs text-danger hover:bg-danger/20 transition"
          >
            Remover lead
          </button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        {/* Perfil */}
        <div className="space-y-4">
          {/* Card de identidade */}
          <div className="rounded-xl bg-panel border border-line p-5 shadow-panel">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-full bg-elevated border border-line font-mono text-sm text-muted">
                  {(lead.name ?? lead.phone).slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="text-base font-semibold text-ink">{lead.name ?? 'Sem nome'}</div>
                  <div className="font-mono text-xs text-muted mt-0.5">{lead.phone}</div>
                </div>
              </div>
              <Badge variant={statusVariant(lead.status)}>{lead.status ?? 'novo'}</Badge>
            </div>

            {!editing ? (
              <>
                <div className="space-y-3 text-sm">
                  <ProfileRow label="Email" value={lead.email} />
                  <ProfileRow label="Cidade" value={lead.city} />
                  <ProfileRow label="Mensagens" value={String(lead.total_messages ?? 0)} />
                  <div className="flex items-start gap-3">
                    <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted w-20 shrink-0 pt-0.5">Tags</span>
                    <div className="flex flex-wrap gap-1">
                      {(lead.tags ?? []).length === 0 ? (
                        <span className="text-muted italic">—</span>
                      ) : (
                        (lead.tags ?? []).map(t => <Badge key={t} variant="muted">{t}</Badge>)
                      )}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setEditing(true)}
                  className="focus-ring mt-5 w-full h-9 rounded-md border border-line bg-elevated text-sm text-ink hover:border-muted transition"
                >
                  Editar perfil
                </button>
              </>
            ) : (
              <div className="space-y-3">
                <FormField label="Nome">
                  <input
                    value={draft.name}
                    onChange={e => setDraft(p => ({ ...p, name: e.target.value }))}
                    className="focus-ring w-full rounded-md border border-line bg-canvas px-3 h-8 text-sm text-ink outline-none focus:border-cyan transition"
                    placeholder="Nome do lead"
                  />
                </FormField>
                <FormField label="Email">
                  <input
                    type="email"
                    value={draft.email}
                    onChange={e => setDraft(p => ({ ...p, email: e.target.value }))}
                    className="focus-ring w-full rounded-md border border-line bg-canvas px-3 h-8 text-sm text-ink outline-none focus:border-cyan transition"
                    placeholder="email@exemplo.com"
                  />
                </FormField>
                <FormField label="Cidade">
                  <input
                    value={draft.city}
                    onChange={e => setDraft(p => ({ ...p, city: e.target.value }))}
                    className="focus-ring w-full rounded-md border border-line bg-canvas px-3 h-8 text-sm text-ink outline-none focus:border-cyan transition"
                    placeholder="São Paulo"
                  />
                </FormField>
                <FormField label="Status">
                  <select
                    value={draft.status}
                    onChange={e => setDraft(p => ({ ...p, status: e.target.value }))}
                    className="focus-ring w-full rounded-md border border-line bg-canvas px-3 h-8 text-sm text-ink outline-none focus:border-cyan transition"
                  >
                    {STATUS_OPTIONS.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </FormField>
                <FormField label="Tags">
                  <input
                    value={draft.tags}
                    onChange={e => setDraft(p => ({ ...p, tags: e.target.value }))}
                    className="focus-ring w-full rounded-md border border-line bg-canvas px-3 h-8 text-sm text-ink outline-none focus:border-cyan transition"
                    placeholder="tag1, tag2, tag3"
                  />
                  <span className="text-[10px] text-muted/60">Separadas por vírgula</span>
                </FormField>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={saveLead}
                    disabled={saving}
                    className="focus-ring flex-1 h-9 rounded-md bg-accent text-canvas text-sm font-semibold hover:bg-[#e7ef58] disabled:opacity-60 transition"
                  >
                    {saving ? 'Salvando…' : 'Salvar'}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="focus-ring h-9 rounded-md border border-line bg-elevated px-4 text-sm text-muted hover:text-ink transition"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Timeline + Vault */}
        <div className="space-y-5">
          {/* Timeline de mensagens */}
          <div className="rounded-xl bg-panel border border-line overflow-hidden shadow-panel">
            <div className="flex items-center justify-between px-5 py-4 border-b border-line">
              <h3 className="text-sm font-semibold text-ink">Histórico de mensagens</h3>
              <Badge variant="muted">{messages.length} msgs</Badge>
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-line/50 p-4 space-y-3">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center py-8 text-center text-muted">
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mb-2 opacity-40">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                  <span className="text-sm">Nenhuma mensagem registrada.</span>
                </div>
              ) : (
                messages.map(msg => (
                  <div
                    key={msg.id}
                    className={`flex gap-3 ${msg.role === 'assistant' ? 'flex-row-reverse' : ''}`}
                  >
                    <div className={`grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-[10px] ${
                      msg.role === 'user' ? 'bg-elevated border border-line text-muted' : 'bg-accent/20 border border-accent/30 text-accent'
                    }`}>
                      {msg.role === 'user' ? 'U' : 'AI'}
                    </div>
                    <div className={`flex-1 min-w-0 max-w-[85%] ${msg.role === 'assistant' ? 'items-end' : ''}`}>
                      <div className={`rounded-lg px-3 py-2 text-sm ${
                        msg.role === 'user'
                          ? 'bg-canvas border border-line text-ink'
                          : 'bg-accent/10 border border-accent/20 text-ink'
                      }`}>
                        {msg.content}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="font-mono text-[10px] text-muted">{formatTime(msg.created_at)}</span>
                        {msg.intent && <Badge variant="muted">{msg.intent}</Badge>}
                        {msg.tokens_used != null && (
                          <span className="font-mono text-[10px] text-muted/50">{msg.tokens_used}t</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Vault */}
          <div className="rounded-xl bg-panel border border-line overflow-hidden shadow-panel">
            <div className="px-5 py-4 border-b border-line">
              <h3 className="text-sm font-semibold text-ink">Vault</h3>
              <p className="mt-0.5 text-xs text-muted">Arquivos Markdown do lead. Compatível com Obsidian.</p>
            </div>

            <Tabs.Root
              defaultValue={vaultTabs[0] ?? 'memoria.md'}
              onValueChange={(v) => loadVaultFile(v)}
            >
              <Tabs.List className="flex border-b border-line px-4 pt-2">
                {vaultTabs.map(file => (
                  <Tabs.Trigger
                    key={file}
                    value={file}
                    onClick={() => loadVaultFile(file)}
                    className="relative -mb-px px-4 py-2.5 font-mono text-xs text-muted transition hover:text-ink data-[state=active]:text-accent data-[state=active]:after:absolute data-[state=active]:after:bottom-0 data-[state=active]:after:left-0 data-[state=active]:after:right-0 data-[state=active]:after:h-px data-[state=active]:after:bg-accent"
                  >
                    {file}
                  </Tabs.Trigger>
                ))}
              </Tabs.List>

              {vaultTabs.map(file => (
                <Tabs.Content key={file} value={file} className="p-4">
                  {loadingVault[file] ? (
                    <div className="flex items-center gap-2 py-8 text-muted text-sm">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                      </svg>
                      Carregando {file}…
                    </div>
                  ) : (
                    <>
                      <textarea
                        value={vaultContent[file] ?? ''}
                        onChange={e => setVaultContent(prev => ({ ...prev, [file]: e.target.value }))}
                        rows={14}
                        className="focus-ring w-full rounded-lg border border-line bg-canvas p-3 font-mono text-xs text-ink leading-relaxed resize-y outline-none focus:border-cyan transition placeholder:text-muted/40"
                        placeholder={`Conteúdo de ${file}…`}
                        spellCheck={false}
                      />
                      <div className="mt-3 flex justify-end">
                        <button
                          onClick={() => saveVaultFile(file)}
                          disabled={savingVault[file]}
                          className="focus-ring h-8 rounded-md bg-accent px-4 text-xs font-semibold text-canvas hover:bg-[#e7ef58] disabled:opacity-60 transition"
                        >
                          {savingVault[file] ? 'Salvando…' : 'Salvar ' + file}
                        </button>
                      </div>
                    </>
                  )}
                </Tabs.Content>
              ))}
            </Tabs.Root>
          </div>
        </div>
      </div>

      {/* Dialogs */}
      <ConfirmDialog
        open={confirmHistory}
        onOpenChange={setConfirmHistory}
        title="Apagar histórico de mensagens"
        description={`O histórico de ${lead.name ?? lead.phone} será apagado permanentemente. O perfil e o vault serão mantidos.`}
        confirmLabel="Sim, apagar histórico"
        onConfirm={deleteHistory}
      />
      <ConfirmDialog
        open={confirmLead}
        onOpenChange={setConfirmLead}
        title="Remover lead permanentemente"
        description={`${lead.name ?? lead.phone} e todos os dados, incluindo vault e mensagens, serão removidos. Esta ação é irreversível.`}
        confirmLabel="Sim, remover lead"
        onConfirm={deleteLead}
      />
    </div>
  )
}

/** Row de dado do perfil */
function ProfileRow({ label, value }: { label: string; value: string | null }): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted w-20 shrink-0 pt-0.5">{label}</span>
      <span className="text-ink truncate">{value ?? <span className="text-muted italic">—</span>}</span>
    </div>
  )
}

/** Wrapper de campo de formulário */
function FormField({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-1">
      <label className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted">{label}</label>
      {children}
    </div>
  )
}
