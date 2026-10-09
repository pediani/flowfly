// Fluxo de caixa: saldo de hoje nas contas + o que já se sabe que vai entrar e sair até uma data.
import { addDays, addMonths, daysInMonth, formatDateBR, monthKeyOf, todayBR } from './dates'
import { pendingRecurring, type Recurring, type Tx } from './finance'
import type { BankBalance } from './pluggy'

export type CashEvent = { date: string; label: string; amount: number; kind: 'fatura' | 'fixa' | 'agendado' | 'simulado' }
export type CashFlow = {
  start: number
  end: number
  min: { value: number; date: string }
  events: CashEvent[]
  series: { date: string; label: string; saldo: number }[]
}

function recurringDate(r: Recurring, key: string): string {
  const d = Math.min(Math.max(1, Number(r.day_of_month)), daysInMonth(key))
  return `${key}-${String(d).padStart(2, '0')}`
}

export function horizonDate(kind: 'mes' | '30d' | 'proximo', today = todayBR()): string {
  const key = monthKeyOf(today)
  if (kind === 'mes') return `${key}-${daysInMonth(key)}`
  if (kind === '30d') return addDays(today, 30)
  const next = addMonths(key, 1)
  return `${next}-${daysInMonth(next)}`
}

export function buildCashFlow(
  accounts: BankBalance[], recurring: Recurring[], txs: Tx[], until: string, today = todayBR(),
  opts: { startOffset?: number; extra?: CashEvent[] } = {},
): CashFlow {
  const start = accounts.filter((a) => a.type === 'Conta').reduce((s, a) => s + Number(a.balance), 0) + (opts.startOffset || 0)
  const events: CashEvent[] = [...(opts.extra || []).filter((e) => e.date >= today && e.date <= until)]

  // Faturas dos cartões, no vencimento
  for (const c of accounts.filter((a) => a.type === 'Cartão')) {
    const name = `Fatura ${c.institution}${c.last4 ? ` ·${c.last4}` : ''}`
    if (c.closedDue && c.closedDueDate && c.closedDueDate >= today && c.closedDueDate <= until) {
      events.push({ date: c.closedDueDate, label: `${name} (fechada)`, amount: -c.closedDue, kind: 'fatura' })
    }
    const open = c.openBill ?? 0
    if (open > 0 && c.openDue && c.openDue >= today && c.openDue <= until) {
      events.push({ date: c.openDue, label: name, amount: -open, kind: 'fatura' })
    }
  }

  // Contas fixas que ainda não foram lançadas (mês atual) e as dos meses seguintes dentro do horizonte
  for (let key = monthKeyOf(today); `${key}-01` <= until; key = addMonths(key, 1)) {
    const list = key === monthKeyOf(today) ? pendingRecurring(txs, recurring, key) : recurring
    for (const r of list) {
      const d = recurringDate(r, key)
      if (d < today || d > until) continue
      events.push({ date: d, label: r.description, amount: (r.type === 'entrada' ? 1 : -1) * Number(r.amount), kind: 'fixa' })
    }
  }

  // Lançamentos já agendados (datas futuras), exceto compras no cartão — elas são pagas pela fatura
  for (const t of txs) {
    if (t.date <= today || t.date > until) continue
    if (t.type !== 'entrada' && t.type !== 'saida') continue
    const bankAccount = (t as Tx & { bank_account?: string | null }).bank_account || ''
    if (/Cart[aã]o/.test(bankAccount)) continue   // no cartão: entra pela fatura
    events.push({ date: t.date, label: t.description, amount: (t.type === 'entrada' ? 1 : -1) * Number(t.amount), kind: 'agendado' })
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount)

  // Saldo dia a dia
  const series: CashFlow['series'] = []
  let saldo = start
  let min = { value: start, date: today }
  let i = 0
  for (let d = today; d <= until; d = addDays(d, 1)) {
    while (i < events.length && events[i].date === d) saldo += events[i++].amount
    saldo = Math.round(saldo * 100) / 100
    if (saldo < min.value) min = { value: saldo, date: d }
    series.push({ date: d, label: formatDateBR(d).slice(0, 5), saldo })
  }
  return { start: Math.round(start * 100) / 100, end: saldo, min, events, series }
}
