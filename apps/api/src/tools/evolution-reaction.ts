// evolution-reaction.ts — Envia reação de emoji a mensagem WhatsApp via Evolution
import { z } from 'zod'
import { getSettingValue } from '../automation/control'

const evolutionReactionInputSchema = z.object({
  emoji: z.string().min(1).max(10),
  message_id: z.string().min(1),
  remote_jid: z.string().min(1),
  from_me: z.boolean().default(false),
  instance: z.string().optional(),
  evolution_url: z.string().url().optional(),
  api_key: z.string().optional(),
  tenant_id: z.string().default('default')
})

export type EvolutionReactionInput = z.infer<typeof evolutionReactionInputSchema>

export interface EvolutionReactionResult {
  success: boolean
  error?: string
}

/** Envia reação de emoji a uma mensagem WhatsApp via Evolution API. */
export async function executeEvolutionReactionTool(rawInput: unknown): Promise<EvolutionReactionResult> {
  const input = evolutionReactionInputSchema.parse(rawInput)

  const evolutionUrl = input.evolution_url
    ?? await getSettingValue('evolution_api_url', '', input.tenant_id)
    ?? process.env.EVOLUTION_API_URL ?? ''

  const apiKey = input.api_key
    ?? await getSettingValue('evolution_api_key', '', input.tenant_id)
    ?? process.env.EVOLUTION_API_KEY ?? ''

  const instance = input.instance
    ?? await getSettingValue('evolution_instance', '', input.tenant_id)
    ?? process.env.EVOLUTION_INSTANCE ?? ''

  if (!evolutionUrl || !instance) {
    return { success: false, error: 'Evolution URL ou instância não configurados.' }
  }

  const url = `${evolutionUrl.replace(/\/$/, '')}/message/sendReaction/${instance}`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': apiKey
      },
      body: JSON.stringify({
        key: {
          remoteJid: input.remote_jid,
          fromMe: input.from_me,
          id: input.message_id
        },
        reaction: input.emoji
      })
    })

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText)
      return { success: false, error: `Evolution retornou ${response.status}: ${text.slice(0, 200)}` }
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Erro desconhecido' }
  }
}
