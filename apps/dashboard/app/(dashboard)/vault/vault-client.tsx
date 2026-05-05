'use client'
// vault-client.tsx — Explorador do Vault: árvore de pastas + editor inline
import { useState, useCallback } from 'react'
import { useToast } from '../../../components/ui/toast-provider'
import { Badge } from '../../../components/ui/badge'

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || '/api/backend')

interface VaultLead {
  phone: string
  folder: string
  path: string
  name: string
}

interface OpenFile {
  phone: string | null     // null = global
  filename: string
  content: string
  dirty: boolean
}

interface VaultClientProps {
  initialLeads: VaultLead[]
  globalFiles: string[]
}

const LEAD_FILES = ['memoria.md', 'historico.md', 'notas.md']
const GLOBAL_ICON = '⬡'
const FOLDER_ICON_OPEN = '▾'
const FOLDER_ICON_CLOSED = '▸'
const FILE_ICON = '◦'

/**
 * Explorador do Vault com árvore lateral e editor inline com highlight Markdown básico.
 * @param props Leads iniciais e arquivos globais.
 * @returns Interface explorador Vault.
 */
export function VaultClient({ initialLeads, globalFiles: globalFilesProp }: VaultClientProps): JSX.Element {
  const { toast } = useToast()

  // Defesas para garantir que nunca são undefined
  const leads = initialLeads ?? []
  const globalFiles = globalFilesProp ?? []

  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['_global']))
  const [openFile, setOpenFile] = useState<OpenFile | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  // Filtra leads pela busca
  const filtered = search.trim()
    ? leads.filter(l =>
        l.name.toLowerCase().includes(search.toLowerCase()) ||
        l.phone.includes(search)
      )
    : leads

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Abre arquivo de lead no editor */
  const openLeadFile = useCallback(async (phone: string, filename: string) => {
    if (openFile?.phone === phone && openFile?.filename === filename) return
    setLoading(true)
    try {
      const res = await fetch(
        `${API_BASE}/api/vault/${encodeURIComponent(phone)}/files/${encodeURIComponent(filename)}`,
        { cache: 'no-store' }
      )
      if (!res.ok) throw new Error()
      const data = await res.json() as { content: string }
      setOpenFile({ phone, filename, content: data.content, dirty: false })
    } catch {
      toast({ title: `Erro ao abrir ${filename}`, variant: 'danger' })
    } finally {
      setLoading(false)
    }
  }, [openFile, toast])

  /** Abre arquivo global no editor */
  const openGlobalFile = useCallback(async (filename: string) => {
    if (openFile?.phone === null && openFile?.filename === filename) return
    setLoading(true)
    try {
      const res = await fetch(
        `${API_BASE}/api/vault/_global/files/${encodeURIComponent(filename)}`,
        { cache: 'no-store' }
      )
      if (!res.ok) throw new Error()
      const data = await res.json() as { content: string }
      setOpenFile({ phone: null, filename, content: data.content, dirty: false })
    } catch {
      toast({ title: `Erro ao abrir ${filename}`, variant: 'danger' })
    } finally {
      setLoading(false)
    }
  }, [openFile, toast])

  /** Salva arquivo aberto */
  async function saveFile() {
    if (!openFile) return
    setSaving(true)
    try {
      const url = openFile.phone === null
        ? `${API_BASE}/api/vault/_global/files/${encodeURIComponent(openFile.filename)}`
        : `${API_BASE}/api/vault/${encodeURIComponent(openFile.phone)}/files/${encodeURIComponent(openFile.filename)}`

      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: openFile.content })
      })
      if (!res.ok) throw new Error()
      setOpenFile(prev => prev ? { ...prev, dirty: false } : null)
      toast({ title: `${openFile.filename} salvo`, variant: 'success' })
    } catch {
      toast({ title: `Erro ao salvar ${openFile.filename}`, variant: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  /** Download do arquivo como .md */
  function downloadFile() {
    if (!openFile) return
    const blob = new Blob([openFile.content], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = openFile.filename
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="font-mono text-xs uppercase tracking-[0.22em] text-accent">Memória</div>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Vault</h2>
        <p className="mt-1.5 text-sm text-muted">
          {leads.length} leads · {globalFiles.length} arquivos globais
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[300px_1fr]" style={{ minHeight: '70vh' }}>
        {/* Árvore lateral */}
        <div className="flex flex-col rounded-xl border border-line bg-panel shadow-panel overflow-hidden">
          {/* Busca */}
          <div className="p-3 border-b border-line">
            <div className="relative">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                type="search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar lead…"
                className="w-full rounded-md border border-line bg-canvas pl-8 pr-3 h-8 text-xs text-ink placeholder:text-muted outline-none focus:border-cyan transition"
              />
            </div>
          </div>

          {/* Árvore */}
          <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
            {/* Pasta _global */}
            <div>
              <button
                onClick={() => toggleExpand('_global')}
                className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-left hover:bg-elevated transition"
              >
                <span className="text-accent text-[11px]">{expanded.has('_global') ? FOLDER_ICON_OPEN : FOLDER_ICON_CLOSED}</span>
                <span className="font-mono text-xs text-accent">{GLOBAL_ICON} _global</span>
                <Badge variant="accent" className="ml-auto text-[9px]">global</Badge>
              </button>
              {expanded.has('_global') && (
                <div className="ml-4 mt-0.5 space-y-0.5">
                  {globalFiles.map(file => (
                    <button
                      key={file}
                      onClick={() => openGlobalFile(file)}
                      className={`flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-left hover:bg-elevated transition text-xs ${
                        openFile?.phone === null && openFile?.filename === file
                          ? 'bg-accent/10 text-accent'
                          : 'text-muted hover:text-ink'
                      }`}
                    >
                      <span className="opacity-40">{FILE_ICON}</span>
                      <span className="font-mono truncate">{file}</span>
                    </button>
                  ))}
                  {globalFiles.length === 0 && (
                    <span className="block px-2 py-1 text-[10px] text-muted/50 italic">
                      Reinicie a API para criar os arquivos globais
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-line my-1.5" />

            {/* Pasta de cada lead */}
            {filtered.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted/60">
                {search ? 'Nenhum lead encontrado' : 'Nenhum lead no vault ainda'}
              </div>
            ) : (
              filtered.map(lead => {
                const folderId = lead.phone
                const isOpen = expanded.has(folderId)
                const displayName = lead.name || lead.phone
                return (
                  <div key={lead.phone}>
                    <button
                      onClick={() => toggleExpand(folderId)}
                      className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-left hover:bg-elevated transition"
                    >
                      <span className="text-muted text-[11px]">{isOpen ? FOLDER_ICON_OPEN : FOLDER_ICON_CLOSED}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-mono text-xs text-ink truncate">{displayName}</div>
                        <div className="font-mono text-[10px] text-muted/60 truncate">{lead.phone}</div>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="ml-4 mt-0.5 space-y-0.5">
                        {LEAD_FILES.map(file => (
                          <button
                            key={file}
                            onClick={() => openLeadFile(lead.phone, file)}
                            className={`flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-left hover:bg-elevated transition text-xs ${
                              openFile?.phone === lead.phone && openFile?.filename === file
                                ? 'bg-accent/10 text-accent'
                                : 'text-muted hover:text-ink'
                            }`}
                          >
                            <span className="opacity-40">{FILE_ICON}</span>
                            <span className="font-mono truncate">{file}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>

          {/* Rodapé */}
          <div className="border-t border-line px-3 py-2 flex items-center justify-between">
            <span className="font-mono text-[10px] text-muted/60">{filtered.length} leads</span>
            <span className="font-mono text-[10px] text-muted/60">vault/</span>
          </div>
        </div>

        {/* Editor inline */}
        <div className="rounded-xl border border-line bg-panel shadow-panel overflow-hidden flex flex-col">
          {!openFile && !loading ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-muted p-8">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="opacity-30">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
                <polyline points="13 2 13 9 20 9"/>
              </svg>
              <div>
                <p className="text-sm">Selecione um arquivo na árvore</p>
                <p className="text-xs text-muted/60 mt-1">Clique em qualquer pasta para expandir e abrir um arquivo.</p>
              </div>
            </div>
          ) : loading ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-muted text-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
              </svg>
              Carregando…
            </div>
          ) : openFile && (
            <>
              {/* Toolbar do editor */}
              <div className="flex flex-col gap-3 border-b border-line bg-panel/80 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted">
                    {openFile.phone === null ? '_global' : openFile.phone}
                  </span>
                  <span className="text-muted/30">/</span>
                  <span className="min-w-0 break-all font-mono text-xs text-ink">{openFile.filename}</span>
                  {openFile.dirty && (
                    <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" title="Não salvo" />
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    onClick={downloadFile}
                    className="focus-ring h-7 rounded-md border border-line bg-elevated px-3 text-xs text-muted hover:text-ink transition inline-flex items-center gap-1.5"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Baixar
                  </button>
                  <button
                    onClick={() => setOpenFile(null)}
                    className="focus-ring h-7 rounded-md border border-line bg-elevated px-3 text-xs text-muted hover:text-ink transition"
                  >
                    Fechar
                  </button>
                  <button
                    onClick={saveFile}
                    disabled={saving || !openFile.dirty}
                    className="focus-ring h-7 rounded-md bg-accent px-3 text-xs font-semibold text-canvas hover:bg-[#e7ef58] disabled:opacity-50 transition"
                  >
                    {saving ? 'Salvando…' : 'Salvar'}
                  </button>
                </div>
              </div>

              {/* Área do editor */}
              <textarea
                value={openFile.content}
                onChange={e => setOpenFile(prev => prev ? { ...prev, content: e.target.value, dirty: true } : null)}
                spellCheck={false}
                className="flex-1 resize-none bg-canvas p-5 font-mono text-[12.5px] text-ink leading-relaxed outline-none focus:outline-none placeholder:text-muted/40"
                style={{ minHeight: '400px' }}
                placeholder={`# ${openFile.filename}\n\nConteúdo do arquivo…`}
              />

              {/* Status bar */}
              <div className="border-t border-line px-4 py-1.5 flex items-center justify-between bg-panel/50">
                <span className="font-mono text-[10px] text-muted/60">Markdown</span>
                <span className="font-mono text-[10px] text-muted/60 tabular-nums">
                  {openFile.content.length} chars · {openFile.content.split('\n').length} linhas
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
