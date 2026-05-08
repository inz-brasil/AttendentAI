// manager.ts — Gerencia arquivos Markdown do vault por lead
import { eq } from 'drizzle-orm'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'

export interface VaultLeadMetadata {
  phone: string
  folder: string
  path: string
  name: string
}

function sanitizeName(name: string): string {
  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return normalized || 'Sem_Nome'
}

function buildMemoryTemplate(phone: string, name: string): string {
  const now = new Date().toISOString()

  return `---
phone: "${phone}"
name: "${name}"
created_at: "${now}"
updated_at: "${now}"
status: "novo"
tags: []
---

## Dados do Contato
- **Telefone:** ${phone}
- **Nome:** ${name}
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

function buildHistoryTemplate(name: string): string {
  return `# Histórico de Conversas — ${name}

## Resumo
[Atualizado automaticamente pelo sistema]
`
}

function buildNotesTemplate(name: string): string {
  return `# Notas — ${name}

[Anotações manuais/automáticas]
`
}

function parseLeadFolder(folder: string, vaultPath: string): VaultLeadMetadata {
  const separatorIndex = folder.indexOf('-')
  const phone = separatorIndex >= 0 ? folder.slice(0, separatorIndex) : folder
  const rawName = separatorIndex >= 0 ? folder.slice(separatorIndex + 1) : ''

  return {
    phone,
    folder,
    path: join(vaultPath, folder),
    name: rawName.replace(/_/g, ' ')
  }
}

export class VaultManager {
  private readonly rootPath: string

  constructor(rootPath = './vault') {
    this.rootPath = rootPath
  }

  /** Cria instância com subdiretório de tenant isolado. */
  static forTenant(basePath: string, tenantId: string): VaultManager {
    return new VaultManager(join(basePath, tenantId))
  }

  /**
   * Cria a pasta de um lead e os arquivos padrão quando necessário.
   * @param phone Telefone do lead.
   * @param name Nome do lead.
   * @returns Caminho da pasta do lead.
   */
  async ensureLeadFolder(phone: string, name: string): Promise<string> {
    await mkdir(this.rootPath, { recursive: true })

    const existingPath = await this.findLeadPath(phone)
    if (existingPath) {
      return existingPath
    }

    const leadPath = join(this.rootPath, `${phone}-${sanitizeName(name)}`)
    await mkdir(leadPath, { recursive: true })
    await this.ensureDefaultFiles(leadPath, phone, name)
    return leadPath
  }

  /**
   * Lê um arquivo Markdown do lead.
   * @param phone Telefone do lead.
   * @param filename Nome do arquivo.
   * @returns Conteúdo do arquivo ou string vazia se não existir.
   */
  async read(phone: string, filename: string): Promise<string> {
    const leadPath = await this.getExistingOrDefaultLeadPath(phone)
    const filePath = this.resolveFilePath(leadPath, filename)

    if (!existsSync(filePath)) {
      return ''
    }

    return readFile(filePath, 'utf8')
  }

  /**
   * Escreve ou sobrescreve um arquivo Markdown do lead.
   * @param phone Telefone do lead.
   * @param filename Nome do arquivo.
   * @param content Conteúdo completo.
   * @returns Nada.
   */
  async write(phone: string, filename: string, content: string): Promise<void> {
    const leadPath = await this.getExistingOrDefaultLeadPath(phone)
    await mkdir(leadPath, { recursive: true })
    await writeFile(this.resolveFilePath(leadPath, filename), content, 'utf8')
  }

  /**
   * Adiciona conteúdo ao final de um arquivo Markdown.
   * @param phone Telefone do lead.
   * @param filename Nome do arquivo.
   * @param content Conteúdo a anexar.
   * @returns Nada.
   */
  async append(phone: string, filename: string, content: string): Promise<void> {
    const previous = await this.read(phone, filename)
    const nextContent = previous.trim().length > 0 ? `${previous.trim()}\n\n---\n\n${content}\n` : `${content}\n`
    await this.write(phone, filename, nextContent)
  }

  /**
   * Lista pastas de leads no vault com metadados básicos.
   * @returns Lista de leads encontrados.
   */
  async listLeads(): Promise<VaultLeadMetadata[]> {
    await mkdir(this.rootPath, { recursive: true })
    const entries = await readdir(this.rootPath, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => entry.name !== '_global')
      .map((entry) => parseLeadFolder(entry.name, this.rootPath))
  }

  /**
   * Lista arquivos de um lead.
   * @param phone Telefone do lead.
   * @returns Nomes dos arquivos.
   */
  async listFiles(phone: string): Promise<string[]> {
    const leadPath = await this.getExistingOrDefaultLeadPath(phone)
    await mkdir(leadPath, { recursive: true })
    const entries = await readdir(leadPath, { withFileTypes: true })
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  }

  /**
   * Apaga a pasta inteira de um lead.
   * @param phone Telefone do lead.
   * @returns Nada.
   */
  async delete(phone: string): Promise<void> {
    const leadPath = await this.findLeadPath(phone)
    if (!leadPath) {
      return
    }

    await rm(leadPath, { recursive: true, force: true })
  }

  /**
   * Apaga historico.md e mensagens do banco, mantendo memoria.md e notas.md.
   * @param phone Telefone do lead.
   * @param tenantId Tenant isolado (default: 'default').
   * @returns Nada.
   */
  async deleteHistory(phone: string, tenantId = 'default'): Promise<void> {
    const leadPath = await this.getExistingOrDefaultLeadPath(phone)
    await writeFile(this.resolveFilePath(leadPath, 'historico.md'), buildHistoryTemplate(phone), 'utf8')
    const [{ db }, { conversations, messages }, { and }] = await Promise.all([
      import('../db/client'),
      import('../db/schema'),
      import('drizzle-orm')
    ])
    await db.delete(messages).where(and(eq(messages.tenant_id, tenantId), eq(messages.lead_phone, phone)))
    await db.delete(conversations).where(and(eq(conversations.tenant_id, tenantId), eq(conversations.lead_phone, phone)))
  }

  private async ensureDefaultFiles(leadPath: string, phone: string, name: string): Promise<void> {
    await this.writeFileIfMissing(join(leadPath, 'memoria.md'), buildMemoryTemplate(phone, name))
    await this.writeFileIfMissing(join(leadPath, 'historico.md'), buildHistoryTemplate(name))
    await this.writeFileIfMissing(join(leadPath, 'notas.md'), buildNotesTemplate(name))
  }

  private async writeFileIfMissing(filePath: string, content: string): Promise<void> {
    if (!existsSync(filePath)) {
      await writeFile(filePath, content, 'utf8')
    }
  }

  private async getExistingOrDefaultLeadPath(phone: string): Promise<string> {
    return (await this.findLeadPath(phone)) ?? join(this.rootPath, phone)
  }

  private async findLeadPath(phone: string): Promise<string | null> {
    await mkdir(this.rootPath, { recursive: true })
    const leads = await this.listLeads()
    const lead = leads.find((entry) => entry.phone === phone)
    return lead?.path ?? null
  }

  private resolveFilePath(leadPath: string, filename: string): string {
    const safeName = basename(filename)
    if (!safeName.endsWith('.md')) {
      throw new Error('Vault files must be Markdown')
    }

    const resolvedLeadPath = resolve(leadPath)
    const resolvedFilePath = resolve(leadPath, safeName)

    if (!resolvedFilePath.startsWith(resolvedLeadPath)) {
      throw new Error('Invalid vault path')
    }

    return resolvedFilePath
  }

  /** Retorna o caminho da pasta _global, criando-a se necessário. */
  private async getGlobalPath(): Promise<string> {
    const globalPath = join(this.rootPath, '_global')
    await mkdir(globalPath, { recursive: true })
    // Cria arquivos padrão se não existirem
    const defaults: Record<string, string> = {
      'conhecimento-base.md': `# Conhecimento Base\n\nInsira aqui as informações do negócio (FAQ, produtos, políticas) que o agente deve conhecer.\n`,
      'politicas.md': `# Políticas\n\nDescreva as políticas da empresa: atendimento, reembolso, SLA, etc.\n`,
      'scripts-vendas.md': `# Scripts de Vendas\n\nTemplates e abordagens recomendadas para conversas de vendas.\n`
    }
    for (const [name, content] of Object.entries(defaults)) {
      const fp = join(globalPath, name)
      if (!existsSync(fp)) await writeFile(fp, content, 'utf-8')
    }
    return globalPath
  }

  /**
   * Lista arquivos da pasta _global.
   * @returns Array de nomes de arquivo.
   */
  async listGlobalFiles(): Promise<string[]> {
    const globalPath = await this.getGlobalPath()
    const entries = await readdir(globalPath)
    return entries.filter(f => f.endsWith('.md')).sort()
  }

  /**
   * Lê arquivo da pasta _global.
   * @param filename Nome do arquivo.
   * @returns Conteúdo do arquivo.
   */
  async readGlobal(filename: string): Promise<string> {
    const globalPath = await this.getGlobalPath()
    const safe = basename(filename)
    if (!safe.endsWith('.md')) throw new Error('Only .md files allowed')
    const fp = join(globalPath, safe)
    if (!existsSync(fp)) return ''
    return readFile(fp, 'utf-8')
  }

  /**
   * Escreve arquivo na pasta _global.
   * @param filename Nome do arquivo.
   * @param content Conteúdo a salvar.
   * @returns Nada.
   */
  async writeGlobal(filename: string, content: string): Promise<void> {
    const globalPath = await this.getGlobalPath()
    const safe = basename(filename)
    if (!safe.endsWith('.md')) throw new Error('Only .md files allowed')
    await writeFile(join(globalPath, safe), content, 'utf-8')
  }
}
