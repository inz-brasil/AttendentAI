// actions.ts — Server actions de autenticação do painel do gestor
'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { api } from '../../lib/api'
import { createGestorToken, gestorCookieName } from '../../lib/gestor-auth'

/**
 * Processa login do gestor com tenant_id + senha.
 * @param formData Dados do formulário.
 */
export async function gestorLoginAction(formData: FormData): Promise<void> {
  const tenantId = String(formData.get('tenant_id') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  if (!tenantId || !password) {
    redirect('/gestor/login?error=1')
  }

  try {
    const result = await api.gestorAuth(tenantId, password)
    if (!result.valid) redirect('/gestor/login?error=1')
  } catch {
    redirect('/gestor/login?error=1')
  }

  cookies().set(gestorCookieName, await createGestorToken(tenantId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/gestor',
    maxAge: 60 * 60 * 12
  })

  redirect('/gestor')
}

/**
 * Encerra sessão do gestor.
 */
export async function gestorLogoutAction(): Promise<void> {
  cookies().delete(gestorCookieName)
  redirect('/gestor/login')
}
