import { NextResponse } from 'next/server'
import { adminDb } from '../../../../lib/botData'
import { relabel } from '../../../../lib/bankSync'
import { listAccounts, pluggyEnabled } from '../../../../lib/pluggy'
import { userFromRequest } from '../../../../lib/serverAuth'

/** Painel → renomeia uma conexão ("MeuPluggy" → "Itaú") e atualiza os lançamentos já importados. */
export async function POST(request: Request) {
  if (!pluggyEnabled() || !adminDb) return NextResponse.json({ error: 'Pluggy não configurada no servidor.' }, { status: 500 })
  const userId = await userFromRequest(request)
  if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { connectionId, name } = await request.json().catch(() => ({}))
  const label = String(name || '').trim().slice(0, 40)
  if (!label) return NextResponse.json({ error: 'Informe um nome.' }, { status: 400 })

  const { data: conn } = await adminDb.from('bank_connections').select('*').eq('id', connectionId).eq('user_id', userId).maybeSingle()
  if (!conn) return NextResponse.json({ error: 'Conexão não encontrada.' }, { status: 404 })

  await adminDb.from('bank_connections').update({ institution: label }).eq('id', conn.id)
  try { await relabel(adminDb, userId, await listAccounts(conn.item_id), conn.institution, label) } catch (e) { console.error('Relabel:', e) }
  return NextResponse.json({ ok: true })
}
