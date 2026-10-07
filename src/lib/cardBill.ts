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

  // Fatura aberta = tudo que ainda não entrou numa fatura fechada (sem billId), exceto pagamentos.
  // Parcelas futuras também vêm "sem fatura": de cada compra parcelada entra só a próxima parcela.
  const unbilled = txs.filter((t) => !t.creditCardMetadata?.billId && !isBillPayment(t))
  const nextInstallment = new Map<string, PluggyTx>()
  const single: PluggyTx[] = []
  for (const t of unbilled) {
    const m = t.creditCardMetadata
    if (m?.totalInstallments && m.totalInstallments > 1) {
      const key = `${(t.description || '').toLowerCase().replace(/\s+/g, ' ').trim()}|${m.totalInstallments}|${Math.abs(Number(t.amount)).toFixed(2)}`
      const cur = nextInstallment.get(key)
      if (!cur || (m.installmentNumber || 99) < (cur.creditCardMetadata?.installmentNumber || 99)) nextInstallment.set(key, t)
    } else if (day(t.date)! <= today) {
      single.push(t)
    }
  }
  const open = sumTxs([...single, ...nextInstallment.values()])
  const nextClose = lastClose ? (() => { let c = lastClose; while (c < today) c = addMonthsDate(c, 1); return c })() : null
  return { open, openCloses: nextClose, closedDue, closedDueDate, method: 'não faturadas' }
}
