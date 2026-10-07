// Acesso ao banco pelo servidor (service role, ignora RLS) — usado pelo webhook e pelo cron.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { daysInMonth } from './dates'
import type { Budget, Recurring, Tx } from './finance'
import { installmentDate, splitInstallments, type ParsedEntry } from './parseEntry'

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

export const adminDb: SupabaseClient | null = URL_ && KEY ? createClient(URL_, KEY, { auth: { persistSession: false } }) : null
export type Db = SupabaseClient

export const TX_COLS = 'id, user_id, amount, type, description, category, date, is_split, created_at, source, installment_group, installment_no, installment_total, split_parent_id'

export type TxRow = Tx & {
  user_id: string
  installment_group?: string | null
  installment_no?: number | null
  installment_total?: number | null
  split_parent_id?: string | null
}

export async function fetchTxs(db: Db, userId: string, fromKey: string, toKey = fromKey): Promise<Tx[]> {
  const { data } = await db.from('transactions').select(TX_COLS).eq('user_id', userId)
    .gte('date', `${fromKey}-01`).lte('date', `${toKey}-${daysInMonth(toKey)}`)
  return (data || []) as Tx[]
}

export async function fetchTxsBetween(db: Db, userId: string, from: string, to: string): Promise<Tx[]> {
  const { data } = await db.from('transactions').select(TX_COLS).eq('user_id', userId).gte('date', from).lte('date', to)
  return (data || []) as Tx[]
}

export async function fetchBudgets(db: Db, userId: string): Promise<Budget[]> {
  const { data } = await db.from('budgets').select('category, monthly_limit').eq('user_id', userId)
  return (data || []) as Budget[]
}

export async function fetchRecurring(db: Db, userId: string): Promise<Recurring[]> {
  const { data } = await db.from('recurring_transactions').select('id, amount, type, description, day_of_month').eq('user_id', userId)
  return (data || []) as Recurring[]
}

/** Primeiro parceiro com parceria aceita (ou null). */
export async function findPartner(db: Db, userId: string): Promise<string | null> {
  const { data } = await db.from('partnerships').select('requester_id, addressee_id')
    .eq('status', 'accepted').or(`requester_id.eq.${userId},addressee_id.eq.${userId}`).limit(1)
  const p = data?.[0]
  return p ? (p.requester_id === userId ? p.addressee_id : p.requester_id) : null
}

/** Grava o lançamento (ou todas as parcelas). Retorna a primeira linha. */
export async function insertEntry(db: Db, userId: string, e: ParsedEntry, source: 'telegram' | 'web' = 'telegram'): Promise<{ row: TxRow | null; error: unknown }> {
  if (e.installments <= 1) {
    const { data, error } = await db.from('transactions').insert({
      user_id: userId, amount: e.amount, description: e.description, type: e.type, category: e.category, date: e.date, source,
    }).select(TX_COLS).single()
    return { row: data as TxRow | null, error }
  }
  const group = crypto.randomUUID()
  const parts = splitInstallments(e.amount, e.installments)
  const rows = parts.map((amount, k) => ({
    user_id: userId, amount, type: e.type, category: e.category, source,
    description: `${e.description} (${k + 1}/${e.installments})`,
    date: installmentDate(e.date, k),
    installment_group: group, installment_no: k + 1, installment_total: e.installments,
  }))
  const { data, error } = await db.from('transactions').insert(rows).select(TX_COLS).order('installment_no')
  return { row: ((data || []) as TxRow[])[0] ?? null, error }
}

/** Linhas afetadas por uma ação: o lançamento ou todas as parcelas do grupo. */
export async function rowsOf(db: Db, tx: TxRow): Promise<TxRow[]> {
  if (!tx.installment_group) return [tx]
  const { data } = await db.from('transactions').select(TX_COLS).eq('installment_group', tx.installment_group).order('installment_no')
  return (data || []) as TxRow[]
}

/** Reconstrói o "lançamento" original a partir das linhas (para redesenhar a mensagem). */
export function entryFromRows(rows: TxRow[]): ParsedEntry {
  const first = rows[0]
  return {
    type: first.type === 'entrada' ? 'entrada' : 'saida',
    description: first.installment_group ? first.description.replace(/\s\(\d+\/\d+\)$/, '') : first.description,
    amount: Math.round(rows.reduce((a, r) => a + Number(r.amount), 0) * 100) / 100,
    category: first.category || 'Geral',
    categoryExplicit: true,
    date: first.date,
    installments: first.installment_total || 1,
  }
}
