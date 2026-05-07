// layout.tsx — Layout raiz e metadados globais do dashboard
import type { Metadata } from 'next'
import Script from 'next/script'
import { ToastProvider } from '../components/ui/toast-provider'
import { DashboardProviders } from '../components/dashboard-providers'
import './globals.css'

export const metadata: Metadata = {
  title: 'AttendentAI Dashboard',
  description: 'Console operacional do AttendentAI'
}

/**
 * Layout raiz do Next.js.
 * @param props Conteúdo renderizado pela rota.
 * @returns Documento HTML.
 */
export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body>
        <Script id="theme-init" strategy="beforeInteractive">
          {`document.documentElement.dataset.theme=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'`}
        </Script>
        <DashboardProviders>
          <ToastProvider>{children}</ToastProvider>
        </DashboardProviders>
      </body>
    </html>
  )
}
