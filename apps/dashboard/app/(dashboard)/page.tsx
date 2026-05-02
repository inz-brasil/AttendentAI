// page.tsx — Home operacional: métricas, status do sistema e feed de conversas
import { Suspense } from 'react'
import { api } from '../../lib/api'
import { HomeClient } from './home-client'

/** Busca dados necessários para a home no servidor. */
async function fetchHomeData() {
  const [leads, health] = await Promise.allSettled([api.leads(), api.health()])

  return {
    leads: leads.status === 'fulfilled' ? leads.value : [],
    health: health.status === 'fulfilled' ? health.value : null
  }
}

/**
 * Página inicial com métricas e status do sistema.
 * @returns Componente React Server Component.
 */
export default async function HomePage(): Promise<JSX.Element> {
  const data = await fetchHomeData()

  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeClient initialData={data} />
    </Suspense>
  )
}

function HomeSkeleton(): JSX.Element {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-64 rounded bg-elevated" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-lg bg-panel" />
        ))}
      </div>
      <div className="h-96 rounded-lg bg-panel" />
    </div>
  )
}
