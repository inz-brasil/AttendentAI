// page.tsx — Conta e integrações do painel do gestor
import { redirect } from 'next/navigation'
import { getGestorSession } from '../../../../lib/gestor-session'
import { api } from '../../../../lib/api'
import { GestorContaClient } from '../../../../components/gestor/gestor-conta-client'

export default async function GestorContaPage(): Promise<JSX.Element> {
  const session = await getGestorSession()
  if (!session) redirect('/gestor/login')

  const [calendarResult, settingsResult] = await Promise.allSettled([
    api.getCalendarStatus(),
    api.settings(session.tenant_id)
  ])

  return (
    <GestorContaClient
      tenantId={session.tenant_id}
      calendarStatus={calendarResult.status === 'fulfilled' ? calendarResult.value : null}
      settings={settingsResult.status === 'fulfilled' ? settingsResult.value : []}
    />
  )
}
