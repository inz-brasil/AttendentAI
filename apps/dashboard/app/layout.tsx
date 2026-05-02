// layout.tsx — Layout raiz e metadados globais do dashboard
import type { Metadata } from 'next'
import { ToastProvider } from '../components/ui/toast-provider'
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
    <html lang="pt-BR">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
