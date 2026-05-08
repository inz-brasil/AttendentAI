// tenants.ts — CRUD de tenants (portfólios/clientes do sistema)
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client'
import { tenants } from '../db/schema'

const tenantParamsSchema = z.object({ id: z.string().min(1) })
const tenantBodySchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9_-]+$/, 'ID deve conter apenas letras minúsculas, números, _ ou -').optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  is_active: z.boolean().optional()
})

/**
 * Registra endpoints de /api/tenants.
 * @param app Instância Fastify.
 * @returns Nada.
 */
export async function registerTenantRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/tenants', async () => {
    return db.select().from(tenants).orderBy(tenants.created_at)
  })

  app.get('/api/tenants/:id', async (request, reply) => {
    const params = tenantParamsSchema.parse(request.params)
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, params.id)).limit(1)
    return tenant ?? reply.code(404).send({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' })
  })

  app.post('/api/tenants', async (request, reply) => {
    const body = tenantBodySchema.parse(request.body)
    const id = body.id ?? body.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    const [existing] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1)
    if (existing) {
      return reply.code(409).send({ error: 'Tenant already exists', code: 'TENANT_EXISTS' })
    }
    await db.insert(tenants).values({ id, name: body.name, description: body.description ?? null })
    const [created] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1)
    return reply.code(201).send(created)
  })

  app.put('/api/tenants/:id', async (request, reply) => {
    const params = tenantParamsSchema.parse(request.params)
    const body = tenantBodySchema.omit({ id: true }).partial().parse(request.body)
    const [existing] = await db.select().from(tenants).where(eq(tenants.id, params.id)).limit(1)
    if (!existing) {
      return reply.code(404).send({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' })
    }
    await db.update(tenants).set({ ...body, updated_at: new Date() }).where(eq(tenants.id, params.id))
    const [updated] = await db.select().from(tenants).where(eq(tenants.id, params.id)).limit(1)
    return updated
  })

  // Nunca deleta dados — apenas desativa o tenant
  app.delete('/api/tenants/:id', async (request, reply) => {
    const params = tenantParamsSchema.parse(request.params)
    if (params.id === 'default') {
      return reply.code(403).send({ error: 'Cannot deactivate the default tenant', code: 'TENANT_DEFAULT_PROTECTED' })
    }
    await db.update(tenants).set({ is_active: false, updated_at: new Date() }).where(eq(tenants.id, params.id))
    return { success: true }
  })
}
