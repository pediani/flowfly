// Classificação de lançamentos por IA (Groq) + regras aprendidas com as suas correções.
import { allCategories, normalize } from './categories'
import { merchantKey } from './analysis'
import { logAiUsage, rateLimitHeaders } from './aiUsage'
import { CHAT_MODEL, groqEnabled } from './groq'
import type { Db } from './botData'

export type ClassifyItem = { description: string; bankDescription?: string | null; amount: number; type: 'entrada' | 'saida'; hint?: string | null; account?: string | null }
export type ClassifyResult = { categories: (string | null)[]; retryAfterMs: number | null; error?: string }

const API = 'https://api.groq.com/openai/v1'

/** Chave do estabelecimento usada nas regras ("SUP SAO VICENTE LJ 03" → "sup sao"). */
export const ruleKey = (description: string, bankDescription?: string | null) => merchantKey(bankDescription || description)

export async function loadRules(db: Db, userId: string): Promise<Map<string, string>> {
  const { data, error } = await db.from('category_rules').select('merchant, category').eq('user_id', userId)
  if (error) return new Map()
  return new Map((data || []).map((r: { merchant: string; category: string }) => [r.merchant, r.category]))
}

function parseRetry(h: Headers): number | null {
  const ra = h.get('retry-after')
  if (ra && Number.isFinite(Number(ra))) return Number(ra) * 1000
  const reset = h.get('x-ratelimit-reset-tokens') || h.get('x-ratelimit-reset-requests')
  const m = reset?.match(/(?:(\d+)m)?([\d.]+)s/)
  return m ? (Number(m[1] || 0) * 60 + Number(m[2])) * 1000 : null
}

/**
 * Classifica até ~40 lançamentos numa chamada. Usa as categorias do usuário (com palavras-chave)
 * e exemplos das regras que ele já ensinou. Devolve uma categoria válida por item (ou null).
 */
export async function classifyWithAI(items: ClassifyItem[], ctx: { userId?: string; examples?: [string, string][]; db?: Db | null; purpose?: string } = {}): Promise<ClassifyResult> {
  if (!groqEnabled() || !items.length) return { categories: items.map(() => null), retryAfterMs: null }
  const cats = allCategories()
  const catLines = cats.map((c) => `- ${c.name}${c.keywords.length ? `: ${c.keywords.slice(0, 8).join(', ')}` : ''}`).join('\n')
  const examples = (ctx.examples || []).slice(0, 40).map(([m, c]) => `"${m}" → ${c}`).join('\n')
  const system = [
    'Você classifica lançamentos de extrato bancário e cartão de crédito no Brasil em UMA categoria da lista.',
    'Responda só JSON: {"c":{"0":"Categoria","1":"Categoria",...}} usando exatamente os nomes da lista.',
    'Pistas: supermercado/mercado/minimercado/atacado/padaria/restaurante/lanchonete/café/bar de comida/ifood/delivery → Alimentação.',
    'Posto/combustível/estacionamento/pedágio/uber/99/autopeças e manutenção do carro → Transporte.',
    'Drogaria/farmácia/hospital/clínica/laboratório/dentista/academia → Saúde. Streaming, apps, nuvem, telefonia/internet mensal → Assinaturas (ou Casa se for conta da casa).',
    'Lojas de roupa, eletrônicos, marketplaces (Shopee, Amazon, Mercado Livre, Renner, C&A, Riachuelo) → Compras. Cinema, ingressos, viagens, hotel, games → Lazer.',
    'Pix ou transferência para pessoa física sem contexto → Geral. Entradas: salário/vendas/rendimentos → Renda; estorno/reembolso → Renda ou Geral.',
    'Se uma categoria personalizada do usuário se encaixar melhor, prefira ela. Na dúvida, Geral.',
    '', 'CATEGORIAS:', catLines,
    ...(examples ? ['', 'O USUÁRIO JÁ CLASSIFICOU ASSIM (siga o mesmo padrão):', examples] : []),
  ].join('\n')
  const user = items.map((it, i) => `${i}|${it.type === 'entrada' ? 'ENTRADA' : 'SAÍDA'}|${it.amount.toFixed(2)}|${(it.bankDescription || it.description).slice(0, 50)}${it.bankDescription && it.description && it.description !== it.bankDescription ? ` (${it.description.slice(0, 30)})` : ''}${it.hint ? `|banco: ${it.hint}` : ''}${it.account && /Cart/.test(it.account) ? '|cartão' : ''}`).join('\n')

  const t0 = Date.now()
  const res = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: CHAT_MODEL, temperature: 0, reasoning_effort: 'low', max_completion_tokens: 1500, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  }).catch((e) => e as Error)
  if (res instanceof Error) {
    await logAiUsage(ctx.db ?? null, { user_id: ctx.userId, provider: 'groq', kind: 'chat', model: CHAT_MODEL, purpose: ctx.purpose || 'categorias', status: 'erro', latency_ms: Date.now() - t0, error: String(res) })
    return { categories: items.map(() => null), retryAfterMs: null, error: String(res) }
  }
  const data = await res.json().catch(() => ({}))
  const u = data.usage || {}
  let parsed: Record<string, string> = {}
  try { parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}').c || {} } catch { parsed = {} }
  const valid = new Map(cats.map((c) => [normalize(c.name), c.name]))
  const categories = items.map((_it, i) => valid.get(normalize(String(parsed[String(i)] || '').trim())) ?? null)
  await logAiUsage(ctx.db ?? null, {
    user_id: ctx.userId, provider: 'groq', kind: 'chat', model: data.model || CHAT_MODEL, purpose: ctx.purpose || 'categorias',
    status: res.ok ? (categories.some(Boolean) ? 'ok' : 'sem resultado') : 'erro', http_status: res.status, latency_ms: Date.now() - t0,
    prompt_tokens: u.prompt_tokens ?? null, completion_tokens: u.completion_tokens ?? null, total_tokens: u.total_tokens ?? null,
    cached_tokens: u.prompt_tokens_details?.cached_tokens ?? null, reasoning_tokens: u.completion_tokens_details?.reasoning_tokens ?? null,
    input_chars: system.length + user.length, result_count: categories.filter(Boolean).length, ratelimit: rateLimitHeaders(res.headers),
    request_id: data.x_groq?.id || data.id || null, error: res.ok ? null : JSON.stringify(data).slice(0, 500),
  })
  return { categories, retryAfterMs: res.status === 429 ? parseRetry(res.headers) ?? 20000 : null, ...(res.ok ? {} : { error: data.error?.message || `HTTP ${res.status}` }) }
}

type LearnRow = { id: string; user_id: string; description: string; bank_description?: string | null; category_by?: string | null }

/**
 * Você trocou a categoria: grava a regra do estabelecimento e aplica nos lançamentos parecidos
 * (que não foram escolhidos por você). Devolve quantos outros foram atualizados.
 */
export async function learnCategory(db: Db, userId: string, txId: string, category: string): Promise<number> {
  const { data: tx } = await db.from('transactions').select('id, user_id, description, bank_description').eq('id', txId).maybeSingle()
  const row = tx as LearnRow | null
  if (!row || row.user_id !== userId) return 0
  const key = ruleKey(row.description, row.bank_description)
  await db.from('transactions').update({ category, category_by: 'user' }).eq('id', row.id).then(({ error }) => error && db.from('transactions').update({ category }).eq('id', row.id))
  if (!key || key.length < 3) return 0
  const { error } = await db.from('category_rules').upsert({ user_id: userId, merchant: key, category, updated_at: new Date().toISOString() })
  if (error) return 0   // migração ainda não rodada
  const since = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10)
  const { data: others } = await db.from('transactions').select('id, description, bank_description, category_by, category')
    .eq('user_id', userId).eq('source', 'bank').gte('date', since).neq('id', row.id).neq('category', category)
  const ids = ((others || []) as (LearnRow & { category: string })[])
    .filter((o) => o.category_by !== 'user' && ruleKey(o.description, o.bank_description) === key).map((o) => o.id)
  for (let i = 0; i < ids.length; i += 100) await db.from('transactions').update({ category, category_by: 'rule' }).in('id', ids.slice(i, i + 100))
  return ids.length
}
