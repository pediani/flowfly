import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
const supabase = createClient(supabaseUrl, supabaseKey)

// O token agora vem estritamente da variável de ambiente segura da Vercel
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''

export async function GET() {
  return NextResponse.json({ status: 'FlowFly Telegram Webhook is active and listening!' })
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    console.log('WEBHOOK TELEGRAM RECEBIDO:', JSON.stringify(body))

    const message = body.message || body.edited_message
    if (!message || !message.text) {
      return NextResponse.json({ ok: true })
    }

    const chatId = message.chat.id
    const text = message.text.trim()
    const telegramUserId = String(message.from.id)

    const { data: connection } = await supabase
      .from('telegram_connections')
      .select('user_id')
      .eq('telegram_id', telegramUserId)
      .single()

    if (!connection) {
      await sendTelegramMessage(chatId, '⚠️ Conta não vinculada! Acesse o painel do FlowFly para conectar o seu Telegram.')
      return NextResponse.json({ ok: true })
    }

    const userId = connection.user_id
    const parts = text.split(' ')
    if (parts.length < 2) {
      await sendTelegramMessage(chatId, '❌ Formato inválido. Use por exemplo: `mercado 45.90` ou `uber 30`')
      return NextResponse.json({ ok: true })
    }

    const description = parts.slice(0, -1).join(' ')
    const amount = parseFloat(parts[parts.length - 1].replace(',', '.'))

    if (isNaN(amount)) {
      await sendTelegramMessage(chatId, '❌ Valor inválido. Certifique-se de colocar o número no final (ex: `almoço 25`)')
      return NextResponse.json({ ok: true })
    }

    const { error } = await supabase.from('transactions').insert({
      user_id: userId,
      amount: amount,
      description: description,
      type: 'saida',
      category: 'Geral',
      date: new Date().toISOString().split('T')[0]
    })

    if (error) {
      console.error('Erro ao salvar transação:', error)
      await sendTelegramMessage(chatId, '❌ Erro ao guardar a despesa no banco de dados.')
    } else {
      await sendTelegramMessage(chatId, `✅ Despesa guardada com sucesso!\n📌 *${description}*: R$ ${amount.toFixed(2)}`)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Erro interno no webhook:', error)
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 })
  }
}

async function sendTelegramMessage(chatId: number, text: string) {
  if (!BOT_TOKEN) return
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
    })
  } catch (err) {
    console.error('Erro ao enviar resposta via Telegram:', err)
  }
}