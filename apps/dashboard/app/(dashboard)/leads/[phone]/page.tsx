// page.tsx — Perfil de lead: dados editáveis, timeline e vault
import { api } from '../../../../lib/api'
import { LeadProfileClient } from './lead-profile-client'
import { notFound } from 'next/navigation'

interface Props {
  params: { phone: string }
  searchParams: { tenant_id?: string }
}

/**
 * Página de perfil do lead — RSC que busca dados em paralelo.
 * @param props phone do lead via params e tenant_id via searchParams.
 * @returns Perfil completo do lead.
 */
export default async function LeadProfilePage({ params, searchParams }: Props): Promise<JSX.Element> {
  const phone = decodeURIComponent(params.phone)
  const tenantId = searchParams.tenant_id ?? 'default'
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001'

  const [leadResult, messagesResult, vaultFilesResult] = await Promise.allSettled([
    api.lead(phone, tenantId),
    fetch(
      `${apiUrl}/api/conversations/${encodeURIComponent(phone)}?tenant_id=${encodeURIComponent(tenantId)}`,
      { cache: 'no-store' }
    ).then(r => r.ok ? r.json() : { messages: [] }),
    api.vaultFiles(phone, tenantId)
  ])

  if (leadResult.status === 'rejected') {
    notFound()
  }

  const lead = leadResult.value
  const conversationData = messagesResult.status === 'fulfilled' ? messagesResult.value : { messages: [] }
  const vaultFiles: string[] = vaultFilesResult.status === 'fulfilled' ? (vaultFilesResult.value.files ?? []) : []

  return (
    <LeadProfileClient
      initialLead={lead}
      initialMessages={conversationData.messages ?? []}
      vaultFiles={vaultFiles}
      phone={phone}
      tenantId={tenantId}
    />
  )
}
