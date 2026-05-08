// page.tsx — Perfil de lead no painel do gestor
import { redirect } from 'next/navigation'
import { getGestorSession } from '../../../../../lib/gestor-session'
import { api } from '../../../../../lib/api'
import { GestorLeadProfileClient } from '../../../../../components/gestor/gestor-lead-profile-client'

interface Props {
  params: { phone: string }
}

export default async function GestorLeadProfilePage({ params }: Props): Promise<JSX.Element> {
  const session = await getGestorSession()
  if (!session) redirect('/gestor/login')

  const phone = decodeURIComponent(params.phone)

  const [leadResult, transcriptResult] = await Promise.allSettled([
    api.lead(phone, session.tenant_id),
    api.leadTranscript(phone, session.tenant_id, 50)
  ])

  if (leadResult.status === 'rejected') redirect('/gestor/leads')

  return (
    <GestorLeadProfileClient
      tenantId={session.tenant_id}
      lead={leadResult.value}
      initialMessages={transcriptResult.status === 'fulfilled' ? transcriptResult.value.messages : []}
    />
  )
}
