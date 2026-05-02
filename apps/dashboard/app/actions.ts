// actions.ts — Server actions de autenticação do dashboard
'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { authCookieName, createAuthToken, isValidDashboardPassword } from '../lib/auth'

/**
 * Processa login por senha única.
 * @param formData Dados do formulário.
 * @returns Nada.
 */
export async function loginAction(formData: FormData): Promise<void> {
  const password = String(formData.get('password') ?? '')

  if (!isValidDashboardPassword(password)) {
    redirect('/login?error=1')
  }

  cookies().set(authCookieName, await createAuthToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12
  })

  redirect('/')
}

/**
 * Encerra sessão do dashboard.
 * @returns Nada.
 */
export async function logoutAction(): Promise<void> {
  cookies().delete(authCookieName)
  redirect('/login')
}
