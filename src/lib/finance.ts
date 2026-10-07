import { addMonths, daysInMonth, monthKeyOf, monthLabel, todayBR } from './dates'
import { formatBRL } from './format'
import { getCategory, normalize } from './categories'

// ---- Tipos (espelham as tabelas do Supabase) ----

export type Tx = {
  id: string
  user_id?: string
  amount: number
  type: 'entrada' | 'saida' | 'a_pagar' | string
  description: string
  category: string | null
  date: string
  is_split?: boolean | null
  created_at?: string | null
  source?: string | null
}

export type Recurring = {
  id: string
  amount: number
  type: 'entrada' | 'saida' | string
  description: string
  day_of_month: number
}

export type Installment = {
  id: string
  description: string
  installment_amount: number
  total_installments: number
  current_installment: number
  start_date: string
}

export type Budget = { category: string; monthly_limit: number }

export type MonthSummary = {
  key: string
  entradas: number
  saidas: number
  saldo: number
  aPagar: number
  aReceber: number
  count: number
}

const n = (v: unknown) => Number(v) || 0
const round2 = (v: number) => Math.round(v * 100) / 100

export function txsOfMonth(txs: Tx[], key: string): Tx[] {
  return txs.filter((t) => monthKeyOf(t.date) === key)
}

export function summarize(txs: Tx[], key: string): MonthSummary {
  const list = txsOfMonth(txs, key)
  const s: MonthSummary = { key, entradas: 0, saidas: 0, saldo: 0, aPagar: 0, aReceber: 0, count: list.length }
  for (const t of list) {
    if (t.type === 'entrada') s.entradas += n(t.amount)
    else if (t.type === 'saida') {
      s.saidas += n(t.amount)
      if (t.is_split) s.aReceber += n(t.amount) / 2
    } else if (t.type === 'a_pagar') s.aPagar += n(t.amount)
  }
  s.saldo = s.entradas - s.saidas
  return s
}

/** Saldo de todos os tempos (entradas − saídas). */
export function overallBalance(txs: Tx[]): number {
  return txs.reduce((acc, t) => acc + (t.type === 'entrada' ? n(t.amount) : t.type === 'saida' ? -n(t.amount) : 0), 0)
}

export function pendingDebts(txs: Tx[]): number {
  return txs.filter((t) => t.type === 'a_pagar').reduce((a, t) => a + n(t.amount), 0)
}

/** Consolidado por mês, do mais recente para o mais antigo (só meses com lançamentos). */
export function monthlyHistory(txs: Tx[], limit = 12): MonthSummary[] {
  const keys = [...new Set(txs.map((t) => monthKeyOf(t.date)))].sort().reverse().slice(0, limit)
  return keys.map((k) => summarize(txs, k))
}

export type CategorySlice = { category: string; total: number; pct: number; color: string; emoji: string }

export function categoryBreakdown(txs: Tx[], key: string): CategorySlice[] {
  const totals: Record<string, number> = {}
  for (const t of txsOfMonth(txs, key)) {
    if (t.type !== 'saida') continue
    const c = t.category || 'Geral'
    totals[c] = (totals[c] || 0) + n(t.amount)
  }
  const sum = Object.values(totals).reduce((a, b) => a + b, 0)
  return Object.entries(totals)
    .map(([category, total]) => {
      const def = getCategory(category)
      return { category, total, pct: sum ? (total / sum) * 100 : 0, color: def.color, emoji: def.emoji }
    })
    .sort((a, b) => b.total - a.total)
}

// ---- Projeções ----

/** Lançamento que corresponde a uma conta fixa (mesmo tipo e descrição). */
function isRecurringLike(t: Tx, recurring: Recurring[]): boolean {
  const d = normalize(t.description || '')
  return recurring.some((r) => r.type === t.type && normalize(r.description) === d)
}

function variableSpending(txs: Tx[], key: string, recurring: Recurring[]): number {
  return txsOfMonth(txs, key)
    .filter((t) => t.type === 'saida' && !isRecurringLike(t, recurring))
    .reduce((a, t) => a + n(t.amount), 0)
}

/** Média de gastos variáveis (fora as contas fixas) dos últimos meses completos que têm dados. */
function avgVariableSpending(txs: Tx[], fromKey: string, recurring: Recurring[], months = 3): number | null {
  const vals: number[] = []
  for (let i = 1; i <= 12 && vals.length < months; i++) {
    const k = addMonths(fromKey, -i)
    if (txsOfMonth(txs, k).length) vals.push(variableSpending(txs, k, recurring))
  }
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

function recurringDay(r: Recurring, key: string): number {
  return Math.min(Math.max(1, n(r.day_of_month)), daysInMonth(key))
}

/** Contas fixas ainda não lançadas no mês (não há lançamento com a mesma descrição). */
export function pendingRecurring(txs: Tx[], recurring: Recurring[], key: string): Recurring[] {
  const monthTx = txsOfMonth(txs, key)
  return recurring.filter((r) => !monthTx.some((t) => t.type === r.type && normalize(t.description) === normalize(r.description)))
}

function installmentsDue(installments: Installment[], key: string): number {
  return installments.reduce((acc, i) => {
    const offset = monthsBetween(monthKeyOf(i.start_date), key) // 0 = mês da parcela "current_installment"
    const k = n(i.current_installment) + offset
    return offset >= 0 && k <= n(i.total_installments) ? acc + n(i.installment_amount) : acc
  }, 0)
}

function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number)
  const [yb, mb] = b.split('-').map(Number)
  return (yb - ya) * 12 + (mb - ma)
}

export type DayPoint = { day: number; label: string; realizado?: number; projetado?: number }

export type MonthProjection = {
  series: DayPoint[]
  isCurrent: boolean
  isFuture: boolean
  projectedEntradas: number
  projectedSaidas: number
  projectedSaldo: number
  /** Média mensal de gastos variáveis dos meses anteriores (informativo, não entra na projeção) */
  avgMonthlyVariable: number | null
  remainingRecurring: Recurring[]
}

/**
 * Saldo do mês dia a dia. No mês atual, projeta até o fim só com o que é conhecido:
 * lançado até hoje + contas fixas que ainda vencem. Gastos avulsos não são extrapolados.
 */
export function monthProjection(txs: Tx[], recurring: Recurring[], key: string, today = todayBR()): MonthProjection {
  const total = daysInMonth(key)
  const curKey = monthKeyOf(today)
  const isCurrent = key === curKey
  const isFuture = key > curKey
  const todayDay = isCurrent ? Number(today.slice(8, 10)) : isFuture ? 0 : total

  const netByDay = new Array(total + 1).fill(0)
  for (const t of txsOfMonth(txs, key)) {
    const d = Number(t.date.slice(8, 10))
    if (t.type === 'entrada') netByDay[d] += n(t.amount)
    else if (t.type === 'saida') netByDay[d] -= n(t.amount)
  }

  const s = summarize(txs, key)
  const remainingRecurring = isCurrent || isFuture
    ? pendingRecurring(txs, recurring, key).filter((r) => recurringDay(r, key) > todayDay)
    : []

  const avgMonthlyVariable = avgVariableSpending(txs, key, recurring)

  const series: DayPoint[] = []
  let acc = 0
  for (let d = 1; d <= total; d++) {
    const p: DayPoint = { day: d, label: String(d).padStart(2, '0') }
    if (d <= todayDay) {
      acc += netByDay[d]
      p.realizado = round2(acc)
      if (d === todayDay && todayDay < total) p.projetado = p.realizado
    } else {
      for (const r of remainingRecurring) if (recurringDay(r, key) === d) acc += r.type === 'entrada' ? n(r.amount) : -n(r.amount)
      p.projetado = round2(acc)
    }
    series.push(p)
  }

  const recIn = remainingRecurring.filter((r) => r.type === 'entrada').reduce((a, r) => a + n(r.amount), 0)
  const recOut = remainingRecurring.filter((r) => r.type === 'saida').reduce((a, r) => a + n(r.amount), 0)
  const projectedEntradas = s.entradas + recIn
  const projectedSaidas = s.saidas + recOut

  return {
    series,
    isCurrent,
    isFuture,
    projectedEntradas: round2(projectedEntradas),
    projectedSaidas: round2(projectedSaidas),
    projectedSaldo: round2(projectedEntradas - projectedSaidas),
    avgMonthlyVariable: avgMonthlyVariable === null ? null : round2(avgMonthlyVariable),
    remainingRecurring,
  }
}

export type FuturePoint = {
  key: string
  label: string
  entradas: number
  saidas: number
  saldoMes: number
  acumulado: number
  realizado: boolean
}

/** Mês atual (projetado) + próximos meses: só contas fixas e parcelas (compromissos conhecidos). */
export function futureProjection(
  txs: Tx[], recurring: Recurring[], installments: Installment[], months = 6, today = todayBR()
): FuturePoint[] {
  const cur = monthKeyOf(today)
  const mp = monthProjection(txs, recurring, cur, today)
  const s = summarize(txs, cur)

  // Saldo acumulado: tudo até hoje + o que ainda falta acontecer no mês atual
  let acumulado = overallBalance(txs) + (mp.projectedSaldo - s.saldo)
  const out: FuturePoint[] = [{
    key: cur, label: monthLabel(cur, 'short'),
    entradas: mp.projectedEntradas, saidas: mp.projectedSaidas, saldoMes: mp.projectedSaldo,
    acumulado: round2(acumulado), realizado: false,
  }]

  const recIn = recurring.filter((r) => r.type === 'entrada').reduce((a, r) => a + n(r.amount), 0)
  const recOut = recurring.filter((r) => r.type === 'saida').reduce((a, r) => a + n(r.amount), 0)
  for (let i = 1; i < months; i++) {
    const k = addMonths(cur, i)
    const entradas = recIn
    const saidas = recOut + installmentsDue(installments, k)
    acumulado += entradas - saidas
    out.push({
      key: k, label: monthLabel(k, 'short'),
      entradas: round2(entradas), saidas: round2(saidas), saldoMes: round2(entradas - saidas),
      acumulado: round2(acumulado), realizado: false,
    })
  }
  return out
}

// ---- Orçamentos ----

export type BudgetStatus = { category: string; limit: number; spent: number; pct: number }

export function budgetStatus(txs: Tx[], budgets: Budget[], key: string): BudgetStatus[] {
  const spent = Object.fromEntries(categoryBreakdown(txs, key).map((c) => [c.category, c.total]))
  return budgets
    .map((b) => {
      const s = spent[b.category] || 0
      return { category: b.category, limit: n(b.monthly_limit), spent: s, pct: n(b.monthly_limit) ? (s / n(b.monthly_limit)) * 100 : 0 }
    })
    .sort((a, b) => b.pct - a.pct)
}

// ---- Avisos ----

export type Insight = {
  id: string
  level: 'danger' | 'warn' | 'info' | 'good'
  emoji: string
  title: string
  text: string
}

const LEVEL_ORDER = { danger: 0, warn: 1, info: 2, good: 3 }

export function buildInsights(
  txs: Tx[], recurring: Recurring[], budgets: Budget[], key: string, today = todayBR()
): Insight[] {
  const out: Insight[] = []
  const s = summarize(txs, key)
  const cats = categoryBreakdown(txs, key)
  const mp = monthProjection(txs, recurring, key, today)

  // 1. Fechamento negativo previsto
  if (mp.isCurrent && (s.count > 0 || recurring.length) && mp.projectedSaldo < 0) {
    out.push({
      id: 'neg', level: 'danger', emoji: '🚨', title: 'Mês deve fechar no vermelho',
      text: `Com as contas fixas que ainda vencem, ${monthLabel(key)} termina com ${formatBRL(mp.projectedSaldo)}.`,
    })
  }

  // 2. Orçamentos
  for (const b of budgetStatus(txs, budgets, key)) {
    const def = getCategory(b.category)
    if (b.pct >= 100) {
      out.push({ id: `bud-${b.category}`, level: 'danger', emoji: def.emoji, title: `Orçamento de ${b.category} estourado`,
        text: `${formatBRL(b.spent)} de ${formatBRL(b.limit)} (${Math.round(b.pct)}%).` })
    } else if (b.pct >= 80) {
      out.push({ id: `bud-${b.category}`, level: 'warn', emoji: def.emoji, title: `${b.category} perto do limite`,
        text: `Já foram ${formatBRL(b.spent)} de ${formatBRL(b.limit)} (${Math.round(b.pct)}%). Restam ${formatBRL(b.limit - b.spent)}.` })
    }
  }

  // 3. Categoria acima da média dos últimos meses
  for (const c of cats) {
    const prev: number[] = []
    for (let i = 1; i <= 6 && prev.length < 3; i++) {
      const k = addMonths(key, -i)
      if (txsOfMonth(txs, k).length) prev.push(categoryBreakdown(txs, k).find((x) => x.category === c.category)?.total || 0)
    }
    if (!prev.length) continue
    const avg = prev.reduce((a, b) => a + b, 0) / prev.length
    if (avg > 0 && c.total >= avg * 1.3 && c.total - avg >= 50 && !out.some((o) => o.id === `bud-${c.category}`)) {
      out.push({ id: `avg-${c.category}`, level: 'warn', emoji: c.emoji, title: `Gasto alto em ${c.category}`,
        text: `${formatBRL(c.total)} este mês, ${Math.round((c.total / avg - 1) * 100)}% acima da sua média (${formatBRL(avg)}).` })
    }
  }

  // 4. Concentração
  const top = cats[0]
  if (top && s.saidas >= 200 && top.pct >= 40 && cats.length > 1) {
    out.push({ id: 'conc', level: 'info', emoji: top.emoji, title: `${top.category} concentra seus gastos`,
      text: `${Math.round(top.pct)}% das saídas de ${monthLabel(key)} (${formatBRL(top.total)}).` })
  }

  // 5. Contas fixas nos próximos 5 dias
  if (mp.isCurrent) {
    const day = Number(today.slice(8, 10))
    const soon = mp.remainingRecurring
      .filter((r) => r.type === 'saida' && recurringDay(r, key) - day <= 5)
      .sort((a, b) => recurringDay(a, key) - recurringDay(b, key))
    if (soon.length) {
      out.push({ id: 'soon', level: 'info', emoji: '🗓️', title: 'Contas fixas chegando',
        text: soon.map((r) => `${r.description} (dia ${recurringDay(r, key)}) ${formatBRL(n(r.amount))}`).join(' · ') })
    }
  }

  // 6. Pendências com parceiro
  const debts = pendingDebts(txs)
  if (debts > 0) {
    out.push({ id: 'debt', level: 'info', emoji: '🤝', title: 'Pendências de divisão',
      text: `Você tem ${formatBRL(debts)} a pagar ao seu parceiro.` })
  }

  // 7. Ponto positivo
  const prevS = summarize(txs, addMonths(key, -1))
  if (!out.some((o) => o.level === 'danger') && prevS.saidas > 0 && s.saidas > 0 && !mp.isCurrent && s.saidas < prevS.saidas * 0.9) {
    out.push({ id: 'good', level: 'good', emoji: '🌱', title: 'Gastou menos que no mês anterior',
      text: `${formatBRL(s.saidas)} contra ${formatBRL(prevS.saidas)} em ${monthLabel(prevS.key)}.` })
  }
  if (mp.isCurrent && s.count > 0 && mp.projectedSaldo > 0 && !out.some((o) => o.level === 'danger' || o.level === 'warn')) {
    out.push({ id: 'good-proj', level: 'good', emoji: '🌱', title: 'Mês no azul',
      text: `A projeção indica fechamento com ${formatBRL(mp.projectedSaldo)} de saldo.` })
  }

  return out.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]).slice(0, 6)
}
