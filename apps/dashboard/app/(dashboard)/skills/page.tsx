// page.tsx — Lista de skills com busca e link para editor
import { api } from '../../../lib/api'
import { SkillsClient } from './skills-client'

/**
 * Página de skills — RSC que busca lista e delega ao client.
 * @returns Página de gerenciamento de skills.
 */
export default async function SkillsPage(): Promise<JSX.Element> {
  let skills: Awaited<ReturnType<typeof api.skills>> = []
  try {
    skills = await api.skills()
  } catch { /* renderiza vazio se API offline */ }

  return <SkillsClient initialSkills={skills} />
}
