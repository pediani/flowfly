import { NextResponse } from 'next/server'
import { adminDb } from '../../../../lib/botData'
import { listAccounts, listTransactions, pluggyEnabled, type BankBalance } from '../../../../lib/pluggy'
import { computeBill } from '../../../../lib/cardBill'
import { addDays, todayBR } from '../../../../lib/dates'
import { userFromRequest } from '../../../../lib/serverAuth'


/** Painel → saldos reais das contas e faturas dos cartões (dados da última atualização da Pluggy). */
export const maxDuration = 30

export async function POST(request: Request) {
  if (!pluggyEnabled() || !adminDb) return NextResponse.json({ accounts: [] })
  const userId = await userFromRequest(request)
  if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: conns } = await adminDb.from('bank_connections').select('item_id, institution').eq('user_id', userId)
  const accounts: BankBalance[] = []
  const errors: string[] = []
  await Promise.all((conns || []).map(async (c) => {
    try {
      for (const a of await listAccounts(c.item_id)) {
        const card = a.type === 'CREDIT'
        let bill: ReturnType<typeof computeBill> | null = null
        if (card) {
          // Fatura = compras/parcelas entre o último fechamento e o próximo (e a fechada, se ainda não venceu)
          const txs = await listTransactions(a.id, { dateFrom: addDays(todayBR(), -75) })
          bill = computeBill(txs, a.creditData?.balanceCloseDate, a.creditData?.balanceDueDate, todayBR())
        }
        accounts.push({
          institution: c.institution || 'Banco',
          type: card ? 'Cartão' : 'Conta',
          name: a.marketingName || a.name || (card ? 'Cartão' : 'Conta'),
          last4: String(a.number || '').replace(/\D/g, '').slice(-4),
          balance: bill ? Math.round((bill.open + bill.closedDue) * 100) / 100 : Number(a.balance || 0),
          ...(bill ? {
            openBill: bill.open, openCloses: bill.openCloses, closedDue: bill.closedDue, closedDueDate: bill.closedDueDate,
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
  return NextResponse.json({ accounts, errors })
}
