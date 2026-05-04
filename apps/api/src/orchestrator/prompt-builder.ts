// prompt-builder.ts — Monta system prompt em camadas para o agente respondedor
import { eq } from 'drizzle-orm'
import pino from 'pino'
import { env } from '../config/env'
import { db } from '../db/client'
import { agents, settings } from '../db/schema'
import { SkillsLoader } from '../skills/loader'
import type { MemorySnapshot } from '../memory/persistent'
import { VaultManager } from '../vault-manager/manager'

export interface LeadPromptContext {
  phone: string
  name: string | null
  city: string | null
  status: string | null
  tags: string[] | null
  currentTime: string
  timezone: string
}

export interface PromptBuilderInput {
  responderId: string
  lead: LeadPromptContext
  memory: MemorySnapshot
  vaultContext: string
}

export interface PromptBuildResult {
  prompt: string
  skills: Array<{
    name: string
    priority: string | null
    order: number | null
    when_to_use: string | null
  }>
  globalFiles: string[]
  promptChars: number
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
    const result = await this.buildDetailed(input)
    return result.prompt
  }

  /**
   * Monta o system prompt e devolve metadados para debug do pipeline.
   * @param input Contexto necessário para montar o prompt.
   * @returns Prompt final e metadados de skills/vault.
   */
  async buildDetailed(input: PromptBuilderInput): Promise<PromptBuildResult> {
    const [agentName, companyName, agentTone, httpToolEnabled, configuredPrompt, skillsContext, globalContext] = await Promise.all([
      this.getSetting('agent_name', 'AtendenteAI'),
      this.getSetting('company_name', 'AttendentAI'),
      this.getSetting('agent_tone', 'humanizado, claro, breve e consultivo'),
      this.getSetting('tool_http_enabled', 'false'),
      this.getAgentSystemPrompt(input.responderId),
      this.loadSkillsContext(input.responderId),
      this.loadGlobalVaultContext()
    ])

    const recentMessages = input.memory.recent_messages
      .slice(-5)
      .map((message) => `${message.role ?? 'unknown'}: ${message.content ?? ''}`)
      .join('\n')

    const basePrompt = this.replacePromptVariables(configuredPrompt, input, agentName, companyName, agentTone)
    const prompt = [
      `CAMADA 1 — PROMPT CONFIGURADO DO AGENTE
${basePrompt || `Nome do atendente: ${agentName}
Empresa: ${companyName}
Tom e estilo: ${agentTone}`}

Contexto operacional:
Nome do atendente: ${agentName}
Empresa: ${companyName}
Tom e estilo: ${agentTone}

${antiHallucinationRules}`,
      `CAMADA 2 — SKILLS ATIVAS
${skillsContext.content || 'Nenhuma skill ativa vinculada ao respondedor.'}`,
      `CAMADA 3 — CONTEXTO DINÂMICO DO LEAD
Telefone: ${input.lead.phone}
Data/hora atual (${input.lead.timezone}): ${input.lead.currentTime}
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
${globalContext.content || 'sem contexto global cadastrado'}`,
      `CAMADA 4 — INSTRUÇÃO DE SAÍDA
Responda APENAS com o texto da mensagem final.
Siga a formatação, ordem de atendimento e restrições definidas no prompt configurado do agente.
Não use markdown, bullets ou headers quando o prompt configurado proibir; quando ele permitir, use apenas os formatos permitidos nele.
${httpToolEnabled === 'true' ? 'Use a tool http_request quando houver webhook/API e dados confirmados para executar uma ação externa.' : 'Tools externas estão desativadas para este agente no momento.'}
Se for curto e adequado para áudio, inclua [AUDIO_OK] ao final
Máximo 3 parágrafos`
    ].join('\n\n---\n\n')

    log.info({ system_prompt: prompt }, 'system prompt built')
    return {
      prompt,
      skills: skillsContext.skills,
      globalFiles: globalContext.files,
      promptChars: prompt.length
    }
  }

  private async getSetting(key: string, fallback: string): Promise<string> {
    const [setting] = await db.select().from(settings).where(eq(settings.key, key)).limit(1)
    return setting?.value ?? fallback
  }

  private async getAgentSystemPrompt(agentId: string): Promise<string> {
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1)
    return agent?.system_prompt ?? ''
  }

  private replacePromptVariables(
    prompt: string,
    input: PromptBuilderInput,
    agentName: string,
    companyName: string,
    agentTone: string
  ): string {
    return prompt
      .replace(/{agent_name}/g, agentName)
      .replace(/{company_name}/g, companyName)
      .replace(/{agent_tone}/g, agentTone)
      .replace(/{lead_name}/g, input.lead.name ?? 'não informado')
      .replace(/{lead_phone}/g, input.lead.phone)
      .replace(/{current_date}/g, input.lead.currentTime)
      .replace(/{current_time}/g, input.lead.currentTime)
      .replace(/{history_summary}/g, input.memory.history_summary || 'sem histórico')
      .replace(/{vault_context}/g, input.vaultContext || 'sem contexto relevante')
  }

  private extractInterest(leadSummary: string, vaultContext: string): string {
    const source = `${leadSummary}\n${vaultContext}`.toLowerCase()
    if (source.includes('premium')) {
      return 'plano premium'
    }

    return 'não informado'
  }

  private async loadSkillsContext(agentId: string): Promise<{
    content: string
    skills: PromptBuildResult['skills']
  }> {
    const rows = await this.skillsLoader.loadRowsForAgent(agentId)
    return {
      content: rows.map((skill) => [
        `## Skill: ${skill.name}`,
        skill.description ? `Descrição: ${skill.description}` : null,
        skill.when_to_use ? `Quando usar: ${skill.when_to_use}` : null,
        `Prioridade: ${skill.priority ?? 'medium'}`,
        skill.content
      ].filter((item): item is string => Boolean(item)).join('\n')).join('\n\n---\n\n'),
      skills: rows.map((skill) => ({
        name: skill.name,
        priority: skill.priority,
        order: skill.order,
        when_to_use: skill.when_to_use
      }))
    }
  }

  private async loadGlobalVaultContext(): Promise<{ content: string; files: string[] }> {
    const files = await this.vault.listGlobalFiles()
    const contents = await Promise.all(
      files.map(async (file) => {
        const content = await this.vault.readGlobal(file)
        return content.trim() ? `# ${file}\n${content.trim()}` : ''
      })
    )
    return {
      content: contents.filter(Boolean).join('\n\n'),
      files
    }
  }
}
