// gestor-session.ts — Lê sessão do gestor a partir do cookie (server-side)
import { cookies } from 'next/headers'
import { type GestorSession, verifyGestorToken } from './gestor-auth'

/**
 * Retorna a sessão do gestor autenticado ou null.
 * Deve ser chamado apenas em Server Components ou Server Actions.
 * @returns Sessão ou null.
 */
export async function getGestorSession(): Promise<GestorSession | null> {
  const cookieStore = cookies()
  const token = cookieStore.get('gestor_session')?.value
  return verifyGestorToken(token)
}
