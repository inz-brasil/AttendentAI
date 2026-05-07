// evolution-send.ts — Tool para agentes enviarem mensagens ativas via Evolution com tracking
import { z } from 'zod'
import { env } from '../config/env'
import { ResponseDispatcher } from '../delivery/dispatcher'

const recipientSchema = z.object({
  phone: z.string().optional(),
  remote_jid: z.string().optional(),
  name: z.string().optional()
}).refine((value) => Boolean(value.phone?.trim() || value.remote_jid?.trim()), {
  message: 'phone ou remote_jid é obrigatório'
})

const evolutionSendToolInputSchema = z.object({
  tenant_id: z.string().min(1).default('default'),
  recipients: z.array(recipientSchema).min(1).max(10),
  messages: z.array(z.string().min(1)).min(1).max(5),
  instance: z.string().optional(),
  instance_id: z.string().nullable().optional(),
  evolution_url: z.string().url().optional(),
  evolution_local_url: z.string().url().optional(),
  api_key: z.string().optional(),
  sender_type: z.enum(['bot', 'internal_assistant']).default('internal_assistant'),
  audio_requested: z.boolean().default(false)
})

export interface EvolutionSendToolResult {
  success: boolean
  sent: number
  failed: number
  results: Array<{
    recipient: string
    message_index: number
    status: 'sent' | 'failed'
    delivery_event_id: string
    error_message: string | null
  }>
}

/**
 * Executa envio ativo via Evolution para um ou mais destinatários.
 * @param rawInput Argumentos vindos do agente.
 * @returns Resumo auditável de envio.
 */
export async function executeEvolutionSendTool(rawInput: unknown): Promise<EvolutionSendToolResult> {
  const input = evolutionSendToolInputSchema.parse(rawInput)
  const dispatcher = new ResponseDispatcher()
  const results: EvolutionSendToolResult['results'] = []

  for (const recipient of input.recipients) {
    for (const [messageIndex, message] of input.messages.entries()) {
      const remoteJid = recipient.remote_jid ?? buildRemoteJid(recipient.phone ?? '')
      const phone = normalizePhone(recipient.phone ?? recipient.remote_jid ?? '')
      const result = await dispatcher.dispatch({
        tenantId: input.tenant_id,
        batchId: null,
        phone,
        remoteJid,
        instance: input.instance ?? env.EVOLUTION_INSTANCE ?? null,
        instanceId: input.instance_id ?? null,
        evolutionUrl: input.evolution_url ?? env.EVOLUTION_API_URL ?? null,
        evolutionLocalUrl: input.evolution_local_url ?? env.EVOLUTION_LOCAL_URL ?? null,
        apiKey: input.api_key ?? env.EVOLUTION_API_KEY ?? null,
        text: message,
        audioRequested: input.audio_requested,
        senderType: input.sender_type,
        sourceEvent: 'tool.evolution_send'
      })

      results.push({
        recipient: recipient.remote_jid ?? recipient.phone ?? '',
        message_index: messageIndex,
        status: result.status,
        delivery_event_id: result.intendedEventId,
        error_message: result.errorMessage
      })
    }
  }

  const sent = results.filter((result) => result.status === 'sent').length
  return {
    success: sent === results.length,
    sent,
    failed: results.length - sent,
    results
  }
}

function buildRemoteJid(phone: string): string {
  const normalized = normalizePhone(phone)
  return phone.includes('@') ? phone : `${normalized}@s.whatsapp.net`
}

function normalizePhone(value: string): string {
  if (value.endsWith('@g.us')) {
    return value.replace('@g.us', '')
  }

  return value.split('@')[0]?.replace(/\D/g, '') ?? value
}
