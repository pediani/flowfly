import { NextResponse } from 'next/server'
import { adminDb } from '../../../../lib/botData'
import { getItem, pluggyEnabled } from '../../../../lib/pluggy'
import { userFromRequest } from '../../../../lib/serverAuth'

/** Painel → situação de cada banco na Pluggy (atualizando? quando foi a última? próxima automática?). */
export async function POST(request: Request) {
  if (!pluggyEnabled() || !adminDb) return NextResponse.json({ items: {} })
  const userId = await userFromRequest(request)
  if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const { data: conns } = await adminDb.from('bank_connections').select('id, item_id').eq('user_id', userId)
  const items: Record<string, { status: string; executionStatus?: string; lastUpdatedAt?: string | null; nextAutoSyncAt?: string | null; consentExpiresAt?: string | null; error?: string | null }> = {}
  await Promise.all((conns || []).map(async (c) => {
    try {
      const it = await getItem(c.item_id)
      items[c.id] = { status: it.status, executionStatus: it.executionStatus, lastUpdatedAt: it.lastUpdatedAt, nextAutoSyncAt: it.nextAutoSyncAt, consentExpiresAt: it.consentExpiresAt, error: it.error?.message || null }
    } catch (e) {
      items[c.id] = { status: 'ERRO', error: String(e).slice(0, 200) }
    }
  }))
  return NextResponse.json({ items })
}
