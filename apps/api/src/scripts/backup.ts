// backup.ts — Cria backup do SQLite e mantém apenas os últimos 7 arquivos
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { env } from '../config/env'

const databasePath = env.DATABASE_URL.replace(/^file:/, '')
const backupDir = join(dirname(databasePath), 'backups')

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/** Cria backup do arquivo SQLite e remove backups antigos. */
export async function runBackup(): Promise<string | null> {
  if (!existsSync(databasePath)) {
    return null
  }

  await mkdir(backupDir, { recursive: true })
  const backupPath = join(backupDir, `db-${timestamp()}.sqlite`)
  await copyFile(databasePath, backupPath)

  const backups = (await readdir(backupDir))
    .filter((file) => file.startsWith('db-') && file.endsWith('.sqlite'))
    .sort()

  const oldBackups = backups.slice(0, Math.max(0, backups.length - 7))
  await Promise.all(oldBackups.map((file) => rm(join(backupDir, file), { force: true })))

  return basename(backupPath)
}

if (import.meta.main) {
  const backup = await runBackup()
  if (backup) {
    console.info(JSON.stringify({ event: 'backup_created', backup }))
  } else {
    console.warn(JSON.stringify({ event: 'backup_skipped', reason: 'database_not_found' }))
  }
}
