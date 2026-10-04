import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

export async function POST(req: Request) {
  try {
    const body = await req.json()
    if (!body.message || !body.message.text) return NextResponse.json({ ok: true })

    const chatId = body.message.chat.id.toString()
    const text = body.message.text.toLowerCase().trim()

    // 1. Busca as conexões do Telegram para identificar o utilizador e possíveis parceiros
    const { data: connections } = await supabase.from('telegram_connections').select('user_id, telegram_chat_id')
    const myConn = connections?.find(c => c.telegram_chat_id === chatId)

    if (!myConn) {
      await sendMessage(chatId, `Seu ID de Chat é: ${chatId}\nPor favor, vincule este ID no sistema FlowFly.`)
      return NextResponse.json({ ok: true })
    }
    
    const userId = myConn.user_id
    // Procura outro utilizador cadastrado para ser o parceiro de divisão padrão, se houver
    const partnerConn = connections?.find(c => c.user_id !== userId)
    const partnerId = partnerConn?.user_id

    // COMANDO ESPECIAL: /saldo
    if (text === '/saldo') {
      const { data: txs } = await supabase.from('transactions').select('amount, type').eq('user_id', userId)
      if (txs) {
        const entradas = txs.filter(t => t.type === 'entrada').reduce((acc, curr) => acc + curr.amount, 0)
        const saidas = txs.filter(t => t.type === 'saida').reduce((acc, curr) => acc + curr.amount, 0)
        await sendMessage(chatId, `📊 Saldo Disponível FlowFly:\n💰 R$ ${(entradas - saidas).toFixed(2)}`)
      }
      return NextResponse.json({ ok: true })
    }

    // EXTRAÇÃO DE VALOR
    const match = text.match(/\d+([.,]\d{1,2})?/)
    if (!match) {
      await sendMessage(chatId, "🤷‍♂️ Não entendi o valor. Exemplo: 'uber 50' ou 'mercado 85.50 /dividir'")
      return NextResponse.json({ ok: true })
    }

    const valor = parseFloat(match[0].replace(',', '.'))
    const isEntrada = text.includes('receb') || text.includes('salário') || text.includes('salario')
    const tipo = isEntrada ? 'entrada' : 'saida'
    const isSplit = text.includes('/dividir') || text.includes('/rachar')

    // CATEGORIZAÇÃO AUTOMÁTICA
    let categoria = 'Geral'
    if (text.includes('ifood') || text.includes('mercado') || text.includes('lanche') || text.includes('restaurante')) categoria = 'Alimentação'
    else if (text.includes('uber') || text.includes('gasolina') || text.includes('carro') || text.includes('onibus') || text.includes('metro')) categoria = 'Transporte'
    else if (text.includes('farmacia') || text.includes('médico') || text.includes('remedio') || text.includes('saude')) categoria = 'Saúde'
    else if (text.includes('cinema') || text.includes('bar') || text.includes('viagem')) categoria = 'Lazer'
    else if (text.includes('aluguel') || text.includes('luz') || text.includes('agua') || text.includes('internet')) categoria = 'Casa'

    // LIMPEZA DA DESCRIÇÃO
    let descricao = text.replace(match[0], '').replace(/(gastei|paguei|recebi|\/dividir|\/rachar)/gi, '').trim()
    descricao = descricao.charAt(0).toUpperCase() + descricao.slice(1) || (isEntrada ? 'Entrada Avulsa' : 'Gasto Avulso')

    // 2. Insere a transação na conta de quem mandou a mensagem
    const { error } = await supabase.from('transactions').insert({
      user_id: userId, 
      amount: valor, 
      description: descricao, 
      type: tipo, 
      category: categoria, 
      is_split: isSplit, 
      date: new Date().toISOString().split('T')[0]
    })

    if (error) {
      await sendMessage(chatId, "❌ Erro ao registrar no banco de dados.")
      return NextResponse.json({ ok: true })
    }

    let resposta = `✅ FlowFly Registrado!\n🧾 ${descricao}\n📂 ${categoria}\n💸 R$ ${valor.toFixed(2)} ${tipo === 'entrada' ? '🟢' : '🔴'}`

    // 3. Se for para dividir e houver parceiro, lança o "a_pagar" para ele
    if (isSplit && partnerId) {
      await supabase.from('transactions').insert({
        user_id: partnerId,
        amount: valor / 2,
        description: `Metade: ${descricao}`,
        type: 'a_pagar',
        category: categoria,
        date: new Date().toISOString().split('T')[0]
      })
      resposta += `\n🤝 Metade (R$ ${(valor / 2).toFixed(2)}) enviada como dívida pendente para o parceiro.`
      
      // Notifica o parceiro no Telegram se ele tiver chat ID cadastrado
      if (partnerConn?.telegram_chat_id && partnerConn.telegram_chat_id !== chatId) {
        await sendMessage(partnerConn.telegram_chat_id, `🔔 FlowFly: Nova despesa dividida!\nVocê tem R$ ${(valor / 2).toFixed(2)} pendentes referente a: ${descricao}`)
      }
    }

    await sendMessage(chatId, resposta)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ ok: true })
  }
}

async function sendMessage(chatId: string, text: string) {
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ chat_id: chatId, text })
  })
}