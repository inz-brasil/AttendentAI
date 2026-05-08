// page.tsx — Explorador do Vault: árvore de leads e arquivos _global
import { api } from '../../../lib/api'
import { VaultClient } from './vault-client'

/**
 * Página do Vault — RSC que carrega lista de leads e arquivos globais.
 * @param props Parâmetros de URL incluindo tenant_id.
 * @returns Explorador de vault com árvore e editor inline.
 */
export default async function VaultPage({
  searchParams
}: {
  searchParams: { tenant_id?: string }
}): Promise<JSX.Element> {
  const tenantId = searchParams.tenant_id ?? 'default'
  const apiUrl = process.env.API_URL ?? 'http://localhost:3001'
  let leads: Awaited<ReturnType<typeof api.vault>>['leads'] = []
  let globalFiles: string[] = []

  try {
    const [vaultRes, globalRes] = await Promise.allSettled([
      api.vault(tenantId),
      fetch(
        `${apiUrl}/api/vault/_global/files?tenant_id=${encodeURIComponent(tenantId)}`,
        { cache: 'no-store' }
      ).then(r => r.json() as Promise<{ files: string[] }>)
    ])
    if (vaultRes.status === 'fulfilled') leads = vaultRes.value.leads ?? []
    if (globalRes.status === 'fulfilled') globalFiles = globalRes.value.files ?? []
  } catch { /* API offline */ }

  return <VaultClient initialLeads={leads} globalFiles={globalFiles} tenantId={tenantId} />
}
