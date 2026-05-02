// route.ts — Proxy server-side do dashboard para a API interna do AttendentAI
import { NextResponse, type NextRequest } from 'next/server'

const apiUrl = process.env.API_URL ?? 'http://api:3001'
const allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

interface RouteContext {
  params: {
    path: string[]
  }
}

function buildTargetUrl(request: NextRequest, path: string[]): string {
  const target = new URL(path.join('/'), `${apiUrl}/`)
  request.nextUrl.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value)
  })
  return target.toString()
}

async function proxy(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  if (!allowedMethods.includes(request.method as typeof allowedMethods[number])) {
    return NextResponse.json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, { status: 405 })
  }

  const headers = new Headers(request.headers)
  headers.delete('host')
  headers.delete('content-length')

  const hasBody = !['GET', 'HEAD'].includes(request.method)
  const response = await fetch(buildTargetUrl(request, context.params.path), {
    method: request.method,
    headers,
    body: hasBody ? await request.text() : undefined,
    cache: 'no-store'
  })

  const body = await response.arrayBuffer()
  const responseHeaders = new Headers(response.headers)
  responseHeaders.delete('content-encoding')
  responseHeaders.delete('content-length')

  return new NextResponse(body, {
    status: response.status,
    headers: responseHeaders
  })
}

/** Encaminha GET para a API interna. */
export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return proxy(request, context)
}

/** Encaminha POST para a API interna. */
export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return proxy(request, context)
}

/** Encaminha PUT para a API interna. */
export async function PUT(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return proxy(request, context)
}

/** Encaminha PATCH para a API interna. */
export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return proxy(request, context)
}

/** Encaminha DELETE para a API interna. */
export async function DELETE(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  return proxy(request, context)
}
