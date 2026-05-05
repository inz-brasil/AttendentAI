// page.tsx — Feed de conversas: busca inicial via RSC, atualiza via WS client-side
import { api } from '../../../lib/api'
import { ConversationsClient } from './conversations-client'

/**
 * Página de conversas — RSC que busca feed inicial e delega ao client.
 * @returns Feed de conversas com WebSocket ao vivo.
 */
export default async function ConversationsPage(): Promise<JSX.Element> {
  let conversations: Awaited<ReturnType<typeof api.conversations>> = { messages: [] }
  try {
    conversations = await api.conversations()
  } catch { /* renderiza vazio se API offline */ }

  return <ConversationsClient initialMessages={conversations.messages} />
}
