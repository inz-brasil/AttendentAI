#!/bin/bash
set -u

API_URL="${API_URL:-http://localhost:3001}"
WEBHOOK_SECRET="${WEBHOOK_SECRET:-}"

if [ -z "$WEBHOOK_SECRET" ] && [ -f ".env" ]; then
  WEBHOOK_SECRET="$(grep '^WEBHOOK_SECRET=' .env | tail -1 | cut -d= -f2-)"
fi

pass() {
  echo "OK - $1"
}

fail() {
  echo "FALHOU - $1"
  exit 1
}

json_value() {
  if command -v jq >/dev/null 2>&1; then
    jq -r "$1"
  else
    sed -n "s/.*\"$2\"[[:space:]]*:[[:space:]]*\\([^,}]*\\).*/\\1/p" | tr -d '"'
  fi
}

echo "=== Teste 1: Health check ==="
curl -fs "$API_URL/health" >/dev/null && pass "health básico" || fail "health básico"
curl -fs "$API_URL/health/detailed" >/dev/null && pass "health detalhado" || fail "health detalhado"

echo "=== Teste 2: Webhook sem auth deve retornar 401 ==="
STATUS="$(curl -s -o /tmp/attendentai-noauth.json -w "%{http_code}" -X POST "$API_URL/api/webhook" \
  -H "Content-Type: application/json" \
  -d '{}')"
[ "$STATUS" = "401" ] && pass "webhook sem auth bloqueado" || fail "esperado 401, veio $STATUS"

echo "=== Teste 3: Primeira mensagem cria lead e resposta ==="
[ -n "$WEBHOOK_SECRET" ] || fail "WEBHOOK_SECRET ausente"
RESP="$(curl -s -X POST "$API_URL/api/webhook?sync=true" \
  -H "Authorization: Bearer $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"phone":"test_integration","name":"Teste","message":"Olá, quero saber sobre vocês","message_type":"text","timestamp":1234567890}')"
SUCCESS="$(printf '%s' "$RESP" | json_value '.success' 'success')"
[ "$SUCCESS" = "true" ] && pass "primeira mensagem processada" || fail "primeira mensagem falhou: $RESP"

echo "=== Teste 4: Segunda mensagem deve usar memória ==="
RESP2="$(curl -s -X POST "$API_URL/api/webhook?sync=true" \
  -H "Authorization: Bearer $WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"phone":"test_integration","name":"Teste","message":"Você lembra do meu interesse?","message_type":"text","timestamp":1234567891}')"
SUCCESS2="$(printf '%s' "$RESP2" | json_value '.success' 'success')"
[ "$SUCCESS2" = "true" ] && pass "segunda mensagem processada" || fail "segunda mensagem falhou: $RESP2"

echo "=== Teste 5: Lead criado no banco ==="
curl -fs "$API_URL/api/leads/test_integration" >/tmp/attendentai-lead.json && pass "lead existe" || fail "lead não encontrado"

echo "=== Teste 6: Vault criado ==="
FILES="$(curl -fs "$API_URL/api/vault/test_integration/files")" || fail "vault não encontrado"
printf '%s' "$FILES" | grep -q "memoria.md" && pass "memoria.md existe" || fail "memoria.md ausente"
printf '%s' "$FILES" | grep -q "historico.md" && pass "historico.md existe" || fail "historico.md ausente"
printf '%s' "$FILES" | grep -q "notas.md" && pass "notas.md existe" || fail "notas.md ausente"

echo "=== Teste 7: Rate limit por phone ==="
RATE_STATUS="200"
for i in $(seq 1 11); do
  RATE_STATUS="$(curl -s -o /tmp/attendentai-rate.json -w "%{http_code}" -X POST "$API_URL/api/webhook?sync=false" \
    -H "Authorization: Bearer $WEBHOOK_SECRET" \
    -H "Content-Type: application/json" \
    -d "{\"phone\":\"test_rate_limit\",\"name\":\"Rate\",\"message\":\"msg $i\",\"message_type\":\"text\",\"timestamp\":1234567890}")"
done
[ "$RATE_STATUS" = "429" ] && pass "rate limit por phone ativo" || fail "esperado 429 no limite por phone, veio $RATE_STATUS"

echo "=== Todos os testes passaram ==="
