import { NextResponse } from 'next/server'
import { adminDb } from '../../../../lib/botData'
import { syncConnection, type BankConnection } from '../../../../lib/bankSync'
import { ensureWebhook, getItem, pluggyEnabled } from '../../../../lib/pluggy'
import { userFromRequest } from '../../../../lib/serverAuth'

export const maxDuration = 60

/** Painel → conecta um Item ID da Pluggy à conta do usuário e importa os últimos 30 dias. */
export async function POST(request: Request) {
  if (!pluggyEnabled() || !adminDb) return NextResponse.json({ error: 'Pluggy não configurada no servidor (PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET).' }, { status: 500 })
  const userId = await userFromRequest(request)
  if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const db = adminDb

  const { itemId } = await request.json().catch(() => ({}))
  const id = String(itemId || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Item ID inválido (é um código no formato xxxxxxxx-xxxx-…).' }, { status: 400 })

  let item
  try { item = await getItem(id) } catch (e) {
    console.error(e)
    return NextResponse.json({ error: 'A Pluggy não encontrou esse Item ID nesta aplicação.' }, { status: 400 })
  }

  const { data: existing } = await db.from('bank_connections').select('*').eq('item_id', id).maybeSingle()
  if (existing && existing.user_id !== userId) return NextResponse.json({ error: 'Esse banco já está conectado em outra conta.' }, { status: 409 })
  const conn = existing ?? (await db.from('bank_connections')
    .insert({ user_id: userId, item_id: id, institution: null, status: item.status })
    .select('*').single()).data
  if (!conn) return NextResponse.json({ error: 'Erro ao salvar a conexão.' }, { status: 500 })

  const secret = process.env.PLUGGY_WEBHOOK_SECRET || process.env.CRON_SECRET
  if (secret) {
    try { await ensureWebhook(`${new URL(request.url).origin}/api/pluggy/webhook`, secret) } catch (e) { console.error('Webhook Pluggy:', e) }
  }

  try {
    const r = await syncConnection(db, conn as BankConnection, { initialDays: 30 })
    return NextResponse.json({ ok: true, institution: r.institution, imported: r.imported.length, matched: r.matched, skipped: r.skipped })
  } catch (e) {
    console.error('Pluggy sync inicial falhou:', e)
    return NextResponse.json({ ok: true, institution: conn.institution, warning: 'Conectado, mas a primeira importação falhou. Tente “Sincronizar”.' })
  }
}
