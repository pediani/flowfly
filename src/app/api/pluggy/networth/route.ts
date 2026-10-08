import { NextResponse } from 'next/server'
import { adminDb } from '../../../../lib/botData'
import { computeNetWorth, saveSnapshot } from '../../../../lib/networth'
import { pluggyEnabled } from '../../../../lib/pluggy'
import { userFromRequest } from '../../../../lib/serverAuth'

export const maxDuration = 30

/** Painel → patrimônio atual (e grava a foto do mês) + histórico mensal. */
export async function POST(request: Request) {
  if (!pluggyEnabled() || !adminDb) return NextResponse.json({ current: null, history: [] })
  const userId = await userFromRequest(request)
  if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const current = await computeNetWorth(adminDb, userId)
  if (current) await saveSnapshot(adminDb, userId, current).catch((e) => console.error('snapshot:', e))
  const { data: history } = await adminDb.from('net_worth_snapshots').select('month, cash, investments, debts, net').eq('user_id', userId).order('month')
  return NextResponse.json({ current, history: history || [] })
}
