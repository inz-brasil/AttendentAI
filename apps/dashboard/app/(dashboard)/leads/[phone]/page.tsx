// page.tsx — Perfil de lead: dados editáveis, timeline e vault
import { api } from '../../../../lib/api'
import { LeadProfileClient } from './lead-profile-client'
import { notFound } from 'next/navigation'

interface Props {
  params: { phone: string }
}

/**
 * Página de perfil do lead — RSC que busca dados em paralelo.
 * @param props phone do lead via params.
 * @returns Perfil completo do lead.
 */
export default async function LeadProfilePage({ params }: Props): Promise<JSX.Element> {
  const phone = decodeURIComponent(params.phone)

  const [leadResult, messagesResult, vaultFilesResult] = await Promise.allSettled([
    api.lead(phone),
    // Busca mensagens via rota de conversas (usa fetch direto pois api.ts não tem este endpoint ainda)
    fetch(
      `${process.env.API_URL ?? 'http://localhost:3001'}/api/conversations/${encodeURIComponent(phone)}`,
      { cache: 'no-store' }
    ).then(r => r.ok ? r.json() : { messages: [] }),
    api.vaultFiles(phone)
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
    />
  )
}
