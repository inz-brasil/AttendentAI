// redis.ts — Centraliza conexão Redis e locks por phone
import Redis from 'ioredis'
import { env } from '../config/env'

export const redisConnection = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null
})

function lockKey(phone: string): string {
  return `lock:${phone}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Tenta adquirir lock Redis para um phone.
 * @param phone Telefone do lead.
 * @param token Valor único do lock.
 * @param ttlSeconds TTL em segundos.
 * @returns True se adquiriu o lock.
 */
export async function acquirePhoneLock(phone: string, token: string, ttlSeconds: number): Promise<boolean> {
  const result = await redisConnection.set(lockKey(phone), token, 'EX', ttlSeconds, 'NX')
  return result === 'OK'
}

/**
 * Libera lock Redis sem remover lock de outro processo.
 * @param phone Telefone do lead.
 * @param token Valor único usado ao adquirir o lock.
 * @returns Nada.
 */
export async function releasePhoneLock(phone: string, token: string): Promise<void> {
  await redisConnection.eval(
    `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    end
    return 0
    `,
    1,
    lockKey(phone),
    token
  )
}

/**
 * Espera até o lock de um phone ser liberado.
 * @param phone Telefone do lead.
 * @param timeoutMs Tempo máximo de espera.
 * @returns True se liberou dentro do prazo.
 */
export async function waitForPhoneLockRelease(phone: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const exists = await redisConnection.exists(lockKey(phone))
    if (exists === 0) {
      return true
    }

    await sleep(500)
  }

  return false
}

/**
 * Aguarda alguns milissegundos.
 * @param ms Milissegundos.
 * @returns Nada.
 */
export async function delay(ms: number): Promise<void> {
  await sleep(ms)
}
