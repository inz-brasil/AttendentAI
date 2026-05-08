// ui-store.ts — Estado visual em memória para tema, idioma, modo debug e tenant ativo
'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'light' | 'dark'
export type LanguageCode = 'pt-BR' | 'en'

interface UiState {
  theme: ThemeMode
  language: LanguageCode
  debugMode: boolean
  sidebarCollapsed: boolean
  tenantId: string
  setTheme: (theme: ThemeMode) => void
  setLanguage: (language: LanguageCode) => void
  setDebugMode: (debugMode: boolean) => void
  setSidebarCollapsed: (sidebarCollapsed: boolean) => void
  setTenantId: (tenantId: string) => void
}

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Store visual com persistência parcial no localStorage.
 */
export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      theme: getInitialTheme(),
      language: 'pt-BR',
      debugMode: false,
      sidebarCollapsed: false,
      tenantId: 'default',
      setTheme: (theme) => {
        document.documentElement.dataset.theme = theme
        set({ theme })
      },
      setLanguage: (language) => set({ language }),
      setDebugMode: (debugMode) => set({ debugMode }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setTenantId: (tenantId) => set({ tenantId: tenantId.trim() || 'default' })
    }),
    {
      name: 'attendentai-ui',
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        debugMode: state.debugMode,
        sidebarCollapsed: state.sidebarCollapsed,
        tenantId: state.tenantId
      })
    }
  )
)
