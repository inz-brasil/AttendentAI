CREATE TABLE IF NOT EXISTS `agent_traces` (
	`id` text PRIMARY KEY NOT NULL,
	`phone` text,
	`agent` text,
	`event_type` text,
	`title` text,
	`data` text DEFAULT '{}',
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer))
);
