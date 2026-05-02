'use client'
// skills-client.tsx — Lista de skills com busca e navegação para editor
import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge } from '../../../components/ui/badge'
import { ConfirmDialog } from '../../../components/ui/confirm-dialog'
import { useToast } from '../../../components/ui/toast-provider'
import type { Skill } from '../../../lib/api'

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || '/api/backend')

const PRIORITY_VARIANT: Record<string, 'accent' | 'success' | 'muted'> = {
  high: 'accent',
  medium: 'success',
  low: 'muted'
}

interface SkillsClientProps {
  initialSkills: Skill[]
}

/**
 * Lista de skills com busca, toggle ativo e link para editor.
 * @param props Lista inicial de skills.
 * @returns Tabela de skills.
 */
export function SkillsClient({ initialSkills }: SkillsClientProps): JSX.Element {
  const router = useRouter()
  const { toast } = useToast()
  const [skills, setSkills] = useState(initialSkills)
  const [search, setSearch] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; id: string | null; name: string | null }>({ open: false, id: null, name: null })

  const filtered = useMemo(() => {
    if (!search.trim()) return skills
    const q = search.toLowerCase()
    return skills.filter(s => s.name.toLowerCase().includes(q) || (s.category ?? '').toLowerCase().includes(q))
  }, [skills, search])

  async function toggleSkill(skill: Skill) {
    try {
      const res = await fetch(`${API_BASE}/api/skills/${encodeURIComponent(skill.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !skill.is_active })
      })
      if (!res.ok) throw new Error()
      setSkills(prev => prev.map(s => s.id === skill.id ? { ...s, is_active: !s.is_active } : s))
      toast({ title: `Skill ${!skill.is_active ? 'ativada' : 'desativada'}`, variant: 'success' })
    } catch {
      toast({ title: 'Erro ao alterar status da skill', variant: 'danger' })
    }
  }

  async function deleteSkill(id: string) {
    try {
      const res = await fetch(`${API_BASE}/api/skills/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setSkills(prev => prev.filter(s => s.id !== id))
      toast({ title: 'Skill removida', variant: 'success' })
      router.refresh()
    } catch {
      toast({ title: 'Erro ao remover skill', variant: 'danger' })
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.22em] text-accent">Configuração</div>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Skills</h2>
          <p className="mt-1.5 text-sm text-muted">
            {skills.length} skills · {skills.filter(s => s.is_active).length} ativas
          </p>
        </div>
        <Link
          href="/skills/new"
          className="focus-ring flex items-center gap-2 h-9 rounded-md bg-accent px-4 text-sm font-semibold text-canvas hover:bg-[#e7ef58] transition"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Nova skill
        </Link>
      </div>

      {/* Busca */}
      <div className="relative max-w-sm">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
          <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Buscar por nome ou categoria…"
          className="focus-ring w-full rounded-lg border border-line bg-panel pl-9 pr-4 h-9 text-sm text-ink placeholder:text-muted transition hover:border-muted focus:border-cyan outline-none"
        />
      </div>

      {/* Tabela */}
      <div className="rounded-xl border border-line overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-panel/80">
              <th className="px-4 py-3 text-left font-mono text-[11px] uppercase tracking-[0.15em] text-muted">Nome</th>
              <th className="hidden px-4 py-3 text-left font-mono text-[11px] uppercase tracking-[0.15em] text-muted md:table-cell">Categoria</th>
              <th className="hidden px-4 py-3 text-left font-mono text-[11px] uppercase tracking-[0.15em] text-muted lg:table-cell">Prioridade</th>
              <th className="px-4 py-3 text-left font-mono text-[11px] uppercase tracking-[0.15em] text-muted">Status</th>
              <th className="px-4 py-3 text-right font-mono text-[11px] uppercase tracking-[0.15em] text-muted">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-canvas">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-3 text-muted">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="opacity-40">
                      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                    </svg>
                    <span className="text-sm">Nenhuma skill encontrada</span>
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map(skill => (
                <tr key={skill.id} className="group hover:bg-elevated transition">
                  <td className="px-4 py-3.5">
                    <Link
                      href={`/skills/${encodeURIComponent(skill.id)}`}
                      className="font-medium text-ink hover:text-accent transition"
                    >
                      {skill.name}
                    </Link>
                    {skill.description && (
                      <div className="mt-0.5 text-xs text-muted truncate max-w-xs">{skill.description}</div>
                    )}
                  </td>
                  <td className="hidden px-4 py-3.5 md:table-cell">
                    {skill.category ? <Badge variant="muted">{skill.category}</Badge> : <span className="text-muted text-xs">—</span>}
                  </td>
                  <td className="hidden px-4 py-3.5 lg:table-cell">
                    <Badge variant={PRIORITY_VARIANT[skill.priority ?? ''] ?? 'muted'}>
                      {skill.priority ?? '—'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3.5">
                    <button
                      onClick={() => toggleSkill(skill)}
                      className={`relative h-5 w-9 rounded-full border transition ${
                        skill.is_active ? 'bg-success/20 border-success/40' : 'bg-canvas border-line'
                      }`}
                    >
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
                        skill.is_active ? 'left-4 bg-success' : 'left-0.5 bg-muted/40'
                      }`} />
                    </button>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition">
                      <Link
                        href={`/skills/${encodeURIComponent(skill.id)}`}
                        className="focus-ring rounded-md border border-line bg-elevated px-3 h-7 inline-flex items-center text-xs text-ink hover:border-muted transition"
                      >
                        Editar
                      </Link>
                      <button
                        onClick={() => setConfirmDelete({ open: true, id: skill.id, name: skill.name })}
                        className="focus-ring rounded-md border border-danger/30 bg-danger/10 px-3 h-7 text-xs text-danger hover:bg-danger/20 transition"
                      >
                        Remover
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={confirmDelete.open}
        onOpenChange={open => setConfirmDelete(prev => ({ ...prev, open }))}
        title="Remover skill permanentemente"
        description={`A skill "${confirmDelete.name}" será removida e desvinculada de todos os agentes.`}
        confirmLabel="Sim, remover"
        onConfirm={() => confirmDelete.id && deleteSkill(confirmDelete.id)}
      />
    </div>
  )
}
