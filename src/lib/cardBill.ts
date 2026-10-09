// Fatura do cartão. O "balance" da Pluggy no cartão é o limite usado total (inclui parcelas futuras),
// então a fatura é calculada pelas transações + faturas fechadas (bills).
import { addDays } from './dates'
import type { PluggyBill, PluggyTx } from './pluggy'

export type BillInfo = {
  open: number                // fatura aberta (atual)
  openCloses: string | null   // fechamento previsto da fatura aberta
  closedDue: number           // fatura fechada ainda não vencida e não paga
  closedDueDate: string | null
  openDue: string | null      // vencimento previsto da fatura aberta
  method: string              // como foi calculado (diagnóstico)
  items: BillItem[]           // o que compõe a fatura aberta
}

export type BillItem = { date: string; description: string; amount: number; inst?: string }
export type CardDays = { closeDay?: number | null; dueDay?: number | null }

/** Próxima data (>= from) com o dia do mês `d` (ajusta para o último dia em meses curtos). */
export function nextDayOfMonth(from: string, d: number, strictlyAfter = false): string {
  const [y, m] = from.split('-').map(Number)
  for (let k = 0; k < 3; k++) {
    const last = new Date(Date.UTC(y, m - 1 + k + 1, 0)).getUTCDate()
    const t = new Date(Date.UTC(y, m - 1 + k, Math.min(d, last))).toISOString().slice(0, 10)
    if (strictlyAfter ? t > from : t >= from) return t
  }
  return from
}

export function addMonthsDate(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10)
}

export const isBillPayment = (t: PluggyTx) =>
  t.operationType === 'PAGAMENTO_FATURA' || (t.type === 'CREDIT' && /pagamento|pgto|pagto/i.test(`${t.description} ${t.descriptionRaw || ''}`))

/** Compras somam, estornos/créditos subtraem, pagamentos de fatura ficam de fora. */
export function sumTxs(txs: PluggyTx[]): number {
  let total = 0
  for (const t of txs) {
    if (isBillPayment(t)) continue
    total += t.type === 'CREDIT' ? -Math.abs(Number(t.amount)) : Math.abs(Number(t.amount))
  }
  return Math.round(total * 100) / 100
}

const day = (s?: string | null) => (s ? s.slice(0, 10) : null)
const isInst = (t: PluggyTx) => (t.creditCardMetadata?.totalInstallments || 0) > 1
const validPeriod = (f?: string | null) => (f && /^20\d\d-(0[1-9]|1[0-2])$/.test(f) ? f : null)
const r2 = (v: number) => Math.round(v * 100) / 100
const purchaseKey = (t: PluggyTx) => {
  const m = t.creditCardMetadata
  return `${(t.description || '').toLowerCase().replace(/\s+/g, ' ').trim()}|${m?.totalInstallments}|${day(m?.purchaseDate) || Math.abs(Number(t.amount)).toFixed(2)}`
}
const toItem = (t: PluggyTx, note = ''): BillItem => ({
  date: day(t.creditCardMetadata?.purchaseDate) || day(t.date)!,
  description: t.description || t.descriptionRaw || 'Compra',
  amount: t.type === 'CREDIT' ? -Math.abs(Number(t.amount)) : Math.abs(Number(t.amount)),
  ...(isInst(t) ? { inst: `${t.creditCardMetadata?.installmentNumber || '?'}/${t.creditCardMetadata?.totalInstallments}${note}` } : {}),
})

/**
 * Parcelas que o banco ainda não lançou. Alguns bancos (ex.: Santander) só publicam a parcela k
 * quando a fatura dela começa; até lá ela não aparece. Para cada compra parcelada cuja última parcela
 * publicada está numa fatura já fechada, prevê a próxima na fatura aberta.
 */
function projectInstallments(txs: PluggyTx[]): BillItem[] {
  // ordem das faturas fechadas (pela data mais recente de cada uma)
  const billEnd = new Map<string, string>()
  for (const t of txs) {
    const id = t.creditCardMetadata?.billId
    if (id && (!billEnd.has(id) || day(t.date)! > billEnd.get(id)!)) billEnd.set(id, day(t.date)!)
  }
  const order = [...billEnd.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id]) => id)
  const rank = new Map(order.map((id, i) => [id, i]))
  const groups = new Map<string, PluggyTx[]>()
  for (const t of txs.filter(isInst)) {
    const k = purchaseKey(t); if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(t)
  }
  const out: BillItem[] = []
  for (const list of groups.values()) {
    if (list.some((t) => !t.creditCardMetadata?.billId)) continue   // já tem parcela na fatura aberta (ou futuras publicadas)
    const last = list.reduce((a, b) => ((b.creditCardMetadata?.installmentNumber || 0) > (a.creditCardMetadata?.installmentNumber || 0) ? b : a))
    const m = last.creditCardMetadata!
    const total = m.totalInstallments || 0
    const r = rank.get(m.billId!) ?? order.length - 1
    const n = (m.installmentNumber || 1) + (order.length - r)
    if (n > total) continue
    out.push({ ...toItem(last), inst: `${n}/${total} · prevista` })
  }
  return out
}

/** Último fechamento conhecido: o mais recente entre a lista de faturas e as compras já faturadas. */
function closedBillsFromTxs(txs: PluggyTx[], today: string) {
  const map = new Map<string, { end: string; txs: PluggyTx[] }>()
  for (const t of txs) {
    const id = t.creditCardMetadata?.billId
    if (!id) continue
    const g = map.get(id) || { end: day(t.date)!, txs: [] }
    g.txs.push(t); if (day(t.date)! > g.end) g.end = day(t.date)!
    map.set(id, g)
  }
  // Só faturas de fato fechadas: sem lançamento pendente e terminadas há pelo menos 3 dias.
  // (Alguns bancos já dão id à fatura aberta; ela não pode virar "fechada a pagar".)
  const limit = addDays(today, -3)
  return [...map.values()]
    .filter((g) => !g.txs.some((t) => (t.status || '').toUpperCase() === 'PENDING') && g.end <= limit)
    .sort((a, b) => a.end.localeCompare(b.end))
}

export function computeBill(txs: PluggyTx[], bills: PluggyBill[], closeHint: string | null | undefined, dueHint: string | null | undefined, today: string, days: CardDays = {}): BillInfo {
  const sortedBills = [...bills].sort((a, b) => day(a.dueDate)!.localeCompare(day(b.dueDate)!))
  const lastBill = sortedBills[sortedBills.length - 1]
  const fromTxs = closedBillsFromTxs(txs, today)
  const lastGroup = fromTxs[fromTxs.length - 1]

  // Fechamento: o que você definiu > faturas/compras faturadas > o que o banco informa
  const knownClose = [day(lastBill?.billClosingDate), lastGroup?.end, day(closeHint), dueHint ? addDays(day(dueHint)!, -7) : null].filter(Boolean).sort().pop() || null
  const roll = (d: string, after: string, strict = false) => { let c = d; let i = 0; while ((strict ? c <= after : c < after) && i++ < 60) c = addMonthsDate(c, 1); return c }
  const nextClose = days.closeDay ? nextDayOfMonth(today, days.closeDay) : knownClose ? roll(knownClose, today) : null
  const prevClose = nextClose ? (days.closeDay ? nextDayOfMonth(addDays(addMonthsDate(nextClose, -1), -2), days.closeDay) : addMonthsDate(nextClose, -1)) : null

  // Fatura aberta: compras sem fatura do ciclo atual + parcelas previstas para ela
  const unbilled = txs.filter((t) => !t.creditCardMetadata?.billId && !isBillPayment(t))
  const inWindow = (t: PluggyTx) => !prevClose || day(t.date)! > addDays(prevClose, days.closeDay ? 0 : -3)
  const singles = unbilled.filter((t) => !isInst(t) && day(t.date)! <= today && inWindow(t))
  const period = singles.map((t) => validPeriod(t.creditCardMetadata?.billForecastDate)).filter(Boolean).sort().pop() || null
  const inst = unbilled.filter(isInst).filter((t) => {
    const f = validPeriod(t.creditCardMetadata?.billForecastDate)
    if (f && period) return f <= period            // bancos que publicam as parcelas futuras com a fatura prevista
    return day(t.date)! <= today && inWindow(t)
  })
  // sem previsão nenhuma: de cada compra parcelada, só a próxima parcela
  let instOpen = inst
  if (!period) {
    const next = new Map<string, PluggyTx>()
    for (const t of inst) {
      const k = purchaseKey(t); const cur = next.get(k)
      if (!cur || (t.creditCardMetadata?.installmentNumber || 99) < (cur.creditCardMetadata?.installmentNumber || 99)) next.set(k, t)
    }
    instOpen = [...next.values()]
  }
  const projected = projectInstallments(txs)
  const items = [...[...singles, ...instOpen].map((t) => toItem(t)), ...projected].sort((a, b) => b.date.localeCompare(a.date))
  const open = r2(items.reduce((sum, x) => sum + x.amount, 0))

  // Vencimento
  const knownDue = [day(lastBill?.dueDate), day(dueHint)].filter(Boolean).sort().pop() || null
  const dueAfter = (close: string) => (days.dueDay ? nextDayOfMonth(close, days.dueDay, true) : knownDue ? roll(knownDue, close, true) : null)
  const openDue = nextClose ? dueAfter(nextClose) : null

  // Fatura fechada ainda não vencida: a da lista do banco; se a lista estiver desatualizada, a das compras já faturadas
  let closedDue = 0
  let closedDueDate: string | null = null
  if (lastBill && day(lastBill.dueDate)! >= today) {
    const paid = (lastBill.payments || []).reduce((sum, x) => sum + Number(x.amount || 0), 0)
    closedDue = Math.max(0, r2(Number(lastBill.totalAmount) - paid))
    closedDueDate = closedDue ? day(lastBill.dueDate) : null
  } else if (lastGroup && (!lastBill || lastGroup.end > (day(lastBill.billClosingDate) || day(lastBill.dueDate)!))) {
    const due = dueAfter(lastGroup.end)
    if (due && due >= today) {
      const paid = txs.filter((t) => isBillPayment(t) && day(t.date)! > lastGroup.end).reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0)
      closedDue = Math.max(0, r2(sumTxs(lastGroup.txs) - paid))
      closedDueDate = closedDue ? due : null
    }
  }

  const how = days.closeDay ? 'pelas datas que você definiu' : 'pelas compras do ciclo atual'
  const range = prevClose && nextClose ? ` (de ${addDays(prevClose, 1).slice(8, 10)}/${addDays(prevClose, 1).slice(5, 7)} a ${nextClose.slice(8, 10)}/${nextClose.slice(5, 7)})` : ''
  return {
    open, openCloses: nextClose, closedDue, closedDueDate, openDue, items,
    method: `${how}${range}${projected.length ? ` + ${projected.length} parcela${projected.length > 1 ? 's' : ''} que o banco ainda não lançou` : ''}`,
  }
}
