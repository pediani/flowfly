// Cartão x débito: em que mês cada compra no cartão é paga (vencimento da fatura em que ela cai).
import { nextDayOfMonth } from './cardBill'
import type { Tx } from './finance'
import type { BankBalance } from './pluggy'

export type PayInfo = { card: boolean; payDate: string; cardName?: string }

type TxBank = Tx & { bank_account?: string | null }

export const isCardTx = (t: Tx) => /Cart[aã]o/.test((t as TxBank).bank_account || '')

/** Cria a função que diz, para cada lançamento, se é do cartão e quando ele é pago. */
export function paymentMapper(accounts: BankBalance[] | null) {
  const cards = (accounts || []).filter((a) => a.type === 'Cartão' && a.openCloses && a.openDue)
  const find = (label: string) => {
    const last4 = label.match(/(\d{4})\s*$/)?.[1]
    const inst = label.split(' · ')[0]
    return cards.find((c) => last4 && c.last4 === last4) || cards.find((c) => c.institution === inst) || null
  }
  return (t: Tx): PayInfo => {
    if (!isCardTx(t)) return { card: false, payDate: t.date }
    const c = find((t as TxBank).bank_account || '')
    if (!c) return { card: true, payDate: t.date }
    const closeDay = Number(c.openCloses!.slice(8, 10))
    const dueDay = Number(c.openDue!.slice(8, 10))
    const close = nextDayOfMonth(t.date, closeDay)
    return { card: true, payDate: nextDayOfMonth(close, dueDay, true), cardName: `${c.institution} ·${c.last4}` }
  }
}

/** Visão "pelo mês em que pago": compras no cartão vão para o mês do vencimento da fatura. */
export function byPaymentMonth(txs: Tx[], accounts: BankBalance[] | null): Tx[] {
  const map = paymentMapper(accounts)
  return txs.map((t) => {
    if (t.type !== 'saida' && t.type !== 'entrada') return t
    const p = map(t)
    return p.card && p.payDate !== t.date ? { ...t, date: p.payDate, purchase_date: t.date } as Tx : t
  })
}
