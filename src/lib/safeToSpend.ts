// "Quanto posso gastar": quanto sobra até a véspera do próximo recebimento (banco + lançado + entradas − saídas − reserva).
// `safeNow` é o limite para gastar já, sem ficar no vermelho antes de o dinheiro entrar.
import { addDays, addMonths, daysInMonth, monthKeyOf, todayBR } from './dates'
import { buildCashFlow, type CashEvent, type CashFlow } from './cashflow'
import type { Recurring, Tx } from './finance'
import type { BankBalance } from './pluggy'
import { isCardTx, paymentMapper } from './paymentDate'

export type SafeToSpend = {
  available: number          // sobra prevista em `until`: banco + lançado + entradas − saídas − reserva
  safeNow: number            // menor saldo do período − reserva: o máximo para gastar hoje sem ficar negativo em nenhum dia
  low: { date: string; value: number }
  pending: Tx[]              // lançamentos do Telegram/painel ainda fora do saldo do banco
  perDay: number
  days: number
  until: string              // véspera do próximo recebimento do mês seguinte
  nextIncome: { date: string; label: string; amount: number } | null
  bankBalance: number        // saldo informado pelo banco
  unsynced: number           // lançamentos do Telegram/painel depois da última atualização do banco (− gasto, + entrada)
  unsyncedCount: number
  bankDate: string | null
  incoming: number
  outgoing: number
  reserve: number
  flow: CashFlow
  shortfall: { date: string; value: number } | null   // se o saldo fica negativo em algum dia
}

/** Primeira entrada do mês seguinte (recorrente ou agendada): a "janela" vai até a véspera dela. */
function nextMonthIncome(recurring: Recurring[], txs: Tx[], today: string): { date: string; label: string; amount: number } | null {
  const next = addMonths(monthKeyOf(today), 1)
  const cands: { date: string; label: string; amount: number }[] = []
  for (const r of recurring.filter((x) => x.type === 'entrada')) {
    const d = Math.min(Math.max(1, Number(r.day_of_month)), daysInMonth(next))
    cands.push({ date: `${next}-${String(d).padStart(2, '0')}`, label: r.description, amount: Number(r.amount) })
  }
  for (const t of txs) if (t.type === 'entrada' && t.date.startsWith(next)) cands.push({ date: t.date, label: t.description, amount: Number(t.amount) })
  return cands.sort((a, b) => a.date.localeCompare(b.date))[0] ?? null
}

export function computeSafeToSpend(
  accounts: BankBalance[], recurring: Recurring[], txs: Tx[],
  opts: { today?: string; reserve?: number; extra?: CashEvent[] } = {},
): SafeToSpend | null {
  const today = opts.today ?? todayBR()
  const reserve = Math.max(0, opts.reserve ?? 0)
  const banks = accounts.filter((a) => a.type === 'Conta')
  if (!banks.length) return null

  const bankBalance = banks.reduce((s, a) => s + Number(a.balance), 0)
  const bankDate = accounts.map((a) => a.updatedAt).filter(Boolean).sort().pop()?.slice(0, 10) ?? null

  // O que você lançou depois da última foto do banco (ainda não aparece no saldo dele)
  const manual = (t: Tx) => (t.source === 'telegram' || t.source === 'web') && !(t as Tx & { external_id?: string | null }).external_id
  const pending = txs.filter((t) =>
    !isCardTx(t) &&
    (t.source === 'telegram' || t.source === 'web') &&
    !(t as Tx & { external_id?: string | null }).external_id &&
    (t.type === 'saida' || t.type === 'entrada') &&
    t.date <= today && (!bankDate || t.date >= bankDate))
  const unsynced = Math.round(pending.reduce((s, t) => s + (t.type === 'entrada' ? 1 : -1) * Number(t.amount), 0) * 100) / 100

  const nextIncome = nextMonthIncome(recurring, txs, today)
  const next = addMonths(monthKeyOf(today), 1)
  const until = nextIncome ? addDays(nextIncome.date, -1) : `${next}-${daysInMonth(next)}`

  // Compras no cartão lançadas por você que o banco ainda não mostra: entram na fatura em que caem
  const payOf = paymentMapper(accounts)
  const cardPending: CashEvent[] = txs
    .filter((t) => manual(t) && isCardTx(t) && t.type === 'saida' && t.date <= today && (!bankDate || t.date >= addDays(bankDate, -3)))
    .map((t) => ({ t, d: payOf(t).payDate }))
    .map(({ t, d }) => ({ date: d < today ? today : d, label: `${t.description} (cartão, ainda fora do banco)`, amount: -Number(t.amount), kind: 'fatura' as const }))
  const flow = buildCashFlow(accounts, recurring, txs, until, today, { startOffset: unsynced, extra: [...(opts.extra || []), ...cardPending] })
  const lowest = Math.min(flow.start, ...flow.series.map((p) => p.saldo))
  const safeNow = Math.round((lowest - reserve) * 100) / 100
  const available = Math.round((flow.end - reserve) * 100) / 100
  const days = Math.max(1, Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000) + 1)
  const neg = flow.series.find((p) => p.saldo < 0)

  return {
    available, safeNow, low: flow.min, pending, perDay: Math.max(0, Math.round((available / days) * 100) / 100), days, until, nextIncome,
    bankBalance: Math.round(bankBalance * 100) / 100, unsynced, unsyncedCount: pending.length, bankDate,
    incoming: flow.events.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0),
    outgoing: flow.events.filter((e) => e.amount < 0).reduce((s, e) => s + e.amount, 0),
    reserve, flow,
    shortfall: neg ? { date: neg.date, value: neg.saldo } : null,
  }
}

// ---- Cartões: melhor para comprar em cada data ----

export type CardPick = { institution: string; name: string; last4: string; closes: string; due: string }

function addMonthsDate(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10)
}

/** Para uma compra na data `day`: em que fatura cai e quando vence, em cada cartão. O melhor é o de vencimento mais distante. */
export function cardsForPurchase(accounts: BankBalance[], day = todayBR()): CardPick[] {
  return accounts
    .filter((a) => a.type === 'Cartão' && a.openCloses && a.openDue)
    .map((a) => {
      const closes0 = a.openCloses!.slice(0, 10)
      const due0 = a.openDue!.slice(0, 10)
      // compra depois do fechamento cai na fatura seguinte
      let k = 0
      while (day > addMonthsDate(closes0, k) && k < 24) k++
      return { institution: a.institution, name: a.name, last4: a.last4, closes: addMonthsDate(closes0, k), due: addMonthsDate(due0, k) }
    })
    .sort((a, b) => b.due.localeCompare(a.due))
}

export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)

export type BestCardRange = { from: string; to: string; card: CardPick; days: number }

/** Melhor cartão dia a dia nos próximos `span` dias, agrupado em períodos. `days` = prazo até pagar (comprando no 1º dia do período). */
export function bestCardTimeline(accounts: BankBalance[], today = todayBR(), span = 45): BestCardRange[] {
  const out: BestCardRange[] = []
  for (let i = 0; i < span; i++) {
    const day = new Date(Date.parse(`${today}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10)
    const best = cardsForPurchase(accounts, day)[0]
    if (!best) return out
    const last = out[out.length - 1]
    if (last && last.card.institution === best.institution && last.card.last4 === best.last4 && last.card.due === best.due) last.to = day
    else out.push({ from: day, to: day, card: best, days: daysBetween(day, best.due) })
  }
  return out
}

/** Simulação de compra: à vista (sai hoje) ou no cartão (parcelas nos próximos vencimentos). */
export function purchaseEvents(amount: number, installments: number, card: CardPick | null, today = todayBR(), label = 'Compra simulada'): CashEvent[] {
  if (!card) return [{ date: today, label, amount: -amount, kind: 'simulado' }]
  const n = Math.max(1, installments)
  const part = Math.round((amount / n) * 100) / 100
  return Array.from({ length: n }, (_, k) => ({ date: addMonthsDate(card.due, k), label: `${label}${n > 1 ? ` (${k + 1}/${n})` : ''}`, amount: -part, kind: 'simulado' as const }))
}
