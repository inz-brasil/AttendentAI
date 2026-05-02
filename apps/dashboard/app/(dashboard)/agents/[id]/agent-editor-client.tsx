'use client'
// agent-editor-client.tsx — Editor completo de agente com 4 abas (Radix Tabs)
import { useState, useCallback } from 'react'
import Link from 'next/link'
import * as Tabs from '@radix-ui/react-tabs'
import { Badge } from '../../../../components/ui/badge'
import { CodeEditor } from '../../../../components/ui/code-editor'
import { useToast } from '../../../../components/ui/toast-provider'
import type { Agent, AgentMetrics, AgentSkillRow, Skill } from '../../../../lib/api'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

const MODELS = [
  { value: 'gpt-4o', label: 'GPT-4o' },
  { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' }
]

const AGENT_TYPES = ['orchestrator', 'classifier', 'responder', 'memory', 'identifier', 'custom'] as const

const PROMPT_VARS = [
  { key: '{lead_name}', desc: 'Nome do lead' },
  { key: '{lead_city}', desc: 'Cidade do lead' },
  { key: '{lead_status}', desc: 'Status atual do lead' },
  { key: '{history_summary}', desc: 'Resumo das últimas conversas' },
  { key: '{current_date}', desc: 'Data e hora atual (pt-BR)' },
  { key: '{lead_tags}', desc: 'Tags do lead separadas por vírgula' },
  { key: '{agent_name}', desc: 'Nome deste agente' }
]

// Preço estimado por 1k tokens (média input+output)
const MODEL_PRICE: Record<string, number> = {
  'gpt-4o': 0.005,
  'gpt-4o-mini': 0.00015,
  'gpt-4-turbo': 0.015,
  'gpt-3.5-turbo': 0.0005
}

interface AgentSkillState {
  skill_id: string
  order: number
  enabled: boolean
}

interface AgentEditorClientProps {
  initialAgent: Agent
  allSkills: Skill[]
  initialAgentSkills: AgentSkillRow[]
  initialMetrics: AgentMetrics
}

/**
 * Editor completo de agente com 4 abas: Identidade, System Prompt, Skills, Métricas.
 * @param props Dados iniciais do agente, skills e métricas.
 * @returns Editor tabbed.
 */
export function AgentEditorClient({
  initialAgent,
  allSkills,
  initialAgentSkills,
  initialMetrics
}: AgentEditorClientProps): JSX.Element {
  const { toast } = useToast()

  // Aba Identidade
  const [identity, setIdentity] = useState({
    name: initialAgent.name,
    description: initialAgent.description ?? '',
    model: initialAgent.model ?? 'gpt-4o-mini',
    type: initialAgent.type ?? 'custom',
    temperature: initialAgent.temperature ?? 0.3,
    max_tokens: initialAgent.max_tokens ?? 1000,
    is_active: initialAgent.is_active ?? true
  })
  const [savingIdentity, setSavingIdentity] = useState(false)

  // Aba System Prompt
  const [systemPrompt, setSystemPrompt] = useState(initialAgent.system_prompt ?? '')
  const [savingPrompt, setSavingPrompt] = useState(false)

  // Aba Skills — inicializa com os skill_ids vinculados
  const enabledIds = new Set(initialAgentSkills.map(s => s.skill_id).filter(Boolean) as string[])
  const [agentSkillList, setAgentSkillList] = useState<AgentSkillState[]>(
    allSkills.map((s, i) => ({
      skill_id: s.id,
      order: initialAgentSkills.find(r => r.skill_id === s.id)?.order ?? i,
      enabled: enabledIds.has(s.id)
    }))
  )
  const [savingSkills, setSavingSkills] = useState(false)
  const [dragging, setDragging] = useState<number | null>(null)

  // ------- HANDLERS -------

  async function saveIdentity() {
    setSavingIdentity(true)
    try {
      const res = await fetch(`${API_BASE}/api/agents/${encodeURIComponent(initialAgent.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...identity, temperature: Number(identity.temperature) })
      })
      if (!res.ok) throw new Error()
      toast({ title: 'Identidade salva', variant: 'success' })
    } catch {
      toast({ title: 'Erro ao salvar identidade', variant: 'danger' })
    } finally {
      setSavingIdentity(false)
    }
  }

  async function savePrompt() {
    setSavingPrompt(true)
    try {
      const res = await fetch(`${API_BASE}/api/agents/${encodeURIComponent(initialAgent.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system_prompt: systemPrompt })
      })
      if (!res.ok) throw new Error()
      toast({ title: 'System prompt salvo', variant: 'success' })
    } catch {
      toast({ title: 'Erro ao salvar system prompt', variant: 'danger' })
    } finally {
      setSavingPrompt(false)
    }
  }

  async function saveSkills() {
    setSavingSkills(true)
    try {
      const payload = agentSkillList
        .filter(s => s.enabled)
        .map(s => ({ skill_id: s.skill_id, order: s.order }))
      const res = await fetch(`${API_BASE}/api/agents/${encodeURIComponent(initialAgent.id)}/skills`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skills: payload })
      })
      if (!res.ok) throw new Error()
      toast({ title: `${payload.length} skills salvas`, variant: 'success' })
    } catch {
      toast({ title: 'Erro ao salvar skills', variant: 'danger' })
    } finally {
      setSavingSkills(false)
    }
  }

  /** Insere variável no sistema prompt ao cursor (inserção simples) */
  const insertVar = useCallback((varKey: string) => {
    setSystemPrompt(prev => prev + varKey)
  }, [])

  // ------- DRAG & DROP para reordenar skills -------
  function handleDragStart(idx: number) { setDragging(idx) }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault()
    if (dragging === null || dragging === idx) return
    setAgentSkillList(prev => {
      const next = [...prev]
      const moved = next.splice(dragging, 1)[0]
      if (!moved) return prev
      next.splice(idx, 0, moved)
      // Recalcula order
      return next.map((s, i) => ({ ...s, order: i }))
    })
    setDragging(idx)
  }

  function handleDragEnd() { setDragging(null) }

  function toggleSkill(skill_id: string) {
    setAgentSkillList(prev => prev.map(s => s.skill_id === skill_id ? { ...s, enabled: !s.enabled } : s))
  }

  // Preço do modelo selecionado
  const pricePerK = MODEL_PRICE[identity.model] ?? 0.001
  const estimatedCost = (initialMetrics.total_tokens / 1000) * pricePerK

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted">
          <Link href="/agents" className="hover:text-accent transition">Agentes</Link>
          <span>/</span>
          <span className="text-ink">{identity.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={identity.is_active ? 'success' : 'muted'}>
            {identity.is_active ? 'Ativo' : 'Inativo'}
          </Badge>
          <span className="font-mono text-xs text-muted">{initialAgent.id.slice(0, 8)}…</span>
        </div>
      </div>

      {/* Tabs */}
      <Tabs.Root defaultValue="identity">
        <Tabs.List className="flex border-b border-line gap-1">
          {[
            { value: 'identity', label: 'Identidade' },
            { value: 'prompt', label: 'System Prompt' },
            { value: 'skills', label: 'Skills' },
            { value: 'metrics', label: 'Métricas' }
          ].map(tab => (
            <Tabs.Trigger
              key={tab.value}
              value={tab.value}
              className="relative px-5 py-3 text-sm text-muted transition hover:text-ink data-[state=active]:text-accent data-[state=active]:after:absolute data-[state=active]:after:bottom-0 data-[state=active]:after:left-0 data-[state=active]:after:right-0 data-[state=active]:after:h-0.5 data-[state=active]:after:bg-accent"
            >
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        {/* ABA: Identidade */}
        <Tabs.Content value="identity" className="mt-5">
          <div className="max-w-2xl space-y-5">
            <FormField label="Nome do agente">
              <input
                value={identity.name}
                onChange={e => setIdentity(p => ({ ...p, name: e.target.value }))}
                className="field-input"
                placeholder="Ex: Classificador de Intenção"
              />
            </FormField>

            <FormField label="Descrição">
              <textarea
                value={identity.description}
                onChange={e => setIdentity(p => ({ ...p, description: e.target.value }))}
                rows={3}
                className="field-input resize-none"
                placeholder="O que este agente faz…"
              />
            </FormField>

            <div className="grid grid-cols-2 gap-4">
              <FormField label="Tipo">
                <select
                  value={identity.type}
                  onChange={e => setIdentity(p => ({ ...p, type: e.target.value }))}
                  className="field-input"
                >
                  {AGENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </FormField>
              <FormField label="Modelo LLM">
                <select
                  value={identity.model}
                  onChange={e => setIdentity(p => ({ ...p, model: e.target.value }))}
                  className="field-input"
                >
                  {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </FormField>
            </div>

            {/* Temperatura com slider */}
            <FormField label={`Temperatura — ${identity.temperature}`}>
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-muted">0.0</span>
                <input
                  type="range" min={0} max={1} step={0.1}
                  value={identity.temperature}
                  onChange={e => setIdentity(p => ({ ...p, temperature: parseFloat(e.target.value) }))}
                  className="flex-1 accent-accent cursor-pointer"
                />
                <span className="font-mono text-xs text-muted">1.0</span>
              </div>
              <div className="mt-1 flex justify-between font-mono text-[10px] text-muted/50">
                <span>Determinístico</span>
                <span>Criativo</span>
              </div>
            </FormField>

            <FormField label="Max tokens">
              <input
                type="number" min={100} max={8000} step={100}
                value={identity.max_tokens}
                onChange={e => setIdentity(p => ({ ...p, max_tokens: parseInt(e.target.value) || 1000 }))}
                className="field-input w-36"
              />
            </FormField>

            {/* Toggle ativo */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIdentity(p => ({ ...p, is_active: !p.is_active }))}
                className={`relative h-6 w-11 rounded-full border transition ${identity.is_active ? 'bg-success/20 border-success/40' : 'bg-canvas border-line'}`}
              >
                <span className={`absolute top-0.5 h-5 w-5 rounded-full transition-all ${identity.is_active ? 'left-5 bg-success' : 'left-0.5 bg-muted/40'}`} />
              </button>
              <span className="text-sm text-ink">{identity.is_active ? 'Agente ativo' : 'Agente inativo'}</span>
            </div>

            <button
              onClick={saveIdentity}
              disabled={savingIdentity}
              className="save-btn"
            >
              {savingIdentity ? 'Salvando…' : 'Salvar identidade'}
            </button>
          </div>
        </Tabs.Content>

        {/* ABA: System Prompt */}
        <Tabs.Content value="prompt" className="mt-5">
          <div className="grid gap-5 xl:grid-cols-[1fr_240px]">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink">System Prompt</h3>
                <span className="font-mono text-xs text-muted">{systemPrompt.length} chars</span>
              </div>
              <CodeEditor
                value={systemPrompt}
                onChange={setSystemPrompt}
                lang="markdown"
                minHeight={400}
                placeholder="Você é um assistente…"
              />
              <div className="flex justify-end">
                <button onClick={savePrompt} disabled={savingPrompt} className="save-btn">
                  {savingPrompt ? 'Salvando…' : 'Salvar system prompt'}
                </button>
              </div>
            </div>

            {/* Painel de variáveis */}
            <div className="rounded-xl bg-panel border border-line p-4 shadow-panel h-fit">
              <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted mb-3">Variáveis disponíveis</div>
              <div className="space-y-2">
                {PROMPT_VARS.map(v => (
                  <button
                    key={v.key}
                    onClick={() => insertVar(v.key)}
                    className="focus-ring w-full rounded-md bg-canvas border border-line p-2.5 text-left hover:border-accent/40 hover:bg-accent/5 transition"
                    title={`Inserir ${v.key}`}
                  >
                    <div className="font-mono text-[11px] text-accent">{v.key}</div>
                    <div className="mt-0.5 text-[10px] text-muted">{v.desc}</div>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[10px] text-muted/50">Clique para inserir ao final do prompt.</p>
            </div>
          </div>
        </Tabs.Content>

        {/* ABA: Skills */}
        <Tabs.Content value="skills" className="mt-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted">
                {agentSkillList.filter(s => s.enabled).length} de {agentSkillList.length} skills habilitadas · Arraste para reordenar.
              </p>
              <button onClick={saveSkills} disabled={savingSkills} className="save-btn">
                {savingSkills ? 'Salvando…' : 'Salvar skills'}
              </button>
            </div>

            <div className="rounded-xl border border-line overflow-hidden">
              {agentSkillList.length === 0 ? (
                <div className="py-12 text-center text-muted text-sm">Nenhuma skill cadastrada.</div>
              ) : (
                <div className="divide-y divide-line">
                  {agentSkillList.map((item, idx) => {
                    const skill = allSkills.find(s => s.id === item.skill_id)
                    return (
                      <div
                        key={item.skill_id}
                        draggable
                        onDragStart={() => handleDragStart(idx)}
                        onDragOver={e => handleDragOver(e, idx)}
                        onDragEnd={handleDragEnd}
                        className={`flex items-center gap-4 px-4 py-3.5 bg-canvas transition ${dragging === idx ? 'opacity-50' : 'hover:bg-elevated'}`}
                      >
                        {/* Drag handle */}
                        <div className="cursor-grab text-muted/30 hover:text-muted transition" aria-label="Arrastar">
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="9" cy="7" r="1.5"/><circle cx="15" cy="7" r="1.5"/>
                            <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                            <circle cx="9" cy="17" r="1.5"/><circle cx="15" cy="17" r="1.5"/>
                          </svg>
                        </div>

                        {/* Ordem */}
                        <span className="font-mono text-[11px] text-muted/50 tabular-nums w-5 shrink-0">
                          {String(idx + 1).padStart(2, '0')}
                        </span>

                        {/* Checkbox */}
                        <button
                          onClick={() => toggleSkill(item.skill_id)}
                          className={`h-5 w-5 shrink-0 rounded border transition ${
                            item.enabled
                              ? 'bg-accent/20 border-accent/50'
                              : 'bg-canvas border-line'
                          } flex items-center justify-center`}
                        >
                          {item.enabled && (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-accent">
                              <path d="M20 6L9 17l-5-5"/>
                            </svg>
                          )}
                        </button>

                        {/* Info da skill */}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-ink truncate">{skill?.name ?? item.skill_id}</div>
                          {skill?.description && (
                            <div className="text-xs text-muted truncate mt-0.5">{skill.description}</div>
                          )}
                        </div>

                        {/* Categoria */}
                        {skill?.category && <Badge variant="muted">{skill.category}</Badge>}

                        {/* Link editar */}
                        <Link
                          href={`/skills/${encodeURIComponent(item.skill_id)}`}
                          className="focus-ring shrink-0 rounded-md border border-line bg-elevated px-3 h-7 inline-flex items-center text-xs text-muted hover:text-ink transition"
                        >
                          Editar
                        </Link>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </Tabs.Content>

        {/* ABA: Métricas */}
        <Tabs.Content value="metrics" className="mt-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <MetricCard
              label="Total de chamadas"
              value={(initialMetrics.total_calls).toLocaleString('pt-BR')}
              sub="chamadas ao LLM"
              tone="text-ink"
            />
            <MetricCard
              label="Total de tokens"
              value={(initialMetrics.total_tokens).toLocaleString('pt-BR')}
              sub="tokens consumidos"
              tone="text-cyan"
            />
            <MetricCard
              label="Custo estimado"
              value={`$${estimatedCost.toFixed(4)}`}
              sub={`${identity.model} · $${(pricePerK * 1000).toFixed(4)}/1M tokens`}
              tone="text-accent"
            />
          </div>

          {/* Informações do modelo */}
          <div className="mt-5 rounded-xl bg-panel border border-line p-5 shadow-panel">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted mb-4">Configuração atual</div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <InfoRow label="Modelo" value={identity.model} />
              <InfoRow label="Temperatura" value={String(identity.temperature)} />
              <InfoRow label="Max tokens" value={String(identity.max_tokens)} />
              <InfoRow label="Status" value={identity.is_active ? 'Ativo' : 'Inativo'} />
            </div>
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}

/** Campo de formulário padrão */
function FormField({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-1.5">
      <label className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{label}</label>
      {children}
    </div>
  )
}

/** Card de métrica */
function MetricCard({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }): JSX.Element {
  return (
    <div className="rounded-xl bg-panel border border-line p-5 shadow-panel">
      <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted">{label}</div>
      <div className={`mt-3 text-3xl font-semibold tabular-nums tracking-tight ${tone}`}>{value}</div>
      <div className="mt-1 text-xs text-muted/60">{sub}</div>
    </div>
  )
}

/** Linha de info */
function InfoRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted/60 mb-1">{label}</div>
      <div className="font-mono text-sm text-ink">{value}</div>
    </div>
  )
}
