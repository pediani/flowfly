// Fatura do cartão. O "balance" da Pluggy no cartão é o limite usado total (inclui parcelas futuras),
// então a fatura é calculada pelas transações + faturas fechadas (bills).
import { addDays } from './dates'
import type { PluggyBill, PluggyTx } from './pluggy'

export type BillInfo = {
  open: number                // fatura aberta (atual)
  openCloses: string | null   // fechamento previsto da fatura aberta
  closedDue: number           // fatura fechada ainda não vencida e não paga
  closedDueDate: string | null
  method: string              // como foi calculado (diagnóstico)
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

export function computeBill(txs: PluggyTx[], bills: PluggyBill[], closeHint: string | null | undefined, dueHint: string | null | undefined, today: string): BillInfo {
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

  const unbilled = txs.filter((t) => !t.creditCardMetadata?.billId)

  // 1) Melhor caso (Open Finance): previsão de fatura em cada transação
  const forecasts = unbilled.map((t) => t.creditCardMetadata?.billForecastDate).filter(Boolean) as string[]
  if (forecasts.length) {
    const period = forecasts.sort()[0]
    const open = sumTxs(unbilled.filter((t) => t.creditCardMetadata?.billForecastDate === period || !t.creditCardMetadata?.billForecastDate && day(t.date)! <= today))
    return { open, openCloses: lastClose ? addMonthsDate(lastClose, 1) : null, closedDue, closedDueDate, method: `previsão ${period}` }
  }

  // 2) Pelo ciclo: depois do último fechamento até o próximo
  if (lastClose) {
    let close = lastClose
    while (addMonthsDate(close, 1) < today) close = addMonthsDate(close, 1)
    const next = addMonthsDate(close, 1)
    const open = sumTxs(unbilled.filter((t) => day(t.date)! > close && day(t.date)! <= next))
    return { open, openCloses: next, closedDue, closedDueDate, method: last?.billClosingDate ? 'ciclo (fechamento real)' : 'ciclo (fechamento estimado)' }
  }

  // 3) Sem datas: não faturadas até hoje
  return { open: sumTxs(unbilled.filter((t) => day(t.date)! <= today)), openCloses: null, closedDue, closedDueDate, method: 'estimado' }
}
