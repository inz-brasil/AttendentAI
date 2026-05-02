// rate-limit.ts — Implementa limites por IP e por phone usando Redis
import type { FastifyReply, FastifyRequest } from 'fastify'
import { redisConnection } from './queue/redis'

export interface RateLimitResult {
  allowed: boolean
  count: number
  limit: number
  resetSeconds: number
}

/** Incrementa contador Redis com janela fixa em segundos. */
export async function hitFixedWindow(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const count = await redisConnection.incr(key)
  if (count === 1) {
    await redisConnection.expire(key, windowSeconds)
  }

  const ttl = await redisConnection.ttl(key)
  return {
    allowed: count <= limit,
    count,
    limit,
    resetSeconds: Math.max(ttl, 0)
  }
}

/** Aplica rate limit por IP para rotas específicas. */
export async function enforceIpRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  scope: string,
  limit: number
): Promise<boolean> {
  const result = await hitFixedWindow(`rate:${scope}:ip:${request.ip}`, limit, 60)
  if (result.allowed) {
    return true
  }

  request.log.warn({ ip: request.ip, scope, count: result.count, limit }, 'rate limit exceeded')
  reply.header('Retry-After', String(result.resetSeconds))
  await reply.code(429).send({
    error: 'Rate limit exceeded',
    code: 'RATE_LIMIT_EXCEEDED',
    details: { scope, limit, reset_seconds: result.resetSeconds }
  })
  return false
}

/** Aplica rate limit por telefone para webhook. */
export async function enforcePhoneRateLimit(
  request: FastifyRequest,
  reply: FastifyReply,
  phone: string,
  limit: number
): Promise<boolean> {
  const result = await hitFixedWindow(`rate:webhook:phone:${phone}`, limit, 60)
  if (result.allowed) {
    return true
  }

  request.log.warn({ phone, count: result.count, limit }, 'webhook phone rate limit exceeded')
  reply.header('Retry-After', String(result.resetSeconds))
  await reply.code(429).send({
    error: 'Rate limit exceeded for phone',
    code: 'PHONE_RATE_LIMIT_EXCEEDED',
    details: { phone, limit, reset_seconds: result.resetSeconds }
  })
  return false
}
