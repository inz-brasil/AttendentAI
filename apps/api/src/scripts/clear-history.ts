// clear-history.ts — Limpa todos os layers de memória de um contato específico
// Modo API (recomendado): chama DELETE /api/leads/:phone/history (inclui broadcast para dashboard)
// Modo direto (fallback): acessa DB e vault diretamente quando API não está disponível
import { and, eq } from 'drizzle-orm'
import { existsSync } from 'node:fs'
import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { closeDb, db } from '../db/client'
import { conversations, messageEvents, messages } from '../db/schema'
import { env } from '../config/env'

const [phone, tenantId = 'default'] = process.argv.slice(2)

if (!phone) {
  console.error('Uso: bun run src/scripts/clear-history.ts <phone> [tenant_id]')
  console.error('Exemplo: bun run src/scripts/clear-history.ts 556791229532 default')
  process.exit(1)
}

const VAULT_ROOT = env.VAULT_PATH

function buildMemoryTemplate(phone: string): string {
  const now = new Date().toISOString()
  return `---
phone: "${phone}"
name: "(não informado)"
created_at: "${now}"
updated_at: "${now}"
status: "novo"
tags: []
---

## Dados do Contato
- **Telefone:** ${phone}
- **Nome:** (não informado)
- **Cidade:** (não informado)
- **Email:** (não informado)

## Perfil
- **Interesse principal:** (não informado)
- **Dor relatada:** (não informado)
- **Objeção principal:** (não informado)
- **Decisor:** (não informado)

## Estágio
- **Status atual:** Novo lead
- **Próximo passo:** (não definido)
- **Data do próximo contato:** (não definida)
`
}

/**
 * Encontra a pasta do lead no vault filtrando por prefixo de phone.
 * @param phone Telefone do lead.
 * @returns Caminho absoluto da pasta ou null se não encontrada.
 */
async function findLeadVaultPath(phone: string): Promise<string | null> {
  if (!existsSync(VAULT_ROOT)) return null
  const entries = await readdir(VAULT_ROOT, { withFileTypes: true })
  const match = entries
    .filter((e) => e.isDirectory() && e.name !== '_global')
    .find((e) => e.name === phone || e.name.startsWith(`${phone}-`))
  return match ? join(VAULT_ROOT, match.name) : null
}

/**
 * Reseta arquivos de memória do vault para templates em branco.
 * @param phone Telefone do lead.
 * @returns Número de arquivos resetados.
 */
async function resetVaultFiles(phone: string): Promise<number> {
  const leadPath = await findLeadVaultPath(phone)
  if (!leadPath) {
    console.log('  vault: pasta não encontrada, pulando')
    return 0
  }

  const files: Record<string, string> = {
    'memoria.md': buildMemoryTemplate(phone),
    'historico.md': `# Histórico de Conversas\n\nSem histórico.\n`,
    'notas.md': `# Notas\n\n[Sem notas]\n`
  }

  let count = 0
  for (const [filename, content] of Object.entries(files)) {
    const fp = join(leadPath, filename)
    if (existsSync(fp)) {
      await writeFile(fp, content, 'utf-8')
      count++
    }
  }

  console.log(`  vault: ${count} arquivos resetados em ${leadPath}`)
  return count
}

async function clearHistory(phone: string, tenantId: string): Promise<void> {
  console.log(`\nLimpando histórico completo de ${phone} (tenant: ${tenantId})...\n`)

  const [msgResult, convResult, evtResult] = await Promise.all([
    db.delete(messages).where(and(eq(messages.tenant_id, tenantId), eq(messages.lead_phone, phone))).returning(),
    db.delete(conversations).where(and(eq(conversations.tenant_id, tenantId), eq(conversations.lead_phone, phone))).returning(),
    db.delete(messageEvents).where(and(eq(messageEvents.tenant_id, tenantId), eq(messageEvents.lead_phone, phone))).returning()
  ])

  console.log(`  messages:      ${msgResult.length} registros removidos`)
  console.log(`  conversations: ${convResult.length} registros removidos`)
  console.log(`  messageEvents: ${evtResult.length} registros removidos`)

  await resetVaultFiles(phone)

  console.log('\nHistórico limpo com sucesso.\n')
}

try {
  await clearHistory(phone, tenantId)
} finally {
  closeDb()
}
