'use client'
// settings-client.tsx — Formulário de configurações globais do AttendentAI
import { useState, useCallback } from 'react'
import { useToast } from '../../../components/ui/toast-provider'
import { ConfirmDialog } from '../../../components/ui/confirm-dialog'
import type { Setting } from '../../../lib/api'

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || '/api/backend')

const MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo', 'gpt-4-turbo']
const TONES = [
  { value: 'formal', label: 'Formal' },
  { value: 'amigavel', label: 'Amigável' },
  { value: 'casual', label: 'Casual' },
  { value: 'humanizado, claro, breve e consultivo', label: 'Consultivo (padrão)' }
]
const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Belem',
  'America/Fortaleza',
  'America/Recife',
  'America/Noronha',
  'UTC'
]

interface SettingsClientProps {
  initialSettings: Setting[]
}

/** Resolve a URL pública da API para integrações externas. */
function resolvePublicApiUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim()
  if (configured) {
    return configured.replace(/\/$/, '')
  }

  if (typeof window === 'undefined') {
    return 'https://seu-dominio'
  }

  const url = new URL(window.location.href)
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    url.port = '3001'
    return url.origin
  }

  // EasyPanel gera hosts por serviço. Quando o env público não vem no bundle,
  // inferimos a API a partir do host do dashboard para não mostrar uma URL inútil.
  url.hostname = url.hostname
    .replace(/^attendentai-/, 'attendentai-api-')
    .replace('attendentai-dashboard', 'attendentai-api')

  return url.origin
}

/** Converte array de settings em mapa chave→valor */
function toMap(settings: Setting[]): Record<string, string> {
  return Object.fromEntries(settings.map(s => [s.key, s.value ?? '']))
}

/**
 * Página de configurações globais com 4 seções: API, Atendente, Webhook, Sistema.
 * @param props Settings iniciais da API.
 * @returns Formulário de configurações.
 */
export function SettingsClient({ initialSettings }: SettingsClientProps): JSX.Element {
  const { toast } = useToast()
  const [values, setValues] = useState<Record<string, string>>(toMap(initialSettings ?? []))
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'idle' | 'ok' | 'fail'>('idle')
  const [showApiKey, setShowApiKey] = useState(false)
  const [showWebhookSecret, setShowWebhookSecret] = useState(false)
  const [confirmClearHistory, setConfirmClearHistory] = useState(false)
  const [clearConfirmStep, setClearConfirmStep] = useState(0)

  const set = useCallback((key: string, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }))
  }, [])

  async function saveAll() {
    setSaving(true)
    try {
      const items = Object.entries(values).map(([key, value]) => ({ key, value }))
      const res = await fetch(`${API_BASE}/api/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(items)
      })
      if (!res.ok) throw new Error()
      const refreshed = await fetch(`${API_BASE}/api/settings`, { cache: 'no-store' })
      if (!refreshed.ok) throw new Error()
      const savedSettings = await refreshed.json() as Setting[]
      setValues(toMap(savedSettings))
      toast({ title: 'Configurações salvas', variant: 'success' })
    } catch {
      toast({ title: 'Erro ao salvar configurações', variant: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  async function testConnection() {
    setTesting(true)
    setTestResult('idle')
    try {
      const res = await fetch(`${API_BASE}/api/playground/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'ping',
          phone: 'playground_settings_test',
          agentId: 'responder',
          history: []
        })
      })
      setTestResult(res.ok ? 'ok' : 'fail')
      toast({
        title: res.ok ? '✓ Conexão OK com a API OpenAI' : '✗ Falha na conexão — verifique a API key',
        variant: res.ok ? 'success' : 'danger'
      })
    } catch {
      setTestResult('fail')
      toast({ title: '✗ API inacessível', variant: 'danger' })
    } finally {
      setTesting(false)
    }
  }

  async function clearAllHistory() {
    try {
      const response = await fetch(`${API_BASE}/api/conversations`, { method: 'DELETE' })
      if (!response.ok) {
        throw new Error('Falha ao apagar histórico')
      }
      toast({ title: 'Histórico apagado com sucesso', variant: 'success' })
    } catch {
      toast({ title: 'Erro ao apagar histórico', variant: 'danger' })
    } finally {
      setConfirmClearHistory(false)
      setClearConfirmStep(0)
    }
  }

  /** Mascaramento de valor sensível */
  function mask(value: string, show: boolean): string {
    if (!value) return ''
    if (show) return value
    const last4 = value.slice(-4)
    return `${'•'.repeat(Math.max(0, value.length - 4))}${last4}`
  }

  const webhookUrl = `${resolvePublicApiUrl()}/api/webhook?sync=true`

  return (
    <div className="space-y-8 max-w-3xl">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.22em] text-accent">Sistema</div>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Configurações</h2>
          <p className="mt-1.5 text-sm text-muted">Configurações globais salvas na tabela settings do banco</p>
        </div>
        <button onClick={saveAll} disabled={saving} className="save-btn">
          {saving ? 'Salvando…' : 'Salvar tudo'}
        </button>
      </div>

      {/* SEÇÃO: API */}
      <Section title="API" description="Conexão com o provedor de LLM (OpenAI compatível)">
        <Field label="OpenAI API Key">
          <div className="flex gap-2">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={values.openai_api_key ?? ''}
              onChange={e => set('openai_api_key', e.target.value)}
              placeholder="sk-..."
              className="field-input flex-1 font-mono text-xs"
            />
            <button
              onClick={() => setShowApiKey(p => !p)}
              className="focus-ring h-9 rounded-md border border-line bg-elevated px-3 text-xs text-muted hover:text-ink transition"
            >
              {showApiKey ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
          {values.openai_api_key && !showApiKey && (
            <span className="font-mono text-[10px] text-muted/60">
              Exibindo: …{values.openai_api_key.slice(-4)}
            </span>
          )}
        </Field>

        <Field label="OpenAI Base URL">
          <input
            value={values.openai_base_url ?? 'https://api.openai.com/v1'}
            onChange={e => set('openai_base_url', e.target.value)}
            placeholder="https://api.openai.com/v1"
            className="field-input font-mono text-xs"
          />
          <span className="text-[11px] text-muted/60">Para usar outros providers (Anthropic via proxy, Azure, Together, etc.)</span>
        </Field>

        <Field label="Modelo padrão do Respondedor">
          <select value={values.model_responder ?? 'gpt-4o-mini'} onChange={e => set('model_responder', e.target.value)} className="field-input">
            {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>

        <div className="pt-1">
          <button
            onClick={testConnection}
            disabled={testing}
            className="focus-ring h-8 rounded-md border border-line bg-elevated px-4 text-xs text-muted hover:text-ink transition inline-flex items-center gap-2"
          >
            {testing ? (
              <>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><path d="M21 12a9 9 0 1 1-9-9"/></svg>
                Testando…
              </>
            ) : (
              <>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                Testar conexão
              </>
            )}
          </button>
          {testResult !== 'idle' && (
            <span className={`ml-3 text-xs font-mono ${testResult === 'ok' ? 'text-success' : 'text-danger'}`}>
              {testResult === 'ok' ? '✓ Conexão OK' : '✗ Falha'}
            </span>
          )}
        </div>
      </Section>

      {/* SEÇÃO: Atendente */}
      <Section title="Atendente" description="Identidade e comportamento do agente de atendimento">
        <Field label="Nome do atendente">
          <input
            value={values.agent_name ?? ''}
            onChange={e => set('agent_name', e.target.value)}
            placeholder="Ana"
            className="field-input"
          />
        </Field>

        <Field label="Nome da empresa">
          <input
            value={values.company_name ?? ''}
            onChange={e => set('company_name', e.target.value)}
            placeholder="AttendentAI"
            className="field-input"
          />
        </Field>

        <Field label="Tom padrão">
          <select value={values.agent_tone ?? ''} onChange={e => set('agent_tone', e.target.value)} className="field-input">
            {TONES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>

        <Field label="Áudio autônomo">
          <div className="flex items-center gap-3">
            <button
              onClick={() => set('audio_auto_enabled', values.audio_auto_enabled === 'true' ? 'false' : 'true')}
              className={`relative h-5 w-9 rounded-full border transition ${values.audio_auto_enabled === 'true' ? 'bg-success/20 border-success/40' : 'bg-canvas border-line'}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${values.audio_auto_enabled === 'true' ? 'left-4 bg-success' : 'left-0.5 bg-muted/40'}`} />
            </button>
            <span className="text-sm text-ink">{values.audio_auto_enabled === 'true' ? 'Ativado' : 'Desativado'}</span>
          </div>
        </Field>

        <Field label="Máx. chars para áudio">
          <input
            type="number"
            min={50}
            max={2000}
            value={values.audio_max_chars ?? '300'}
            onChange={e => set('audio_max_chars', e.target.value)}
            className="field-input w-32"
          />
          <span className="text-[11px] text-muted/60">Respostas maiores que este limite não serão convertidas em áudio</span>
        </Field>
      </Section>

      {/* SEÇÃO: Webhook */}
      <Section title="Webhook" description="Configurações de integração com o n8n ou outros systems">
        <Field label="Webhook Secret">
          <div className="flex gap-2">
            <input
              type={showWebhookSecret ? 'text' : 'password'}
              value={values.webhook_secret ?? ''}
              onChange={e => set('webhook_secret', e.target.value)}
              placeholder="Mínimo 32 caracteres"
              className="field-input flex-1 font-mono text-xs"
            />
            <button
              onClick={() => setShowWebhookSecret(p => !p)}
              className="focus-ring h-9 rounded-md border border-line bg-elevated px-3 text-xs text-muted hover:text-ink transition"
            >
              {showWebhookSecret ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
        </Field>

        <Field label="URL do Webhook (readonly)">
          <div className="flex gap-2">
            <input
              readOnly
              value={webhookUrl}
              className="field-input flex-1 font-mono text-xs opacity-70 cursor-default"
            />
            <button
              onClick={() => { navigator.clipboard.writeText(webhookUrl).catch(() => {}); toast({ title: 'URL copiada', variant: 'success' }) }}
              className="focus-ring h-9 rounded-md border border-line bg-elevated px-3 text-xs text-muted hover:text-ink transition"
            >
              Copiar
            </button>
          </div>
        </Field>
      </Section>

      {/* SEÇÃO: Assistente interno */}
      <Section title="Assistente interno" description="Números/JIDs que serão atendidos pelo agente de gestão da plataforma">
        <Field label="Contatos autorizados">
          <textarea
            value={values.internal_assistant_contacts ?? ''}
            onChange={e => set('internal_assistant_contacts', e.target.value)}
            placeholder="5511999999999&#10;120363000000000000@g.us"
            className="field-input min-h-24 font-mono text-xs"
          />
          <span className="text-[11px] text-muted/60">
            Um por linha, ou separados por vírgula. Quando bater com phone, session_id, jid, remoteJid ou groupJid, o respondedor normal é bypassado.
          </span>
        </Field>
      </Section>

      {/* SEÇÃO: Tools */}
      <Section title="Tools dos agentes" description="Capacidades externas liberadas para o atendimento">
        <Field label="HTTP Request">
          <div className="flex items-center gap-3">
            <button
              onClick={() => set('tool_http_enabled', values.tool_http_enabled === 'true' ? 'false' : 'true')}
              className={`relative h-5 w-9 rounded-full border transition ${values.tool_http_enabled === 'true' ? 'bg-success/20 border-success/40' : 'bg-canvas border-line'}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${values.tool_http_enabled === 'true' ? 'left-4 bg-success' : 'left-0.5 bg-muted/40'}`} />
            </button>
            <span className="text-sm text-ink">{values.tool_http_enabled === 'true' ? 'Ativada' : 'Desativada'}</span>
          </div>
          <span className="text-[11px] text-muted/60">
            Quando ativada, o respondedor pode chamar webhooks HTTP com JSON. Deixe desativada até configurar os prompts/URLs.
          </span>
        </Field>
      </Section>

      {/* SEÇÃO: Sistema */}
      <Section title="Sistema" description="Configurações de runtime e operação">
        <Field label="Timezone">
          <select value={values.timezone ?? 'America/Sao_Paulo'} onChange={e => set('timezone', e.target.value)} className="field-input">
            {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </Field>

        <Field label="Máximo de conversas simultâneas">
          <div className="space-y-2">
            <input
              type="range"
              min={1}
              max={200}
              value={parseInt(values.max_concurrent_chats ?? '50', 10)}
              onChange={e => set('max_concurrent_chats', e.target.value)}
              className="w-full accent-accent"
            />
            <div className="flex justify-between font-mono text-[10px] text-muted/60">
              <span>1</span>
              <span className="text-accent font-semibold">{values.max_concurrent_chats ?? '50'} chats</span>
              <span>200</span>
            </div>
          </div>
        </Field>

        <Field label="Modo debug">
          <div className="flex items-center gap-3">
            <button
              onClick={() => set('debug_mode', values.debug_mode === 'true' ? 'false' : 'true')}
              className={`relative h-5 w-9 rounded-full border transition ${values.debug_mode === 'true' ? 'bg-danger/20 border-danger/40' : 'bg-canvas border-line'}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${values.debug_mode === 'true' ? 'left-4 bg-danger' : 'left-0.5 bg-muted/40'}`} />
            </button>
            <span className="text-sm text-ink">{values.debug_mode === 'true' ? 'Ativo — system prompts completos nos logs' : 'Desativado'}</span>
          </div>
        </Field>

        {/* Zona de perigo */}
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-5 mt-2">
          <div className="font-mono text-[11px] uppercase tracking-[0.15em] text-danger mb-3">Zona de Perigo</div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-ink">Apagar TODO o histórico de conversas</p>
              <p className="text-xs text-muted mt-1">Remove todas as mensagens e conversas do banco. Esta ação é irreversível.</p>
            </div>
            <button
              onClick={() => { setClearConfirmStep(1); setConfirmClearHistory(true) }}
              className="focus-ring shrink-0 h-8 rounded-md border border-danger/40 bg-danger/10 px-4 text-xs text-danger hover:bg-danger/20 transition"
            >
              Apagar histórico
            </button>
          </div>
        </div>
      </Section>

      {/* Dialog de confirmação dupla */}
      <ConfirmDialog
        open={confirmClearHistory}
        onOpenChange={open => { setConfirmClearHistory(open); if (!open) setClearConfirmStep(0) }}
        title={clearConfirmStep === 1 ? 'Apagar histórico — Confirmação 1/2' : 'Confirmação FINAL — ação irreversível'}
        description={
          clearConfirmStep === 1
            ? 'Você está prestes a apagar TODAS as mensagens e conversas. Clique em Continuar para a confirmação final.'
            : 'Esta é sua última chance. Depois de confirmar, o histórico não poderá ser recuperado. Deseja realmente apagar TUDO?'
        }
        confirmLabel={clearConfirmStep === 1 ? 'Continuar →' : 'Sim, apagar TUDO'}
        onConfirm={() => {
          if (clearConfirmStep === 1) {
            setClearConfirmStep(2)
          } else {
            void clearAllHistory()
          }
        }}
      />
    </div>
  )
}

/** Componente de seção */
function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded-xl bg-panel border border-line p-6 shadow-panel space-y-5">
      <div>
        <h3 className="font-semibold text-ink">{title}</h3>
        <p className="text-xs text-muted mt-0.5">{description}</p>
      </div>
      <div className="space-y-4 border-t border-line pt-4">
        {children}
      </div>
    </div>
  )
}

/** Componente de campo */
function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-1.5">
      <label className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{label}</label>
      <div className="space-y-1">
        {children}
      </div>
    </div>
  )
}
