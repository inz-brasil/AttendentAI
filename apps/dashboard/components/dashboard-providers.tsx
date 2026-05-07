// dashboard-providers.tsx — Agrupa providers client-side do dashboard
'use client'

import { useEffect, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { DashboardI18nProvider } from '../lib/i18n'
import { DashboardQueryProvider } from '../lib/query-provider'
import { useUiStore } from '../lib/ui-store'

function PreferencesBridge({ children }: { children: ReactNode }): JSX.Element {
  const theme = useUiStore((state) => state.theme)
  const language = useUiStore((state) => state.language)
  const { i18n } = useTranslation()

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    void i18n.changeLanguage(language)
    document.documentElement.lang = language
  }, [i18n, language])

  return <>{children}</>
}

/**
 * Envolve o dashboard com i18n, React Query e ponte de preferências.
 * @param props Conteúdo React.
 * @returns Providers globais.
 */
export function DashboardProviders({ children }: { children: ReactNode }): JSX.Element {
  return (
    <DashboardI18nProvider>
      <DashboardQueryProvider>
        <PreferencesBridge>{children}</PreferencesBridge>
      </DashboardQueryProvider>
    </DashboardI18nProvider>
  )
}
