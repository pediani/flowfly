import { NextResponse } from 'next/server'
import { adminDb } from '../../../../lib/botData'
import { syncConnection, type BankConnection } from '../../../../lib/bankSync'
import { pluggyEnabled } from '../../../../lib/pluggy'
import { userFromRequest } from '../../../../lib/serverAuth'

export const maxDuration = 60

/** Painel → "Sincronizar agora" (todas as conexões do usuário). */
export async function POST(request: Request) {
  if (!pluggyEnabled() || !adminDb) return NextResponse.json({ error: 'Pluggy não configurada no servidor.' }, { status: 500 })
  const userId = await userFromRequest(request)
  if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: conns } = await adminDb.from('bank_connections').select('*').eq('user_id', userId)
  const out = { imported: 0, matched: 0, errors: [] as string[] }
  for (const c of (conns || []) as BankConnection[]) {
    try {
      const r = await syncConnection(adminDb, c)
      out.imported += r.imported.length
      out.matched += r.matched
    } catch (e) {
      console.error('Pluggy sync falhou:', c.item_id, e)
      out.errors.push(c.institution || c.item_id)
    }
  }
  return NextResponse.json(out)
}
