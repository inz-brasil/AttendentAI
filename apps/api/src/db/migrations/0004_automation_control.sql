CREATE TABLE IF NOT EXISTS `automation_blacklist` (
	`phone` text PRIMARY KEY NOT NULL,
	`reason` text DEFAULT 'human_takeover',
	`source` text DEFAULT 'system',
	`expires_at` integer,
	`created_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
	`updated_at` integer DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer)),
	FOREIGN KEY (`phone`) REFERENCES `leads`(`phone`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT OR IGNORE INTO `settings` (`key`, `value`, `description`, `updated_at`) VALUES
	('automation_enabled', 'true', 'Liga/desliga respostas automáticas do agente principal', cast((julianday('now') - 2440587.5)*86400000 as integer)),
	('automation_schedule_enabled', 'false', 'Quando true, o bot só responde dentro da janela configurada', cast((julianday('now') - 2440587.5)*86400000 as integer)),
	('automation_schedule_start', '18:00', 'Início da janela em que o bot pode responder automaticamente', cast((julianday('now') - 2440587.5)*86400000 as integer)),
	('automation_schedule_end', '09:00', 'Fim da janela em que o bot pode responder automaticamente', cast((julianday('now') - 2440587.5)*86400000 as integer)),
	('automation_schedule_timezone', 'America/Sao_Paulo', 'Timezone usado para janela de atendimento automático', cast((julianday('now') - 2440587.5)*86400000 as integer)),
	('automation_blacklist_default_minutes', '120', 'Duração padrão da pausa automática quando humano assume', cast((julianday('now') - 2440587.5)*86400000 as integer)),
	('wacli_enabled', 'false', 'Habilita tool wacli para assistente interno', cast((julianday('now') - 2440587.5)*86400000 as integer)),
	('wacli_command', '/usr/local/bin/wacli', 'Binário/comando wacli disponível no container da API', cast((julianday('now') - 2440587.5)*86400000 as integer)),
	('wacli_store', '/data/wacli', 'Diretório opcional do store wacli; vazio usa padrão do wacli', cast((julianday('now') - 2440587.5)*86400000 as integer));
