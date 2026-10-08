// Groq (plano gratuito): transcrição de áudio (Whisper) e interpretação de frases livres.
// Só roda no servidor. Requer GROQ_API_KEY. Cada chamada é registrada em ai_usage.
import { categoryNames } from './categories'
import { resolveDateToken, type ParsedEntry } from './parseEntry'
import { todayBR } from './dates'
import { logAiUsage, rateLimitHeaders } from './aiUsage'
import { adminDb } from './botData'

const API = 'https://api.groq.com/openai/v1'
const KEY = () => process.env.GROQ_API_KEY || ''
// llama-3.3-70b-versatile foi desligado pela Groq em 16/08/2026; o substituto recomendado é o gpt-oss-120b
export const CHAT_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b'
export const AUDIO_MODEL = process.env.GROQ_AUDIO_MODEL || 'whisper-large-v3-turbo'
// Modelo multimodal (lê imagens) disponível no plano gratuito da Groq
export const VISION_MODEL = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b'

export function groqEnabled(): boolean {
  return !!KEY()
}

export async function transcribe(audio: Blob, ctx: { userId?: string; seconds?: number } = {}, filename = 'voice.ogg'): Promise<string | null> {
  const form = new FormData()
  form.append('file', audio, filename)
  form.append('model', AUDIO_MODEL)
  form.append('language', 'pt')
  form.append('response_format', 'verbose_json')
  const t0 = Date.now()
  let res: Response
  try {
    res = await fetch(`${API}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${KEY()}` }, body: form })
  } catch (e) {
    await logAiUsage(adminDb, { user_id: ctx.userId, provider: 'groq', kind: 'audio', model: AUDIO_MODEL, purpose: 'áudio', status: 'erro', latency_ms: Date.now() - t0, error: String(e) })
    return null
  }
  const latency = Date.now() - t0
  const limits = rateLimitHeaders(res.headers)
  const reqId = res.headers.get('x-request-id')
  if (!res.ok) {
    const err = await res.text()
    console.error('Groq transcrição falhou:', res.status, err)
    await logAiUsage(adminDb, { user_id: ctx.userId, provider: 'groq', kind: 'audio', model: AUDIO_MODEL, purpose: 'áudio', status: 'erro', http_status: res.status, latency_ms: latency, audio_seconds: ctx.seconds ?? null, ratelimit: limits, request_id: reqId, error: err.slice(0, 500) })
    return null
  }
  const data = await res.json()
  const text = typeof data.text === 'string' ? data.text.trim() : null
  await logAiUsage(adminDb, {
    user_id: ctx.userId, provider: 'groq', kind: 'audio', model: AUDIO_MODEL, purpose: 'áudio',
    status: text ? 'ok' : 'sem resultado', http_status: res.status, latency_ms: latency,
    audio_seconds: Number(data.duration ?? ctx.seconds ?? 0) || null,
    request_id: data.x_groq?.id || reqId, ratelimit: limits, input_chars: text?.length ?? null,
  })
  return text
}

type RawItem = { type?: string; description?: string; amount?: number | string; category?: string; date?: string; installments?: number }

/** Extrai um ou mais lançamentos de uma frase livre: "gastei 20 no mercado e 30 de uber ontem". */
export async function interpretMany(text: string, ctx: { userId?: string; purpose?: string } = {}, today = todayBR()): Promise<ParsedEntry[]> {
  const system = [
    'Você extrai lançamentos financeiros de mensagens em português do Brasil. Uma mensagem pode ter VÁRIOS lançamentos.',
    `Hoje é ${today}. Responda SOMENTE um JSON no formato {"items": [ ... ]}, onde cada item tem:`,
    '{"type": "saida"|"entrada", "description": string curta (2-4 palavras, sem valor nem data), "amount": number em reais,',
    ` "category": uma de [${categoryNames().join(', ')}], "date": "YYYY-MM-DD", "installments": inteiro (1 se à vista)}`,
    'Números por extenso viram dígitos ("trinta e cinco e noventa" = 35.90; "12 reais e 50 centavos" = 12.50; "12 e 50" = 12.50). "recebi", "ganhei", "salário" = entrada; "gastei", "paguei", "comprei" = saída.',
    'Se um item não disser o tipo ou a data, use os do item anterior. Se não houver lançamento, responda {"items": []}.',
  ].join('\n')

  const t0 = Date.now()
  let res: Response
  try {
    res = await fetch(`${API}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: CHAT_MODEL,
        temperature: 0,
        reasoning_effort: 'low',
        max_completion_tokens: 1200,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: text.slice(0, 800) }],
      }),
    })
  } catch (e) {
    await logAiUsage(adminDb, { user_id: ctx.userId, provider: 'groq', kind: 'chat', model: CHAT_MODEL, purpose: ctx.purpose, status: 'erro', latency_ms: Date.now() - t0, input_chars: text.length, error: String(e) })
    return []
  }
  const latency = Date.now() - t0
  const limits = rateLimitHeaders(res.headers)
  if (!res.ok) {
    const err = await res.text()
    console.error('Groq interpretação falhou:', res.status, err)
    await logAiUsage(adminDb, { user_id: ctx.userId, provider: 'groq', kind: 'chat', model: CHAT_MODEL, purpose: ctx.purpose, status: 'erro', http_status: res.status, latency_ms: latency, input_chars: text.length, ratelimit: limits, request_id: res.headers.get('x-request-id'), error: err.slice(0, 500) })
    return []
  }

  const data = await res.json()
  const u = data.usage || {}
  const entries: ParsedEntry[] = []
  let parseError: string | null = null
  try {
    const j = JSON.parse(data.choices?.[0]?.message?.content || '{}')
    const items: RawItem[] = Array.isArray(j.items) ? j.items : j.amount ? [j] : []
    let lastType: 'entrada' | 'saida' = 'saida'
    let lastDate = today
    for (const it of items) {
      const amount = Math.round(Number(it.amount) * 100) / 100
      if (!Number.isFinite(amount) || amount <= 0 || !it.description) continue
      const type: 'entrada' | 'saida' = it.type === 'entrada' ? 'entrada' : it.type === 'saida' ? 'saida' : lastType
      const rawDate = String(it.date || '')
      const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && rawDate <= today ? rawDate : (resolveDateToken(rawDate, today) ?? lastDate)
      const category = categoryNames().includes(String(it.category)) ? String(it.category) : type === 'entrada' ? 'Renda' : 'Geral'
      const installments = type === 'saida' ? Math.min(48, Math.max(1, Math.round(Number(it.installments) || 1))) : 1
      entries.push({ type, description: String(it.description).slice(0, 200), amount, category, categoryExplicit: false, date, installments })
      lastType = type
      lastDate = date
    }
  } catch (e) {
    parseError = `JSON inválido: ${String(e)}`
    console.error('Groq resposta inválida:', e)
  }

  await logAiUsage(adminDb, {
    user_id: ctx.userId, provider: 'groq', kind: 'chat', model: data.model || CHAT_MODEL, purpose: ctx.purpose,
    status: parseError ? 'erro' : entries.length ? 'ok' : 'sem resultado',
    http_status: res.status, latency_ms: latency,
    prompt_tokens: u.prompt_tokens ?? null, completion_tokens: u.completion_tokens ?? null, total_tokens: u.total_tokens ?? null,
    cached_tokens: u.prompt_tokens_details?.cached_tokens ?? null, reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? null,
    queue_time_ms: u.queue_time != null ? Math.round(u.queue_time * 1000) : null,
    server_time_ms: u.total_time != null ? Math.round(u.total_time * 1000) : null,
    result_count: entries.length, input_chars: text.length,
    request_id: data.x_groq?.id || data.id || null, ratelimit: limits, error: parseError,
  })
  return entries
}

/** Lê a foto de um comprovante / nota / Pix e devolve o(s) lançamento(s). */
export async function readReceipt(image: Blob, mime: string, ctx: { userId?: string; caption?: string } = {}, today = todayBR()): Promise<ParsedEntry[]> {
  const b64 = Buffer.from(await image.arrayBuffer()).toString('base64')
  const system = [
    'Você lê fotos de comprovantes (Pix, transferência, cartão), notas fiscais e cupons em português do Brasil.',
    `Hoje é ${today}. Responda SOMENTE um JSON {"items": [ ... ]} com UM item pelo valor TOTAL pago (não liste os produtos), com:`,
    '{"type": "saida"|"entrada", "description": nome do estabelecimento ou do destinatário (2-4 palavras), "amount": number em reais,',
    ` "category": uma de [${categoryNames().join(', ')}], "date": "YYYY-MM-DD" (data do comprovante), "installments": inteiro}`,
    'Pix ou transferência RECEBIDA = entrada; paga/enviada = saída. Se não for um comprovante, responda {"items": []}.',
  ].join('\n')
  const body = (json: boolean) => JSON.stringify({
    model: VISION_MODEL,
    temperature: 0,
    max_completion_tokens: 1500,
    ...(json ? { response_format: { type: 'json_object' } } : {}),
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: [
        { type: 'text', text: ctx.caption ? `Legenda do usuário: ${ctx.caption.slice(0, 300)}` : 'Extraia o lançamento desta imagem.' },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
      ] },
    ],
  })

  const t0 = Date.now()
  let res = await fetch(`${API}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/json' }, body: body(true) })
  // alguns modelos não aceitam modo JSON com imagem: tenta de novo sem
  if (res.status === 400) res = await fetch(`${API}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/json' }, body: body(false) })
  const latency = Date.now() - t0
  const limits = rateLimitHeaders(res.headers)
  if (!res.ok) {
    const err = await res.text()
    console.error('Groq visão falhou:', res.status, err)
    await logAiUsage(adminDb, { user_id: ctx.userId, provider: 'groq', kind: 'chat', model: VISION_MODEL, purpose: 'foto', status: 'erro', http_status: res.status, latency_ms: latency, ratelimit: limits, error: err.slice(0, 500) })
    return []
  }
  const data = await res.json()
  const u = data.usage || {}
  const content: string = data.choices?.[0]?.message?.content || '{}'
  const jsonText = (content.match(/\{[\s\S]*\}/g) || ['{}']).pop()!
  const entries: ParsedEntry[] = []
  try {
    const j = JSON.parse(jsonText)
    for (const it of (Array.isArray(j.items) ? j.items : j.amount ? [j] : []) as RawItem[]) {
      const amount = Math.round(Number(String(it.amount).replace(',', '.')) * 100) / 100
      if (!Number.isFinite(amount) || amount <= 0) continue
      const type = it.type === 'entrada' ? 'entrada' : 'saida'
      const rawDate = String(it.date || '')
      const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && rawDate <= today ? rawDate : today
      entries.push({
        type, amount, date, description: String(it.description || 'Comprovante').slice(0, 200), categoryExplicit: false,
        category: categoryNames().includes(String(it.category)) ? String(it.category) : type === 'entrada' ? 'Renda' : 'Geral',
        installments: type === 'saida' ? Math.min(48, Math.max(1, Math.round(Number(it.installments) || 1))) : 1,
      })
    }
  } catch (e) { console.error('Groq visão: JSON inválido', e, content.slice(0, 300)) }
  await logAiUsage(adminDb, {
    user_id: ctx.userId, provider: 'groq', kind: 'chat', model: data.model || VISION_MODEL, purpose: 'foto',
    status: entries.length ? 'ok' : 'sem resultado', http_status: res.status, latency_ms: latency,
    prompt_tokens: u.prompt_tokens ?? null, completion_tokens: u.completion_tokens ?? null, total_tokens: u.total_tokens ?? null,
    queue_time_ms: u.queue_time != null ? Math.round(u.queue_time * 1000) : null, server_time_ms: u.total_time != null ? Math.round(u.total_time * 1000) : null,
    result_count: entries.length, request_id: data.x_groq?.id || data.id || null, ratelimit: limits,
  })
  return entries
}

/** Responde perguntas sobre as finanças do usuário usando um resumo compacto dos dados. */
export async function answerQuestion(question: string, context: string, ctx: { userId?: string } = {}): Promise<string | null> {
  const system = [
    'Você é o assistente financeiro do app FlowFly. Responda em português do Brasil, de forma curta (até 6 linhas), direta e simpática.',
    'Use SOMENTE os dados abaixo. Se a resposta não estiver nos dados, diga isso e sugira o que registrar. Não invente números.',
    'Formate valores como R$ 1.234,56. Pode usar emojis com moderação. Não use markdown com ** ou #.',
    '', 'DADOS DO USUÁRIO:', context,
  ].join('\n')
  const t0 = Date.now()
  const res = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: CHAT_MODEL, temperature: 0.2, reasoning_effort: 'low', max_completion_tokens: 900, messages: [{ role: 'system', content: system }, { role: 'user', content: question.slice(0, 500) }] }),
  }).catch((e) => e as Error)
  if (res instanceof Error) { await logAiUsage(adminDb, { user_id: ctx.userId, provider: 'groq', kind: 'chat', model: CHAT_MODEL, purpose: 'pergunta', status: 'erro', latency_ms: Date.now() - t0, error: String(res) }); return null }
  const limits = rateLimitHeaders(res.headers)
  const data = await res.json().catch(() => ({}))
  const u = data.usage || {}
  const answer: string | null = res.ok ? (data.choices?.[0]?.message?.content || '').trim() || null : null
  await logAiUsage(adminDb, {
    user_id: ctx.userId, provider: 'groq', kind: 'chat', model: data.model || CHAT_MODEL, purpose: 'pergunta',
    status: answer ? 'ok' : res.ok ? 'sem resultado' : 'erro', http_status: res.status, latency_ms: Date.now() - t0,
    prompt_tokens: u.prompt_tokens ?? null, completion_tokens: u.completion_tokens ?? null, total_tokens: u.total_tokens ?? null,
    cached_tokens: u.prompt_tokens_details?.cached_tokens ?? null, reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? null,
    queue_time_ms: u.queue_time != null ? Math.round(u.queue_time * 1000) : null, server_time_ms: u.total_time != null ? Math.round(u.total_time * 1000) : null,
    input_chars: question.length + context.length, request_id: data.x_groq?.id || data.id || null, ratelimit: limits,
    error: res.ok ? null : JSON.stringify(data).slice(0, 500),
  })
  return answer
}
