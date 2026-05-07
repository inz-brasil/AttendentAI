// home-client.tsx — Dashboard operacional com configs em tempo real e status do sistema
'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { ArrowRight, Circle, Settings2 } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { api, type Lead } from '../../lib/api'
import { useUiStore } from '../../lib/ui-store'

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

function statusVariant(status: string | null): 'success' | 'accent' | 'danger' | 'muted' | 'cyan' {
  if (status === 'lead_quente') return 'accent'
  if (status === 'ativo') return 'success'
  if (status === 'convertido') return 'cyan'
  if (status === 'inativo') return 'danger'
  return 'muted'
}

function isEnabled(value: unknown): boolean {
  return value === true || value === 'true' || value === '1'
}

/**
 * Componente client da Home com cache curto e atualização otimista.
 * @param props Dados iniciais buscados no servidor.
 * @returns Dashboard principal.
 */
export function HomeClient({ initialData }: HomeClientProps): JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const debugMode = useUiStore((state) => state.debugMode)
  const [optimisticAutomation, setOptimisticAutomation] = useState<boolean | null>(null)

  const leadsQuery = useQuery({
    queryKey: ['home', 'leads'],
    queryFn: api.leads,
    initialData: initialData.leads
  })
  const healthQuery = useQuery({
    queryKey: ['home', 'health'],
    queryFn: api.health,
    initialData: initialData.health ?? undefined
  })
  const automationQuery = useQuery({
    queryKey: ['config', 'automation'],
    queryFn: () => api.configSection('automation')
  })
  const queueQuery = useQuery({
    queryKey: ['queue', 'status'],
    queryFn: api.queueStatus,
    retry: false
  })
  const wacliQuery = useQuery({
    queryKey: ['wacli', 'status'],
    queryFn: api.getWacliStatus,
    retry: false
  })
  const evolutionQuery = useQuery({
    queryKey: ['config', 'evolution'],
    queryFn: () => api.configSection('evolution')
  })
  const businessQuery = useQuery({
    queryKey: ['config', 'business'],
    queryFn: () => api.configSection('business')
  })

  const automationMutation = useMutation({
    mutationFn: (enabled: boolean) => api.updateConfigSection('automation', { enabled }),
    onMutate: (enabled) => {
      setOptimisticAutomation(enabled)
    },
    onSettled: async () => {
      setOptimisticAutomation(null)
      await queryClient.invalidateQueries({ queryKey: ['config', 'automation'] })
    }
  })

  const leads = leadsQuery.data ?? []
  const health = healthQuery.data ?? null
  const automationConfig = automationQuery.data?.config ?? {}
  const botEnabled = optimisticAutomation ?? isEnabled(automationConfig.enabled)
  const scheduleEnabled = isEnabled(automationConfig.schedule_enabled)
  const apiOk = health?.status === 'ok'
  const evolutionOk = Boolean((evolutionQuery.data?.config.status as { configured?: boolean } | undefined)?.configured)
  const wacliOk = Boolean(wacliQuery.data?.doctor?.data?.authenticated)
  const bullmqOk = !queueQuery.isError
  const totalMessages = leads.reduce((sum, lead) => sum + (lead.total_messages ?? 0), 0)
  const recentLeads = useMemo(() => [...leads]
    .sort((a, b) => new Date(b.last_message_at ?? 0).getTime() - new Date(a.last_message_at ?? 0).getTime())
    .slice(0, 8), [leads])

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.18em] text-accent">{t('home.eyebrow')}</div>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{t('home.title')}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{t('home.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={() => void Promise.all([
            leadsQuery.refetch(),
            healthQuery.refetch(),
            queueQuery.refetch(),
            wacliQuery.refetch(),
            evolutionQuery.refetch(),
            businessQuery.refetch()
          ])}
          className="focus-ring min-h-11 rounded-xl border border-line bg-panel px-4 text-sm text-ink shadow-panel"
        >
          {t('common.refresh')}
        </button>
      </section>

      <section className="surface rounded-2xl p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Settings2 className="h-4 w-4 text-muted" strokeWidth={1.8} />
              {t('home.initialSetup')}
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              {businessQuery.data?.config.company_name
                ? t('home.initialSetupReady', { company: String(businessQuery.data.config.company_name) })
                : t('home.initialSetupSubtitle')}
            </p>
          </div>
          <Link href="/settings" className="focus-ring inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-line bg-elevated px-4 text-sm text-ink hover:text-accent">
            {t('home.startSetup')}
            <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <motion.div layout className="surface rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted">{t('home.botToggle')}</span>
            <button
              type="button"
              onClick={() => automationMutation.mutate(!botEnabled)}
              className={[
                'focus-ring relative h-11 w-[74px] rounded-full border transition',
                botEnabled ? 'border-accent bg-accent' : 'border-line bg-elevated'
              ].join(' ')}
              aria-pressed={botEnabled}
            >
              <span
                className={[
                  'absolute top-1 grid h-9 w-9 place-items-center rounded-full bg-panel text-xs shadow-panel transition-transform',
                  botEnabled ? 'translate-x-[31px]' : 'translate-x-1'
                ].join(' ')}
              >
                {botEnabled ? '✓' : '–'}
              </span>
            </button>
          </div>
          <div className="mt-5 text-2xl font-semibold">{botEnabled ? t('common.enabled') : t('common.disabled')}</div>
        </motion.div>

        <MetricCard label={t('home.schedule')} value={scheduleEnabled ? t('home.insideSchedule') : t('home.outsideSchedule')} tone={scheduleEnabled ? 'text-success' : 'text-warning'} />
        <MetricCard label={t('home.messagesToday')} value={totalMessages.toLocaleString()} tone="text-ink" />
        <MetricCard label={t('home.systemStatus')} value={apiOk ? t('common.online') : t('common.offline')} tone={apiOk ? 'text-success' : 'text-danger'} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="surface overflow-hidden rounded-2xl">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <h3 className="text-sm font-semibold">{t('home.latestConversations')}</h3>
            <Link href="/leads" className="focus-ring rounded-lg px-3 py-2 text-sm text-muted hover:bg-elevated hover:text-ink">
              {t('home.openClients')}
            </Link>
          </div>
          {recentLeads.length === 0 ? (
            <div className="p-8 text-sm text-muted">{t('home.noConversations')}</div>
          ) : (
            <div className="divide-y divide-line">
              {recentLeads.map((lead) => (
                <Link
                  key={lead.phone}
                  href={`/leads/${encodeURIComponent(lead.phone)}`}
                  className="flex min-h-[72px] items-center gap-4 px-5 py-3 transition hover:bg-elevated"
                >
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-elevated text-sm font-semibold">
                    {(lead.name ?? lead.phone).slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{lead.name ?? lead.phone}</div>
                    <div className="mt-1 truncate font-mono text-xs text-muted">{lead.phone}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant={statusVariant(lead.status)}>{lead.status ?? 'novo'}</Badge>
                    <span className="font-mono text-xs text-muted">{lead.total_messages ?? 0}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="surface rounded-2xl p-5">
            <h3 className="text-sm font-semibold">{t('home.systemStatus')}</h3>
            <div className="mt-4 space-y-3">
              <StatusLine label={t('home.statusEvolution')} ok={evolutionOk} />
              <StatusLine label={t('home.statusWacli')} ok={wacliOk} />
              <StatusLine label={t('home.statusBullmq')} ok={bullmqOk} />
            </div>
          </div>
          <div className="surface rounded-2xl p-5">
            <h3 className="text-sm font-semibold">{t('home.shortcuts')}</h3>
            <div className="mt-4 grid gap-2">
              {debugMode && <Shortcut href="/debug" label={t('home.openDebug')} />}
              <Shortcut href="/settings" label={t('home.testEvolution')} />
              <Shortcut href="/leads" label={t('home.openClients')} />
            </div>
          </div>
          {debugMode && (
            <div className="surface rounded-2xl p-5">
              <h3 className="text-sm font-semibold">{t('debug.liveLogs')}</h3>
              <pre className="mt-4 max-h-64 overflow-auto rounded-xl bg-elevated p-3 font-mono text-xs text-muted">
                {JSON.stringify({
                  automation: automationConfig,
                  evolution: evolutionQuery.data?.config ?? null,
                  queue: queueQuery.data?.counts ?? null,
                  wacli: wacliQuery.data?.doctor?.data ?? null
                }, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: string }): JSX.Element {
  return (
    <div className="surface rounded-2xl p-5">
      <div className="text-sm text-muted">{label}</div>
      <div className={`mt-5 text-2xl font-semibold tracking-tight ${tone}`}>{value}</div>
    </div>
  )
}

function StatusLine({ label, ok }: { label: string; ok: boolean }): JSX.Element {
  return (
    <div className="flex min-h-11 items-center justify-between rounded-xl bg-elevated px-3">
      <span className="text-sm text-muted">{label}</span>
      <Circle className={ok ? 'h-2.5 w-2.5 fill-success text-success' : 'h-2.5 w-2.5 fill-danger text-danger'} />
    </div>
  )
}

function Shortcut({ href, label }: { href: string; label: string }): JSX.Element {
  return (
    <Link href={href} className="focus-ring flex min-h-11 items-center justify-between rounded-xl bg-elevated px-3 text-sm hover:text-accent">
      <span>{label}</span>
      <span aria-hidden="true">›</span>
    </Link>
  )
}
