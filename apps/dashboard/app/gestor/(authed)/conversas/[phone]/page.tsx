// page.tsx — Chat individual do gestor com um lead
import { redirect } from 'next/navigation'
import { getGestorSession } from '../../../../../lib/gestor-session'
import { api } from '../../../../../lib/api'
import { GestorChatClient } from '../../../../../components/gestor/gestor-chat-client'

interface Props {
  params: { phone: string }
}

export default async function GestorChatPage({ params }: Props): Promise<JSX.Element> {
  const session = await getGestorSession()
  if (!session) redirect('/gestor/login')

  const phone = decodeURIComponent(params.phone)

  const [transcriptResult, leadResult] = await Promise.allSettled([
    api.leadTranscript(phone, session.tenant_id, 100),
    api.lead(phone, session.tenant_id)
  ])

  return (
    <GestorChatClient
      tenantId={session.tenant_id}
      phone={phone}
      initialMessages={transcriptResult.status === 'fulfilled' ? transcriptResult.value.messages : []}
      lead={leadResult.status === 'fulfilled' ? leadResult.value : null}
    />
  )
}
