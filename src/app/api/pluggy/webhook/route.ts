import { NextResponse, after } from 'next/server'
import { adminDb, findPartner } from '../../../../lib/botData'
import { notifyImported, syncConnection, type BankConnection } from '../../../../lib/bankSync'

// A Pluggy chama este endpoint quando há transações novas (evento transactions/created).
// Precisa responder em até 10s: respondemos já e sincronizamos depois (after).
export const maxDuration = 60

export async function POST(request: Request) {
  const secret = process.env.PLUGGY_WEBHOOK_SECRET || process.env.CRON_SECRET
  if (!secret || request.headers.get('x-flowfly-secret') !== secret) return NextResponse.json({ ok: false }, { status: 401 })
  if (!adminDb) return NextResponse.json({ ok: false }, { status: 500 })
  const db = adminDb

  const body = await request.json().catch(() => ({}))
  console.log('Pluggy webhook:', body.event, body.itemId, body.triggeredBy)
  const itemId: string | undefined = body.itemId
  if (!itemId || !['transactions/created', 'item/updated'].includes(body.event)) return NextResponse.json({ ok: true })

  after(async () => {
    try {
      const { data: conn } = await db.from('bank_connections').select('*').eq('item_id', itemId).maybeSingle()
      if (!conn) return
      const r = await syncConnection(db, conn as BankConnection)
      console.log('Pluggy sync (webhook):', itemId, { imported: r.imported.length, matched: r.matched, skipped: r.skipped })
      await notifyImported(db, conn.user_id, r.imported, !!(await findPartner(db, conn.user_id)))
    } catch (e) {
      console.error('Pluggy sync falhou (webhook):', e)
    }
  })
  return NextResponse.json({ ok: true })
}
