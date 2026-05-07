// debug-client.tsx — Console de traces, fila e timeline por batch
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api, type TraceEventRow } from '../../../lib/api'

const apiBase = process.env.NEXT_PUBLIC_API_URL || '/api/backend'

function formatJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2)
}

/**
 * Console de debug com SSE e busca por batch.
 * @returns UI de debug.
 */
export function DebugClient(): JSX.Element {
  const { t } = useTranslation()
  const [batchId, setBatchId] = useState('')
  const [live, setLive] = useState(false)
  const [events, setEvents] = useState<TraceEventRow[]>([])
  const timelineQuery = useQuery({
    queryKey: ['trace-timeline', batchId],
    queryFn: () => api.traceTimeline(batchId),
    enabled: batchId.trim().length > 0,
    retry: false
  })
  const queueQuery = useQuery({
    queryKey: ['queue-status'],
    queryFn: api.queueStatus,
    retry: false
  })

  useEffect(() => {
    if (!live) return
    const source = new EventSource(`${apiBase}/api/traces/stream?tenant_id=default`)
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as TraceEventRow
      setEvents((current) => [event, ...current].slice(0, 100))
    }
    source.onerror = () => source.close()
    return () => source.close()
  }, [live])

  const timeline = useMemo(() => timelineQuery.data?.traces ?? [], [timelineQuery.data])

  return (
    <div className="space-y-5">
      <section>
        <div className="text-xs font-medium uppercase tracking-[0.18em] text-accent">{t('debug.eyebrow')}</div>
        <h2 className="mt-2 text-3xl font-semibold">{t('debug.title')}</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted">{t('debug.subtitle')}</p>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="surface rounded-2xl p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              value={batchId}
              onChange={(event) => setBatchId(event.target.value)}
              className="field-input"
              placeholder={t('debug.batchId')}
            />
            <button
              type="button"
              onClick={() => void timelineQuery.refetch()}
              className="focus-ring rounded-xl bg-accent px-4 text-sm font-semibold text-[var(--accent-contrast)]"
            >
              {t('common.search')}
            </button>
          </div>
          <div className="mt-5">
            <h3 className="text-sm font-semibold">{t('debug.timeline')}</h3>
            <div className="mt-3 space-y-3">
              {timeline.length === 0 ? (
                <div className="rounded-xl bg-elevated p-4 text-sm text-muted">{t('common.empty')}</div>
              ) : timeline.map((event, index) => (
                <article key={event.id} className="rounded-xl border border-line bg-elevated p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">{index + 1}. {event.event}</div>
                    <span className="rounded-full bg-panel px-2 py-1 text-xs text-muted">{event.status}</span>
                  </div>
                  <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-panel p-3 font-mono text-xs text-muted">
                    {formatJson(event.data)}
                  </pre>
                </article>
              ))}
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="surface rounded-2xl p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">{t('debug.liveLogs')}</h3>
              <button
                type="button"
                onClick={() => setLive((current) => !current)}
                className="focus-ring min-h-11 rounded-xl bg-elevated px-3 text-sm"
              >
                {live ? t('debug.disconnectSse') : t('debug.connectSse')}
              </button>
            </div>
            <div className="mt-3 max-h-96 space-y-2 overflow-auto">
              {events.length === 0 ? <div className="text-sm text-muted">{t('common.empty')}</div> : events.map((event) => (
                <div key={event.id} className="rounded-xl bg-elevated p-3">
                  <div className="text-xs font-medium">{event.event}</div>
                  <div className="mt-1 truncate font-mono text-[11px] text-muted">{event.batch_id ?? event.phone ?? event.tenant_id}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="surface rounded-2xl p-4">
            <h3 className="text-sm font-semibold">{t('debug.queue')}</h3>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-elevated p-3 font-mono text-xs text-muted">
              {formatJson(queueQuery.data ?? queueQuery.error)}
            </pre>
          </div>
        </aside>
      </section>
    </div>
  )
}
