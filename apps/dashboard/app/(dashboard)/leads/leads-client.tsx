'use client'
// leads-client.tsx — Tabela de leads com busca debounced, filtro de status, paginação e ações rápidas
import { useState, useMemo, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import * as Select from '@radix-ui/react-select'
import { useTranslation } from 'react-i18next'
import { Badge } from '../../../components/ui/badge'
import { ConfirmDialog } from '../../../components/ui/confirm-dialog'
import { useToast } from '../../../components/ui/toast-provider'
import type { Lead } from '../../../lib/api'

const PAGE_SIZE = 20

const STATUS_OPTIONS = [
  { value: '__all__', label: 'Todos os status' },
  { value: '__admin__', label: 'Admin/debug' },
  { value: 'novo', label: 'Novo' },
  { value: 'ativo', label: 'Ativo' },
  { value: 'lead_quente', label: 'Lead quente' },
  { value: 'convertido', label: 'Convertido' },
  { value: 'inativo', label: 'Inativo' }
]

type StatusFilter = '__all__' | '__admin__' | 'novo' | 'ativo' | 'lead_quente' | 'convertido' | 'inativo'

function statusVariant(status: string | null): 'success' | 'accent' | 'danger' | 'muted' | 'cyan' {
  switch (status) {
    case 'lead_quente': return 'accent'
    case 'ativo': return 'success'
    case 'convertido': return 'cyan'
    case 'inativo': return 'danger'
    default: return 'muted'
  }
}

interface ConfirmState {
  open: boolean
  type: 'history' | 'lead' | null
  phone: string | null
  name: string | null
}


function useDebouncedSearch(initial: string, delay = 120) {
  const [raw, setRaw] = useState(initial)
  const [debounced, setDebounced] = useState(initial)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(raw), delay)
    return () => clearTimeout(timer)
  }, [delay, raw])

  return { raw, debounced, onChange: setRaw }
}

/**
 * Tabela de leads interativa com busca, filtro e ações.
 * @param props Lista inicial de leads.
 * @returns Tabela operacional de leads.
 */
export function LeadsClient({ initialLeads }: { initialLeads: Lead[] }): JSX.Element {
  const { t } = useTranslation()
  const router = useRouter()
  const { toast } = useToast()

  const { raw: searchRaw, debounced: search, onChange: setSearch } = useDebouncedSearch('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('__all__')
  const [page, setPage] = useState(0)
  const [leads, setLeads] = useState(initialLeads)
  const [confirm, setConfirm] = useState<ConfirmState>({ open: false, type: null, phone: null, name: null })

  useEffect(() => {
    setLeads(initialLeads)
  }, [initialLeads])

  // Filtragem client-side
  const filtered = useMemo(() => {
    let result = leads
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(l =>
        l.phone.includes(q) || (l.name ?? '').toLowerCase().includes(q)
      )
    }
    if (statusFilter === '__admin__') {
      result = result.filter(l => (l.tags ?? []).includes('admin'))
    } else if (statusFilter !== '__all__') {
      result = result.filter(l => (l.status ?? 'novo') === statusFilter)
    }
    return result
  }, [leads, search, statusFilter])

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  // Reset página ao mudar filtro
  const handleSearch = useCallback((v: string) => {
    setSearch(v); setPage(0)
  }, [setSearch])

  const handleStatusFilter = useCallback((v: string) => {
    setStatusFilter(v as StatusFilter); setPage(0)
  }, [])

  /** Apaga histórico de mensagens do lead */
  async function handleDeleteHistory(phone: string) {
    try {
      const res = await fetch(
        `${(process.env.NEXT_PUBLIC_API_URL || '/api/backend')}/api/leads/${encodeURIComponent(phone)}/history`,
        { method: 'DELETE' }
      )
      if (!res.ok) throw new Error('Erro ao apagar histórico')
      setLeads(prev => prev.map(lead =>
        lead.phone === phone ? { ...lead, total_messages: 0 } : lead
      ))
      toast({ title: 'Histórico apagado', variant: 'success' })
      router.refresh()
    } catch {
      toast({ title: 'Erro ao apagar histórico', variant: 'danger' })
    }
  }

  /** Remove lead completamente */
  async function handleDeleteLead(phone: string) {
    try {
      const res = await fetch(
        `${(process.env.NEXT_PUBLIC_API_URL || '/api/backend')}/api/leads/${encodeURIComponent(phone)}`,
        { method: 'DELETE' }
      )
      if (!res.ok) throw new Error('Erro ao remover lead')
      setLeads(prev => prev.filter(l => l.phone !== phone))
      router.refresh()
      toast({ title: 'Lead removido', variant: 'success' })
    } catch {
      toast({ title: 'Erro ao remover lead', variant: 'danger' })
    }
  }

  function openConfirm(type: 'history' | 'lead', lead: Lead) {
    setConfirm({ open: true, type, phone: lead.phone, name: lead.name })
  }

  function handleConfirm() {
    if (!confirm.phone || !confirm.type) return
    if (confirm.type === 'history') handleDeleteHistory(confirm.phone)
    else handleDeleteLead(confirm.phone)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.22em] text-accent">{t('clients.eyebrow')}</div>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{t('clients.title')}</h2>
          <p className="mt-1.5 text-sm text-muted">
            {t('clients.subtitle')}
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Busca */}
        <div className="relative flex-1">
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
          >
            <circle cx="11" cy="11" r="8"/>
            <path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="search"
            value={searchRaw}
            onChange={e => handleSearch(e.target.value)}
            placeholder={t('clients.searchPlaceholder')}
            className="focus-ring w-full rounded-lg border border-line bg-panel pl-9 pr-4 h-9 text-sm text-ink placeholder:text-muted transition hover:border-muted focus:border-cyan outline-none"
          />
        </div>

        {/* Filtro de status (Radix Select) */}
        <Select.Root value={statusFilter} onValueChange={handleStatusFilter}>
          <Select.Trigger
            id="status-filter"
            className="focus-ring flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-line bg-panel px-3 text-sm text-ink transition hover:border-muted sm:w-48"
          >
            <Select.Value />
            <Select.Icon>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m6 9 6 6 6-6"/>
              </svg>
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content
              className="z-50 min-w-[192px] overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
              position="popper"
              sideOffset={4}
            >
              <Select.Viewport className="p-1">
                {STATUS_OPTIONS.map(opt => (
                  <Select.Item
                    key={opt.value}
                    value={opt.value}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-ink outline-none hover:bg-elevated data-[highlighted]:bg-elevated"
                  >
                    <Select.ItemText>{opt.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Viewport>
            </Select.Content>
          </Select.Portal>
        </Select.Root>
      </div>

      {/* Tabela */}
      <div className="rounded-xl border border-line overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-panel/80">
                <th className="px-4 py-3 text-left font-mono text-[11px] uppercase tracking-[0.15em] text-muted">{t('clients.phone')}</th>
                <th className="px-4 py-3 text-left font-mono text-[11px] uppercase tracking-[0.15em] text-muted">{t('clients.name')}</th>
                <th className="hidden px-4 py-3 text-left font-mono text-[11px] uppercase tracking-[0.15em] text-muted md:table-cell">{t('clients.messages')}</th>
                <th className="hidden px-4 py-3 text-left font-mono text-[11px] uppercase tracking-[0.15em] text-muted lg:table-cell">Tags</th>
                <th className="px-4 py-3 text-left font-mono text-[11px] uppercase tracking-[0.15em] text-muted">{t('clients.status')}</th>
                <th className="px-4 py-3 text-right font-mono text-[11px] uppercase tracking-[0.15em] text-muted">{t('clients.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-canvas">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-3 text-muted">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                        <circle cx="9" cy="7" r="4"/>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
                      </svg>
                      <span className="text-sm">{t('common.empty')}</span>
                    </div>
                  </td>
                </tr>
              ) : (
                paginated.map(lead => (
                  <tr key={lead.phone} className="group hover:bg-elevated transition">
                    <td className="px-4 py-3.5">
                      <span className="font-mono text-xs text-muted">{lead.phone}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/leads/${encodeURIComponent(lead.phone)}`}
                        className="font-medium text-ink hover:text-accent transition truncate max-w-[180px] block"
                      >
                        {lead.name ?? <span className="text-muted italic">Sem nome</span>}
                      </Link>
                    </td>
                    <td className="hidden px-4 py-3.5 md:table-cell">
                      <span className="font-mono text-xs tabular-nums text-muted">{lead.total_messages ?? 0}</span>
                    </td>
                    <td className="hidden px-4 py-3.5 lg:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {(lead.tags ?? []).slice(0, 3).map((tag: string) => (
                          <Badge key={tag} variant="muted">{tag}</Badge>
                        ))}
                        {(lead.tags ?? []).length > 3 && (
                          <span className="text-[10px] text-muted">+{(lead.tags ?? []).length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge variant={statusVariant(lead.status)}>
                        {lead.status ?? 'novo'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex flex-wrap items-center justify-end gap-2 opacity-100 transition sm:flex-nowrap lg:opacity-0 lg:group-hover:opacity-100">
                        <Link
                          href={`/leads/${encodeURIComponent(lead.phone)}`}
                          className="focus-ring rounded-md border border-line bg-elevated px-3 h-7 inline-flex items-center text-xs text-ink hover:border-muted transition"
                        >
                          {t('clients.profile')}
                        </Link>
                        <button
                          onClick={() => openConfirm('history', lead)}
                          className="focus-ring rounded-md border border-line bg-elevated px-3 h-7 text-xs text-muted hover:text-ink hover:border-muted transition"
                          title="Apagar histórico de mensagens"
                        >
                          {t('clients.transcript')}
                        </button>
                        <button
                          onClick={() => openConfirm('lead', lead)}
                          className="focus-ring rounded-md border border-danger/30 bg-danger/10 px-3 h-7 text-xs text-danger hover:bg-danger/20 transition"
                          title="Remover lead permanentemente"
                        >
                          {t('common.remove')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-line bg-panel/50 px-4 py-3">
            <span className="font-mono text-xs text-muted">
              Página {page + 1} de {totalPages} · {filtered.length} leads
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="focus-ring h-7 rounded-md border border-line bg-elevated px-3 text-xs text-muted transition hover:text-ink disabled:opacity-40"
              >
                ← Anterior
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="focus-ring h-7 rounded-md border border-line bg-elevated px-3 text-xs text-muted transition hover:text-ink disabled:opacity-40"
              >
                Próxima →
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Modal de confirmação */}
      <ConfirmDialog
        open={confirm.open}
        onOpenChange={(open: boolean) => setConfirm(prev => ({ ...prev, open }))}
        title={confirm.type === 'lead' ? 'Remover lead permanentemente' : 'Apagar histórico de mensagens'}
        description={
          confirm.type === 'lead'
            ? `Esta ação removerá ${confirm.name ?? confirm.phone} e todos os dados do vault. Irreversível.`
            : `O histórico de mensagens de ${confirm.name ?? confirm.phone} será apagado. O perfil e as notas serão mantidos.`
        }
        confirmLabel={confirm.type === 'lead' ? 'Sim, remover lead' : 'Sim, apagar histórico'}
        onConfirm={handleConfirm}
      />
    </div>
  )
}
