// Cartões do usuário para lançamentos manuais (Telegram/painel): vêm das conexões da Pluggy.
import type { Db } from './botData'
import { accountLabel } from './bankSync'
import { normalize } from './categories'
import { listAccounts, pluggyEnabled } from './pluggy'

export type UserCard = { label: string; institution: string; name: string; last4: string }

/** Rótulo genérico quando a compra foi no cartão mas ainda não se sabe qual. */
export const GENERIC_CARD = 'Cartão'

export async function listUserCards(db: Db, userId: string): Promise<UserCard[]> {
  if (!pluggyEnabled()) return []
  const { data: conns } = await db.from('bank_connections').select('item_id, institution').eq('user_id', userId)
  const out: UserCard[] = []
  for (const c of conns || []) {
    try {
      for (const a of await listAccounts(c.item_id)) {
        if (a.type !== 'CREDIT') continue
        out.push({ label: accountLabel(c.institution, a), institution: c.institution || 'Banco', name: a.marketingName || a.name || 'Cartão', last4: String(a.number || '').replace(/\D/g, '').slice(-4) })
      }
    } catch (e) { console.error('Cartões:', c.item_id, e) }
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

const ALIASES: Record<string, string> = { mp: 'mercado pago', mercadopago: 'mercado pago', 'mercado livre': 'mercado pago', itau: 'itau', nu: 'nubank', santa: 'santander', bb: 'banco do brasil', inter: 'inter' }

/** "santander", "mp", "3947", "elite"… → cartão. null se não der para saber. */
export function resolveCard(cards: UserCard[], hint?: string | null): UserCard | null {
  if (!hint) return null
  const h = ALIASES[normalize(hint)] ?? normalize(hint)
  const hits = cards.filter((c) => {
    if (/^\d{4}$/.test(h)) return c.last4 === h
    const inst = normalize(c.institution)
    const name = normalize(c.name)
    return inst.includes(h) || h.includes(inst) || name.includes(h) || h.split(' ').every((w) => inst.includes(w) || name.includes(w))
  })
  return hits.length === 1 ? hits[0] : null
}

export const cardShort = (label: string) => label.replace(' · Cartão', '').replace(/ (\d{4})$/, ' ·$1')
