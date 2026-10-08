import { createHash, randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { adminDb } from '../../../../lib/botData'
import { userFromRequest } from '../../../../lib/serverAuth'

/** Painel → gera um token para o atalho (o token só é mostrado uma vez; guardamos o hash). */
export async function POST(request: Request) {
  if (!adminDb) return NextResponse.json({ error: 'Servidor não configurado.' }, { status: 500 })
  const userId = await userFromRequest(request)
  if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const { label } = await request.json().catch(() => ({}))
  const token = `ff_${randomBytes(24).toString('base64url')}`
  const { error } = await adminDb.from('api_tokens').insert({ user_id: userId, label: String(label || 'Atalho').slice(0, 40), token_hash: createHash('sha256').update(token).digest('hex') })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ token })
}
