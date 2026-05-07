// i18n.tsx — Inicializa traduções client-side do dashboard
'use client'

import i18next from 'i18next'
import { initReactI18next, I18nextProvider } from 'react-i18next'
import type { ReactNode } from 'react'
import ptBr from '../locales/pt-BR.json'
import en from '../locales/en.json'

export const languages = [
  { code: 'pt-BR', label: 'PT-BR' },
  { code: 'en', label: 'EN' }
] as const

if (!i18next.isInitialized) {
  void i18next.use(initReactI18next).init({
    resources: {
      'pt-BR': { translation: ptBr },
      en: { translation: en }
    },
    lng: 'pt-BR',
    fallbackLng: 'pt-BR',
    interpolation: { escapeValue: false },
    returnNull: false
  })
}

/**
 * Envolve a UI com o provider de traduções.
 * @param props Conteúdo React.
 * @returns Provider i18n.
 */
export function DashboardI18nProvider({ children }: { children: ReactNode }): JSX.Element {
  return <I18nextProvider i18n={i18next}>{children}</I18nextProvider>
}
