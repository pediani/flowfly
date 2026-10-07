import { NextResponse } from 'next/server'
import { adminDb } from '../../../../lib/botData'
import { listAccounts, listBills, listTransactions, pluggyEnabled, type BankBalance } from '../../../../lib/pluggy'
import { computeBill } from '../../../../lib/cardBill'
import { addDays, todayBR } from '../../../../lib/dates'
import { userFromRequest } from '../../../../lib/serverAuth'


/** Painel → saldos reais das contas e faturas dos cartões (dados da última atualização da Pluggy). */
export const maxDuration = 30

export async function POST(request: Request) {
  if (!pluggyEnabled() || !adminDb) return NextResponse.json({ accounts: [] })
  const userId = await userFromRequest(request)
  if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const debug = new URL(request.url).searchParams.get('debug') === '1'
  const diag: unknown[] = []
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
          const [txs, bills] = await Promise.all([
            listTransactions(a.id, { dateFrom: addDays(todayBR(), -75) }),
            listBills(a.id).catch(() => []),
          ])
          bill = computeBill(txs, bills, a.creditData?.balanceCloseDate, a.creditData?.balanceDueDate, todayBR())
          if (debug) diag.push(diagnose(a.marketingName || a.name || a.id, txs, bills, bill))
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
  return NextResponse.json(debug ? { accounts, errors, diag } : { accounts, errors })
}

/** Diagnóstico (só com ?debug=1): resumo das transações e faturas de um cartão */
function diagnose(name: string, txs: import('../../../../lib/pluggy').PluggyTx[], bills: import('../../../../lib/pluggy').PluggyBill[], bill: ReturnType<typeof computeBill>) {
  const unbilled = txs.filter((t) => !t.creditCardMetadata?.billId)
  const byForecast: Record<string, number> = {}
  for (const t of unbilled) {
    const k = t.creditCardMetadata?.billForecastDate || 'sem previsão'
    byForecast[k] = Math.round(((byForecast[k] || 0) + (t.type === 'CREDIT' ? -1 : 1) * Math.abs(Number(t.amount))) * 100) / 100
  }
  return {
    name, computed: bill,
    bills: bills.slice(-3).map((b) => ({ close: b.billClosingDate, due: b.dueDate, total: b.totalAmount, paid: (b.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0) })),
    txCount: txs.length, unbilledCount: unbilled.length,
    unbilledByForecast: byForecast,
    sample: unbilled.slice(0, 40).map((t) => [t.date.slice(0, 10), t.type === 'CREDIT' ? -Math.abs(t.amount) : Math.abs(t.amount), (t.description || '').slice(0, 18), t.status, t.creditCardMetadata?.billForecastDate || '', t.operationType || '', t.creditCardMetadata?.installmentNumber ? `${t.creditCardMetadata.installmentNumber}/${t.creditCardMetadata.totalInstallments}` : '']),
  }
}
