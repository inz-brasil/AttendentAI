CREATE TABLE `agent_skills` (
	`agent_id` text,
	`skill_id` text,
	`order` integer DEFAULT 0,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`type` text,
	`model` text DEFAULT 'gpt-4o-mini',
	`temperature` real DEFAULT 0.3,
	`max_tokens` integer DEFAULT 1000,
	`system_prompt` text,
	`is_active` integer DEFAULT true,
	`total_calls` integer DEFAULT 0,
	`total_tokens` integer DEFAULT 0,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer))
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_phone` text,
	`started_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
	`ended_at` integer,
	`summary` text,
	`intent_main` text,
	`total_messages` integer DEFAULT 0,
	`total_tokens` integer DEFAULT 0,
	FOREIGN KEY (`lead_phone`) REFERENCES `leads`(`phone`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`phone` text PRIMARY KEY NOT NULL,
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
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer))
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
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
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lead_phone`) REFERENCES `leads`(`phone`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`description` text,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer))
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text,
	`description` text,
	`category` text,
	`content` text,
	`when_to_use` text,
	`priority` text DEFAULT 'medium',
	`is_active` integer DEFAULT true,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `skills_slug_unique` ON `skills` (`slug`);--> statement-breakpoint
CREATE TABLE `token_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text,
	`model` text,
	`agent_type` text,
	`prompt_tokens` integer DEFAULT 0,
	`completion_tokens` integer DEFAULT 0,
	`total_tokens` integer DEFAULT 0,
	`estimated_cost_usd` real DEFAULT 0
);
