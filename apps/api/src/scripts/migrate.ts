// migrate.ts — Aplica migrations SQL versionadas usando bun:sqlite
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Database } from 'bun:sqlite'
import { env } from '../config/env'

const databasePath = env.DATABASE_URL.replace(/^file:/, '')
const migrationsPath = join(import.meta.dir, '../db/migrations')

function prepareDatabaseFiles(): void {
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
}

function ensureMigrationTable(sqlite: Database): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `)
}

function hasMigration(sqlite: Database, name: string): boolean {
  const row = sqlite.query('SELECT name FROM __migrations WHERE name = ?').get(name)
  return Boolean(row)
}

function markMigration(sqlite: Database, name: string): void {
  sqlite
    .query('INSERT OR IGNORE INTO __migrations (name, applied_at) VALUES (?, ?)')
    .run(name, Date.now())
}

/** Aplica migrations pendentes no SQLite. */
export async function runMigrations(): Promise<void> {
  prepareDatabaseFiles()
  const sqlite = new Database(databasePath)
  sqlite.exec('PRAGMA busy_timeout = 5000')
  sqlite.exec(`PRAGMA journal_mode = ${env.SQLITE_JOURNAL_MODE}`)
  sqlite.exec('PRAGMA foreign_keys = ON')
  ensureMigrationTable(sqlite)

  const files = (await readdir(migrationsPath))
    .filter((file) => file.endsWith('.sql'))
    .sort()

  for (const file of files) {
    if (hasMigration(sqlite, file)) {
      continue
    }

    const sql = await readFile(join(migrationsPath, file), 'utf8')
    try {
      sqlite.exec(sql)
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (!message.includes('already exists')) {
        sqlite.close()
        throw error
      }
    }
    markMigration(sqlite, file)
    console.info(JSON.stringify({ event: 'migration_applied', migration: file }))
  }

  sqlite.close()
}

await runMigrations()
