'use client'
// gestor-leads-client.tsx — CRM de leads do painel do gestor
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { api, type Lead } from '../../lib/api'
import { Search, Users, Flame, Snowflake, Thermometer } from 'lucide-react'

interface Props {
  tenantId: string
  initialLeads: Lead[]
}

type TempFilter = 'all' | 'lead_quente' | 'ativo' | 'novo' | 'inativo' | 'convertido'

const tempColors: Record<string, string> = {
  lead_quente: 'text-red-400',
  ativo: 'text-emerald-400',
  novo: 'text-blue-400',
  convertido: 'text-purple-400',
  inativo: 'text-white/30'
}

const tempLabels: Record<string, string> = {
  lead_quente: 'Quente',
  ativo: 'Ativo',
  novo: 'Novo',
  convertido: 'Convertido',
  inativo: 'Inativo'
}

export function GestorLeadsClient({ tenantId, initialLeads }: Props): JSX.Element {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<TempFilter>('all')

  const leadsQuery = useQuery({
    queryKey: ['gestor', tenantId, 'leads'],
    queryFn: () => api.leads(tenantId),
    initialData: initialLeads
  })

  const leads = leadsQuery.data ?? []

  const filtered = leads.filter((l) => {
    const matchSearch =
      !search ||
      (l.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
      l.phone.includes(search)
    const matchFilter = filter === 'all' || l.status === filter
    return matchSearch && matchFilter
  })

  const filterButtons: { value: TempFilter; label: string }[] = [
    { value: 'all', label: 'Todos' },
    { value: 'lead_quente', label: 'Quente' },
    { value: 'ativo', label: 'Ativo' },
    { value: 'novo', label: 'Novo' },
    { value: 'convertido', label: 'Convertido' },
    { value: 'inativo', label: 'Inativo' }
  ]

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-5 border-b border-white/8">
        <h1 className="text-white text-xl font-semibold">Leads</h1>
        <p className="text-white/40 text-sm mt-0.5">{leads.length} contatos</p>
      </div>

      {/* Busca */}
      <div className="px-4 pt-3 pb-2 border-b border-white/8 space-y-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou telefone..."
            className="w-full bg-white/5 border border-white/8 rounded-xl pl-9 pr-4 py-2 text-white text-sm placeholder-white/25 focus:outline-none focus:border-white/20 transition-colors"
          />
        </div>
        {/* Filtro de status */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {filterButtons.map((btn) => (
            <button
              key={btn.value}
              onClick={() => setFilter(btn.value)}
              className={`
                flex-shrink-0 px-3 py-1 rounded-lg text-xs font-medium transition-colors
                ${filter === btn.value
                  ? 'bg-white/15 text-white'
                  : 'bg-white/5 text-white/40 hover:text-white/70'}
              `}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-white/25">
            <Users size={32} className="mb-3 opacity-50" />
            <p className="text-sm">Nenhum lead encontrado</p>
          </div>
        ) : (
          filtered.map((lead) => (
            <button
              key={lead.phone}
              onClick={() => router.push(`/gestor/leads/${encodeURIComponent(lead.phone)}`)}
              className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-white/5 transition-colors text-left"
            >
              <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-white/60 text-sm font-medium flex-shrink-0">
                {(lead.name ?? lead.phone).charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm font-medium truncate">{lead.name ?? lead.phone}</p>
                <p className="text-white/35 text-xs truncate">{lead.phone}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {lead.tags && lead.tags.length > 0 && (
                  <span className="bg-white/8 text-white/50 text-xs px-2 py-0.5 rounded-full">
                    {lead.tags[0]}
                    {lead.tags.length > 1 ? ` +${lead.tags.length - 1}` : ''}
                  </span>
                )}
                {lead.status && (
                  <span className={`text-xs font-medium ${tempColors[lead.status] ?? 'text-white/30'}`}>
                    {tempLabels[lead.status] ?? lead.status}
                  </span>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
