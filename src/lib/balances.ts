// Saldos reais das contas e faturas dos cartões (servidor). Usado pelo painel e pelo bot.
import type { Db } from './botData'
import { listAccounts, listBills, listTransactions, type BankBalance, type PluggyBill, type PluggyTx } from './pluggy'
import { computeBill } from './cardBill'
import { addDays, todayBR } from './dates'

export type BalanceDiag = { name: string; txs: PluggyTx[]; bills: PluggyBill[]; bill: ReturnType<typeof computeBill> }

export async function getBankBalances(db: Db, userId: string, opts: { debug?: boolean } = {}): Promise<{ accounts: BankBalance[]; errors: string[]; diag: BalanceDiag[] }> {
  const debug = !!opts.debug
  const diag: BalanceDiag[] = []
  const { data: conns } = await db.from('bank_connections').select('item_id, institution').eq('user_id', userId)
  const accounts: BankBalance[] = []
  const errors: string[] = []
  await Promise.all((conns || []).map(async (c) => {
    try {
      for (const a of await listAccounts(c.item_id)) {
        const card = a.type === 'CREDIT'
        let bill: ReturnType<typeof computeBill> | null = null
        if (card) {
          // Fatura = compras/parcelas entre o último fechamento e o próximo (e a fechada, se ainda não venceu)
          const [txs, bills] = await Promise.all([
            listTransactions(a.id, { dateFrom: addDays(todayBR(), -75) }),
            listBills(a.id).catch(() => []),
          ])
          bill = computeBill(txs, bills, a.creditData?.balanceCloseDate, a.creditData?.balanceDueDate, todayBR())
          if (debug) diag.push({ name: a.marketingName || a.name || a.id, txs, bills, bill })
        }
        accounts.push({
          institution: c.institution || 'Banco',
          type: card ? 'Cartão' : 'Conta',
          name: a.marketingName || a.name || (card ? 'Cartão' : 'Conta'),
          last4: String(a.number || '').replace(/\D/g, '').slice(-4),
          balance: bill ? Math.round((bill.open + bill.closedDue) * 100) / 100 : Number(a.balance || 0),
          ...(bill ? {
            openBill: bill.open, openCloses: bill.openCloses, closedDue: bill.closedDue, closedDueDate: bill.closedDueDate, openDue: bill.openDue,
            usedLimit: Math.abs(Number(a.balance || 0)), billMethod: bill.method,
          } : {}),
          creditLimit: a.creditData?.creditLimit ?? null,
          available: a.creditData?.availableCreditLimit ?? null,
          dueDate: a.creditData?.balanceDueDate ?? null,
          closeDate: a.creditData?.balanceCloseDate ?? null,
          updatedAt: a.updatedAt ?? null,
        })
      }
    } catch (e) {
      console.error('Pluggy saldos:', c.item_id, e)
      errors.push(c.institution || c.item_id)
    }
  }))
  accounts.sort((x, y) => x.institution.localeCompare(y.institution) || x.type.localeCompare(y.type))
  return { accounts, errors, diag }
}
