// prompt-builder.ts — Monta system prompt em camadas para o agente respondedor
import { eq } from 'drizzle-orm'
import pino from 'pino'
import { env } from '../config/env'
import { db } from '../db/client'
import { settings } from '../db/schema'
import { SkillsLoader } from '../skills/loader'
import type { MemorySnapshot } from '../memory/persistent'
import { VaultManager } from '../vault-manager/manager'

export interface LeadPromptContext {
  name: string | null
  city: string | null
  status: string | null
  tags: string[] | null
}

export interface PromptBuilderInput {
  responderId: string
  lead: LeadPromptContext
  memory: MemorySnapshot
  vaultContext: string
}

const log = pino({ name: 'attendentai-prompt-builder' })

const antiHallucinationRules = `REGRAS INVIOLÁVEIS:
1. Se você não tem certeza de uma informação, NÃO a invente
2. Se não encontrou a informação nos dados fornecidos, use: "Vou verificar isso para você"
3. Nunca invente preços, prazos, funcionalidades ou políticas
4. Responda apenas com base no contexto fornecido
5. Em caso de dúvida, prefira pedir mais informações ao usuário`

export class PromptBuilder {
  private readonly skillsLoader = new SkillsLoader()
  private readonly vault = new VaultManager(env.VAULT_PATH)

  /**
   * Monta o system prompt do respondedor em quatro camadas.
   * @param input Contexto necessário para montar o prompt.
   * @returns System prompt final.
   */
  async build(input: PromptBuilderInput): Promise<string> {
    const [agentName, companyName, agentTone, skillsContext, globalContext] = await Promise.all([
      this.getSetting('agent_name', 'AtendenteAI'),
      this.getSetting('company_name', 'AttendentAI'),
      this.getSetting('agent_tone', 'humanizado, claro, breve e consultivo'),
      this.skillsLoader.loadForAgent(input.responderId),
      this.loadGlobalVaultContext()
    ])

    const recentMessages = input.memory.recent_messages
      .slice(-5)
      .map((message) => `${message.role ?? 'unknown'}: ${message.content ?? ''}`)
      .join('\n')

    const prompt = [
      `CAMADA 1 — IDENTIDADE BASE
Nome do atendente: ${agentName}
Empresa: ${companyName}
Tom e estilo: ${agentTone}

${antiHallucinationRules}`,
      `CAMADA 2 — SKILLS ATIVAS
${skillsContext || 'Nenhuma skill ativa vinculada ao respondedor.'}`,
      `CAMADA 3 — CONTEXTO DINÂMICO DO LEAD
Nome: ${input.lead.name ?? 'não informado'}
Cidade: ${input.lead.city ?? 'não informada'}
Interesse: ${this.extractInterest(input.memory.lead_summary, input.vaultContext)}
Estágio: ${input.lead.status ?? 'não informado'}
Tags: ${input.lead.tags?.join(', ') || 'sem tags'}

Resumo das últimas mensagens:
${recentMessages || 'sem mensagens recentes'}

Contexto relevante do vault:
${input.vaultContext || 'sem contexto relevante'}

Contexto global aprovado:
${globalContext || 'sem contexto global cadastrado'}`,
      `CAMADA 4 — INSTRUÇÃO DE SAÍDA
Responda APENAS com o texto da mensagem
Sem markdown, sem bullets, sem headers
Se for curto e adequado para áudio, inclua [AUDIO_OK] ao final
Máximo 3 parágrafos`
    ].join('\n\n---\n\n')

    log.info({ system_prompt: prompt }, 'system prompt built')
    return prompt
  }

  private async getSetting(key: string, fallback: string): Promise<string> {
    const [setting] = await db.select().from(settings).where(eq(settings.key, key)).limit(1)
    return setting?.value ?? fallback
  }

  private extractInterest(leadSummary: string, vaultContext: string): string {
    const source = `${leadSummary}\n${vaultContext}`.toLowerCase()
    if (source.includes('premium')) {
      return 'plano premium'
    }

    return 'não informado'
  }

  private async loadGlobalVaultContext(): Promise<string> {
    const files = await this.vault.listGlobalFiles()
    const contents = await Promise.all(
      files.map(async (file) => {
        const content = await this.vault.readGlobal(file)
        return content.trim() ? `# ${file}\n${content.trim()}` : ''
      })
    )
    return contents.filter(Boolean).join('\n\n')
  }
}
