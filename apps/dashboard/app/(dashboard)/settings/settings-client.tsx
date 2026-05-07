// settings-client.tsx — Configurações, onboarding, aparência e integrações editáveis em tempo real
'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bot,
  Building2,
  CheckCircle2,
  Clipboard,
  Database,
  Eye,
  Globe2,
  KeyRound,
  Languages,
  Moon,
  Network,
  PlugZap,
  RefreshCw,
  Settings2,
  Shield,
  Smartphone,
  Sun,
  TerminalSquare,
  Workflow
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CalendarStatus, Setting, WacliProcessStatus } from '../../../lib/api'
import { api } from '../../../lib/api'
import { languages } from '../../../lib/i18n'
import { useUiStore, type LanguageCode, type ThemeMode } from '../../../lib/ui-store'

const configSections = [
  'business',
  'tenants',
  'evolution_instances',
  'evolution',
  'wacli',
  'automation',
  'queue',
  'audio',
  'reactions',
  'presence'
] as const

type ConfigSectionName = typeof configSections[number]
type SettingsTab = 'onboarding' | 'appearance' | 'business' | 'tenants' | ConfigSectionName | 'blacklist'

interface SettingsClientProps {
  initialSettings: Setting[]
  initialCalendarStatus: CalendarStatus
}

interface SettingsNavItem {
  id: SettingsTab
  icon: typeof Settings2
}

const settingsNav: SettingsNavItem[] = [
  { id: 'onboarding', icon: Workflow },
  { id: 'appearance', icon: Eye },
  { id: 'business', icon: Building2 },
  { id: 'tenants', icon: Network },
  { id: 'evolution_instances', icon: PlugZap },
  { id: 'evolution', icon: Smartphone },
  { id: 'wacli', icon: TerminalSquare },
  { id: 'automation', icon: Bot },
  { id: 'queue', icon: Database },
  { id: 'audio', icon: Globe2 },
  { id: 'reactions', icon: CheckCircle2 },
  { id: 'presence', icon: RefreshCw },
  { id: 'blacklist', icon: Shield }
]

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

function parseValue(value: string): string | boolean | number | string[] {
  const trimmed = value.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) return parsed
    } catch {
      return value
    }
  }
  return value
}

function isConfigSection(tab: SettingsTab): tab is ConfigSectionName {
  return (configSections as readonly string[]).includes(tab)
}

/**
 * Tela de configurações com onboarding, tenants, integrações e preferências visuais.
 * @param props Dados legados mantidos para compatibilidade da página.
 * @returns UI de configuração.
 */
export function SettingsClient(_props: SettingsClientProps): JSX.Element {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const [selectedTab, setSelectedTab] = useState<SettingsTab>('onboarding')
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({})
  const [blacklistPhone, setBlacklistPhone] = useState('')
  const [blacklistReason, setBlacklistReason] = useState('')
  const [testNumber, setTestNumber] = useState('')
  const [testText, setTestText] = useState('')

  const theme = useUiStore((state) => state.theme)
  const language = useUiStore((state) => state.language)
  const debugMode = useUiStore((state) => state.debugMode)
  const setTheme = useUiStore((state) => state.setTheme)
  const setLanguage = useUiStore((state) => state.setLanguage)
  const setDebugMode = useUiStore((state) => state.setDebugMode)

  const configQueries = useQueries({
    queries: configSections.map((section) => ({
      queryKey: ['config', section],
      queryFn: () => api.configSection(section)
    }))
  })
  const blacklistQuery = useQuery({
    queryKey: ['blacklist'],
    queryFn: () => api.blacklist()
  })
  const wacliQuery = useQuery({
    queryKey: ['wacli', 'status'],
    queryFn: api.getWacliStatus,
    retry: false
  })
  const wacliAuthQuery = useQuery({
    queryKey: ['wacli', 'auth-output'],
    queryFn: api.getWacliAuthOutput,
    enabled: selectedTab === 'wacli',
    refetchInterval: selectedTab === 'wacli' && wacliQuery.data?.auth_running ? 1500 : false
  })
  const wacliSyncQuery = useQuery({
    queryKey: ['wacli', 'sync-output'],
    queryFn: api.getWacliSyncOutput,
    enabled: selectedTab === 'wacli',
    refetchInterval: selectedTab === 'wacli' && wacliQuery.data?.sync_running ? 1500 : false
  })

  const configs = useMemo(() => {
    const output: Partial<Record<ConfigSectionName, Record<string, unknown>>> = {}
    configSections.forEach((section, index) => {
      output[section] = configQueries[index]?.data?.config ?? {}
    })
    return output
  }, [configQueries])

  const updateConfigMutation = useMutation({
    mutationFn: (payload: { section: ConfigSectionName; data: Record<string, unknown> }) =>
      api.updateConfigSection(payload.section, payload.data),
    onSuccess: async (_, variables) => {
      setDrafts((current) => ({ ...current, [variables.section]: {} }))
      await queryClient.invalidateQueries({ queryKey: ['config', variables.section] })
    }
  })
  const addBlacklistMutation = useMutation({
    mutationFn: () => api.addBlacklist({ phone: blacklistPhone, reason: blacklistReason || 'manual_admin', duration_minutes: null }),
    onSuccess: async () => {
      setBlacklistPhone('')
      setBlacklistReason('')
      await queryClient.invalidateQueries({ queryKey: ['blacklist'] })
    }
  })
  const removeBlacklistMutation = useMutation({
    mutationFn: (phone: string) => api.removeBlacklist(phone),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['blacklist'] })
  })
  const testSendMutation = useMutation({
    mutationFn: () => api.testEvolutionSend({ number: testNumber, text: testText })
  })
  const wacliActionMutation = useMutation({
    mutationFn: (action: 'enable' | 'disable' | 'auth_start' | 'auth_stop' | 'sync_start' | 'sync_stop') => runWacliAction(action),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['wacli', 'status'] }),
        queryClient.invalidateQueries({ queryKey: ['wacli', 'auth-output'] }),
        queryClient.invalidateQueries({ queryKey: ['wacli', 'sync-output'] })
      ])
    }
  })

  const businessConfig = configs.business ?? {}
  const webhookUrl = buildWebhookUrl(String(businessConfig.tenant_id ?? 'default'))

  function updateDraft(section: ConfigSectionName, key: string, value: string): void {
    setDrafts((current) => ({
      ...current,
      [section]: {
        ...(current[section] ?? {}),
        [key]: value
      }
    }))
  }

  function saveSection(section: ConfigSectionName): void {
    const draft = drafts[section] ?? {}
    const data = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, parseValue(value)]))
    updateConfigMutation.mutate({ section, data })
  }

  function changeLanguage(value: string): void {
    const nextLanguage = value as LanguageCode
    setLanguage(nextLanguage)
    void i18n.changeLanguage(nextLanguage)
  }

  function changeTheme(value: string): void {
    setTheme(value as ThemeMode)
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-accent">{t('settings.eyebrow')}</div>
        <h2 className="mt-2 text-3xl font-semibold">{t('settings.title')}</h2>
        <p className="mt-2 text-sm text-muted">{t('settings.subtitle')}</p>
      </section>

      <section className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="surface h-fit rounded-2xl p-2">
          {settingsNav.map((item) => {
            const active = selectedTab === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedTab(item.id)}
                className={[
                  'focus-ring mb-1 flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm transition',
                  active ? 'bg-elevated text-ink' : 'text-muted hover:bg-elevated hover:text-ink'
                ].join(' ')}
              >
                <item.icon className="h-4 w-4" strokeWidth={1.8} />
                <span>{t(`settings.tabs.${item.id}`)}</span>
              </button>
            )
          })}
        </aside>

        <div className="min-w-0">
          {selectedTab === 'onboarding' && (
            <OnboardingPanel
              businessConfig={businessConfig}
              webhookUrl={webhookUrl}
              onStart={() => setSelectedTab('business')}
            />
          )}

          {selectedTab === 'appearance' && (
            <div className="surface rounded-2xl p-5">
              <SectionHeader icon={Settings2} title={t('settings.tabs.appearance')} description={t('settings.appearanceDescription')} />
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                <label>
                  <span className="mb-1 block text-sm text-muted">{t('common.theme')}</span>
                  <select value={theme} onChange={(event) => changeTheme(event.target.value)} className="field-input">
                    <option value="light">{t('common.light')}</option>
                    <option value="dark">{t('common.dark')}</option>
                  </select>
                </label>
                <label>
                  <span className="mb-1 block text-sm text-muted">{t('common.language')}</span>
                  <select value={language} onChange={(event) => changeLanguage(event.target.value)} className="field-input">
                    {languages.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
                  </select>
                </label>
                <ToggleCard
                  label={t('shell.debugMode')}
                  description={t('settings.debugDescription')}
                  enabled={debugMode}
                  onToggle={() => setDebugMode(!debugMode)}
                />
              </div>
            </div>
          )}

          {isConfigSection(selectedTab) && selectedTab !== 'wacli' && (
            <ConfigPanel
              section={selectedTab}
              config={configs[selectedTab] ?? {}}
              draft={drafts[selectedTab] ?? {}}
              saving={updateConfigMutation.isPending}
              onChange={(key, value) => updateDraft(selectedTab, key, value)}
              onSave={() => saveSection(selectedTab)}
              extra={selectedTab === 'evolution_instances' ? <WebhookPanel webhookUrl={webhookUrl} /> : null}
            />
          )}

          {selectedTab === 'wacli' && (
            <WacliPanel
              config={configs.wacli ?? {}}
              draft={drafts.wacli ?? {}}
              status={wacliQuery.data}
              authStatus={wacliAuthQuery.data}
              syncStatus={wacliSyncQuery.data}
              saving={updateConfigMutation.isPending || wacliActionMutation.isPending}
              onChange={(key, value) => updateDraft('wacli', key, value)}
              onSave={() => saveSection('wacli')}
              onAction={(action) => wacliActionMutation.mutate(action)}
            />
          )}

          {selectedTab === 'blacklist' && (
            <BlacklistPanel
              phone={blacklistPhone}
              reason={blacklistReason}
              items={blacklistQuery.data?.items ?? []}
              onPhoneChange={setBlacklistPhone}
              onReasonChange={setBlacklistReason}
              onAdd={() => addBlacklistMutation.mutate()}
              onRemove={(phone) => removeBlacklistMutation.mutate(phone)}
              disabled={addBlacklistMutation.isPending || removeBlacklistMutation.isPending}
            />
          )}
        </div>
      </section>

      <section className="surface rounded-2xl p-5">
        <SectionHeader icon={KeyRound} title={t('settings.testSend')} description={t('settings.testSendDescription')} />
        <div className="mt-4 grid gap-2 md:grid-cols-[1fr_2fr_auto]">
          <input value={testNumber} onChange={(event) => setTestNumber(event.target.value)} className="field-input" placeholder={t('clients.phone')} />
          <input value={testText} onChange={(event) => setTestText(event.target.value)} className="field-input" placeholder={t('common.send')} />
          <button
            type="button"
            disabled={!testNumber.trim() || !testText.trim() || testSendMutation.isPending}
            onClick={() => testSendMutation.mutate()}
            className="save-btn"
          >
            {t('settings.testSend')}
          </button>
        </div>
      </section>
    </div>
  )
}

function OnboardingPanel({ businessConfig, webhookUrl, onStart }: { businessConfig: Record<string, unknown>; webhookUrl: string; onStart: () => void }): JSX.Element {
  const { t } = useTranslation()
  const configured = Boolean(businessConfig.company_name)
  return (
    <div className="surface rounded-2xl p-5">
      <SectionHeader icon={Workflow} title={t('settings.tabs.onboarding')} description={t('settings.onboardingDescription')} />
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <SetupStep done={configured} title={t('settings.setupBusiness')} description={String(businessConfig.company_name || t('settings.setupBusinessDescription'))} />
        <SetupStep done={Boolean(businessConfig.tenant_id)} title={t('settings.setupTenant')} description={String(businessConfig.tenant_id || 'default')} />
        <SetupStep done={Boolean(webhookUrl)} title={t('settings.setupWebhook')} description={webhookUrl} />
      </div>
      <button type="button" onClick={onStart} className="save-btn mt-5">
        {configured ? t('settings.continueSetup') : t('settings.startSetup')}
      </button>
    </div>
  )
}

function SetupStep({ done, title, description }: { done: boolean; title: string; description: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-line bg-elevated p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <CheckCircle2 className={done ? 'h-4 w-4 text-success' : 'h-4 w-4 text-muted'} strokeWidth={1.8} />
        {title}
      </div>
      <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted">{description}</p>
    </div>
  )
}

function ConfigPanel({
  section,
  config,
  draft,
  saving,
  onChange,
  onSave,
  extra
}: {
  section: ConfigSectionName
  config: Record<string, unknown>
  draft: Record<string, string>
  saving: boolean
  onChange: (key: string, value: string) => void
  onSave: () => void
  extra?: JSX.Element | null
}): JSX.Element {
  const { t } = useTranslation()
  const dirty = Object.keys(draft).length > 0
  return (
    <div className="surface rounded-2xl p-5">
      <SectionHeader icon={sectionIcon(section)} title={t(`settings.tabs.${section}`)} description={t(`settings.descriptions.${section}`)} />
      {extra}
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {Object.entries(config).filter(([key]) => key !== 'status').map(([key, value]) => {
          const multiline = key.includes('items') || key.includes('summary') || key.includes('services') || key.includes('audience') || key.includes('policies')
          return (
            <label key={key} className={multiline ? 'md:col-span-2' : ''}>
              <span className="mb-1 block font-mono text-xs text-muted">{key}</span>
              {multiline ? (
                <textarea
                  value={draft[key] ?? formatValue(value)}
                  onChange={(event) => onChange(key, event.target.value)}
                  rows={key.includes('items') ? 8 : 4}
                  className="field-input resize-y"
                />
              ) : (
                <input
                  value={draft[key] ?? formatValue(value)}
                  onChange={(event) => onChange(key, event.target.value)}
                  className="field-input"
                />
              )}
            </label>
          )
        })}
      </div>
      <button type="button" onClick={onSave} disabled={!dirty || saving} className="save-btn mt-4">
        {t('common.save')}
      </button>
    </div>
  )
}

function WebhookPanel({ webhookUrl }: { webhookUrl: string }): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="mt-5 rounded-xl border border-line bg-elevated p-4">
      <div className="text-sm font-semibold">{t('settings.webhookTitle')}</div>
      <div className="mt-3 flex flex-col gap-2 md:flex-row">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-canvas px-3 py-2 font-mono text-xs text-muted">{webhookUrl}</code>
        <button type="button" onClick={() => void navigator.clipboard.writeText(webhookUrl)} className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-line bg-panel px-3 text-sm">
          <Clipboard className="h-4 w-4" strokeWidth={1.8} />
          {t('settings.copyWebhook')}
        </button>
      </div>
    </div>
  )
}

function WacliPanel({
  config,
  draft,
  status,
  authStatus,
  syncStatus,
  saving,
  onChange,
  onSave,
  onAction
}: {
  config: Record<string, unknown>
  draft: Record<string, string>
  status: Awaited<ReturnType<typeof api.getWacliStatus>> | undefined
  authStatus: WacliProcessStatus | undefined
  syncStatus: WacliProcessStatus | undefined
  saving: boolean
  onChange: (key: string, value: string) => void
  onSave: () => void
  onAction: (action: 'enable' | 'disable' | 'auth_start' | 'auth_stop' | 'sync_start' | 'sync_stop') => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="surface rounded-2xl p-5">
      <SectionHeader icon={TerminalSquare} title={t('settings.tabs.wacli')} description={t('settings.descriptions.wacli')} />
      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <StatusBox label="Binário" value={status?.installed ? t('common.ok') : t('common.error')} ok={Boolean(status?.installed)} />
        <StatusBox label="Login" value={status?.doctor?.data?.authenticated ? t('common.active') : t('common.inactive')} ok={Boolean(status?.doctor?.data?.authenticated)} />
        <StatusBox label="Conexão" value={status?.doctor?.data?.connected ? t('common.online') : t('common.offline')} ok={Boolean(status?.doctor?.data?.connected)} />
        <StatusBox label="Sync" value={status?.sync_running ? t('common.active') : t('common.inactive')} ok={Boolean(status?.sync_running)} />
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        {Object.entries(config).map(([key, value]) => (
          <label key={key}>
            <span className="mb-1 block font-mono text-xs text-muted">{key}</span>
            <input value={draft[key] ?? formatValue(value)} onChange={(event) => onChange(key, event.target.value)} className="field-input" />
          </label>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={onSave} disabled={Object.keys(draft).length === 0 || saving} className="save-btn">{t('common.save')}</button>
        <ActionButton onClick={() => onAction(status?.enabled ? 'disable' : 'enable')} disabled={saving}>{status?.enabled ? t('common.disabled') : t('common.enabled')}</ActionButton>
        <ActionButton onClick={() => onAction('auth_start')} disabled={saving}>{t('settings.reconnectWacli')}</ActionButton>
        <ActionButton onClick={() => onAction('auth_stop')} disabled={saving}>{t('settings.stopAuth')}</ActionButton>
        <ActionButton onClick={() => onAction('sync_start')} disabled={saving}>{t('settings.startSync')}</ActionButton>
        <ActionButton onClick={() => onAction('sync_stop')} disabled={saving}>{t('settings.stopSync')}</ActionButton>
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        <ProcessOutput title={t('settings.authOutput')} status={authStatus} />
        <ProcessOutput title={t('settings.syncOutput')} status={syncStatus} />
      </div>
    </div>
  )
}

function BlacklistPanel({
  phone,
  reason,
  items,
  disabled,
  onPhoneChange,
  onReasonChange,
  onAdd,
  onRemove
}: {
  phone: string
  reason: string
  items: Array<{ phone: string; reason: string | null; expires_at: string | null }>
  disabled: boolean
  onPhoneChange: (value: string) => void
  onReasonChange: (value: string) => void
  onAdd: () => void
  onRemove: (phone: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="surface rounded-2xl p-5">
      <SectionHeader icon={Shield} title={t('blacklist.title')} description={t('settings.blacklistDescription')} />
      <div className="mt-4 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
        <input value={phone} onChange={(event) => onPhoneChange(event.target.value)} className="field-input" placeholder={t('blacklist.phone')} />
        <input value={reason} onChange={(event) => onReasonChange(event.target.value)} className="field-input" placeholder={t('blacklist.reason')} />
        <button type="button" disabled={!phone.trim() || disabled} onClick={onAdd} className="save-btn">{t('blacklist.add')}</button>
      </div>
      <div className="mt-4 divide-y divide-line">
        {items.map((item) => (
          <div key={item.phone} className="flex min-h-14 items-center justify-between gap-3 py-2">
            <div className="min-w-0">
              <div className="truncate font-mono text-sm">{item.phone}</div>
              <div className="truncate text-xs text-muted">{item.reason ?? t('blacklist.reason')}</div>
            </div>
            <button type="button" onClick={() => onRemove(item.phone)} disabled={disabled} className="focus-ring rounded-xl bg-elevated px-3 py-2 text-sm text-danger">
              {t('blacklist.remove')}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function ToggleCard({ label, description, enabled, onToggle }: { label: string; description: string; enabled: boolean; onToggle: () => void }): JSX.Element {
  return (
    <button type="button" onClick={onToggle} className="focus-ring flex min-h-[6.5rem] flex-col justify-between rounded-xl border border-line bg-elevated p-4 text-left">
      <span className="text-sm font-semibold">{label}</span>
      <span className="text-xs leading-5 text-muted">{description}</span>
      <span className={enabled ? 'text-sm text-success' : 'text-sm text-muted'}>{enabled ? 'Ativo' : 'Inativo'}</span>
    </button>
  )
}

function SectionHeader({ icon: Icon, title, description }: { icon: typeof Settings2; title: string; description: string }): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-line bg-elevated">
        <Icon className="h-4 w-4 text-muted" strokeWidth={1.8} />
      </div>
      <div className="min-w-0">
        <h3 className="text-lg font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
      </div>
    </div>
  )
}

function StatusBox({ label, value, ok }: { label: string; value: string; ok: boolean }): JSX.Element {
  return (
    <div className="rounded-xl border border-line bg-elevated p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={ok ? 'mt-2 text-sm font-semibold text-success' : 'mt-2 text-sm font-semibold text-danger'}>{value}</div>
    </div>
  )
}

function ActionButton({ children, disabled, onClick }: { children: string; disabled: boolean; onClick: () => void }): JSX.Element {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="focus-ring min-h-11 rounded-xl border border-line bg-elevated px-3 text-sm text-ink disabled:opacity-50">
      {children}
    </button>
  )
}

function ProcessOutput({ title, status }: { title: string; status: WacliProcessStatus | undefined }): JSX.Element {
  return (
    <div className="rounded-xl border border-line bg-elevated p-3">
      <div className="text-sm font-semibold">{title}</div>
      <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-canvas p-3 font-mono text-xs text-muted">{status?.output || status?.error || 'sem saída'}</pre>
    </div>
  )
}

function sectionIcon(section: ConfigSectionName): typeof Settings2 {
  const item = settingsNav.find((entry) => entry.id === section)
  return item?.icon ?? Settings2
}

function buildWebhookUrl(tenantId: string): string {
  const base = process.env.NEXT_PUBLIC_API_URL || '/api/backend'
  const normalized = base.replace(/\/$/, '')
  return `${normalized}/api/webhook/evolution/raw?tenant_id=${encodeURIComponent(tenantId || 'default')}`
}

async function runWacliAction(action: 'enable' | 'disable' | 'auth_start' | 'auth_stop' | 'sync_start' | 'sync_stop'): Promise<unknown> {
  if (action === 'enable') return api.enableWacli()
  if (action === 'disable') return api.disableWacli()
  if (action === 'auth_start') return api.startWacliAuth()
  if (action === 'auth_stop') return api.stopWacliAuth()
  if (action === 'sync_start') return api.startWacliSync()
  return api.stopWacliSync()
}
