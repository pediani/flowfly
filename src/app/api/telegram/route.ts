import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    console.log('MENSAGEM RECEBIDA DO TELEGRAM:', JSON.stringify(body))
    
    // Responde OK para o Telegram não ficar re-enviando
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('ERRO NO WEBHOOK:', error)
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Telegram webhook route is active!' })
}