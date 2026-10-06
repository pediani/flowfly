import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { parseExpense } from '../../../lib/parseExpense'
import { todayBR } from '../../../lib/dates'

// O webhook roda no servidor e precisa da service role (ignora RLS).
// Sem fallback para a anon key: se faltar configuração, falha de forma explícita.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
// Valor definido no setWebhook (secret_token). O Telegram o reenvia no header abaixo.
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ''

const supabase = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null

export async function GET() {
  return NextResponse.json({ status: 'FlowFly Telegram Webhook is active and listening!' })
}

export async function POST(request: Request) {
  // 1. Autenticidade: só aceita requisições vindas do Telegram
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

    if (!message?.text || message.chat?.type !== 'private') {
      return NextResponse.json({ ok: true })
    }

    const chatId: number = message.chat.id
    const text: string = message.text.trim()

    // Vinculação: /start <código> (vindo do link t.me/<bot>?start=<código> gerado no painel)
    const startMatch = text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9]{6,20})$/)
    if (startMatch) {
      const { data: linkedUser, error: linkError } = await supabase.rpc('consume_telegram_link_code', {
        p_code: startMatch[1],
        p_chat_id: chatId,
      })
      if (linkError) {
        console.error('Erro ao vincular Telegram:', linkError)
        await sendTelegramMessage(chatId, '❌ Erro ao vincular a conta. Tente novamente em instantes.')
      } else if (!linkedUser) {
        await sendTelegramMessage(chatId, '⚠️ Código inválido ou expirado. Gere um novo na aba <b>Conexões</b> do painel.')
      } else {
        await sendTelegramMessage(chatId, '✅ Conta vinculada! Agora é só mandar suas despesas, ex.: <code>mercado 45,90</code>')
      }
      return NextResponse.json({ ok: true })
    }

    const { data: connection, error: connError } = await supabase
      .from('telegram_connections')
      .select('user_id')
      .eq('telegram_chat_id', chatId)
      .maybeSingle()

    if (connError) {
      console.error('Erro ao buscar vínculo do Telegram:', connError)
      await sendTelegramMessage(chatId, '❌ Erro ao consultar o banco de dados. Tente novamente em instantes.')
      return NextResponse.json({ ok: true })
    }

    if (!connection) {
      await sendTelegramMessage(
        chatId,
        '⚠️ Conta não vinculada!\nNo painel do FlowFly, abra a aba <b>Conexões</b> e toque em <b>Conectar Telegram</b>.'
      )
      return NextResponse.json({ ok: true })
    }

    if (text.startsWith('/')) {
      await sendTelegramMessage(chatId, '👋 Envie uma despesa no formato <code>descrição valor</code>.\nEx.: <code>mercado 45,90</code>')
      return NextResponse.json({ ok: true })
    }

    const parsed = parseExpense(text)
    if (!parsed) {
      await sendTelegramMessage(chatId, '❌ Formato inválido. Use <code>descrição valor</code>, ex.: <code>uber 30</code> ou <code>almoço 25,50</code>')
      return NextResponse.json({ ok: true })
    }

    const { error } = await supabase.from('transactions').insert({
      user_id: connection.user_id,
      amount: parsed.amount,
      description: parsed.description,
      type: 'saida',
      category: 'Geral',
      date: todayBR(),
    })

    if (error) {
      console.error('Erro ao salvar transação:', error)
      await sendTelegramMessage(chatId, '❌ Erro ao guardar a despesa no banco de dados.')
    } else {
      const valor = parsed.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      await sendTelegramMessage(chatId, `✅ Despesa guardada!\n📌 <b>${escapeHtml(parsed.description)}</b>: ${valor}`)
    }
  } catch (error) {
    console.error('Erro interno no webhook:', error)
  }

  return NextResponse.json({ ok: true })
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function sendTelegramMessage(chatId: number, text: string) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    })
    if (!res.ok) console.error('Telegram sendMessage falhou:', res.status, await res.text())
  } catch (err) {
    console.error('Erro ao enviar resposta via Telegram:', err)
  }
}
