// Patrimônio: dinheiro nas contas + investimentos − faturas a pagar (atual + fechada não vencida).
// Parcelas futuras do cartão aparecem à parte, como "comprometido", sem descontar do patrimônio de hoje.
import type { Db } from './botData'
import { getBankBalances } from './balances'
import { listInvestments } from './pluggy'
import { monthKeyOf, todayBR } from './dates'

export type NetWorth = {
  cash: number; investments: number; debts: number; net: number
  futureInstallments: number   // parcelas de faturas que ainda vão fechar (informativo)
  details: { accounts: { institution: string; name: string; type: string; value: number; future?: number }[]; investments: { institution: string; name: string; type: string; value: number }[] }
}

const r2 = (v: number) => Math.round(v * 100) / 100

export async function computeNetWorth(db: Db, userId: string): Promise<NetWorth | null> {
  const { accounts } = await getBankBalances(db, userId)
  if (!accounts.length) return null
  const cash = accounts.filter((a) => a.type === 'Conta').reduce((s, a) => s + Number(a.balance), 0)
  const cards = accounts.filter((a) => a.type === 'Cartão')
  const billOf = (a: (typeof cards)[number]) => Number(a.openBill ?? 0) + Number(a.closedDue ?? 0)
  const debts = cards.reduce((s, a) => s + billOf(a), 0)
  const futureInstallments = cards.reduce((s, a) => s + Math.max(0, Number(a.usedLimit ?? 0) - billOf(a)), 0)

  const { data: conns } = await db.from('bank_connections').select('item_id, institution').eq('user_id', userId)
  const inv: NetWorth['details']['investments'] = []
  for (const c of conns || []) {
    try {
      for (const i of await listInvestments(c.item_id)) {
        const value = Number(i.balance ?? i.amount ?? 0)
        if (value) inv.push({ institution: c.institution || 'Banco', name: i.name || i.type || 'Investimento', type: i.subtype || i.type || '', value: r2(value) })
      }
    } catch (e) { console.error('Pluggy investimentos:', c.item_id, e) }
  }
  const investments = inv.reduce((s, i) => s + i.value, 0)
  return {
    cash: r2(cash), investments: r2(investments), debts: r2(debts), net: r2(cash + investments - debts), futureInstallments: r2(futureInstallments),
    details: {
      accounts: accounts.map((a) => ({
        institution: a.institution, name: a.name, type: a.type,
        value: a.type === 'Cartão' ? -billOf(a) : Number(a.balance),
        future: a.type === 'Cartão' ? r2(Math.max(0, Number(a.usedLimit ?? 0) - billOf(a))) : 0,
      })),
      investments: inv.sort((a, b) => b.value - a.value),
    },
  }
}

/** Guarda a foto do mês atual (sobrescreve durante o mês; o último dia fica como fechamento). */
export async function saveSnapshot(db: Db, userId: string, nw: NetWorth) {
  await db.from('net_worth_snapshots').upsert({
    user_id: userId, month: monthKeyOf(todayBR()), cash: nw.cash, investments: nw.investments, debts: nw.debts, net: nw.net,
    details: { ...nw.details, futureInstallments: nw.futureInstallments }, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,month' })
}
