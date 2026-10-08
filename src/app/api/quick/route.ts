import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { adminDb } from '../../../lib/botData'
import { saveEntries, understandText } from '../../../lib/entryPipeline'
import { formatBRL } from '../../../lib/format'

// Atalho (Siri / Android): POST /api/quick  { "text": "gastei 30 no uber" }
// Header: Authorization: Bearer <token gerado no painel>. Responde em texto simples para o atalho falar/mostrar.
export const maxDuration = 30

const text = (body: string, status = 200) => new NextResponse(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

export async function POST(request: Request) {
  if (!adminDb) return text('Servidor não configurado.', 500)
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  if (!token) return text('Token ausente. Gere um no painel (Conexões → Atalho).', 401)
  const hash = createHash('sha256').update(token).digest('hex')
  const { data: tk } = await adminDb.from('api_tokens').select('id, user_id').eq('token_hash', hash).maybeSingle()
  if (!tk) return text('Token inválido. Gere um novo no painel.', 401)

  let input = ''
  const ct = request.headers.get('content-type') || ''
  if (ct.includes('application/json')) input = String((await request.json().catch(() => ({}))).text || '')
  else input = (await request.text()).trim()
  if (!input) return text('Diga o lançamento, por exemplo: gastei 30 no uber.', 400)

  await adminDb.from('api_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', tk.id)
  const entries = await understandText(adminDb, tk.user_id, input, 'atalho')
  if (!entries.length) return text(`Não entendi "${input}". Fale o valor e o que foi, por exemplo: uber 30 reais.`, 422)

  // avisa no Telegram também (com os botões de ajuste), se estiver vinculado
  const { data: conn } = await adminDb.from('telegram_connections').select('telegram_chat_id').eq('user_id', tk.user_id).maybeSingle()
  const saved = await saveEntries(adminDb, tk.user_id, entries, conn ? Number(conn.telegram_chat_id) : null, 'web')
  if (!saved.length) return text('Não consegui gravar. Tente de novo.', 500)
  const summary = entries.map((e) => `${e.type === 'entrada' ? 'entrada' : 'saída'} de ${formatBRL(e.amount)} em ${e.description} (${e.category})`).join('; ')
  return text(`Pronto! Registrei ${summary}.`)
}
