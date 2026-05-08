// page.tsx — Lista de conversas do painel do gestor
import { redirect } from 'next/navigation'
import { getGestorSession } from '../../../../lib/gestor-session'
import { api } from '../../../../lib/api'
import { GestorConversasClient } from '../../../../components/gestor/gestor-conversas-client'

export default async function GestorConversasPage(): Promise<JSX.Element> {
  const session = await getGestorSession()
  if (!session) redirect('/gestor/login')

  const [convsResult, leadsResult] = await Promise.allSettled([
    api.conversations(session.tenant_id),
    api.leads(session.tenant_id)
  ])

  return (
    <GestorConversasClient
      tenantId={session.tenant_id}
      initialMessages={convsResult.status === 'fulfilled' ? convsResult.value.messages : []}
      initialLeads={leadsResult.status === 'fulfilled' ? leadsResult.value : []}
    />
  )
}
