// gestor-auth.ts — Assina e valida cookie de sessão do painel do gestor
const encoder = new TextEncoder()

export const gestorCookieName = 'gestor_session'

function getSecret(): string {
  const secret = process.env.GESTOR_JWT_SECRET ?? process.env.DASHBOARD_SECRET
  if (!secret) throw new Error('GESTOR_JWT_SECRET must be configured')
  return secret
}

function base64UrlEncode(input: string): string {
  if (typeof btoa === 'function') {
    return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  }
  return Buffer.from(input, 'utf8').toString('base64url')
}

function base64UrlDecode(input: string): string {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  if (typeof atob === 'function') return atob(normalized)
  return Buffer.from(input, 'base64url').toString('utf8')
}

async function sign(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(getSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export interface GestorSession {
  tenant_id: string
  role: 'gestor'
  iat: number
}

/**
 * Cria token de sessão do gestor com tenant_id embutido.
 * @param tenantId ID do tenant autenticado.
 * @returns Token assinado.
 */
export async function createGestorToken(tenantId: string): Promise<string> {
  const payload = base64UrlEncode(
    JSON.stringify({ tenant_id: tenantId, role: 'gestor', iat: Date.now() } satisfies GestorSession)
  )
  return `${payload}.${await sign(payload)}`
}

/**
 * Valida e decodifica token de sessão do gestor.
 * @param token Valor do cookie.
 * @returns Sessão decodificada ou null se inválido.
 */
export async function verifyGestorToken(token: string | undefined): Promise<GestorSession | null> {
  if (!token) return null
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  try {
    const expected = await sign(payload)
    if (signature !== expected) return null
    return JSON.parse(base64UrlDecode(payload)) as GestorSession
  } catch {
    return null
  }
}
