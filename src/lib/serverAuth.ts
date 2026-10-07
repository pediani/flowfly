import { adminDb } from './botData'

/** Usuário logado a partir do header "Authorization: Bearer <access_token do Supabase>". */
export async function userFromRequest(request: Request): Promise<string | null> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token || !adminDb) return null
  const { data, error } = await adminDb.auth.getUser(token)
  return error ? null : data.user?.id ?? null
}
