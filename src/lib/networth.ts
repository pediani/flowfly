// Patrimônio: dinheiro nas contas + investimentos − dívidas no cartão (limite usado, inclui parcelas futuras).
import type { Db } from './botData'
import { getBankBalances } from './balances'
import { listInvestments } from './pluggy'
import { monthKeyOf, todayBR } from './dates'

export type NetWorth = {
  cash: number; investments: number; debts: number; net: number
  details: { accounts: { institution: string; name: string; type: string; value: number }[]; investments: { institution: string; name: string; type: string; value: number }[] }
}

const r2 = (v: number) => Math.round(v * 100) / 100

export async function computeNetWorth(db: Db, userId: string): Promise<NetWorth | null> {
  const { accounts } = await getBankBalances(db, userId)
  if (!accounts.length) return null
  const cash = accounts.filter((a) => a.type === 'Conta').reduce((s, a) => s + Number(a.balance), 0)
  const debts = accounts.filter((a) => a.type === 'Cartão').reduce((s, a) => s + Number(a.usedLimit ?? a.balance ?? 0), 0)

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
    cash: r2(cash), investments: r2(investments), debts: r2(debts), net: r2(cash + investments - debts),
    details: {
      accounts: accounts.map((a) => ({ institution: a.institution, name: a.name, type: a.type, value: a.type === 'Cartão' ? -Number(a.usedLimit ?? a.balance ?? 0) : Number(a.balance) })),
      investments: inv.sort((a, b) => b.value - a.value),
    },
  }
}

/** Guarda a foto do mês atual (sobrescreve durante o mês; o último dia fica como fechamento). */
export async function saveSnapshot(db: Db, userId: string, nw: NetWorth) {
  await db.from('net_worth_snapshots').upsert({
    user_id: userId, month: monthKeyOf(todayBR()), cash: nw.cash, investments: nw.investments, debts: nw.debts, net: nw.net,
    details: nw.details, updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,month' })
}
