import { NextResponse } from 'next/server'
import { adminDb } from '../../../../lib/botData'
import { refreshConnections } from '../../../../lib/bankRefresh'
import { pluggyEnabled } from '../../../../lib/pluggy'
import { userFromRequest } from '../../../../lib/serverAuth'

/** Painel → "Atualizar agora": pede à Pluggy para buscar dados novos no banco. */
export async function POST(request: Request) {
  if (!pluggyEnabled() || !adminDb) return NextResponse.json({ error: 'Pluggy não configurada no servidor.' }, { status: 500 })
  const userId = await userFromRequest(request)
  if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const { data: conns } = await adminDb.from('bank_connections').select('id, item_id, institution').eq('user_id', userId)
  const results = await refreshConnections(adminDb, conns || [], { webhookUrl: `${new URL(request.url).origin}/api/pluggy/webhook` })
  return NextResponse.json({ results })
}
