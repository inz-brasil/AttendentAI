CREATE TABLE IF NOT EXISTS `message_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`conversation_id` text,
	`lead_phone` text NOT NULL,
	`external_message_id` text,
	`source` text NOT NULL,
	`source_event` text,
	`direction` text NOT NULL,
	`from_me` integer NOT NULL,
	`sender_type` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`message_type` text NOT NULL,
	`processed_type` text NOT NULL,
	`media_url` text,
	`quoted_external_message_id` text,
	`quoted_content` text,
	`remote_jid` text,
	`instance` text,
	`instance_id` text,
	`chatwoot_conversation_id` integer,
	`chatwoot_inbox_id` integer,
	`chatwoot_message_id` integer,
	`delivery_status` text NOT NULL,
	`batch_id` text,
	`error_message` text,
	`raw_payload` text,
	`whatsapp_timestamp` integer NOT NULL,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_me_tenant_phone_ts` ON `message_events` (`tenant_id`,`lead_phone`,`whatsapp_timestamp`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_me_tenant_phone_cr` ON `message_events` (`tenant_id`,`lead_phone`,`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_me_tenant_ext_id` ON `message_events` (`tenant_id`,`source`,`external_message_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_me_tenant_dedupe` ON `message_events` (`tenant_id`,`content_hash`,`lead_phone`,`direction`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_me_delivery_status` ON `message_events` (`tenant_id`,`delivery_status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_me_instance` ON `message_events` (`tenant_id`,`instance`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_me_remote_jid` ON `message_events` (`tenant_id`,`remote_jid`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_me_batch_id` ON `message_events` (`batch_id`);
