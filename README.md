# AttendentAI

Sistema de atendimento automatizado via WhatsApp com múltiplos agentes de IA, orquestrado por n8n e gerenciado por um dashboard Next.js.

## Arquitetura

```
n8n (webhook) → API Fastify/Bun → Agentes IA (OpenAI) → Resposta
                      ↕
              Redis (filas + locks)
              SQLite (histórico + leads)
              Vault (conhecimento)
                      ↕
            Dashboard Next.js (gestão)
```

---

## Setup Local (Desenvolvimento)

### Pré-requisitos

- [Docker](https://docs.docker.com/get-docker/) 24+
- [Docker Compose](https://docs.docker.com/compose/) v2.20+
- [Bun](https://bun.sh/) 1.x (para rodar localmente sem Docker)

### 1. Clonar e configurar variáveis de ambiente

```bash
git clone <repo-url> attendentai
cd attendentai

# Copiar e editar o arquivo de ambiente
cp .env.example .env
```

Editar o `.env` com suas credenciais (ver seção [Variáveis de Ambiente](#variáveis-de-ambiente)).

### 2. Subir com Docker Compose

```bash
# Build e inicialização de todos os serviços
docker compose build
docker compose up -d

# Verificar status
docker compose ps

# Acompanhar logs da API
docker compose logs api -f
```

### 3. Verificar funcionamento

```bash
# Health check da API
curl http://localhost:3001/health

# Dashboard
open http://localhost:3000
```

### 4. Encerrar

```bash
docker compose down

# Incluindo volumes (apaga dados do Redis)
docker compose down -v
```

---

## Deploy no EasyPanel

### Pré-requisitos

- Servidor VPS com EasyPanel instalado
- Docker disponível no servidor
- Domínios configurados (ou subdomínios do EasyPanel)

### Passo 1 — Preparar o servidor

Acesse seu painel EasyPanel e crie um novo **Projeto** chamado `attendentai`.

### Passo 2 — Adicionar os serviços

No EasyPanel, crie quatro serviços dentro do projeto:

#### Serviço: Redis

1. Clique em **"+ Add Service" → "App"**
2. Nome: `redis`
3. Selecione **"Docker Image"**
4. Imagem: `redis:7-alpine`
5. Comando: `redis-server --appendonly yes --appendfsync everysec --maxmemory 256mb --maxmemory-policy noeviction`
6. Porta interna: `6379` (não expor externamente)
7. Volume: `/data` → `redis_data`
8. Salvar e Deploy

#### Serviço: API

1. Clique em **"+ Add Service" → "App"**
2. Nome: `api`
3. Selecione **"GitHub"** (conectar ao seu repositório)
4. Branch: `main`
5. Dockerfile path: `apps/api/Dockerfile`
6. Porta: `3001`
7. Volumes:
   - `/data` → `sqlite_data` (persistente)
   - `/vault` → `vault_data` (persistente)
8. Configurar **Environment Variables** (ver seção abaixo)
9. Salvar e Deploy

#### Serviço: Dashboard

1. Clique em **"+ Add Service" → "App"**
2. Nome: `dashboard`
3. Selecione **"GitHub"** (mesmo repositório)
4. Branch: `main`
5. Dockerfile path: `apps/dashboard/Dockerfile`
6. Porta: `3000`
7. Configurar domínio personalizado (ex: `dashboard.seudominio.com`)
8. Configurar **Environment Variables** (ver seção abaixo)
9. Salvar e Deploy

#### Serviço: Worker

1. Clique em **"+ Add Service" → "App"**
2. Nome: `worker`
3. Selecione **"GitHub"** (mesmo repositório)
4. Branch: `main`
5. Dockerfile path: `apps/api/Dockerfile`
6. Comando: `bun run src/queue/worker.ts`
7. Volumes:
   - `/data` → `sqlite_data` (mesmo volume da API)
   - `/vault` → `vault_data` (mesmo volume da API)
8. Configurar as mesmas **Environment Variables** da API
9. Salvar e Deploy

### Passo 3 — Configurar variáveis de ambiente no EasyPanel

No EasyPanel, acesse cada serviço → **Environment** e adicione as variáveis:

#### API — variáveis obrigatórias:
```
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
WEBHOOK_SECRET=seu_secret_minimo_32_chars
REDIS_URL=redis://redis:6379
DATABASE_URL=file:/data/db.sqlite
VAULT_PATH=/vault
MODEL_ORCHESTRATOR=gpt-4o-mini
MODEL_CLASSIFIER=gpt-4o-mini
MODEL_IDENTIFIER=gpt-4o-mini
MODEL_RESPONDER=gpt-4o
MODEL_SUMMARIZER=gpt-4o-mini
MODEL_MEMORY=gpt-4o-mini
MAX_TOKENS_RESPONSE=800
MAX_TOKENS_CONTEXT=4000
MAX_MESSAGES_IN_CONTEXT=20
WEBHOOK_TIMEOUT_MS=25000
MAX_CONCURRENT_CHATS=50
LOCK_TTL_SECONDS=30
SQLITE_JOURNAL_MODE=DELETE
API_PORT=3001
DASHBOARD_PORT=3000
NEXT_PUBLIC_API_URL=https://api.seudominio.com
DASHBOARD_SECRET=senha_segura_dashboard
AUDIO_AUTO_ENABLED=true
AUDIO_MAX_CHARS=300
```

#### Dashboard — variáveis obrigatórias:
```
NEXT_PUBLIC_API_URL=https://api.seudominio.com
DASHBOARD_SECRET=senha_segura_dashboard
```

### Passo 4 — Configurar domínios

No EasyPanel, para cada serviço acesse **Domains**:

- `api` → `api.seudominio.com` (ou use o domínio gerado pelo EasyPanel)
- `dashboard` → `dashboard.seudominio.com`

O EasyPanel configura HTTPS automaticamente via Let's Encrypt.

### Passo 5 — Verificar deploy

```bash
# Substituir pelo domínio configurado
curl https://api.seudominio.com/health
# Esperado: {"status":"ok",...}
```

---

## Conectar com o n8n

### Configuração do webhook no n8n

1. Criar um **Webhook Node** no n8n
2. Método: `POST`
3. URL do webhook: `https://api.seudominio.com/api/webhook?sync=true`
4. Header de autenticação:
   - Header: `Authorization`
   - Valor: `Bearer <WEBHOOK_SECRET>`

### Payload esperado pela API

```json
{
  "phone": "5511999999999",
  "name": "João Silva",
  "message": "Olá, quero agendar uma consulta",
  "message_type": "text",
  "timestamp": 1777680000
}
```

### Resposta da API para o n8n

```json
{
  "success": true,
  "message": "Olá João! Posso ajudá-lo com o agendamento...",
  "audio_requested": false,
  "metadata": {
    "phone": "5511999999999",
    "intent": "agendamento",
    "tokens_used": 1234
  }
}
```

---

## Variáveis de Ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `OPENAI_API_KEY` | ✅ | Chave da API OpenAI |
| `OPENAI_BASE_URL` | ✅ | URL base da API (para proxies compatíveis) |
| `WEBHOOK_SECRET` | ✅ | Secret compartilhado com o n8n (mín. 32 chars) |
| `REDIS_URL` | ✅ | URL de conexão Redis |
| `DATABASE_URL` | ✅ | Caminho do banco SQLite ou URL PostgreSQL |
| `SQLITE_JOURNAL_MODE` | ✅ | `DELETE` em Docker/EasyPanel; `WAL` local sem bind mount |
| `VAULT_PATH` | ✅ | Diretório dos arquivos de conhecimento |
| `MODEL_ORCHESTRATOR` | ✅ | Modelo do agente orquestrador |
| `MODEL_CLASSIFIER` | ✅ | Modelo do classificador de intenção |
| `MODEL_IDENTIFIER` | ✅ | Modelo do identificador de lead |
| `MODEL_RESPONDER` | ✅ | Modelo do agente respondedor |
| `MODEL_SUMMARIZER` | ✅ | Modelo do summarizador de memória |
| `MODEL_MEMORY` | ✅ | Modelo do agente de memória |
| `NEXT_PUBLIC_API_URL` | ✅ | URL pública da API (usada pelo dashboard) |
| `DASHBOARD_SECRET` | ✅ | Senha de acesso ao dashboard |
| `MAX_TOKENS_RESPONSE` | ❌ | Limite de tokens da resposta (default: 800) |
| `MAX_TOKENS_CONTEXT` | ❌ | Limite de tokens do contexto (default: 4000) |
| `MAX_MESSAGES_IN_CONTEXT` | ❌ | Máx. mensagens no histórico (default: 20) |
| `WEBHOOK_TIMEOUT_MS` | ❌ | Timeout do webhook em ms (default: 25000) |
| `MAX_CONCURRENT_CHATS` | ❌ | Máx. atendimentos simultâneos (default: 50) |
| `LOCK_TTL_SECONDS` | ❌ | TTL do lock por usuário em segundos (default: 30) |
| `AUDIO_AUTO_ENABLED` | ❌ | Habilitar resposta em áudio (default: true) |
| `AUDIO_MAX_CHARS` | ❌ | Limite de chars para resposta em áudio (default: 300) |

---

## Comandos Úteis

```bash
# Rebuild de um serviço específico
docker compose build api
docker compose up -d api

# Ver logs em tempo real
docker compose logs -f

# Acessar shell do container da API
docker compose exec api sh

# Executar migration do banco manualmente
docker compose exec api bun run src/scripts/migrate.ts

# Backup do SQLite
docker compose exec api bun run src/scripts/backup.ts

# Monitorar uso de recursos
docker stats
```

---

## Troubleshooting

### API container falha ao iniciar

Se o container da API falhar com erros relacionados a módulos nativos no Alpine Linux, a imagem `oven/bun:1-debian` já é usada como base (Debian, não Alpine), o que resolve incompatibilidades com `better-sqlite3`.

### Dashboard não conecta na API

Verificar se `NEXT_PUBLIC_API_URL` está apontando para o endereço correto:
- Local: `http://api:3001` (comunicação Docker interna)
- Produção: `https://api.seudominio.com` (URL pública)

### Redis não persiste dados

Verificar se o volume `redis_data` está montado corretamente:
```bash
docker volume inspect attendentai-redis-data
```

### Rebuild completo

```bash
docker compose down -v
docker compose build --no-cache
docker compose up -d
```
