# apps/api/Dockerfile — Build e runtime da API Fastify com Bun

# ────────────────────────────────────────────────────────────────
# Estágio 1: builder — instala dependências e compila o projeto
# ────────────────────────────────────────────────────────────────
FROM oven/bun:1-debian AS builder

WORKDIR /app

# Instalar ferramentas de build nativas necessárias para compilar better-sqlite3
# (node-gyp requer Python 3, make e g++ para construir módulos nativos)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copiar manifesto de dependências primeiro (melhor cache de layer)
COPY package.json bun.lock* ./

# Instalar dependências — better-sqlite3 compila nativamente via node-gyp
RUN bun install --frozen-lockfile

# Copiar o restante do código fonte
COPY src ./src
COPY tsconfig.json ./
COPY drizzle.config.ts ./

# Verificar tipos sem emitir (falha o build se houver erros TS)
# RUN bun tsc --noEmit

# ────────────────────────────────────────────────────────────────
# Estágio 2: wacli-builder — compila o WhatsApp CLI usado por tools internas
# ────────────────────────────────────────────────────────────────
FROM golang:1.25-bookworm AS wacli-builder

RUN go install -tags sqlite_fts5 github.com/steipete/wacli/cmd/wacli@v0.6.0

# ────────────────────────────────────────────────────────────────
# Estágio 3: runner — imagem mínima de produção
# ────────────────────────────────────────────────────────────────
FROM oven/bun:1-debian AS runner

WORKDIR /app

USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copiar dependências e código do builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/drizzle.config.ts ./
COPY --from=wacli-builder /go/bin/wacli /usr/local/bin/wacli

# Criar diretórios de dados com permissões corretas
RUN mkdir -p /data /data/wacli /vault

# Variáveis de ambiente sem valores default para secrets
ENV NODE_ENV=production
ENV PORT=3001
ENV VAULT_PATH=/vault
ENV DATABASE_URL=file:/data/db.sqlite
ENV WACLI_STORE_DIR=/data/wacli

# Porta exposta para o EasyPanel mapear
EXPOSE 3001

# Health check: aguarda a API estar pronta
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD bun -e "const r = await fetch('http://localhost:3001/health'); if (!r.ok) process.exit(1)"

# Executar diretamente com Bun (sem build step — Bun executa TS nativamente)
CMD ["sh", "-c", "bun run src/scripts/migrate.ts && bun run src/db/seed.ts && bun run src/scripts/start-with-backup.ts"]
