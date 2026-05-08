// page.tsx — Página de configurações globais do sistema
import { api } from '../../../lib/api'
import { SettingsClient } from './settings-client'

export default async function SettingsPage({
  searchParams
}: {
  searchParams: { tenant_id?: string }
}): Promise<JSX.Element> {
  const tenantId = searchParams.tenant_id ?? 'default'
  let settings: Awaited<ReturnType<typeof api.settings>> = []
  let calendarStatus: Awaited<ReturnType<typeof api.getCalendarStatus>> = {
    connected: false,
    server: null,
    credential: null,
    account_email: null,
    tools_count: 0
  }
  try {
    const [settingsResult, calendarResult] = await Promise.allSettled([
      api.settings(tenantId),
      api.getCalendarStatus()
    ])
    if (settingsResult.status === 'fulfilled') settings = settingsResult.value
    if (calendarResult.status === 'fulfilled') calendarStatus = calendarResult.value
  } catch { /* API offline */ }

  return <SettingsClient initialSettings={settings} initialCalendarStatus={calendarStatus} tenantId={tenantId} />
}
