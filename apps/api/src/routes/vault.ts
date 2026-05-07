// vault.ts — Expõe operações HTTP do VaultManager (leads e _global)
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { env } from '../config/env'
import { VaultManager } from '../vault-manager/manager'

const phoneParamsSchema = z.object({ phone: z.string().min(1) })
const fileParamsSchema = z.object({
  phone: z.string().min(1),
  filename: z.string().min(1)
})
const fileBodySchema = z.object({ content: z.string() })

/**
 * Registra endpoints de /api/vault.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerVaultRoutes(app: FastifyInstance): Promise<void> {
  const vault = new VaultManager(env.VAULT_PATH)

  app.get('/api/vault', async () => {
    return { leads: await vault.listLeads() }
  })

  // ---- Vault Global (_global/) — conhecimento compartilhado entre agentes ----

  app.get('/api/vault/_global/files', async () => {
    const files = await vault.listGlobalFiles()
    return { files }
  })

  app.get('/api/vault/_global/files/:filename', async (request) => {
    const { filename } = z.object({ filename: z.string().min(1) }).parse(request.params)
    const content = await vault.readGlobal(filename)
    return { filename, content }
  })

  app.put('/api/vault/_global/files/:filename', async (request, reply) => {
    if (isWacliWriteRequest(request.headers)) {
      return reply.code(403).send({ error: 'Forbidden', code: 'WACLI_VAULT_WRITE_FORBIDDEN' })
    }

    const { filename } = z.object({ filename: z.string().min(1) }).parse(request.params)
    const { content } = fileBodySchema.parse(request.body)
    await vault.writeGlobal(filename, content)
    return { success: true }
  })

  app.get('/api/vault/:phone/files', async (request) => {
    const params = phoneParamsSchema.parse(request.params)
    return { files: await vault.listFiles(params.phone) }
  })

  app.get('/api/vault/:phone/files/:filename', async (request) => {
    const params = fileParamsSchema.parse(request.params)
    const content = await vault.read(params.phone, params.filename)
    return { filename: params.filename, content }
  })

  app.put('/api/vault/:phone/files/:filename', async (request, reply) => {
    if (isWacliWriteRequest(request.headers)) {
      return reply.code(403).send({ error: 'Forbidden', code: 'WACLI_VAULT_WRITE_FORBIDDEN' })
    }

    const params = fileParamsSchema.parse(request.params)
    const body = fileBodySchema.parse(request.body)
    await vault.write(params.phone, params.filename, body.content)
    return { success: true }
  })

  app.delete('/api/vault/:phone/history', async (request) => {
    const params = phoneParamsSchema.parse(request.params)
    await vault.deleteHistory(params.phone)
    return { success: true }
  })

  app.delete('/api/vault/:phone', async (request) => {
    const params = phoneParamsSchema.parse(request.params)
    await vault.delete(params.phone)
    return { success: true }
  })
}

export function isWacliWriteRequest(headers: Record<string, string | string[] | undefined>): boolean {
  const source = headers['x-source'] ?? headers['x-attendentai-source']
  if (Array.isArray(source)) {
    return source.some((value) => value.toLowerCase() === 'wacli')
  }

  return typeof source === 'string' && source.toLowerCase() === 'wacli'
}
