// Grupos de divisão: saldos por pessoa e a menor lista de pagamentos para zerar tudo.

export type SMember = { id: string; name: string; user_id: string | null; pix_key: string | null }
export type SExpense = { id: string; paid_by: string; amount: number; description: string; date: string }
export type SShare = { expense_id: string; member_id: string; share: number }
export type SSettlement = { id: string; from_member: string; to_member: string; amount: number; date: string }

const r2 = (v: number) => Math.round(v * 100) / 100

/** Positivo = tem a receber; negativo = deve. */
export function balances(members: SMember[], expenses: SExpense[], shares: SShare[], settlements: SSettlement[]): Record<string, number> {
  const b: Record<string, number> = Object.fromEntries(members.map((m) => [m.id, 0]))
  for (const e of expenses) b[e.paid_by] = (b[e.paid_by] || 0) + Number(e.amount)
  for (const s of shares) b[s.member_id] = (b[s.member_id] || 0) - Number(s.share)
  for (const s of settlements) {
    b[s.from_member] = (b[s.from_member] || 0) + Number(s.amount)
    b[s.to_member] = (b[s.to_member] || 0) - Number(s.amount)
  }
  for (const k of Object.keys(b)) b[k] = r2(b[k])
  return b
}

/** Quem paga quem (algoritmo guloso: maior devedor paga o maior credor). */
export function simplifyDebts(bal: Record<string, number>): { from: string; to: string; amount: number }[] {
  const debtors = Object.entries(bal).filter(([, v]) => v < -0.009).map(([id, v]) => ({ id, v: -v })).sort((a, b) => b.v - a.v)
  const creditors = Object.entries(bal).filter(([, v]) => v > 0.009).map(([id, v]) => ({ id, v })).sort((a, b) => b.v - a.v)
  const out: { from: string; to: string; amount: number }[] = []
  let i = 0, j = 0
  while (i < debtors.length && j < creditors.length) {
    const amt = r2(Math.min(debtors[i].v, creditors[j].v))
    if (amt > 0) out.push({ from: debtors[i].id, to: creditors[j].id, amount: amt })
    debtors[i].v = r2(debtors[i].v - amt)
    creditors[j].v = r2(creditors[j].v - amt)
    if (debtors[i].v <= 0.009) i++
    if (creditors[j].v <= 0.009) j++
  }
  return out
}

/** Divide em partes iguais (centavos que sobram vão para os primeiros) ou por percentuais. */
export function computeShares(amount: number, memberIds: string[], mode: 'igual' | 'percentual' | 'valor', custom: Record<string, number> = {}): Record<string, number> {
  if (!memberIds.length) return {}
  if (mode === 'valor') return Object.fromEntries(memberIds.map((id) => [id, r2(custom[id] || 0)]))
  if (mode === 'percentual') {
    const out = Object.fromEntries(memberIds.map((id) => [id, r2((amount * (custom[id] || 0)) / 100)]))
    const diff = r2(amount - Object.values(out).reduce((a, b) => a + b, 0))
    if (diff) out[memberIds[0]] = r2(out[memberIds[0]] + diff)
    return out
  }
  const cents = Math.round(amount * 100)
  const base = Math.floor(cents / memberIds.length)
  let rest = cents - base * memberIds.length
  return Object.fromEntries(memberIds.map((id) => [id, (base + (rest-- > 0 ? 1 : 0)) / 100]))
}
