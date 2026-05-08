// page.tsx — Feed de conversas: busca inicial via RSC, atualiza via WS client-side
import { api } from '../../../lib/api'
import { ConversationsClient } from './conversations-client'

/**
 * Página de conversas — RSC que busca feed inicial e delega ao client.
 * @param props Parâmetros de URL incluindo tenant_id.
 * @returns Feed de conversas com WebSocket ao vivo.
 */
export default async function ConversationsPage({
  searchParams
}: {
  searchParams: { tenant_id?: string }
}): Promise<JSX.Element> {
  const tenantId = searchParams.tenant_id ?? 'default'
  let conversations: Awaited<ReturnType<typeof api.conversations>> = { messages: [] }
  try {
    conversations = await api.conversations(tenantId)
  } catch { /* renderiza vazio se API offline */ }

  return <ConversationsClient initialMessages={conversations.messages} tenantId={tenantId} />
}
