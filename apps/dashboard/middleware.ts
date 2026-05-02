// middleware.ts — Protege rotas do dashboard por cookie httpOnly
import { NextResponse, type NextRequest } from 'next/server'
import { authCookieName, verifyAuthToken } from './lib/auth'

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl
  const isLogin = pathname === '/login'
  const isAuthenticated = await verifyAuthToken(request.cookies.get(authCookieName)?.value)

  if (!isAuthenticated && !isLogin) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  if (isAuthenticated && isLogin) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
}
