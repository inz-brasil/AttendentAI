# EasyPanel Schemas

Use `schema-existing-redis.json` quando o projeto EasyPanel já tiver um serviço chamado `redis`.

Use `schema-with-redis.json` quando quiser subir um Redis isolado junto com o AttendentAI.

O AttendentAI atualmente usa SQLite em `/data/db.sqlite`. O banco é criado automaticamente no primeiro boot, junto com migrations, agentes, skills e settings padrão.

Depois de importar o schema, troque no EasyPanel:

- `OPENAI_API_KEY`
- `WEBHOOK_SECRET`
- `DASHBOARD_SECRET`
- `NEXT_PUBLIC_API_URL`, se o domínio público da API não bater com `https://api-$(EASYPANEL_DOMAIN)`
- `REDIS_URL`, se o seu Redis existente não estiver disponível como `redis://$(PROJECT_NAME)_redis:6379`

Webhook para o n8n:

```text
POST https://DOMINIO_PUBLICO_DA_API/api/webhook?sync=true
Authorization: Bearer WEBHOOK_SECRET
```

Observação: Postgres ainda não é backend ativo do AttendentAI. Para usar o Postgres existente do projeto, é preciso migrar o client Drizzle e as migrations SQLite para Postgres.
