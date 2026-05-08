// page.tsx — CRM de leads do painel do gestor
import { redirect } from 'next/navigation'
import { getGestorSession } from '../../../../lib/gestor-session'
import { api } from '../../../../lib/api'
import { GestorLeadsClient } from '../../../../components/gestor/gestor-leads-client'

export default async function GestorLeadsPage(): Promise<JSX.Element> {
  const session = await getGestorSession()
  if (!session) redirect('/gestor/login')

  const leadsResult = await api.leads(session.tenant_id).catch(() => [])

  return (
    <GestorLeadsClient
      tenantId={session.tenant_id}
      initialLeads={leadsResult}
    />
  )
}
