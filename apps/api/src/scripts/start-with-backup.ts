// start-with-backup.ts — Agenda backups periódicos e inicia a API
import { runBackup } from './backup'

const sixHoursMs = 6 * 60 * 60 * 1000

async function backupSafely(): Promise<void> {
  try {
    const backup = await runBackup()
    console.info(JSON.stringify({ event: backup ? 'scheduled_backup_created' : 'scheduled_backup_skipped', backup }))
  } catch (error) {
    console.error(JSON.stringify({
      event: 'scheduled_backup_failed',
      error: error instanceof Error ? error.message : 'unknown_error',
      stack: error instanceof Error ? error.stack : undefined
    }))
  }
}

setInterval(() => {
  void backupSafely()
}, sixHoursMs)

await import('../main')
