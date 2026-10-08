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

/**
 * Com o dia de fechamento definido por você, a fatura é montada pelas datas:
 * cada compra cai na fatura do primeiro fechamento >= data da compra; a parcela k cai k−1 faturas depois.
 */
export function computeBillByDates(txs: PluggyTx[], bills: PluggyBill[], dueHint: string | null | undefined, today: string, days: CardDays & { closeDay: number }): BillInfo {
  const closeFor = (d: string) => nextDayOfMonth(d, days.closeDay)
  const shift = (close: string, n: number) => (n ? closeFor(addDays(addMonthsDate(close, n), -2)) : close)
  const nextClose = closeFor(today)
  const prevClose = shift(nextClose, -1)
  const isInst = (t: PluggyTx) => (t.creditCardMetadata?.totalInstallments || 0) > 1
  const keyOf = (t: PluggyTx) => `${(t.description || '').toLowerCase().replace(/\s+/g, ' ').trim()}|${t.creditCardMetadata?.totalInstallments}|${Math.abs(Number(t.amount)).toFixed(2)}`

  // As parcelas vêm com a data da compra (todas iguais) ou com a data de lançamento (uma por mês)?
  const groups = new Map<string, Set<string>>()
  for (const t of txs.filter(isInst)) {
    const k = keyOf(t); if (!groups.has(k)) groups.set(k, new Set())
    groups.get(k)!.add(day(t.date)!)
  }

  // Em que fatura (data de fechamento) cada lançamento cai
  const landing = (t: PluggyTx): string => {
    const m = t.creditCardMetadata
    if (!isInst(t)) return closeFor(day(t.date)!)
    const n = Math.max(1, m?.installmentNumber || 1)
    const purchase = day(m?.purchaseDate)
    if (purchase) return shift(closeFor(purchase), n - 1)
    const dates = groups.get(keyOf(t))
    const postingDates = !!dates && dates.size > 1
    return postingDates ? closeFor(day(t.date)!) : shift(closeFor(day(t.date)!), n - 1)
  }

  const valid = txs.filter((t) => !isBillPayment(t))
  const inCycle = (close: string) => valid.filter((t) => landing(t) === close && (isInst(t) || day(t.date)! <= today))
  const openTxs = inCycle(nextClose)
  const open = sumTxs(openTxs)

  // Fatura fechada ainda não vencida: a do banco, se houver; senão a do ciclo anterior, menos pagamentos feitos depois do fechamento
  const lastBill = [...bills].sort((a, b) => day(a.dueDate)!.localeCompare(day(b.dueDate)!)).pop()
  const prevDue = days.dueDay ? nextDayOfMonth(prevClose, days.dueDay, true) : (lastBill ? day(lastBill.dueDate) : null)
  let closedDue = 0
  let closedDueDate: string | null = null
  if (lastBill && day(lastBill.dueDate)! >= today) {
    const paid = (lastBill.payments || []).reduce((sum, x) => sum + Number(x.amount || 0), 0)
    closedDue = Math.max(0, Math.round((Number(lastBill.totalAmount) - paid) * 100) / 100)
    closedDueDate = closedDue ? day(lastBill.dueDate) : null
  } else if (prevDue && prevDue >= today) {
    const paid = txs.filter((t) => isBillPayment(t) && day(t.date)! > prevClose).reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0)
    closedDue = Math.max(0, Math.round((sumTxs(inCycle(prevClose)) - paid) * 100) / 100)
    closedDueDate = closedDue ? prevDue : null
  }

  const lastDue = day(lastBill?.dueDate) || day(dueHint)
  let openDue: string | null = null
  if (days.dueDay) openDue = nextDayOfMonth(nextClose, days.dueDay, true)
  else if (lastDue) { let d = lastDue; while (d <= nextClose) d = addMonthsDate(d, 1); openDue = d }

  const items: BillItem[] = openTxs.map((t) => ({
    date: day(t.creditCardMetadata?.purchaseDate) || day(t.date)!,
    description: t.description || t.descriptionRaw || 'Compra',
    amount: t.type === 'CREDIT' ? -Math.abs(Number(t.amount)) : Math.abs(Number(t.amount)),
    ...(isInst(t) ? { inst: `${t.creditCardMetadata?.installmentNumber || '?'}/${t.creditCardMetadata?.totalInstallments}` } : {}),
  })).sort((a, b) => b.date.localeCompare(a.date))
  return { open, openCloses: nextClose, closedDue, closedDueDate, openDue, method: `pelas datas que você definiu (compras de ${addDays(prevClose, 1).slice(8, 10)}/${addDays(prevClose, 1).slice(5, 7)} a ${nextClose.slice(8, 10)}/${nextClose.slice(5, 7)})`, items }
}

export function computeBill(txs: PluggyTx[], bills: PluggyBill[], closeHint: string | null | undefined, dueHint: string | null | undefined, today: string, days: CardDays = {}): BillInfo {
  if (days.closeDay) return computeBillByDates(txs, bills, dueHint, today, { ...days, closeDay: days.closeDay })
  const sorted = [...bills].sort((a, b) => (day(a.billClosingDate) || day(a.dueDate)!).localeCompare(day(b.billClosingDate) || day(b.dueDate)!))
  const last = sorted[sorted.length - 1]
  const lastClose = day(last?.billClosingDate) || (last ? addDays(day(last.dueDate)!, -7) : day(closeHint) || (dueHint ? addDays(day(dueHint)!, -7) : null))

  // Fatura fechada que ainda não venceu: total − pagamentos já feitos
  let closedDue = 0
  let closedDueDate: string | null = null
  if (last && day(last.dueDate)! >= today) {
    const paid = (last.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0)
    closedDue = Math.max(0, Math.round((Number(last.totalAmount) - paid) * 100) / 100)
    closedDueDate = closedDue ? day(last.dueDate) : null
  }

  // Fatura aberta = tudo que ainda não entrou numa fatura fechada (sem billId), exceto pagamentos.
  // Parcelas futuras também vêm "sem fatura": entram só as previstas até a fatura aberta.
  const unbilled = txs.filter((t) => !t.creditCardMetadata?.billId && !isBillPayment(t))
  const validPeriod = (f?: string | null) => (f && /^20\d\d-(0[1-9]|1[0-2])$/.test(f) ? f : null)
  const isInst = (t: PluggyTx) => (t.creditCardMetadata?.totalInstallments || 0) > 1
  const inst = unbilled.filter(isInst)

  // Fechamento: o que você definiu > o que o banco informa
  const autoClose = lastClose ? (() => { let c = lastClose; while (c < today) c = addMonthsDate(c, 1); return c })() : null
  const nextClose = days.closeDay ? nextDayOfMonth(today, days.closeDay) : autoClose
  const prevClose = nextClose ? addMonthsDate(nextClose, -1) : null
  // Compras à vista sem fatura: só as do ciclo atual (sem previsão do banco, pela data)
  const single = unbilled.filter((t) => {
    if (isInst(t) || day(t.date)! > today) return false
    if (validPeriod(t.creditCardMetadata?.billForecastDate)) return true
    return !prevClose || day(t.date)! > addDays(prevClose, -3)
  })

  // Período da fatura aberta: o mais recente entre as compras à vista; sem elas, o primeiro das parcelas
  const singlePeriods = single.map((t) => validPeriod(t.creditCardMetadata?.billForecastDate)).filter(Boolean) as string[]
  const instPeriods = inst.map((t) => validPeriod(t.creditCardMetadata?.billForecastDate)).filter(Boolean) as string[]
  const period = singlePeriods.sort().pop() || instPeriods.sort()[0] || null
  // à vista com previsão anterior à fatura aberta = sobra antiga sem billId: fica de fora
  const singles = period ? single.filter((t) => { const f = validPeriod(t.creditCardMetadata?.billForecastDate); return !f || f >= period }) : single

  let installments: PluggyTx[]
  if (period) {
    installments = inst.filter((t) => { const f = validPeriod(t.creditCardMetadata?.billForecastDate); return !!f && f <= period })
  } else {
    // Sem previsão: de cada compra parcelada, só a próxima parcela
    const next = new Map<string, PluggyTx>()
    for (const t of inst) {
      const m = t.creditCardMetadata!
      const key = `${(t.description || '').toLowerCase().replace(/\s+/g, ' ').trim()}|${m.totalInstallments}|${Math.abs(Number(t.amount)).toFixed(2)}`
      const cur = next.get(key)
      if (!cur || (m.installmentNumber || 99) < (cur.creditCardMetadata?.installmentNumber || 99)) next.set(key, t)
    }
    installments = [...next.values()]
  }
  const included = [...singles, ...installments]
  const open = sumTxs(included)
  const items: BillItem[] = included.map((t) => ({
    date: day(t.creditCardMetadata?.purchaseDate) || day(t.date)!,
    description: t.description || t.descriptionRaw || 'Compra',
    amount: t.type === 'CREDIT' ? -Math.abs(Number(t.amount)) : Math.abs(Number(t.amount)),
    ...(isInst(t) ? { inst: `${t.creditCardMetadata?.installmentNumber || '?'}/${t.creditCardMetadata?.totalInstallments}` } : {}),
  })).sort((a, b) => b.date.localeCompare(a.date))
  // Vencimento da fatura aberta: o mês seguinte ao da fechada pendente, ou o próximo vencimento a partir do último conhecido
  const lastDue = day(last?.dueDate) || day(dueHint)
  let openDue: string | null = null
  if (days.dueDay && nextClose) openDue = nextDayOfMonth(nextClose, days.dueDay, true)
  else if (closedDue && closedDueDate) openDue = addMonthsDate(closedDueDate, 1)
  else if (lastDue) { let d = lastDue; while (d < today) d = addMonthsDate(d, 1); openDue = d }
  return { open, openCloses: nextClose, closedDue, closedDueDate, openDue, method: period ? `pela previsão do banco (fatura ${period.slice(5, 7)}/${period.slice(0, 4)})` : 'compras ainda sem fatura', items }
}
