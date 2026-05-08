-- 0008_tenants_table.sql — Cria tabela de tenants para gerenciamento de portfólios
CREATE TABLE IF NOT EXISTS `tenants` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `is_active` integer NOT NULL DEFAULT 1,
  `created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
  `updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer))
);
--> statement-breakpoint
-- Insere o tenant padrão para compatibilidade com dados existentes
INSERT OR IGNORE INTO `tenants` (`id`, `name`, `description`, `is_active`)
VALUES ('default', 'Padrão', 'Tenant padrão do sistema', 1);
