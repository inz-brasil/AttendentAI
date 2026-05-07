// context-sync.ts — Mantém compatibilidade chamando WACLI apenas como ingestor de message_events
import { WacliSyncService } from './sync-service'

export interface WacliContextSnapshot {
  available: boolean
  chat_jid: string | null
  chat_name: string | null
  context: string
  prompt_context: string
  messages_count: number
}

/**
 * Sincroniza histórico real no banco sem escrever vault ou montar prompt solto.
 * @param phone Telefone do lead.
 * @param remoteJid JID opcional.
 * @param leadName Nome legado, mantido apenas por compatibilidade de assinatura.
 * @returns Snapshot sem contexto textual solto.
 */
export async function syncWacliChatContext(
  phone: string,
  remoteJid: string | null | undefined,
  leadName: string
): Promise<WacliContextSnapshot> {
  void leadName
  const service = new WacliSyncService()
  const result = await service.sync({
    tenantId: 'default',
    phone,
    remoteJid: remoteJid ?? null,
    requests: 1,
    count: 50
  })

  return {
    available: result.enabled && result.error === null,
    chat_jid: result.chatJid,
    chat_name: null,
    context: '',
    prompt_context: '',
    messages_count: result.fetched
  }
}
