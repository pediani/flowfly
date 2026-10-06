import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { parseEntry } from '../../../lib/parseEntry'
import { addMonths, currentMonthKey, daysInMonth, todayBR } from '../../../lib/dates'
import type { Budget, Recurring, Tx } from '../../../lib/finance'
import {
  INVALID_FORMAT, helpMessage, lastEntriesMessage, savedMessage, summaryMessage, undoMessage,
} from '../../../lib/telegramBot'

// O webhook roda no servidor e precisa da service role (ignora RLS).
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
// Valor definido no setWebhook (secret_token). O Telegram o reenvia no header abaixo.
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ''

const supabase = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null

type Db = NonNullable<typeof supabase>

export async function GET() {
  return NextResponse.json({ status: 'FlowFly Telegram Webhook is active and listening!' })
}

export async function POST(request: Request) {
  if (!WEBHOOK_SECRET || request.headers.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  if (!supabase || !BOT_TOKEN) {
    console.error('Configuração ausente: SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL ou TELEGRAM_BOT_TOKEN')
    return NextResponse.json({ ok: false }, { status: 500 })
  }

  // A partir daqui sempre responde 200: um erro 5xx faz o Telegram reenviar a mesma mensagem em loop.
  try {
    const body = await request.json()
    const message = body.message || body.edited_message
    console.log('Telegram update recebido:', body.update_id)

    if (!message?.text || message.chat?.type !== 'private') return NextResponse.json({ ok: true })

    const chatId: number = message.chat.id
    const text: string = message.text.trim()

    // Vinculação: /start <código> (link t.me/<bot>?start=<código> gerado no painel)
    const startMatch = text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9]{6,20})$/)
    if (startMatch) {
      await handleLink(supabase, chatId, startMatch[1])
      return NextResponse.json({ ok: true })
    }

    const { data: connection, error: connError } = await supabase
      .from('telegram_connections').select('user_id').eq('telegram_chat_id', chatId).maybeSingle()

    if (connError) {
      console.error('Erro ao buscar vínculo do Telegram:', connError)
      await reply(chatId, '❌ Erro ao consultar o banco de dados. Tente novamente em instantes.')
      return NextResponse.json({ ok: true })
    }
    if (!connection) {
      await reply(chatId, '👋 <b>Bem-vindo ao FlowFly!</b>\n\nPara começar, abra o painel, vá na aba <b>Conexões</b> e toque em <b>Conectar Telegram</b>.')
      return NextResponse.json({ ok: true })
    }

    const userId: string = connection.user_id
    const command = text.startsWith('/') ? text.split(/\s|@/)[0].toLowerCase() : null

    if (command) {
      if (command === '/resumo') await handleSummary(supabase, chatId, userId)
      else if (command === '/ultimos') await handleLast(supabase, chatId, userId)
      else if (command === '/desfazer') await handleUndo(supabase, chatId, userId)
      else await reply(chatId, helpMessage())
      return NextResponse.json({ ok: true })
    }

    const entry = parseEntry(text)
    if (!entry) {
      await reply(chatId, INVALID_FORMAT)
      return NextResponse.json({ ok: true })
    }

    const { error } = await supabase.from('transactions').insert({
      user_id: userId,
      amount: entry.amount,
      description: entry.description,
      type: entry.type,
      category: entry.category,
      date: todayBR(),
      source: 'telegram',
    })

    if (error) {
      console.error('Erro ao salvar transação:', error)
      await reply(chatId, '❌ Erro ao guardar o lançamento no banco de dados.')
      return NextResponse.json({ ok: true })
    }

    const key = currentMonthKey()
    const [monthTxs, budgets] = await Promise.all([fetchTxs(supabase, userId, key), fetchBudgets(supabase, userId)])
    await reply(chatId, savedMessage(entry, new Date().toISOString(), monthTxs, budgets, key))
  } catch (error) {
    console.error('Erro interno no webhook:', error)
  }

  return NextResponse.json({ ok: true })
}

// ---- Handlers ----

async function handleLink(db: Db, chatId: number, code: string) {
  const { data: linkedUser, error } = await db.rpc('consume_telegram_link_code', { p_code: code, p_chat_id: chatId })
  if (error) {
    console.error('Erro ao vincular Telegram:', error)
    await reply(chatId, '❌ Erro ao vincular a conta. Tente novamente em instantes.')
  } else if (!linkedUser) {
    await reply(chatId, '⚠️ Código inválido ou expirado. Gere um novo na aba <b>Conexões</b> do painel.')
  } else {
    await reply(chatId, `✅ <b>Conta vinculada!</b>\n\n${helpMessage()}`)
  }
}

async function handleSummary(db: Db, chatId: number, userId: string) {
  const key = currentMonthKey()
  const [txs, budgets, recurring] = await Promise.all([
    fetchTxs(db, userId, addMonths(key, -3), key), // histórico ajuda a projeção no começo do mês
    fetchBudgets(db, userId),
    db.from('recurring_transactions').select('id, amount, type, description, day_of_month').eq('user_id', userId)
      .then(({ data }) => (data || []) as Recurring[]),
  ])
  await reply(chatId, summaryMessage(txs, recurring, budgets, key, todayBR()))
}

async function handleLast(db: Db, chatId: number, userId: string) {
  const { data } = await db.from('transactions')
    .select('id, amount, type, description, category, date, created_at, source')
    .eq('user_id', userId)
    .order('date', { ascending: false }).order('created_at', { ascending: false, nullsFirst: false })
    .limit(8)
  await reply(chatId, lastEntriesMessage((data || []) as Tx[]))
}

async function handleUndo(db: Db, chatId: number, userId: string) {
  const { data: last } = await db.from('transactions')
    .select('id, amount, type, description, category, date, created_at, source')
    .eq('user_id', userId).eq('source', 'telegram')
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(1).maybeSingle()

  if (!last) {
    await reply(chatId, '🤷 Não há lançamentos feitos pelo Telegram para desfazer.')
    return
  }
  const { error } = await db.from('transactions').delete().eq('id', last.id).eq('user_id', userId)
  if (error) {
    console.error('Erro ao desfazer:', error)
    await reply(chatId, '❌ Não consegui remover o lançamento.')
    return
  }
  const key = currentMonthKey()
  await reply(chatId, undoMessage(last as Tx, await fetchTxs(db, userId, key), key))
}

// ---- Dados ----

async function fetchTxs(db: Db, userId: string, fromKey: string, toKey = fromKey): Promise<Tx[]> {
  const { data } = await db.from('transactions')
    .select('id, amount, type, description, category, date, is_split, created_at, source')
    .eq('user_id', userId)
    .gte('date', `${fromKey}-01`)
    .lte('date', `${toKey}-${daysInMonth(toKey)}`)
  return (data || []) as Tx[]
}

async function fetchBudgets(db: Db, userId: string): Promise<Budget[]> {
  const { data } = await db.from('budgets').select('category, monthly_limit').eq('user_id', userId)
  return (data || []) as Budget[]
}

async function reply(chatId: number, text: string) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
    })
    if (!res.ok) console.error('Telegram sendMessage falhou:', res.status, await res.text())
  } catch (err) {
    console.error('Erro ao enviar resposta via Telegram:', err)
  }
}
