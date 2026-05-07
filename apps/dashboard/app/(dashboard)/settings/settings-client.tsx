// settings-client.tsx — Configurações editáveis em tempo real, blacklist e testes operacionais
'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { CalendarStatus, Setting } from '../../../lib/api'
import { api } from '../../../lib/api'

const sections = ['evolution', 'automation', 'queue', 'audio', 'reactions', 'presence'] as const

type SectionName = typeof sections[number]

interface SettingsClientProps {
  initialSettings: Setting[]
  initialCalendarStatus: CalendarStatus
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function parseValue(value: string): string | boolean | number {
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value)
  return value
}

/**
 * Tela de configurações com salvamento sem restart.
 * @param props Dados legados mantidos para compatibilidade da página.
 * @returns UI de configuração.
 */
export function SettingsClient(_props: SettingsClientProps): JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [selectedSection, setSelectedSection] = useState<SectionName>('evolution')
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [blacklistPhone, setBlacklistPhone] = useState('')
  const [testNumber, setTestNumber] = useState('')
  const [testText, setTestText] = useState('')

  const configQueries = useQueries({
    queries: sections.map((section) => ({
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

  const activeConfig = useMemo(() => {
    const index = sections.indexOf(selectedSection)
    return configQueries[index]?.data?.config ?? {}
  }, [configQueries, selectedSection])

  const mutation = useMutation({
    mutationFn: (payload: { section: SectionName; data: Record<string, unknown> }) =>
      api.updateConfigSection(payload.section, payload.data),
    onSuccess: async (_, variables) => {
      setDraft({})
      await queryClient.invalidateQueries({ queryKey: ['config', variables.section] })
    }
  })
  const addBlacklistMutation = useMutation({
    mutationFn: () => api.addBlacklist({ phone: blacklistPhone, reason: 'manual_admin', duration_minutes: null }),
    onSuccess: async () => {
      setBlacklistPhone('')
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

  function saveSection(): void {
    const data = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, parseValue(value)]))
    mutation.mutate({ section: selectedSection, data })
  }

  return (
    <div className="space-y-6">
      <section>
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-accent">{t('settings.eyebrow')}</div>
        <h2 className="mt-2 text-3xl font-semibold">{t('settings.title')}</h2>
        <p className="mt-2 text-sm text-muted">{t('settings.subtitle')}</p>
      </section>

      <section className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="surface rounded-2xl p-3">
          {sections.map((section) => (
            <button
              key={section}
              type="button"
              onClick={() => {
                setSelectedSection(section)
                setDraft({})
              }}
              className={[
                'focus-ring mb-1 flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm',
                selectedSection === section ? 'bg-elevated text-ink' : 'text-muted hover:bg-elevated hover:text-ink'
              ].join(' ')}
            >
              {t(`settings.${section}`)}
            </button>
          ))}
        </aside>

        <div className="surface rounded-2xl p-4">
          <div className="grid gap-3 md:grid-cols-2">
            {Object.entries(activeConfig).filter(([key]) => key !== 'status').map(([key, value]) => (
              <label key={key} className="block">
                <span className="mb-1 block font-mono text-xs text-muted">{key}</span>
                <input
                  value={draft[key] ?? formatValue(value)}
                  onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                  className="field-input"
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={saveSection}
            disabled={Object.keys(draft).length === 0 || mutation.isPending}
            className="save-btn mt-4"
          >
            {t('common.save')}
          </button>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="surface rounded-2xl p-4">
          <h3 className="text-sm font-semibold">{t('blacklist.title')}</h3>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              value={blacklistPhone}
              onChange={(event) => setBlacklistPhone(event.target.value)}
              className="field-input"
              placeholder={t('blacklist.phone')}
            />
            <button
              type="button"
              disabled={!blacklistPhone.trim() || addBlacklistMutation.isPending}
              onClick={() => addBlacklistMutation.mutate()}
              className="save-btn"
            >
              {t('blacklist.add')}
            </button>
          </div>
          <div className="mt-4 divide-y divide-line">
            {(blacklistQuery.data?.items ?? []).map((item) => (
              <div key={item.phone} className="flex min-h-14 items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm">{item.phone}</div>
                  <div className="truncate text-xs text-muted">{item.reason ?? t('blacklist.reason')}</div>
                </div>
                <button
                  type="button"
                  onClick={() => removeBlacklistMutation.mutate(item.phone)}
                  className="focus-ring min-h-11 rounded-xl bg-elevated px-3 text-sm text-danger"
                >
                  {t('blacklist.remove')}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="surface rounded-2xl p-4">
          <h3 className="text-sm font-semibold">{t('settings.evolution')}</h3>
          <div className="mt-4 grid gap-2">
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
          <div className="mt-5 rounded-xl bg-elevated p-3 text-sm text-muted">
            {t('settings.wacli')}: {wacliQuery.data?.enabled ? t('common.enabled') : t('common.disabled')}
          </div>
        </div>
      </section>
    </div>
  )
}
