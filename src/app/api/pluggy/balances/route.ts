import { NextResponse } from 'next/server'
import { adminDb } from '../../../../lib/botData'
import { pluggyEnabled } from '../../../../lib/pluggy'
import { getBankBalances } from '../../../../lib/balances'
import { userFromRequest } from '../../../../lib/serverAuth'


/** Painel → saldos reais das contas e faturas dos cartões (dados da última atualização da Pluggy). */
export const maxDuration = 30

export async function POST(request: Request) {
  if (!pluggyEnabled() || !adminDb) return NextResponse.json({ accounts: [] })
  const userId = await userFromRequest(request)
  if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const debug = new URL(request.url).searchParams.get('debug') === '1'
  const { accounts, errors, diag: raw } = await getBankBalances(adminDb, userId, { debug })
  const diag = raw.map((d) => ({
    id: d.id, name: d.name, credit: d.credit,
    computed: { ...d.bill, items: d.bill.items.length }, byBank: { ...d.byBank, items: d.byBank.items.length },
    bills: d.bills.slice(-3).map((b) => ({ close: b.billClosingDate?.slice(0, 10), due: b.dueDate?.slice(0, 10), total: b.totalAmount, paid: (b.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0) })),
    // compras dos últimos 100 dias + todas as parceladas: data | compra | valor | descrição | status | fatura | previsão | parcela | operação
    txs: d.txs
      .filter((t) => (t.creditCardMetadata?.totalInstallments || 0) > 1 || t.date.slice(0, 10) >= new Date(Date.now() - 100 * 86400000).toISOString().slice(0, 10))
      .map((t) => [t.date.slice(0, 10), t.creditCardMetadata?.purchaseDate?.slice(0, 10) || '', t.type === 'CREDIT' ? -Math.abs(t.amount) : Math.abs(t.amount), (t.description || '').slice(0, 24), t.status || '', t.creditCardMetadata?.billId ? String(t.creditCardMetadata.billId).slice(0, 6) : '', t.creditCardMetadata?.billForecastDate || '', t.creditCardMetadata?.installmentNumber ? `${t.creditCardMetadata.installmentNumber}/${t.creditCardMetadata.totalInstallments}` : '', t.operationType || ''].join('|')),
  }))
  return NextResponse.json(debug ? { accounts, errors, diag } : { accounts, errors })
}
