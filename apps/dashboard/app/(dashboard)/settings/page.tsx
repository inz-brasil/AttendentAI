// page.tsx — Página de configurações globais do sistema
import { api } from '../../../lib/api'
import { SettingsClient } from './settings-client'

export default async function SettingsPage(): Promise<JSX.Element> {
  let settings: Awaited<ReturnType<typeof api.settings>> = []
  try {
    settings = await api.settings()
  } catch { /* API offline */ }

  return <SettingsClient initialSettings={settings} />
}
