import { NextResponse } from 'next/server'
import { adminDb, loadUserCategories } from '../../../../lib/botData'
import { learnCategory } from '../../../../lib/aiCategorize'
import { userFromRequest } from '../../../../lib/serverAuth'

/** Painel → você trocou a categoria: lembra o estabelecimento e corrige os parecidos. */
export async function POST(request: Request) {
  if (!adminDb) return NextResponse.json({ updated: 0 })
  const userId = await userFromRequest(request)
  if (!userId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const { txId, category } = await request.json().catch(() => ({}))
  if (!txId || !category) return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
  await loadUserCategories(adminDb, userId)
  const updated = await learnCategory(adminDb, userId, String(txId), String(category).slice(0, 60))
  return NextResponse.json({ updated })
}
