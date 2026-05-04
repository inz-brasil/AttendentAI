// page.tsx — Explorador do Vault: árvore de leads e arquivos _global
import { api } from '../../../lib/api'
import { VaultClient } from './vault-client'

/**
 * Página do Vault — RSC que carrega lista de leads e arquivos globais.
 * @returns Explorador de vault com árvore e editor inline.
 */
export default async function VaultPage(): Promise<JSX.Element> {
  let leads: Awaited<ReturnType<typeof api.vault>>['leads'] = []
  let globalFiles: string[] = []

  try {
    const [vaultRes, globalRes] = await Promise.allSettled([
      api.vault(),
      fetch(`${process.env.API_URL ?? 'http://localhost:3001'}/api/vault/_global/files`, { cache: 'no-store' })
        .then(r => r.json() as Promise<{ files: string[] }>)
    ])
    if (vaultRes.status === 'fulfilled') leads = vaultRes.value.leads ?? []
    if (globalRes.status === 'fulfilled') globalFiles = globalRes.value.files ?? []
  } catch { /* API offline */ }

  return <VaultClient initialLeads={leads} globalFiles={globalFiles} />
}
