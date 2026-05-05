'use client'
// skill-editor-client.tsx — Editor de skill: CodeMirror + preview Markdown + histórico de versões
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import ReactMarkdown from 'react-markdown'
import { CodeEditor } from '../../../../components/ui/code-editor'
import { Badge } from '../../../../components/ui/badge'
import { useToast } from '../../../../components/ui/toast-provider'
import type { Skill } from '../../../../lib/api'

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || '/api/backend')

const CATEGORIES = ['atendimento', 'vendas', 'suporte', 'agendamento', 'coleta', 'fallback', 'outro']
const PRIORITIES = ['high', 'medium', 'low'] as const

interface SkillVersion {
  id: string
  content: string
  savedAt: string
}

interface SkillEditorClientProps {
  initialSkill: Skill | null
  isNew: boolean
}

/** Constrói frontmatter YAML inicial para nova skill */
function buildInitialContent(name: string): string {
  return `---
name: "${name}"
description: ""
category: "atendimento"
when_to_use: ""
priority: medium
is_active: true
---

# ${name}

Descreva aqui o comportamento desta skill.

## Quando usar

Descreva quando o agente deve acionar esta skill.

## Exemplos

- Exemplo de situação 1
- Exemplo de situação 2
`
}

/**
 * Editor de skill com CodeMirror (YAML+Markdown), preview ao lado e histórico de versões local.
 * @param props Skill inicial e flag de criação nova.
 * @returns Editor completo.
 */
export function SkillEditorClient({ initialSkill, isNew }: SkillEditorClientProps): JSX.Element {
  const router = useRouter()
  const { toast } = useToast()

  // Conteúdo completo (frontmatter + markdown)
  const [content, setContent] = useState(
    initialSkill?.content ?? buildInitialContent(initialSkill?.name ?? 'Nova Skill')
  )

  // Metadados extraídos do frontmatter / campos separados
  const [meta, setMeta] = useState({
    name: initialSkill?.name ?? 'Nova Skill',
    description: initialSkill?.description ?? '',
    category: initialSkill?.category ?? 'atendimento',
    when_to_use: initialSkill?.when_to_use ?? '',
    priority: (initialSkill?.priority ?? 'medium') as typeof PRIORITIES[number],
    is_active: initialSkill?.is_active ?? true
  })

  // Preview mode
  const [showPreview, setShowPreview] = useState(false)

  // Histórico de versões (localStorage para persistência local)
  const [versions, setVersions] = useState<SkillVersion[]>([])
  const [showHistory, setShowHistory] = useState(false)

  const [saving, setSaving] = useState(false)

  // Carrega versões do localStorage
  useEffect(() => {
    if (!initialSkill) return
    const key = `skill_versions_${initialSkill.id}`
    try {
      const stored = localStorage.getItem(key)
      if (stored) setVersions(JSON.parse(stored) as SkillVersion[])
    } catch { /* ignora */ }
  }, [initialSkill])

  /** Salva snapshot de versão no localStorage (mantém últimas 5) */
  const saveVersion = useCallback(() => {
    if (!initialSkill) return
    const key = `skill_versions_${initialSkill.id}`
    const newVersion: SkillVersion = {
      id: Date.now().toString(),
      content,
      savedAt: new Date().toLocaleString('pt-BR')
    }
    const updated = [newVersion, ...versions].slice(0, 5)
    setVersions(updated)
    try {
      localStorage.setItem(key, JSON.stringify(updated))
    } catch { /* ignora */ }
  }, [initialSkill, content, versions])

  /** Restaura versão anterior */
  function restoreVersion(version: SkillVersion) {
    setContent(version.content)
    setShowHistory(false)
    toast({ title: `Versão de ${version.savedAt} restaurada`, variant: 'success' })
  }

  async function save() {
    setSaving(true)
    saveVersion()
    try {
      const body = {
        name: meta.name,
        description: meta.description || null,
        category: meta.category || null,
        when_to_use: meta.when_to_use || null,
        priority: meta.priority,
        is_active: meta.is_active,
        content
      }

      let res: Response
      if (isNew) {
        res = await fetch(`${API_BASE}/api/skills`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
      } else {
        res = await fetch(`${API_BASE}/api/skills/${encodeURIComponent(initialSkill!.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
      }

      if (!res.ok) throw new Error()
      const saved = await res.json() as Skill

      toast({ title: isNew ? 'Skill criada' : 'Skill salva', variant: 'success' })

      if (isNew) {
        router.push(`/skills/${encodeURIComponent(saved.id)}`)
      }
    } catch {
      toast({ title: 'Erro ao salvar skill', variant: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  // Corpo do markdown sem frontmatter (para preview)
  const markdownBody = content.replace(/^---[\s\S]*?---\n/, '')

  return (
    <div className="space-y-5">
      {/* Breadcrumb + ações */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2 text-sm text-muted">
          <Link href="/skills" className="hover:text-accent transition">Skills</Link>
          <span>/</span>
          <span className="truncate text-ink">{meta.name}</span>
          {isNew && <Badge variant="accent">Nova</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowHistory(prev => !prev)}
            className="focus-ring h-8 rounded-md border border-line bg-elevated px-3 text-xs text-muted hover:text-ink transition"
          >
            Histórico ({versions.length})
          </button>
          <Link
            href="/playground"
            className="focus-ring h-8 rounded-md border border-line bg-elevated px-3 text-xs text-muted hover:text-ink transition inline-flex items-center"
          >
            Testar no Playground
          </Link>
          <button onClick={save} disabled={saving} className="save-btn whitespace-nowrap text-xs sm:text-sm">
            {saving ? 'Salvando…' : isNew ? 'Criar skill' : 'Salvar'}
          </button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[320px_1fr]">
        {/* Painel de metadados */}
        <div className="space-y-4">
          <div className="rounded-xl bg-panel border border-line p-5 shadow-panel space-y-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Metadados</div>

            <FormField label="Nome">
              <input
                value={meta.name}
                onChange={e => setMeta(p => ({ ...p, name: e.target.value }))}
                className="field-input"
                placeholder="Nome da skill"
              />
            </FormField>

            <FormField label="Descrição">
              <textarea
                value={meta.description}
                onChange={e => setMeta(p => ({ ...p, description: e.target.value }))}
                rows={3}
                className="field-input resize-none"
                placeholder="O que esta skill faz…"
              />
            </FormField>

            <FormField label="Categoria">
              <select value={meta.category} onChange={e => setMeta(p => ({ ...p, category: e.target.value }))} className="field-input">
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </FormField>

            <FormField label="Quando usar">
              <textarea
                value={meta.when_to_use}
                onChange={e => setMeta(p => ({ ...p, when_to_use: e.target.value }))}
                rows={3}
                className="field-input resize-none"
                placeholder="Descreva as condições de ativação…"
              />
            </FormField>

            <FormField label="Prioridade">
              <div className="flex gap-2">
                {PRIORITIES.map(p => (
                  <button
                    key={p}
                    onClick={() => setMeta(prev => ({ ...prev, priority: p }))}
                    className={`flex-1 h-8 rounded-md border text-xs font-mono transition ${
                      meta.priority === p
                        ? p === 'high' ? 'bg-accent/20 border-accent/40 text-accent' : p === 'medium' ? 'bg-success/20 border-success/40 text-success' : 'bg-elevated border-line text-muted'
                        : 'bg-canvas border-line text-muted hover:border-muted'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </FormField>

            {/* Toggle ativo */}
            <div className="flex items-center gap-3 pt-1">
              <button
                onClick={() => setMeta(p => ({ ...p, is_active: !p.is_active }))}
                className={`relative h-5 w-9 rounded-full border transition ${meta.is_active ? 'bg-success/20 border-success/40' : 'bg-canvas border-line'}`}
              >
                <span className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${meta.is_active ? 'left-4 bg-success' : 'left-0.5 bg-muted/40'}`} />
              </button>
              <span className="text-sm text-ink">{meta.is_active ? 'Ativa' : 'Inativa'}</span>
            </div>
          </div>

          {/* Histórico de versões */}
          {showHistory && (
            <div className="rounded-xl bg-panel border border-line p-4 shadow-panel">
              <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-muted mb-3">Histórico local (últimas 5)</div>
              {versions.length === 0 ? (
                <p className="text-xs text-muted">Nenhuma versão salva ainda.</p>
              ) : (
                <div className="space-y-2">
                  {versions.map(v => (
                    <div key={v.id} className="flex items-center justify-between gap-2 rounded-md bg-canvas border border-line px-3 py-2">
                      <span className="font-mono text-[10px] text-muted">{v.savedAt}</span>
                      <button
                        onClick={() => restoreVersion(v)}
                        className="focus-ring text-xs text-accent hover:underline"
                      >
                        Restaurar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Editor + Preview */}
        <div className="space-y-3">
          {/* Toolbar do editor */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-1 rounded-lg bg-panel border border-line p-1">
              <button
                onClick={() => setShowPreview(false)}
                className={`h-7 rounded-md px-3 text-xs transition ${!showPreview ? 'bg-elevated text-ink' : 'text-muted hover:text-ink'}`}
              >
                Editor
              </button>
              <button
                onClick={() => setShowPreview(true)}
                className={`h-7 rounded-md px-3 text-xs transition ${showPreview ? 'bg-elevated text-ink' : 'text-muted hover:text-ink'}`}
              >
                Preview
              </button>
            </div>
            <span className="font-mono text-xs text-muted">{content.length} chars</span>
          </div>

          {!showPreview ? (
            <CodeEditor
              value={content}
              onChange={setContent}
              lang="markdown"
              minHeight={520}
            />
          ) : (
            <div className="min-h-[520px] overflow-y-auto rounded-lg border border-line bg-canvas p-6 prose prose-invert prose-sm max-w-none
              prose-headings:text-ink prose-headings:font-semibold
              prose-p:text-muted prose-p:leading-7
              prose-code:text-accent prose-code:bg-elevated prose-code:px-1 prose-code:rounded prose-code:font-mono prose-code:text-[11px]
              prose-pre:bg-panel prose-pre:border prose-pre:border-line
              prose-li:text-muted prose-strong:text-ink
              prose-blockquote:border-l-accent prose-blockquote:text-muted">
              <ReactMarkdown>{markdownBody}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Campo de formulário */
function FormField({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-1.5">
      <label className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{label}</label>
      {children}
    </div>
  )
}
