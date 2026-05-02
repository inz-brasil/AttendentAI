// client.ts — Cria conexão Drizzle com SQLite no runtime Bun e habilita WAL mode
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { env } from '../config/env'
import * as schema from './schema'

const databasePath = env.DATABASE_URL.replace(/^file:/, '')
const databaseDir = dirname(databasePath)

if (!existsSync(databaseDir)) {
  mkdirSync(databaseDir, { recursive: true })
}

if (env.SQLITE_JOURNAL_MODE === 'DELETE') {
  for (const suffix of ['-wal', '-shm']) {
    const filePath = `${databasePath}${suffix}`
    if (existsSync(filePath)) {
      rmSync(filePath, { force: true })
    }
  }
}

export const sqlite = new Database(databasePath)

sqlite.exec('PRAGMA busy_timeout = 5000')

sqlite.exec(`PRAGMA journal_mode = ${env.SQLITE_JOURNAL_MODE}`)

sqlite.exec('PRAGMA foreign_keys = ON')

export const db = drizzle(sqlite, { schema })

/**
 * Fecha a conexão SQLite usada pela aplicação.
 * @returns Nada.
 */
export function closeDb(): void {
  sqlite.close()
}
