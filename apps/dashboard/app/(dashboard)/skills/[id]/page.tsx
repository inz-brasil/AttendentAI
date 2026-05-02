// page.tsx — Editor de skill: busca dados e delega ao client
import { api } from '../../../../lib/api'
import { SkillEditorClient } from './skill-editor-client'
import { notFound } from 'next/navigation'

interface Props {
  params: { id: string }
}

/**
 * Página de edição de skill com editor e preview.
 * @param props id da skill (ou 'new' para nova).
 * @returns Editor de skill.
 */
export default async function SkillEditorPage({ params }: Props): Promise<JSX.Element> {
  // Se id === 'new', renderiza editor vazio
  if (params.id === 'new') {
    return (
      <SkillEditorClient
        initialSkill={null}
        isNew={true}
      />
    )
  }

  let skill: Awaited<ReturnType<typeof api.skill>>
  try {
    skill = await api.skill(params.id)
  } catch {
    notFound()
  }

  return <SkillEditorClient initialSkill={skill} isNew={false} />
}
