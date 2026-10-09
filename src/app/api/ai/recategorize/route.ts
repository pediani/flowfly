import { NextResponse } from 'next/server'
import { adminDb, loadUserCategories } from '../../../../lib/botData'
import { classifyWithAI, loadRules, ruleKey } from '../../../../lib/aiCategorize'
import { groqEnabled } from '../../../../lib/groq'
import { userFromRequest } from '../../../../lib/serverAuth'

export const maxDuration = 60
const PAGE = 40

type Row = { id: string; description: string; bank_description: string | null; amount: number; type: 'entrada' | 'saida'; date: string; category: string | null; bank_account: string | null; note?: string | null }

/**
 * Painel → revisar categorias dos lançamentos do banco com IA.
 * mode "suggest": devolve sugestões (não altera nada) · mode "apply": grava as escolhidas.
 */
export async function POST(request: Request) {
  if (!adminDb) return NextResponse.json({ error: 'Servidor sem banco' }, { status: 500 })
  const userId = await userFromRequest(request)
  if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  const db = adminDb

  if (body.mode === 'apply') {
    const changes = (Array.isArray(body.changes) ? body.changes : []) as { id: string; category: string }[]
    const keep = (Array.isArray(body.keep) ? body.keep : []) as string[]
    const confirmed = (Array.isArray(body.confirmed) ? body.confirmed : []) as string[]
    for (const c of changes) await db.from('transactions').update({ category: String(c.category).slice(0, 60), category_by: 'ai' }).eq('id', c.id).eq('user_id', userId)
    for (let i = 0; i < keep.length; i += 100) await db.from('transactions').update({ category_by: 'user' }).in('id', keep.slice(i, i + 100)).eq('user_id', userId)
    for (let i = 0; i < confirmed.length; i += 100) await db.from('transactions').update({ category_by: 'ai' }).in('id', confirmed.slice(i, i + 100)).eq('user_id', userId)
    return NextResponse.json({ ok: true, changed: changes.length })
  }

  if (!groqEnabled()) return NextResponse.json({ error: 'IA não configurada (GROQ_API_KEY).' }, { status: 400 })
  await loadUserCategories(db, userId)
  const since = new Date(Date.now() - Number(body.days || 180) * 86400000).toISOString().slice(0, 10)
  const offset = Math.max(0, Number(body.offset) || 0)
  const base = () => db.from('transactions').select('id, description, bank_description, amount, type, date, category, bank_account', { count: 'exact' })
    .eq('user_id', userId).eq('source', 'bank').in('type', ['saida', 'entrada']).gte('date', since)
    .or('category_by.is.null,category_by.eq.auto')
  const { data, count, error } = await base().order('date', { ascending: false }).range(offset, offset + PAGE - 1)
  if (error) return NextResponse.json({ error: /category_by/.test(error.message) ? 'migration' : error.message }, { status: 400 })
  const rows = (data || []) as Row[]
  if (!rows.length) return NextResponse.json({ total: count ?? 0, items: [], next: null })

  const rules = await loadRules(db, userId)
  const { categories, retryAfterMs, error: aiError } = await classifyWithAI(rows.map((r) => ({
    description: r.description, bankDescription: r.bank_description, amount: Number(r.amount), type: r.type, account: r.bank_account,
  })), { userId, examples: [...rules.entries()], db, purpose: 'categorias (revisão)' })
  if (retryAfterMs && !categories.some(Boolean)) return NextResponse.json({ total: count ?? 0, items: [], next: offset, retryAfterMs })
  if (aiError && !categories.some(Boolean)) return NextResponse.json({ error: aiError }, { status: 502 })

  const items = rows.map((r, i) => {
    const rule = rules.get(ruleKey(r.description, r.bank_description))
    return { id: r.id, date: r.date, description: r.description, bank: r.bank_description, amount: Number(r.amount), type: r.type, from: r.category || 'Geral', to: rule || categories[i] || r.category || 'Geral' }
  })
  const next = offset + rows.length < (count ?? 0) ? offset + rows.length : null
  return NextResponse.json({ total: count ?? 0, items, next, retryAfterMs })
}
