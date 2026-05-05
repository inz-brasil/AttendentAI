CREATE TABLE IF NOT EXISTS `lead_memory_meta` (
	`phone` text PRIMARY KEY NOT NULL,
	`last_compaction_at` integer,
	`total_compactions` integer DEFAULT 0,
	`total_messages_summarized` integer DEFAULT 0,
	FOREIGN KEY (`phone`) REFERENCES `leads`(`phone`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`transport` text NOT NULL,
	`url` text,
	`command` text,
	`auth_type` text DEFAULT 'none',
	`is_active` integer DEFAULT true,
	`tools_cache` text,
	`tools_cached_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `mcp_servers_slug_unique` ON `mcp_servers` (`slug`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `agent_mcp_servers` (
	`agent_id` text,
	`mcp_server_id` text,
	`enabled` integer DEFAULT true,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mcp_server_id`) REFERENCES `mcp_servers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `mcp_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`mcp_server_id` text,
	`scope` text DEFAULT 'system',
	`access_token_encrypted` text,
	`refresh_token_encrypted` text,
	`token_expiry` integer,
	`granted_at` integer,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
	FOREIGN KEY (`mcp_server_id`) REFERENCES `mcp_servers`(`id`) ON UPDATE no action ON DELETE no action
);
