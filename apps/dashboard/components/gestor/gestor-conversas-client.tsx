'use client'
// gestor-conversas-client.tsx — Lista de conversas agrupadas por lead
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { api, type ConversationMessage, type Lead } from '../../lib/api'
import { Search, MessageSquare } from 'lucide-react'

interface Props {
  tenantId: string
  initialMessages: ConversationMessage[]
  initialLeads: Lead[]
}

interface ConvSummary {
  phone: string
  name: string | null
  lastMessage: string
  lastAt: string | null
  unread: boolean
}

function buildSummaries(messages: ConversationMessage[], leads: Lead[]): ConvSummary[] {
  const leadMap = new Map(leads.map((l) => [l.phone, l]))
  const byPhone = new Map<string, ConversationMessage[]>()
  for (const msg of messages) {
    if (!msg.lead_phone) continue
    const arr = byPhone.get(msg.lead_phone) ?? []
    arr.push(msg)
    byPhone.set(msg.lead_phone, arr)
  }
  return [...byPhone.entries()]
    .map(([phone, msgs]) => {
      const sorted = [...msgs].sort(
        (a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
      )
      const last = sorted[0]
      const lead = leadMap.get(phone)
      return {
        phone,
        name: lead?.name ?? last?.lead_name ?? null,
        lastMessage: last?.content ?? '',
        lastAt: last?.created_at ?? null,
        unread: last?.role === 'user'
      }
    })
    .sort((a, b) => new Date(b.lastAt ?? 0).getTime() - new Date(a.lastAt ?? 0).getTime())
}

export function GestorConversasClient({ tenantId, initialMessages, initialLeads }: Props): JSX.Element {
  const router = useRouter()
  const [search, setSearch] = useState('')

  const convsQuery = useQuery({
    queryKey: ['gestor', tenantId, 'conversations'],
    queryFn: () => api.conversations(tenantId),
    initialData: { messages: initialMessages },
    refetchInterval: 10000
  })
  const leadsQuery = useQuery({
    queryKey: ['gestor', tenantId, 'leads'],
    queryFn: () => api.leads(tenantId),
    initialData: initialLeads
  })

  const summaries = buildSummaries(
    convsQuery.data?.messages ?? [],
    leadsQuery.data ?? []
  )

  const filtered = search
    ? summaries.filter(
        (s) =>
          s.phone.includes(search) ||
          (s.name ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : summaries

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-5 border-b border-white/8">
        <h1 className="text-white text-xl font-semibold">Conversas</h1>
        <p className="text-white/40 text-sm mt-0.5">{summaries.length} contatos</p>
      </div>

      {/* Busca */}
      <div className="px-4 py-3 border-b border-white/8">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou telefone..."
            className="w-full bg-white/5 border border-white/8 rounded-xl pl-9 pr-4 py-2 text-white text-sm placeholder-white/25 focus:outline-none focus:border-white/20 transition-colors"
          />
        </div>
      </div>

      {/* Lista */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-white/25">
            <MessageSquare size={32} className="mb-3 opacity-50" />
            <p className="text-sm">Nenhuma conversa encontrada</p>
          </div>
        ) : (
          filtered.map((conv) => (
            <button
              key={conv.phone}
              onClick={() => router.push(`/gestor/conversas/${encodeURIComponent(conv.phone)}`)}
              className="w-full flex items-center gap-4 px-5 py-4 hover:bg-white/5 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 text-white/60 text-sm font-medium">
                {(conv.name ?? conv.phone).charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className={`text-sm truncate ${conv.unread ? 'text-white font-medium' : 'text-white/80'}`}>
                    {conv.name ?? conv.phone}
                  </p>
                  {conv.unread && <div className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />}
                </div>
                <p className="text-white/35 text-xs truncate mt-0.5">{conv.lastMessage}</p>
              </div>
              {conv.lastAt && (
                <span className="text-white/25 text-xs flex-shrink-0">
                  {new Date(conv.lastAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
