// page.tsx — Feed de conversas: busca inicial via RSC, atualiza via WS client-side
import { api } from '../../../lib/api'
import { ConversationsClient } from './conversations-client'

/**
 * Página de conversas — RSC que busca feed inicial e delega ao client.
 * @returns Feed de conversas com WebSocket ao vivo.
 */
export default async function ConversationsPage(): Promise<JSX.Element> {
  let conversations: Awaited<ReturnType<typeof api.leads>> = []
  try {
    // Usa o endpoint de leads para obter lista inicial com última atividade
    conversations = await api.leads()
  } catch { /* renderiza vazio se API offline */ }

  return <ConversationsClient initialLeads={conversations} />
}
