// drizzle.config.ts — Configura migrations Drizzle quando executadas dentro de apps/api
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL?.replace(/^file:/, '') ?? '../../data/db.sqlite'
  }
})
