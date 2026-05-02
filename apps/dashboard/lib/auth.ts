// auth.ts — Assina e valida cookie de sessão do dashboard com Web Crypto
const encoder = new TextEncoder()
const cookieName = 'auth_token'

export const authCookieName = cookieName

function getSecret(): string {
  const secret = process.env.DASHBOARD_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('DASHBOARD_SECRET must be configured with at least 16 characters')
  }

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
  if (typeof atob === 'function') {
    return atob(normalized)
  }

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
  const bytes = Array.from(new Uint8Array(signature))
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Cria token assinado simples para o cookie do dashboard.
 * @returns Token assinado.
 */
export async function createAuthToken(): Promise<string> {
  const payload = base64UrlEncode(JSON.stringify({ sub: 'dashboard', iat: Date.now() }))
  return `${payload}.${await sign(payload)}`
}

/**
 * Valida token assinado do cookie.
 * @param token Valor do cookie.
 * @returns True se válido.
 */
export async function verifyAuthToken(token: string | undefined): Promise<boolean> {
  if (!token) {
    return false
  }

  const [payload, signature] = token.split('.')
  if (!payload || !signature) {
    return false
  }

  try {
    JSON.parse(base64UrlDecode(payload)) as { sub: string; iat: number }
    return signature === (await sign(payload))
  } catch {
    return false
  }
}

/**
 * Compara senha recebida com DASHBOARD_SECRET.
 * @param password Senha informada.
 * @returns True se correta.
 */
export function isValidDashboardPassword(password: string): boolean {
  return password === getSecret()
}
