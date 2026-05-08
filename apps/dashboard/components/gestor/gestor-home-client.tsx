'use client'
// gestor-home-client.tsx — Home interativa do painel do gestor
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ConversationMessage, type Lead } from '../../lib/api'
import { MessageSquare, Users, ShieldOff, Power, TrendingUp, Clock } from 'lucide-react'

interface Props {
  tenantId: string
  initialLeads: Lead[]
  initialMessages: ConversationMessage[]
  initialAutomationConfig: Record<string, unknown>
  initialBlacklistCount: number
}

function isBotEnabled(config: Record<string, unknown>): boolean {
  const v = config['automation_enabled'] ?? config['enabled']
  if (v === false || v === 'false' || v === 0) return false
  return true
}

export function GestorHomeClient({
  tenantId,
  initialLeads,
  initialMessages,
  initialAutomationConfig,
  initialBlacklistCount
}: Props): JSX.Element {
  const router = useRouter()
  const queryClient = useQueryClient()

  const automationQuery = useQuery({
    queryKey: ['gestor', tenantId, 'automation'],
    queryFn: () => api.configSection('automation', tenantId),
    initialData: { section: 'automation', config: initialAutomationConfig }
  })

  const leadsQuery = useQuery({
    queryKey: ['gestor', tenantId, 'leads'],
    queryFn: () => api.leads(tenantId),
    initialData: initialLeads
  })

  const convsQuery = useQuery({
    queryKey: ['gestor', tenantId, 'conversations'],
    queryFn: () => api.conversations(tenantId),
    initialData: { messages: initialMessages }
  })

  const botEnabled = isBotEnabled(automationQuery.data?.config ?? {})

  const toggleBotMutation = useMutation({
    mutationFn: () =>
      api.updateConfigSection('automation', { automation_enabled: !botEnabled }, tenantId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gestor', tenantId, 'automation'] })
    }
  })

  // KPIs
  const leads = leadsQuery.data ?? []
  const messages = convsQuery.data?.messages ?? []
  const today = new Date().toDateString()
  const messagesToday = messages.filter(
    (m) => m.created_at && new Date(m.created_at).toDateString() === today
  ).length
  const activeLeads = leads.filter((l) => l.status === 'ativo' || l.status === 'lead_quente').length

  // Últimas conversas (últimas 5 distintas por telefone)
  const seen = new Set<string>()
  const recentConvs: ConversationMessage[] = []
  for (const msg of [...messages].reverse()) {
    if (msg.lead_phone && !seen.has(msg.lead_phone)) {
      seen.add(msg.lead_phone)
      recentConvs.push(msg)
      if (recentConvs.length >= 5) break
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header com toggle do bot */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-white text-2xl font-semibold">Início</h1>
          <p className="text-white/40 text-sm mt-0.5">Visão geral do atendimento</p>
        </div>

        <button
          onClick={() => toggleBotMutation.mutate()}
          disabled={toggleBotMutation.isPending}
          className={`
            flex items-center gap-2.5 px-4 py-2 rounded-xl text-sm font-medium transition-all
            ${botEnabled
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30'
              : 'bg-white/8 text-white/50 border border-white/10 hover:bg-white/12'}
          `}
        >
          <div className={`w-2 h-2 rounded-full ${botEnabled ? 'bg-emerald-400' : 'bg-white/30'}`} />
          <Power size={14} />
          Bot {botEnabled ? 'ativo' : 'pausado'}
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { icon: MessageSquare, label: 'Mensagens hoje', value: messagesToday, color: 'text-blue-400' },
          { icon: Users, label: 'Leads ativos', value: activeLeads, color: 'text-purple-400' },
          { icon: TrendingUp, label: 'Total de leads', value: leads.length, color: 'text-emerald-400' },
          { icon: ShieldOff, label: 'Bloqueados', value: initialBlacklistCount, color: 'text-red-400' }
        ].map(({ icon: Icon, label, value, color }) => (
          <div
            key={label}
            className="bg-white/5 border border-white/8 rounded-2xl p-4 space-y-3"
          >
            <Icon size={18} className={color} />
            <div>
              <p className="text-white text-2xl font-semibold">{value}</p>
              <p className="text-white/40 text-xs mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Últimas conversas */}
      <div className="bg-white/5 border border-white/8 rounded-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
          <div className="flex items-center gap-2 text-white/70 text-sm font-medium">
            <Clock size={15} />
            Conversas recentes
          </div>
          <button
            onClick={() => router.push('/gestor/conversas')}
            className="text-white/40 text-xs hover:text-white/70 transition-colors"
          >
            Ver todas →
          </button>
        </div>

        {recentConvs.length === 0 ? (
          <div className="px-5 py-8 text-center text-white/25 text-sm">
            Nenhuma conversa ainda
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {recentConvs.map((msg) => (
              <button
                key={msg.lead_phone}
                onClick={() => router.push(`/gestor/conversas/${encodeURIComponent(msg.lead_phone!)}`)}
                className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-white/5 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 text-white/50 text-sm font-medium">
                  {(msg.lead_name ?? msg.lead_phone ?? '?').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm font-medium truncate">
                    {msg.lead_name ?? msg.lead_phone}
                  </p>
                  <p className="text-white/40 text-xs truncate mt-0.5">{msg.content ?? ''}</p>
                </div>
                {msg.created_at && (
                  <span className="text-white/25 text-xs flex-shrink-0">
                    {new Date(msg.created_at).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
