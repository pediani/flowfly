import { NextResponse } from 'next/server'
import { adminDb } from '../../../../lib/botData'
import { pluggyEnabled } from '../../../../lib/pluggy'
import { getBankBalances } from '../../../../lib/balances'
import { computeBill } from '../../../../lib/cardBill'
import { userFromRequest } from '../../../../lib/serverAuth'


/** Painel → saldos reais das contas e faturas dos cartões (dados da última atualização da Pluggy). */
export const maxDuration = 30

export async function POST(request: Request) {
  if (!pluggyEnabled() || !adminDb) return NextResponse.json({ accounts: [] })
  const userId = await userFromRequest(request)
  if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const debug = new URL(request.url).searchParams.get('debug') === '1'
  const { accounts, errors, diag: raw } = await getBankBalances(adminDb, userId, { debug })
  const diag = raw.map((d) => diagnose(d.name, d.txs, d.bills, d.bill))
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
