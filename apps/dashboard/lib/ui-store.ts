// ui-store.ts — Estado visual em memória para tema, idioma e modo debug
'use client'

import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark'
export type LanguageCode = 'pt-BR' | 'en'

interface UiState {
  theme: ThemeMode
  language: LanguageCode
  debugMode: boolean
  sidebarCollapsed: boolean
  setTheme: (theme: ThemeMode) => void
  setLanguage: (language: LanguageCode) => void
  setDebugMode: (debugMode: boolean) => void
  setSidebarCollapsed: (sidebarCollapsed: boolean) => void
}

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/**
 * Store visual sem persistência local.
 */
export const useUiStore = create<UiState>((set) => ({
  theme: getInitialTheme(),
  language: 'pt-BR',
  debugMode: false,
  sidebarCollapsed: false,
  setTheme: (theme) => {
    document.documentElement.dataset.theme = theme
    set({ theme })
  },
  setLanguage: (language) => set({ language }),
  setDebugMode: (debugMode) => set({ debugMode }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed })
}))
