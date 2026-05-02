// leads.ts — Expõe endpoints CRUD básicos para leads
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client'
import { leads, messages } from '../db/schema'
import { VaultManager } from '../vault-manager/manager'

const leadParamsSchema = z.object({ phone: z.string().min(1) })
const leadBodySchema = z.object({
  phone: z.string().min(1),
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  status: z.enum(['novo', 'ativo', 'lead_quente', 'convertido', 'inativo']).optional(),
  tags: z.array(z.string()).optional(),
  custom_data: z.record(z.unknown()).optional(),
  vault_path: z.string().nullable().optional()
})

/**
 * Registra endpoints de /api/leads.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerLeadRoutes(app: FastifyInstance): Promise<void> {
  const vault = new VaultManager()

  app.get('/api/leads', async () => db.select().from(leads))

  app.get('/api/leads/:phone', async (request, reply) => {
    const params = leadParamsSchema.parse(request.params)
    const [lead] = await db.select().from(leads).where(eq(leads.phone, params.phone)).limit(1)
    return lead ?? reply.code(404).send({ error: 'Lead not found', code: 'LEAD_NOT_FOUND' })
  })

  app.post('/api/leads', async (request, reply) => {
    const body = leadBodySchema.parse(request.body)
    await db.insert(leads).values(body)
    return reply.code(201).send(body)
  })

  app.put('/api/leads/:phone', async (request) => {
    const params = leadParamsSchema.parse(request.params)
    const body = leadBodySchema.omit({ phone: true }).partial().parse(request.body)
    await db.update(leads).set({ ...body, updated_at: new Date() }).where(eq(leads.phone, params.phone))
    const [lead] = await db.select().from(leads).where(eq(leads.phone, params.phone)).limit(1)
    return lead
  })

  // Apaga apenas o histórico de mensagens — mantém perfil e vault (notas/memoria)
  app.delete('/api/leads/:phone/history', async (request) => {
    const { phone } = leadParamsSchema.parse(request.params)
    await db.delete(messages).where(eq(messages.lead_phone, phone))
    // Limpa historico.md mas preserva outros arquivos do vault
    try {
      await vault.deleteHistory(phone)
    } catch (error) {
      // Vault pode não existir — não bloqueia a resposta, mas registra para auditoria.
      request.log.warn({ err: error, phone }, 'lead vault history deletion failed')
    }
    request.log.info({ phone }, 'lead history deleted')
    return { success: true }
  })

  // Remove lead completamente, incluindo mensagens e pasta do vault
  app.delete('/api/leads/:phone', async (request) => {
    const { phone } = leadParamsSchema.parse(request.params)
    await db.delete(messages).where(eq(messages.lead_phone, phone))
    await db.delete(leads).where(eq(leads.phone, phone))
    try {
      await vault.delete(phone)
    } catch (error) {
      // Vault pode não existir — não bloqueia a resposta, mas registra para auditoria.
      request.log.warn({ err: error, phone }, 'lead vault deletion failed')
    }
    request.log.info({ phone }, 'lead deleted')
    return { success: true }
  })
}
