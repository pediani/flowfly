// Texto → lançamentos → banco (+ aviso no Telegram). Usado pelo bot e pelos atalhos (Siri/Android).
import { logAiUsage } from './aiUsage'
import { currentMonthKey } from './dates'
import { groqEnabled, interpretMany } from './groq'
import { extractPayment, extractTags, normalizeSpokenAmounts, parseEntry, parseMany, parseNatural, type ParsedEntry } from './parseEntry'
import { GENERIC_CARD, listUserCards, resolveCard, type UserCard } from './cards'
import { fetchBudgets, fetchTxs, findPartner, insertEntry, type Db, type TxRow } from './botData'
import { cardChoiceKeyboard, entryKeyboard, escapeHtml, multiSummaryMessage, savedMessage } from './telegramBot'
import { sendMessage } from './telegramApi'

export type Origin = 'texto' | 'áudio' | 'atalho' | 'foto'

/** Primeiro sem IA (rápido e grátis); se não der, Groq. Tags "@evento" valem para todos os itens. */
export async function understandText(db: Db, userId: string, raw: string, origin: Origin, onAi?: () => Promise<unknown>): Promise<ParsedEntry[]> {
  const { text: noTags, tags } = extractTags(raw)
  const text = normalizeSpokenAmounts(noTags)
  const many = parseMany(text)
  const single = many.length ? null : parseEntry(text)
  let entries = many.length ? many : single ? [single] : []
  // Frase livre: "gastei 120 numa camisa no cartão santander" → tira o cartão antes de interpretar
  const loose = entries.length ? null : extractPayment(text)
  if (!entries.length) { const n = parseNatural(loose!.text); if (n) entries = [n] }
  if (entries.length) {
    await logAiUsage(db, { user_id: userId, provider: 'local', kind: 'local', purpose: origin, status: 'ok', result_count: entries.length, input_chars: raw.length })
  } else if (groqEnabled()) {
    await onAi?.()
    entries = await interpretMany(loose?.text || text, { userId, purpose: origin === 'áudio' ? 'áudio (interpretação)' : origin === 'atalho' ? 'atalho' : 'texto livre' })
  }
  if (tags.length) for (const e of entries) e.tags = [...new Set([...(e.tags || []), ...tags])]
  if (loose?.payment) for (const e of entries) if (e.type === 'saida' && !e.payment) e.payment = loose.payment
  return entries
}

/** Grava e, se houver chat, responde no Telegram (um lançamento = mensagem completa; vários = enxutas + resumo). */
export async function saveEntries(db: Db, userId: string, entries: ParsedEntry[], chatId: number | null, source: 'telegram' | 'web' = 'telegram'): Promise<TxRow[]> {
  const partner = chatId ? await findPartner(db, userId) : null
  // Cartão citado: resolve qual; se não der, grava como "Cartão" e pergunta
  let cards: UserCard[] | null = null
  const ask: Set<number> = new Set()
  for (const [i, e] of entries.entries()) {
    if (e.payment?.method !== 'cartao') continue
    cards ??= await listUserCards(db, userId)
    const card = resolveCard(cards, e.payment.hint) ?? (cards.length === 1 ? cards[0] : null)
    if (card) e.bankAccount = card.label
    else if (cards.length) { e.bankAccount = GENERIC_CARD; ask.add(i) }
    else e.bankAccount = e.payment.hint ? `${e.payment.hint.replace(/\b\p{L}/gu, (c) => c.toUpperCase())} · Cartão` : GENERIC_CARD
  }
  const saved: TxRow[] = []
  const key = currentMonthKey()
  for (const [i, entry] of entries.entries()) {
    const { row, error } = await insertEntry(db, userId, entry, source)
    if (error || !row) {
      console.error('Erro ao salvar transação:', error)
      if (chatId) await sendMessage(chatId, `❌ Não consegui guardar “${escapeHtml(entry.description)}”.`)
      continue
    }
    saved.push(row)
    if (!chatId) continue
    const kb = entryKeyboard(row.id, { canSplit: !!partner, isIn: entry.type === 'entrada' })
    if (entries.length === 1) {
      const [monthTxs, budgets] = await Promise.all([fetchTxs(db, userId, key), fetchBudgets(db, userId)])
      await sendMessage(chatId, savedMessage(entry, row.created_at || new Date().toISOString(), monthTxs, budgets, key), kb)
    } else {
      await sendMessage(chatId, savedMessage(entry, row.created_at || new Date().toISOString(), [], [], key, { compact: true, index: `${i + 1}/${entries.length}` }), kb)
    }
    if (ask.has(i) && cards?.length) {
      await sendMessage(chatId, `💳 <b>${escapeHtml(entry.description)}</b>: em qual cartão${entry.payment?.hint ? ` (não achei “${escapeHtml(entry.payment.hint)}”)` : ''}?`, cardChoiceKeyboard(row.id, cards))
    }
  }
  if (chatId && entries.length > 1 && saved.length) await sendMessage(chatId, multiSummaryMessage(saved.length, await fetchTxs(db, userId, key), key))
  return saved
}
