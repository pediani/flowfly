// Fatura do cartão a partir das transações (a Pluggy informa no "balance" o limite usado total,
// que inclui todas as parcelas futuras — não serve como "fatura em aberto").
import { addDays } from './dates'
import type { PluggyTx } from './pluggy'

export type BillInfo = {
  open: number            // fatura atual (aberta), até o próximo fechamento
  openCloses: string      // data em que a fatura aberta fecha
  closedDue: number       // fatura já fechada que ainda não venceu (0 se já venceu/foi paga)
  closedDueDate: string | null
  method: 'fechamento' | 'estimado'
}

function addMonthsDate(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 + n, 1))
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10)
}

const isPayment = (t: PluggyTx) => t.type === 'CREDIT' && /pagamento|pgto|pagto/i.test(`${t.description} ${t.descriptionRaw || ''}`)

/** Soma do período (from, to]: compras somam, estornos subtraem, pagamentos de fatura ficam de fora. */
function sumWindow(txs: PluggyTx[], from: string, to: string): number {
  let total = 0
  for (const t of txs) {
    const d = t.date.slice(0, 10)
    if (d <= from || d > to || isPayment(t)) continue
    total += t.type === 'CREDIT' ? -Math.abs(Number(t.amount)) : Math.abs(Number(t.amount))
  }
  return Math.round(total * 100) / 100
}

export function computeBill(txs: PluggyTx[], closeDate: string | null | undefined, dueDate: string | null | undefined, today: string): BillInfo {
  // Data de fechamento: a informada, ou ~7 dias antes do vencimento
  let close = closeDate?.slice(0, 10) || (dueDate ? addDays(dueDate.slice(0, 10), -7) : null)
  let due = dueDate?.slice(0, 10) || (close ? addDays(close, 7) : null)

  if (!close) {
    // Sem datas: estimativa com os últimos 30 dias
    const from = addDays(today, -30)
    return { open: sumWindow(txs, from, today), openCloses: today, closedDue: 0, closedDueDate: null, method: 'estimado' }
  }
  // Dados podem estar defasados: avança mês a mês até o próximo fechamento ser hoje ou depois
  while (addMonthsDate(close, 1) < today) { close = addMonthsDate(close, 1); if (due) due = addMonthsDate(due, 1) }
  // Se o "fechamento" informado ainda não chegou, ele é o próximo fechamento
  if (close >= today) { close = addMonthsDate(close, -1); if (due) due = addMonthsDate(due, -1) }

  const nextClose = addMonthsDate(close, 1)
  const open = sumWindow(txs, close, nextClose)

  // Fatura fechada ainda não vencida e sem pagamento registrado depois do fechamento
  let closedDue = 0
  if (due && due >= today) {
    const paid = txs.some((t) => isPayment(t) && t.date.slice(0, 10) > close!)
    if (!paid) closedDue = sumWindow(txs, addMonthsDate(close, -1), close)
  }
  return { open, openCloses: nextClose, closedDue, closedDueDate: closedDue ? due : null, method: 'fechamento' }
}
