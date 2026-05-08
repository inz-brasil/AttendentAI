// page.tsx — Home do painel do gestor
import { redirect } from 'next/navigation'
import { getGestorSession } from '../../../lib/gestor-session'
import { api } from '../../../lib/api'
import { GestorHomeClient } from '../../../components/gestor/gestor-home-client'

export default async function GestorHomePage(): Promise<JSX.Element> {
  const session = await getGestorSession()
  if (!session) redirect('/gestor/login')

  const [leads, conversations, settings, blacklist] = await Promise.allSettled([
    api.leads(session.tenant_id),
    api.conversations(session.tenant_id),
    api.configSection('automation', session.tenant_id),
    api.blacklist(session.tenant_id)
  ])

  return (
    <GestorHomeClient
      tenantId={session.tenant_id}
      initialLeads={leads.status === 'fulfilled' ? leads.value : []}
      initialMessages={
        conversations.status === 'fulfilled' ? conversations.value.messages : []
      }
      initialAutomationConfig={
        settings.status === 'fulfilled' ? settings.value.config : {}
      }
      initialBlacklistCount={
        blacklist.status === 'fulfilled' ? blacklist.value.items.length : 0
      }
    />
  )
}
