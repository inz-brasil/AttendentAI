// business-vault.ts — Persiste perfil empresarial configurado no dashboard como memória semântica do tenant
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from './env'
import type { ConfigSection } from './dashboard-config'

const businessFields = [
  ['tenant_id', 'Tenant'],
  ['company_name', 'Empresa'],
  ['summary', 'Resumo do negócio'],
  ['products_services', 'Produtos e serviços'],
  ['target_audience', 'Público-alvo'],
  ['tone', 'Tom de atendimento'],
  ['policies', 'Políticas e regras'],
  ['website', 'Site']
] as const

/**
 * Grava o perfil empresarial no vault do tenant após atualização do onboarding.
 * @param config Configuração pública da seção business.
 * @returns Nada.
 */
export async function writeBusinessProfileVault(config: ConfigSection): Promise<void> {
  const tenantId = sanitizeTenantId(String(config.tenant_id ?? 'default'))
  const dir = join(env.VAULT_PATH, 'tenants', tenantId)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'empresa.md'), buildBusinessProfileText(config), 'utf8')
}

function buildBusinessProfileText(config: ConfigSection): string {
  const lines = ['# Perfil da empresa', '']
  for (const [key, label] of businessFields) {
    const value = String(config[key] ?? '').trim()
    if (value) {
      lines.push(`## ${label}`, value, '')
    }
  }

  lines.push(`Atualizado em: ${new Date().toISOString()}`)
  return lines.join('\n')
}

function sanitizeTenantId(value: string): string {
  const clean = value.replace(/[^a-zA-Z0-9_-]/g, '').trim()
  return clean || 'default'
}
