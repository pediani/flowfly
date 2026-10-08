// Registro de cada uso da IA (ou de mensagens resolvidas sem IA) na tabela ai_usage.
import type { Db } from './botData'

export type AiUsageRow = {
  user_id?: string | null
  provider: 'groq' | 'local'
  kind: 'chat' | 'audio' | 'local'
  model?: string | null
  purpose?: string | null
  status: 'ok' | 'erro' | 'sem resultado'
  http_status?: number | null
  latency_ms?: number | null
  prompt_tokens?: number | null
  completion_tokens?: number | null
  cached_tokens?: number | null
  reasoning_tokens?: number | null
  total_tokens?: number | null
  audio_seconds?: number | null
  queue_time_ms?: number | null
  server_time_ms?: number | null
  result_count?: number | null
  input_chars?: number | null
  request_id?: string | null
  ratelimit?: Record<string, string> | null
  error?: string | null
}

/** Headers de limite da Groq (x-ratelimit-*, retry-after) */
export function rateLimitHeaders(h: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  h.forEach((v, k) => { if (k.startsWith('x-ratelimit') || k === 'retry-after') out[k] = v })
  return out
}

export async function logAiUsage(db: Db | null, row: AiUsageRow) {
  if (!db) return
  try {
    const { error } = await db.from('ai_usage').insert(row)
    if (error) console.error('ai_usage insert:', error.message)
  } catch (e) {
    console.error('ai_usage insert falhou:', e)
  }
}

// Preços públicos da Groq (USD). Fonte: console.groq.com/docs/model/* — atualize se mudarem.
export const PRICING: Record<string, { input: number; cachedInput?: number; output: number } | { perHour: number; minSeconds: number }> = {
  'openai/gpt-oss-120b': { input: 0.15, cachedInput: 0.075, output: 0.6 },   // por 1M tokens
  'openai/gpt-oss-20b': { input: 0.075, cachedInput: 0.037, output: 0.3 },
  'whisper-large-v3-turbo': { perHour: 0.04, minSeconds: 10 },
  'whisper-large-v3': { perHour: 0.111, minSeconds: 10 },
}

/** Custo equivalente (USD) se a chamada fosse cobrada no plano pago */
export function estimateCostUSD(r: { model?: string | null; prompt_tokens?: number | null; cached_tokens?: number | null; completion_tokens?: number | null; audio_seconds?: number | null }): number {
  const p = r.model ? PRICING[r.model] : undefined
  if (!p) return 0
  if ('perHour' in p) return r.audio_seconds != null ? (Math.max(p.minSeconds, Number(r.audio_seconds)) / 3600) * p.perHour : 0
  const cached = Number(r.cached_tokens || 0)
  const input = Math.max(0, Number(r.prompt_tokens || 0) - cached)
  return (input * p.input + cached * (p.cachedInput ?? p.input) + Number(r.completion_tokens || 0) * p.output) / 1e6
}
