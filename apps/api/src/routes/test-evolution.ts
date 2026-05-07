// test-evolution.ts — Endpoints de teste operacional da Evolution API para o dashboard
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getSettingValue } from '../config/dashboard-config'
import { env } from '../config/env'
import { EvolutionSender } from '../delivery/evolution-sender'

const sendBodySchema = z.object({
  phone: z.string().min(1),
  text: z.string().min(1),
  instance: z.string().min(1).optional(),
  remote_jid: z.string().min(1).optional()
})

const mediaBodySchema = z.object({
  message_id: z.string().min(1),
  instance: z.string().min(1).optional()
})

/**
 * Registra endpoints /api/test/evolution/*.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerEvolutionTestRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/test/evolution/send', async (request) => {
    const body = sendBodySchema.parse(request.body)
    const config = await loadEvolutionConfig(body.instance)
    const sender = new EvolutionSender(config)
    const result = await sender.sendText({
      remoteJid: body.remote_jid ?? buildRemoteJid(body.phone),
      text: body.text
    })
    return { success: true, external_message_id: result.externalMessageId, raw: result.raw }
  })

  app.post('/api/test/evolution/media', async (request) => {
    const body = mediaBodySchema.parse(request.body)
    const config = await loadEvolutionConfig(body.instance)
    const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/getBase64FromMediaMessage/${encodeURIComponent(config.instance)}`, {
      method: 'POST',
      headers: {
        apikey: config.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: { key: { id: body.message_id } } })
    })

    const payload = await parseResponse(response)
    return {
      success: response.ok,
      status: response.status,
      media_present: hasBase64(payload),
      raw: payload
    }
  })
}

async function loadEvolutionConfig(instanceOverride?: string): Promise<{ baseUrl: string; apiKey: string; instance: string }> {
  const [localUrl, apiUrl, apiKey, instance] = await Promise.all([
    getSettingValue('evolution_local_url'),
    getSettingValue('evolution_api_url'),
    getSettingValue('evolution_api_key'),
    getSettingValue('evolution_instance')
  ])
  const baseUrl = localUrl || env.EVOLUTION_LOCAL_URL || apiUrl || env.EVOLUTION_API_URL
  const resolvedApiKey = apiKey || env.EVOLUTION_API_KEY
  const resolvedInstance = instanceOverride || instance || env.EVOLUTION_INSTANCE

  if (!baseUrl) throw new Error('Evolution URL não configurada')
  if (!resolvedApiKey) throw new Error('Evolution API key não configurada')
  if (!resolvedInstance) throw new Error('Evolution instance não configurada')

  return { baseUrl, apiKey: resolvedApiKey, instance: resolvedInstance }
}

function buildRemoteJid(phone: string): string {
  return phone.includes('@') ? phone : `${phone.replace(/\D/g, '')}@s.whatsapp.net`
}

async function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? ''
  return contentType.includes('application/json') ? response.json() : response.text()
}

function hasBase64(payload: unknown): boolean {
  return Boolean(toRecord(payload)?.base64)
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
