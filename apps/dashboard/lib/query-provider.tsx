// query-provider.tsx — Provider React Query com cache curto para dados operacionais
'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

/**
 * Expõe o QueryClient para o dashboard.
 * @param props Conteúdo React.
 * @returns Provider com cache de 60 segundos.
 */
export function DashboardQueryProvider({ children }: { children: ReactNode }): JSX.Element {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false
      }
    }
  }))

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
