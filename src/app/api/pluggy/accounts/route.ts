import { NextResponse } from 'next/server'
import { adminDb } from '../../../../lib/botData'
import { listAccounts, pluggyEnabled } from '../../../../lib/pluggy'
import { userFromRequest } from '../../../../lib/serverAuth'

/** Painel → contas e cartões de cada conexão (ajuda a identificar qual banco é qual). */
export async function POST(request: Request) {
  if (!pluggyEnabled() || !adminDb) return NextResponse.json({ error: 'Pluggy não configurada no servidor.' }, { status: 500 })
  const userId = await userFromRequest(request)
  if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const db = adminDb

  const { data: conns } = await db.from('bank_connections').select('id, item_id').eq('user_id', userId)
  const out: Record<string, { type: string; name: string; last4: string }[]> = {}
  await Promise.all((conns || []).map(async (c) => {
    try {
      out[c.id] = (await listAccounts(c.item_id)).map((a) => ({
        type: a.type === 'CREDIT' ? 'Cartão' : 'Conta',
        name: a.marketingName || a.name || '',
        last4: String(a.number || '').replace(/\D/g, '').slice(-4),
      }))
    } catch (e) {
      console.error('Pluggy contas:', c.item_id, e)
      out[c.id] = []
    }
  }))
  return NextResponse.json(out)
}
