CREATE TABLE IF NOT EXISTS `trace_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`batch_id` text,
	`phone` text,
	`event` text NOT NULL,
	`status` text NOT NULL,
	`data` text DEFAULT '{}' NOT NULL,
	`duration_ms` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_te_tenant_event_created` ON `trace_events` (`tenant_id`,`event`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_te_batch_id` ON `trace_events` (`batch_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_te_tenant_phone_created` ON `trace_events` (`tenant_id`,`phone`,`created_at`);
