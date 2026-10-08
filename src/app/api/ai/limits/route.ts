import { NextResponse } from 'next/server'
import { AUDIO_MODEL, CHAT_MODEL, groqEnabled } from '../../../../lib/groq'
import { logAiUsage, rateLimitHeaders } from '../../../../lib/aiUsage'
import { adminDb } from '../../../../lib/botData'
import { userFromRequest } from '../../../../lib/serverAuth'

/**
 * Painel → consulta os limites atuais da conta na Groq.
 * Faz uma chamada mínima ao modelo de texto (1 token de saída) só para ler os headers x-ratelimit-*.
 * Conta como 1 requisição do limite diário.
 */
export async function POST(request: Request) {
  const userId = await userFromRequest(request)
  if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!groqEnabled()) return NextResponse.json({ chatModel: CHAT_MODEL, audioModel: AUDIO_MODEL, error: 'GROQ_API_KEY não configurada' })

  const t0 = Date.now()
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: CHAT_MODEL, max_completion_tokens: 1, reasoning_effort: 'low', messages: [{ role: 'user', content: 'ok' }] }),
  }).catch((e) => e as Error)

  if (res instanceof Error) return NextResponse.json({ chatModel: CHAT_MODEL, audioModel: AUDIO_MODEL, error: String(res) })
  const headers = rateLimitHeaders(res.headers)
  const body = await res.json().catch(() => ({}))
  const u = body.usage || {}
  await logAiUsage(adminDb, {
    user_id: userId, provider: 'groq', kind: 'chat', model: CHAT_MODEL, purpose: 'verificação de limites',
    status: res.ok ? 'ok' : 'erro', http_status: res.status, latency_ms: Date.now() - t0,
    prompt_tokens: u.prompt_tokens ?? null, completion_tokens: u.completion_tokens ?? null, total_tokens: u.total_tokens ?? null,
    request_id: body.x_groq?.id || body.id || null, ratelimit: headers, error: res.ok ? null : JSON.stringify(body).slice(0, 500),
  })
  return NextResponse.json({ chatModel: CHAT_MODEL, audioModel: AUDIO_MODEL, headers, checkedAt: new Date().toISOString(), ok: res.ok, error: res.ok ? null : body?.error?.message || `HTTP ${res.status}` })
}
