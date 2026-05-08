// gestor-auth.ts — Autenticação do painel do gestor (por tenant)
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getSettingValue } from '../config/dashboard-config'

const loginBodySchema = z.object({
  tenant_id: z.string().min(1),
  password: z.string().min(1)
})

/**
 * Registra endpoint de login do painel do gestor.
 * @param app Instância Fastify.
 */
export async function registerGestorAuthRoutes(app: FastifyInstance): Promise<void> {
  // Valida credenciais — retorna { valid: boolean } — o JWT é emitido pelo Next.js (dashboard)
  app.post('/api/gestor/auth', async (request, reply) => {
    const body = loginBodySchema.parse(request.body)

    // Primeiro tenta senha específica do tenant salva em settings
    const tenantPassword = await getSettingValue('gestor_password', body.tenant_id)
    // Fallback: variável de ambiente GESTOR_SECRET (senha padrão para todos os tenants)
    const fallback = process.env.GESTOR_SECRET ?? ''

    const expected = tenantPassword?.trim() || fallback
    if (!expected) {
      return reply.code(503).send({ error: 'Gestor password not configured', code: 'GESTOR_NOT_CONFIGURED' })
    }

    if (body.password !== expected) {
      return reply.code(401).send({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' })
    }

    return { valid: true, tenant_id: body.tenant_id }
  })
}
