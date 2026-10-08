import { NextResponse } from 'next/server'
import { adminDb } from '../../../../lib/botData'
import { refreshConnections } from '../../../../lib/bankRefresh'
import { pluggyEnabled } from '../../../../lib/pluggy'

// Atualização automática extra (além da diária da Pluggy). Chamado por agendador externo
// (pg_cron no Supabase) com "Authorization: Bearer <CRON_SECRET>". Só pede atualização de
// bancos com dados de mais de 3 horas, para respeitar os limites do Open Finance.
export const maxDuration = 60

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ ok: false }, { status: 401 })
  if (!pluggyEnabled() || !adminDb) return NextResponse.json({ ok: false, error: 'Pluggy não configurada' }, { status: 500 })
  const { data: conns } = await adminDb.from('bank_connections').select('id, item_id, institution')
  const results = await refreshConnections(adminDb, conns || [], { minAgeHours: 3, webhookUrl: `${new URL(request.url).origin}/api/pluggy/webhook` })
  console.log('Pluggy refresh-all:', results)
  return NextResponse.json({ ok: true, results })
}
export const POST = GET
