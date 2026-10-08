// Texto → lançamentos → banco (+ aviso no Telegram). Usado pelo bot e pelos atalhos (Siri/Android).
import { logAiUsage } from './aiUsage'
import { currentMonthKey } from './dates'
import { groqEnabled, interpretMany } from './groq'
import { extractTags, normalizeSpokenAmounts, parseEntry, parseMany, parseNatural, type ParsedEntry } from './parseEntry'
import { fetchBudgets, fetchTxs, findPartner, insertEntry, type Db, type TxRow } from './botData'
import { entryKeyboard, escapeHtml, multiSummaryMessage, savedMessage } from './telegramBot'
import { sendMessage } from './telegramApi'

export type Origin = 'texto' | 'áudio' | 'atalho' | 'foto'

/** Primeiro sem IA (rápido e grátis); se não der, Groq. Tags "@evento" valem para todos os itens. */
export async function understandText(db: Db, userId: string, raw: string, origin: Origin, onAi?: () => Promise<unknown>): Promise<ParsedEntry[]> {
  const { text: noTags, tags } = extractTags(raw)
  const text = normalizeSpokenAmounts(noTags)
  const many = parseMany(text)
  const single = many.length ? null : parseEntry(text) ?? parseNatural(text)
  let entries = many.length ? many : single ? [single] : []
  if (entries.length) {
    await logAiUsage(db, { user_id: userId, provider: 'local', kind: 'local', purpose: origin, status: 'ok', result_count: entries.length, input_chars: raw.length })
  } else if (groqEnabled()) {
    await onAi?.()
    entries = await interpretMany(text, { userId, purpose: origin === 'áudio' ? 'áudio (interpretação)' : origin === 'atalho' ? 'atalho' : 'texto livre' })
  }
  if (tags.length) for (const e of entries) e.tags = [...new Set([...(e.tags || []), ...tags])]
  return entries
}

/** Grava e, se houver chat, responde no Telegram (um lançamento = mensagem completa; vários = enxutas + resumo). */
export async function saveEntries(db: Db, userId: string, entries: ParsedEntry[], chatId: number | null, source: 'telegram' | 'web' = 'telegram'): Promise<TxRow[]> {
  const partner = chatId ? await findPartner(db, userId) : null
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
  }
  if (chatId && entries.length > 1 && saved.length) await sendMessage(chatId, multiSummaryMessage(saved.length, await fetchTxs(db, userId, key), key))
  return saved
}
