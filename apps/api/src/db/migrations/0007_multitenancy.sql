-- 0007_multitenancy.sql — Adiciona tenant_id a todas as tabelas relevantes
-- Tabelas com mudança de PK são recriadas; demais recebem ADD COLUMN.
-- Todos os dados existentes recebem tenant_id = 'default'.
PRAGMA foreign_keys = OFF;
--> statement-breakpoint

-- ============================================================
-- 1. leads — PK: (phone) → (tenant_id, phone)
-- ============================================================
CREATE TABLE `leads_new` (
	`phone` text NOT NULL,
	`tenant_id` text NOT NULL DEFAULT 'default',
	`name` text,
	`email` text,
	`city` text,
	`status` text DEFAULT 'novo',
	`tags` text DEFAULT '[]',
	`custom_data` text DEFAULT '{}',
	`vault_path` text,
	`total_messages` integer DEFAULT 0,
	`last_message_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
	PRIMARY KEY (`tenant_id`, `phone`)
);
--> statement-breakpoint
INSERT INTO `leads_new` SELECT `phone`, 'default', `name`, `email`, `city`, `status`, `tags`, `custom_data`, `vault_path`, `total_messages`, `last_message_at`, `created_at`, `updated_at` FROM `leads`;
--> statement-breakpoint
DROP TABLE `leads`;
--> statement-breakpoint
ALTER TABLE `leads_new` RENAME TO `leads`;
--> statement-breakpoint
CREATE INDEX `idx_leads_tenant_phone` ON `leads` (`tenant_id`, `phone`);
--> statement-breakpoint
CREATE INDEX `idx_leads_last_message` ON `leads` (`tenant_id`, `last_message_at`);
--> statement-breakpoint

-- ============================================================
-- 2. conversations — remove FK a leads.phone, add tenant_id
-- ============================================================
CREATE TABLE `conversations_new` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL DEFAULT 'default',
	`lead_phone` text,
	`started_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
	`ended_at` integer,
	`summary` text,
	`intent_main` text,
	`total_messages` integer DEFAULT 0,
	`total_tokens` integer DEFAULT 0
);
--> statement-breakpoint
INSERT INTO `conversations_new` SELECT `id`, 'default', `lead_phone`, `started_at`, `ended_at`, `summary`, `intent_main`, `total_messages`, `total_tokens` FROM `conversations`;
--> statement-breakpoint
DROP TABLE `conversations`;
--> statement-breakpoint
ALTER TABLE `conversations_new` RENAME TO `conversations`;
--> statement-breakpoint
CREATE INDEX `idx_conversations_tenant` ON `conversations` (`tenant_id`, `lead_phone`);
--> statement-breakpoint

-- ============================================================
-- 3. messages — remove FK a leads.phone, add tenant_id
--    mantém FK a conversations(id) pois conversations.id ainda é PK único
-- ============================================================
CREATE TABLE `messages_new` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL DEFAULT 'default',
	`conversation_id` text,
	`lead_phone` text,
	`role` text,
	`content` text,
	`message_type` text DEFAULT 'text',
	`audio_requested` integer DEFAULT false,
	`intent` text,
	`tokens_used` integer DEFAULT 0,
	`agent_used` text,
	`processing_ms` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `messages_new` SELECT `id`, 'default', `conversation_id`, `lead_phone`, `role`, `content`, `message_type`, `audio_requested`, `intent`, `tokens_used`, `agent_used`, `processing_ms`, `created_at` FROM `messages`;
--> statement-breakpoint
DROP TABLE `messages`;
--> statement-breakpoint
ALTER TABLE `messages_new` RENAME TO `messages`;
--> statement-breakpoint
CREATE INDEX `idx_messages_tenant` ON `messages` (`tenant_id`, `lead_phone`);
--> statement-breakpoint

-- ============================================================
-- 4. settings — PK: (key) → (tenant_id, key)
-- ============================================================
CREATE TABLE `settings_new` (
	`key` text NOT NULL,
	`tenant_id` text NOT NULL DEFAULT 'default',
	`value` text,
	`description` text,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
	PRIMARY KEY (`tenant_id`, `key`)
);
--> statement-breakpoint
INSERT INTO `settings_new` SELECT `key`, 'default', `value`, `description`, `updated_at` FROM `settings`;
--> statement-breakpoint
DROP TABLE `settings`;
--> statement-breakpoint
ALTER TABLE `settings_new` RENAME TO `settings`;
--> statement-breakpoint
CREATE INDEX `idx_settings_tenant_key` ON `settings` (`tenant_id`, `key`);
--> statement-breakpoint

-- ============================================================
-- 5. automation_blacklist — PK: (phone) → (tenant_id, phone), remove FK
-- ============================================================
CREATE TABLE `automation_blacklist_new` (
	`phone` text NOT NULL,
	`tenant_id` text NOT NULL DEFAULT 'default',
	`reason` text DEFAULT 'human_takeover',
	`source` text DEFAULT 'system',
	`expires_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
	PRIMARY KEY (`tenant_id`, `phone`)
);
--> statement-breakpoint
INSERT INTO `automation_blacklist_new` SELECT `phone`, 'default', `reason`, `source`, `expires_at`, `created_at`, `updated_at` FROM `automation_blacklist`;
--> statement-breakpoint
DROP TABLE `automation_blacklist`;
--> statement-breakpoint
ALTER TABLE `automation_blacklist_new` RENAME TO `automation_blacklist`;
--> statement-breakpoint
CREATE INDEX `idx_blacklist_tenant_phone` ON `automation_blacklist` (`tenant_id`, `phone`);
--> statement-breakpoint

-- ============================================================
-- 6. lead_memory_meta — PK: (phone) → (tenant_id, phone), remove FK
-- ============================================================
CREATE TABLE `lead_memory_meta_new` (
	`phone` text NOT NULL,
	`tenant_id` text NOT NULL DEFAULT 'default',
	`last_compaction_at` integer,
	`total_compactions` integer DEFAULT 0,
	`total_messages_summarized` integer DEFAULT 0,
	PRIMARY KEY (`tenant_id`, `phone`)
);
--> statement-breakpoint
INSERT INTO `lead_memory_meta_new` SELECT `phone`, 'default', `last_compaction_at`, `total_compactions`, `total_messages_summarized` FROM `lead_memory_meta`;
--> statement-breakpoint
DROP TABLE `lead_memory_meta`;
--> statement-breakpoint
ALTER TABLE `lead_memory_meta_new` RENAME TO `lead_memory_meta`;
--> statement-breakpoint
CREATE INDEX `idx_lead_memory_meta_tenant` ON `lead_memory_meta` (`tenant_id`, `phone`);
--> statement-breakpoint

-- ============================================================
-- 7. agents — ADD tenant_id
-- ============================================================
ALTER TABLE `agents` ADD COLUMN `tenant_id` text NOT NULL DEFAULT 'default';
--> statement-breakpoint
CREATE INDEX `idx_agents_tenant` ON `agents` (`tenant_id`);
--> statement-breakpoint

-- ============================================================
-- 8. agent_skills — ADD tenant_id
-- ============================================================
ALTER TABLE `agent_skills` ADD COLUMN `tenant_id` text NOT NULL DEFAULT 'default';
--> statement-breakpoint

-- ============================================================
-- 9. agent_traces — ADD tenant_id
-- ============================================================
ALTER TABLE `agent_traces` ADD COLUMN `tenant_id` text NOT NULL DEFAULT 'default';
--> statement-breakpoint
CREATE INDEX `idx_agent_traces_tenant` ON `agent_traces` (`tenant_id`, `phone`);
--> statement-breakpoint

-- ============================================================
-- 10. token_usage — ADD tenant_id
-- ============================================================
ALTER TABLE `token_usage` ADD COLUMN `tenant_id` text NOT NULL DEFAULT 'default';
--> statement-breakpoint
CREATE INDEX `idx_token_usage_tenant` ON `token_usage` (`tenant_id`);
--> statement-breakpoint

PRAGMA foreign_keys = ON;
