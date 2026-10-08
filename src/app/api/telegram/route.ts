import { NextResponse } from 'next/server'
import { CATEGORIES, detectCategory } from '../../../lib/categories'
import { addDays, addMonths, currentMonthKey, daysInMonth, monthKeyOf, todayBR } from '../../../lib/dates'
import { pendingRecurring } from '../../../lib/finance'
import { answerQuestion, groqEnabled, readReceipt, transcribe } from '../../../lib/groq'
import { detectSubscriptions, monthRecap, qaContext } from '../../../lib/analysis'
import { extractTags, type ParsedEntry } from '../../../lib/parseEntry'
import { saveEntries, understandText, type Origin } from '../../../lib/entryPipeline'
import {
  INVALID_FORMAT, categoryKeyboard, entryKeyboard, escapeHtml, helpMessage, lastEntriesMessage,
  canBuyMessage, recapMessage, savedMessage, subscriptionsMessage, summaryMessage, todayMessage, undoMessage, weeklyMessage,
} from '../../../lib/telegramBot'
import { getBankBalances } from '../../../lib/balances'
import { cardsForPurchase, computeSafeToSpend, purchaseEvents } from '../../../lib/safeToSpend'
import { answerCallback, downloadFile, editKeyboard, editMessage, sendMessage, sendTyping } from '../../../lib/telegramApi'
import {
  TX_COLS, adminDb, entryFromRows, fetchBudgets, fetchRecurring, fetchTxs, fetchTxsBetween, findPartner, rowsOf,
  type Db, type TxRow,
} from '../../../lib/botData'
import { bankEntryMessage, bankKeyboard } from '../../../lib/bankSync'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
// Valor definido no setWebhook (secret_token). O Telegram o reenvia no header abaixo.
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ''

export const maxDuration = 30

export async function GET() {
  return NextResponse.json({ status: 'FlowFly Telegram Webhook is active and listening!' })
}

export async function POST(request: Request) {
  if (!WEBHOOK_SECRET || request.headers.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  if (!adminDb || !BOT_TOKEN) {
    console.error('Configuração ausente: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL ou TELEGRAM_BOT_TOKEN')
    return NextResponse.json({ ok: false }, { status: 500 })
  }
  const db = adminDb

  // A partir daqui sempre responde 200: um erro 5xx faz o Telegram reenviar a mesma mensagem em loop.
  try {
    const body = await request.json()
    console.log('Telegram update recebido:', body.update_id)

    if (body.callback_query) {
      await handleCallback(db, body.callback_query)
      return NextResponse.json({ ok: true })
    }

    const message = body.message || body.edited_message
    const image = message?.photo?.length ? message.photo[message.photo.length - 1] : message?.document?.mime_type?.startsWith('image/') ? message.document : null
    if (!message || message.chat?.type !== 'private' || (!message.text && !message.voice && !message.audio && !image)) {
      return NextResponse.json({ ok: true })
    }

    const chatId: number = message.chat.id
    const text: string = (message.text || '').trim()

    // Vinculação: /start <código> (link t.me/<bot>?start=<código> gerado no painel)
    const startMatch = text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9]{6,20})$/)
    if (startMatch) {
      await handleLink(db, chatId, startMatch[1])
      return NextResponse.json({ ok: true })
    }

    const userId = await userOfChat(db, chatId)
    if (userId === undefined) {
      await sendMessage(chatId, '❌ Erro ao consultar o banco de dados. Tente novamente em instantes.')
      return NextResponse.json({ ok: true })
    }
    if (!userId) {
      await sendMessage(chatId, '👋 <b>Bem-vindo ao FlowFly!</b>\n\nPara começar, abra o painel, vá na aba <b>Conexões</b> e toque em <b>Conectar Telegram</b>.')
      return NextResponse.json({ ok: true })
    }

    // Foto de comprovante → lançamento
    if (image) {
      await handlePhoto(db, chatId, userId, image, message.document?.mime_type || 'image/jpeg', message.caption || '')
      return NextResponse.json({ ok: true })
    }

    // Áudio → texto
    if (message.voice || message.audio) {
      await handleVoice(db, chatId, userId, message.voice || message.audio)
      return NextResponse.json({ ok: true })
    }

    if (text.startsWith('/')) {
      const command = text.split(/\s|@/)[0].toLowerCase()
      if (command === '/hoje') await handleToday(db, chatId, userId)
      else if (command === '/assinaturas') await handleSubscriptions(db, chatId, userId)
      else if (command === '/mes') await handleRecap(db, chatId, userId, /anterior|passado/i.test(text))
      else if (command === '/p' || command === '/pergunta') await handleQuestion(db, chatId, userId, text.replace(/^\/\S+\s*/, ''))
      else if (command === '/posso') await handleCanBuy(db, chatId, userId, text)
      else if (command === '/resumo') await handleSummary(db, chatId, userId)
      else if (command === '/semana') await handleWeek(db, chatId, userId)
      else if (command === '/ultimos') await handleLast(db, chatId, userId)
      else if (command === '/desfazer') await handleUndo(db, chatId, userId)
      else await sendMessage(chatId, helpMessage(groqEnabled()))
      return NextResponse.json({ ok: true })
    }

    if (/\?\s*$/.test(text) && !/\d/.test(text.replace(/\?/g, '').slice(-12))) {
      await handleQuestion(db, chatId, userId, text)
      return NextResponse.json({ ok: true })
    }
    const entries = await understand(db, chatId, userId, text, 'texto')
    if (!entries.length) {
      await sendMessage(chatId, INVALID_FORMAT)
      return NextResponse.json({ ok: true })
    }
    await registerEntries(db, chatId, userId, entries)
  } catch (error) {
    console.error('Erro interno no webhook:', error)
  }

  return NextResponse.json({ ok: true })
}

// ---- Helpers ----

/** user_id vinculado ao chat; null se não vinculado; undefined se deu erro. */
async function userOfChat(db: Db, chatId: number): Promise<string | null | undefined> {
  const { data, error } = await db.from('telegram_connections').select('user_id').eq('telegram_chat_id', chatId).maybeSingle()
  if (error) { console.error('Erro ao buscar vínculo do Telegram:', error); return undefined }
  return data?.user_id ?? null
}

async function renderEntry(db: Db, userId: string, entry: ParsedEntry, createdAt: string) {
  const key = currentMonthKey()
  const [monthTxs, budgets] = await Promise.all([fetchTxs(db, userId, key), fetchBudgets(db, userId)])
  return savedMessage(entry, createdAt, monthTxs, budgets, key)
}

async function understand(db: Db, chatId: number, userId: string, text: string, origin: Origin): Promise<ParsedEntry[]> {
  return understandText(db, userId, text, origin, () => sendTyping(chatId))
}

async function registerEntries(db: Db, chatId: number, userId: string, entries: ParsedEntry[]) {
  await saveEntries(db, userId, entries, chatId, 'telegram')
}

async function handleLink(db: Db, chatId: number, code: string) {
  const { data: linkedUser, error } = await db.rpc('consume_telegram_link_code', { p_code: code, p_chat_id: chatId })
  if (error) {
    console.error('Erro ao vincular Telegram:', error)
    await sendMessage(chatId, '❌ Erro ao vincular a conta. Tente novamente em instantes.')
  } else if (!linkedUser) {
    await sendMessage(chatId, '⚠️ Código inválido ou expirado. Gere um novo na aba <b>Conexões</b> do painel.')
  } else {
    await sendMessage(chatId, `✅ <b>Conta vinculada!</b>\n\n${helpMessage(groqEnabled())}`)
  }
}

async function handlePhoto(db: Db, chatId: number, userId: string, file: { file_id: string; file_size?: number }, mime: string, caption: string) {
  if (!groqEnabled()) { await sendMessage(chatId, '📷 Leitura de fotos ainda não está ativada.'); return }
  if ((file.file_size || 0) > 3_500_000) { await sendMessage(chatId, '📷 Imagem muito grande. Mande como foto (não como arquivo) ou recorte o comprovante.'); return }
  await sendTyping(chatId)
  const blob = await downloadFile(file.file_id)
  // a legenda pode trazer tags ou ajustes ("@viagem", "#lazer")
  const { tags } = extractTags(caption)
  const entries = blob ? await readReceipt(blob, mime, { userId, caption }) : []
  if (!entries.length) {
    await sendMessage(chatId, '📷 Não consegui ler um valor nessa imagem. Tente uma foto mais nítida do comprovante, ou mande por texto: <code>s mercado 45,90</code>')
    return
  }
  if (tags.length) for (const e of entries) e.tags = tags
  await sendMessage(chatId, '📷 <i>Li o comprovante:</i>')
  await saveEntries(db, userId, entries, chatId, 'telegram')
}

async function handleVoice(db: Db, chatId: number, userId: string, file: { file_id: string; duration?: number }) {
  if (!groqEnabled()) {
    await sendMessage(chatId, '🎙️ Áudios ainda não estão ativados. Por enquanto, envie por texto: <code>s uber 30</code>')
    return
  }
  if ((file.duration || 0) > 60) {
    await sendMessage(chatId, '🎙️ Áudio muito longo. Mande um áudio curto, tipo “gastei 30 no uber”.')
    return
  }
  await sendTyping(chatId)
  const blob = await downloadFile(file.file_id)
  const heard = blob ? await transcribe(blob, { userId, seconds: file.duration }) : null
  if (!heard) {
    await sendMessage(chatId, '🎙️ Não consegui entender o áudio. Tente de novo ou envie por texto.')
    return
  }
  const entries = await understand(db, chatId, userId, heard, 'áudio')
  if (!entries.length) {
    await sendMessage(chatId, `🎙️ Ouvi: “${escapeHtml(heard)}”\n\nMas não consegui identificar o lançamento. Tente falar o valor e o que foi, ex.: “uber 30 reais”.`)
    return
  }
  await sendMessage(chatId, `🎙️ <i>“${escapeHtml(heard)}”</i>`)
  await registerEntries(db, chatId, userId, entries)
}

async function safeContext(db: Db, userId: string) {
  const key = currentMonthKey()
  const [{ accounts }, recurring, txs] = await Promise.all([
    getBankBalances(db, userId),
    fetchRecurring(db, userId),
    fetchTxsBetween(db, userId, addDays(todayBR(), -10), `${addMonths(key, 1)}-${daysInMonth(addMonths(key, 1))}`),
  ])
  return { accounts, recurring, txs }
}

async function handleToday(db: Db, chatId: number, userId: string) {
  await sendTyping(chatId)
  const { accounts, recurring, txs } = await safeContext(db, userId)
  const safe = computeSafeToSpend(accounts, recurring, txs)
  if (!safe) { await sendMessage(chatId, '🏦 Conecte um banco no painel (aba Conexões) para eu calcular quanto você pode gastar.'); return }
  await sendMessage(chatId, todayMessage(safe, cardsForPurchase(accounts)[0] ?? null))
}

async function handleCanBuy(db: Db, chatId: number, userId: string, text: string) {
  // /posso 2400 10x · /posso 89,90 · /posso 300 pix
  const m = text.match(/\/posso(?:@\w+)?\s+(?:R\$\s*)?([\d.]+(?:,\d{1,2})?)(?:\s+(?:em\s+)?(\d{1,2})\s?x)?(\s+(?:pix|debito|débito|dinheiro))?/i)
  if (!m) { await sendMessage(chatId, 'Use assim: <code>/posso 2400 10x</code> (no melhor cartão) ou <code>/posso 300 pix</code>.'); return }
  const amount = parseFloat(m[1].replace(/\./g, '').replace(',', '.'))
  const inst = m[2] ? Math.max(1, Math.min(24, Number(m[2]))) : 1
  await sendTyping(chatId)
  const { accounts, recurring, txs } = await safeContext(db, userId)
  const before = computeSafeToSpend(accounts, recurring, txs)
  if (!before) { await sendMessage(chatId, '🏦 Conecte um banco no painel para eu simular a compra.'); return }
  const card = m[3] ? null : cardsForPurchase(accounts)[0] ?? null
  const after = computeSafeToSpend(accounts, recurring, txs, { extra: purchaseEvents(amount, inst, card) })!
  await sendMessage(chatId, canBuyMessage(amount, card ? inst : 1, card, before, after))
}

async function handleSubscriptions(db: Db, chatId: number, userId: string) {
  const [txs, recurring] = await Promise.all([fetchTxsBetween(db, userId, addDays(todayBR(), -400), todayBR()), fetchRecurring(db, userId)])
  await sendMessage(chatId, subscriptionsMessage(detectSubscriptions(txs, recurring)))
}

async function handleRecap(db: Db, chatId: number, userId: string, previous: boolean) {
  const key = previous ? addMonths(currentMonthKey(), -1) : currentMonthKey()
  const [txs, budgets, goals] = await Promise.all([
    fetchTxs(db, userId, addMonths(key, -1), key), fetchBudgets(db, userId),
    db.from('goals').select('title, saved_amount, target_amount').eq('user_id', userId).then(({ data }) => data || []),
  ])
  await sendMessage(chatId, recapMessage(monthRecap(txs, budgets, key), goals))
}

async function handleQuestion(db: Db, chatId: number, userId: string, question: string) {
  if (!question.trim()) { await sendMessage(chatId, 'Pergunte algo, por exemplo: <code>/p quanto gastei de ifood em setembro?</code>'); return }
  if (!groqEnabled()) { await sendMessage(chatId, '🤖 A IA não está configurada.'); return }
  await sendTyping(chatId)
  const [txs, budgets, recurring] = await Promise.all([
    fetchTxsBetween(db, userId, `${addMonths(currentMonthKey(), -5)}-01`, todayBR()), fetchBudgets(db, userId), fetchRecurring(db, userId),
  ])
  const answer = await answerQuestion(question, qaContext(txs, budgets, recurring), { userId })
  await sendMessage(chatId, answer ? `🤖 ${escapeHtml(answer)}` : '🤖 Não consegui responder agora. Tente de novo em instantes.')
}

async function handleSummary(db: Db, chatId: number, userId: string) {
  const key = currentMonthKey()
  const [txs, budgets, recurring] = await Promise.all([fetchTxs(db, userId, addMonths(key, -3), key), fetchBudgets(db, userId), fetchRecurring(db, userId)])
  await sendMessage(chatId, summaryMessage(txs, recurring, budgets, key, todayBR()))
}

async function handleWeek(db: Db, chatId: number, userId: string) {
  const to = todayBR()
  const from = addDays(to, -6)
  await sendMessage(chatId, weeklyMessage(await fetchTxsBetween(db, userId, from, to), from, to))
}

async function handleLast(db: Db, chatId: number, userId: string) {
  const { data } = await db.from('transactions').select(TX_COLS).eq('user_id', userId)
    .lte('date', todayBR()).neq('type', 'ignorado')
    .order('date', { ascending: false }).order('created_at', { ascending: false, nullsFirst: false }).limit(8)
  await sendMessage(chatId, lastEntriesMessage((data || []) as TxRow[]))
}

async function handleUndo(db: Db, chatId: number, userId: string) {
  const { data: last } = await db.from('transactions').select(TX_COLS)
    .eq('user_id', userId).eq('source', 'telegram')
    .order('created_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
  if (!last) {
    await sendMessage(chatId, '🤷 Não há lançamentos feitos pelo Telegram para desfazer.')
    return
  }
  await sendMessage(chatId, await undoRows(db, userId, last as TxRow))
}

async function undoRows(db: Db, userId: string, tx: TxRow): Promise<string> {
  const rows = await rowsOf(db, tx)
  const { error } = await db.from('transactions').delete().in('id', rows.map((r) => r.id)).eq('user_id', userId)
  if (error) { console.error('Erro ao desfazer:', error); return '❌ Não consegui remover o lançamento.' }
  const key = currentMonthKey()
  const entry = entryFromRows(rows)
  return undoMessage({ ...rows[0], description: entry.description + (rows.length > 1 ? ` (${rows.length} parcelas)` : ''), amount: entry.amount }, await fetchTxs(db, userId, key), key)
}

// ---- Botões ----

type CallbackQuery = { id: string; data?: string; message?: { chat: { id: number }; message_id: number } }

async function handleCallback(db: Db, cq: CallbackQuery) {
  const chatId = cq.message?.chat.id
  const messageId = cq.message?.message_id
  if (!chatId || !messageId || !cq.data) { await answerCallback(cq.id); return }

  const userId = await userOfChat(db, chatId)
  if (!userId) { await answerCallback(cq.id, 'Conta não vinculada'); return }

  const [action, id, extra] = cq.data.split(':')

  // Conta fixa paga (lembrete do cron)
  if (action === 'p') {
    const { data: r } = await db.from('recurring_transactions').select('id, amount, type, description, day_of_month, user_id').eq('id', id).maybeSingle()
    if (!r || r.user_id !== userId) { await answerCallback(cq.id, 'Conta fixa não encontrada'); return }
    const today = todayBR()
    const monthTxs = await fetchTxs(db, userId, monthKeyOf(today))
    if (!pendingRecurring(monthTxs, [r], monthKeyOf(today)).length) { await answerCallback(cq.id, 'Já lançada este mês ✔'); return }
    const { error } = await db.from('transactions').insert({
      user_id: userId, amount: r.amount, type: r.type, description: r.description,
      category: detectCategory(r.description, r.type === 'entrada' ? 'entrada' : 'saida'), date: today, source: 'telegram',
    })
    await answerCallback(cq.id, error ? 'Erro ao lançar' : `✅ ${r.description} lançada`)
    if (!error) await sendMessage(chatId, `✅ <b>${escapeHtml(r.description)}</b> lançada hoje (${r.type === 'entrada' ? '+' : '−'} R$ ${Number(r.amount).toFixed(2).replace('.', ',')}).`)
    return
  }

  const { data: tx } = await db.from('transactions').select(TX_COLS).eq('id', id).maybeSingle()
  if (!tx || tx.user_id !== userId) {
    await answerCallback(cq.id, 'Lançamento não encontrado (talvez já removido)')
    await editKeyboard(chatId, messageId, { inline_keyboard: [] })
    return
  }
  const row = tx as TxRow & { bank_description?: string | null; bank_account?: string | null }
  const partner = await findPartner(db, userId)
  const fromBank = row.source === 'bank'
  const kb = fromBank
    ? bankKeyboard(row.id, !!partner && !row.is_split, row.type === 'entrada')
    : entryKeyboard(row.id, { canSplit: !!partner && !row.is_split, isIn: row.type === 'entrada' })
  // Lançamentos do banco: redesenha com o layout próprio
  const rerender = async (rows: TxRow[]) => fromBank
    ? bankEntryMessage({ ...row, ...rows[0] })
    : renderEntry(db, userId, entryFromRows(rows), row.created_at || new Date().toISOString())

  switch (action) {
    case 'c':
      await answerCallback(cq.id)
      await editKeyboard(chatId, messageId, categoryKeyboard(row.id))
      return
    case 'b':
      await answerCallback(cq.id)
      await editKeyboard(chatId, messageId, kb)
      return
    case 's': {
      const cat = CATEGORIES[Number(extra)]
      if (!cat) { await answerCallback(cq.id); return }
      const rows = await rowsOf(db, row)
      await db.from('transactions').update({ category: cat.name }).in('id', rows.map((r) => r.id))
      await answerCallback(cq.id, `${cat.emoji} ${cat.name}`)
      await editMessage(chatId, messageId, await rerender(rows.map((r) => ({ ...r, category: cat.name }))), kb)
      return
    }
    case 'y': {
      const rows = await rowsOf(db, row)
      await Promise.all(rows.map((r) => db.from('transactions').update({ date: addDays(r.date, -1) }).eq('id', r.id)))
      await answerCallback(cq.id, '📅 Movido para o dia anterior')
      await editMessage(chatId, messageId, await rerender(rows.map((r) => ({ ...r, date: addDays(r.date, -1) }))), kb)
      return
    }
    case 'd': {
      if (!partner) { await answerCallback(cq.id, 'Adicione um parceiro no painel'); return }
      if (row.is_split || row.type !== 'saida') { await answerCallback(cq.id, 'Já dividido'); return }
      const rows = await rowsOf(db, row)
      await db.from('transactions').update({ is_split: true }).in('id', rows.map((r) => r.id))
      await db.from('transactions').insert(rows.map((r) => ({
        user_id: partner, amount: Math.round((Number(r.amount) / 2) * 100) / 100, type: 'a_pagar',
        description: `Metade: ${r.description}`, category: r.category, date: r.date, source: 'telegram', split_parent_id: r.id,
      })))
      await answerCallback(cq.id, '👥 Dividido com seu parceiro')
      await editKeyboard(chatId, messageId, fromBank ? bankKeyboard(row.id, false, false) : entryKeyboard(row.id, { canSplit: false, isIn: false }))
      return
    }
    case 'i': {
      // Ignorar (lançamento do banco): mantém o vínculo para não reimportar, mas tira dos totais
      await db.from('transactions').update({ type: 'ignorado' }).eq('id', row.id)
      await answerCallback(cq.id, '🙈 Ignorado')
      await editMessage(chatId, messageId, bankEntryMessage({ ...row, type: 'ignorado' }))
      return
    }
    case 'u':
      if (fromBank) {
        await db.from('transactions').update({ type: 'ignorado' }).eq('id', row.id)
        await answerCallback(cq.id, '🙈 Ignorado')
        await editMessage(chatId, messageId, bankEntryMessage({ ...row, type: 'ignorado' }))
        return
      }
      await answerCallback(cq.id, '↩️ Removido')
      await editMessage(chatId, messageId, await undoRows(db, userId, row))
      return
    default:
      await answerCallback(cq.id)
  }
}
