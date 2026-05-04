// seed.ts — Insere agentes e skills padrão de forma idempotente
import { eq } from 'drizzle-orm'
import { db, closeDb } from './client'
import { agentSkills, agents, settings, skills } from './schema'

const now = new Date()

async function readSkillTemplate(filename: string): Promise<string> {
  return Bun.file(new URL(`../skills/templates/${filename}`, import.meta.url)).text()
}

const defaultAgents = [
  {
    id: 'classifier',
    name: 'Classifier',
    description: 'Classifica intenção, sentimento e tipo de mensagem recebida.',
    type: 'classifier' as const,
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_tokens: 500,
    system_prompt:
      'Classifique a mensagem do lead em JSON estruturado. Não invente dados ausentes e use apenas o texto recebido.'
  },
  {
    id: 'identifier',
    name: 'Identifier',
    description: 'Extrai dados explícitos do lead e identifica atualizações de perfil.',
    type: 'identifier' as const,
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_tokens: 700,
    system_prompt:
      'Extraia somente informações declaradas pelo lead. Retorne JSON validável e ignore inferências sem evidência.'
  },
  {
    id: 'responder',
    name: 'Responder',
    description: 'Gera a resposta final humanizada com base no contexto confirmado.',
    type: 'responder' as const,
    model: 'gpt-4o',
    temperature: 0.3,
    max_tokens: 800,
    system_prompt:
      'Responda de forma clara e humana usando apenas o contexto fornecido. Se faltar informação, diga: "Vou verificar isso para você".'
  },
  {
    id: 'memory-agent',
    name: 'Memory Agent',
    description: 'Lê, resume e registra memória persistente do lead.',
    type: 'memory' as const,
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_tokens: 800,
    system_prompt:
      'Organize a memória do lead com fatos verificáveis, histórico resumido e próximos passos. Não registre suposições.'
  },
  {
    id: 'internal-assistant',
    name: 'Assistente Interno',
    description: 'Atende operadores autorizados e opera a plataforma com tools internas.',
    type: 'internal' as const,
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_tokens: 900,
    system_prompt:
      'Você é o assistente interno do AttendentAI. Consulte dados reais com tools, ajude a resumir leads, gerar relatórios e enviar dados para webhooks quando solicitado.'
  }
]

const defaultSkillDefinitions = [
  {
    id: 'atendimento-geral',
    name: 'Atendimento Geral',
    slug: 'atendimento-geral',
    description: 'Fluxo base para atendimento inicial e dúvidas gerais.',
    category: 'atendimento',
    when_to_use: 'Use quando a intenção não se encaixar em uma skill mais específica.',
    priority: 'medium' as const,
    template: 'atendimento-geral.md'
  },
  {
    id: 'vendas',
    name: 'Vendas',
    slug: 'vendas',
    description: 'Condução de conversas com intenção comercial.',
    category: 'vendas',
    when_to_use: 'Use quando o lead demonstrar interesse em contratar, comprar ou comparar planos.',
    priority: 'high' as const,
    template: 'vendas.md'
  },
  {
    id: 'suporte',
    name: 'Suporte',
    slug: 'suporte',
    description: 'Atendimento para dúvidas técnicas, problemas e solicitações de ajuda.',
    category: 'suporte',
    when_to_use: 'Use quando o lead relatar erro, bloqueio, problema ou dúvida operacional.',
    priority: 'high' as const,
    template: 'suporte.md'
  },
  {
    id: 'qualificacao',
    name: 'Qualificação',
    slug: 'qualificacao',
    description: 'Perguntas para entender perfil, necessidade e estágio do lead.',
    category: 'vendas',
    when_to_use: 'Use quando faltarem dados para identificar fit, urgência ou decisor.',
    priority: 'medium' as const,
    template: 'qualificacao.md'
  },
  {
    id: 'agendamento',
    name: 'Agendamento',
    slug: 'agendamento',
    description: 'Fluxo para marcar reuniões, demonstrações ou próximos contatos.',
    category: 'atendimento',
    when_to_use: 'Use quando o lead pedir reunião, demonstração, ligação ou retorno em data específica.',
    priority: 'high' as const,
    template: 'agendamento.md'
  },
  {
    id: 'reativacao',
    name: 'Reativação',
    slug: 'reativacao',
    description: 'Retomada de conversa com leads inativos.',
    category: 'vendas',
    when_to_use: 'Use quando o lead voltar após longo intervalo ou quando houver tentativa ativa de retomada.',
    priority: 'low' as const,
    template: 'reativacao.md'
  }
]

const defaultSettings = [
  {
    key: 'agent_name',
    value: 'AtendenteAI',
    description: 'Nome exibido/usado pelo atendente principal'
  },
  {
    key: 'company_name',
    value: 'AttendentAI',
    description: 'Nome da empresa atendida pelo agente'
  },
  {
    key: 'agent_tone',
    value: 'humanizado, claro, breve e consultivo',
    description: 'Tom padrão das respostas do agente'
  },
  {
    key: 'internal_assistant_contacts',
    value: '',
    description: 'Telefones ou JIDs autorizados para o assistente interno, separados por vírgula ou linha'
  },
  {
    key: 'tool_http_enabled',
    value: 'false',
    description: 'Habilita a tool http_request para o agente respondedor'
  }
]

/**
 * Insere registros padrão sem duplicar dados já existentes.
 * @returns Nada.
 */
async function seed(): Promise<void> {
  const defaultSkills = await Promise.all(
    defaultSkillDefinitions.map(async (skill) => ({
      ...skill,
      content: await readSkillTemplate(skill.template)
    }))
  )

  await db
    .insert(agents)
    .values(defaultAgents.map((agent) => ({ ...agent, updated_at: now })))
    .onConflictDoNothing()

  await db
    .insert(settings)
    .values(defaultSettings.map((setting) => ({ ...setting, updated_at: now })))
    .onConflictDoNothing()

  await db
    .insert(skills)
    .values(defaultSkills.map(({ template, ...skill }) => ({ ...skill, updated_at: now })))
    .onConflictDoNothing()

  const existingResponderSkills = await db.select().from(agentSkills).where(eq(agentSkills.agent_id, 'responder'))
  if (existingResponderSkills.length === 0) {
    await db.insert(agentSkills).values(
      defaultSkills.map((skill, index) => ({
        agent_id: 'responder',
        skill_id: skill.id,
        order: index
      }))
    )
  }
}

try {
  await seed()
  closeDb()
} catch (error) {
  closeDb()
  throw error
}
