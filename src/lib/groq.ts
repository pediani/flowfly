// Groq (plano gratuito): transcrição de áudio (Whisper) e interpretação de frases livres (Llama).
// Só roda no servidor. Requer GROQ_API_KEY.
import { CATEGORY_NAMES } from './categories'
import { resolveDateToken, type ParsedEntry } from './parseEntry'
import { todayBR } from './dates'

const API = 'https://api.groq.com/openai/v1'
const KEY = () => process.env.GROQ_API_KEY || ''

export function groqEnabled(): boolean {
  return !!KEY()
}

export async function transcribe(audio: Blob, filename = 'voice.ogg'): Promise<string | null> {
  const form = new FormData()
  form.append('file', audio, filename)
  form.append('model', 'whisper-large-v3-turbo')
  form.append('language', 'pt')
  form.append('response_format', 'json')
  const res = await fetch(`${API}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${KEY()}` }, body: form })
  if (!res.ok) { console.error('Groq transcrição falhou:', res.status, await res.text()); return null }
  const data = await res.json()
  return typeof data.text === 'string' ? data.text.trim() : null
}

/** Extrai um lançamento de uma frase livre: "gastei trinta reais no uber ontem". */
export async function interpret(text: string, today = todayBR()): Promise<ParsedEntry | null> {
  const system = [
    'Você extrai lançamentos financeiros de mensagens em português do Brasil.',
    `Hoje é ${today}. Responda SOMENTE um JSON com as chaves:`,
    '{"ok": boolean, "type": "saida"|"entrada", "description": string curta (2-4 palavras, sem valor nem data), "amount": number em reais,',
    ` "category": uma de [${CATEGORY_NAMES.join(', ')}], "date": "YYYY-MM-DD", "installments": inteiro (1 se à vista)}`,
    'Números por extenso viram dígitos ("trinta e cinco e noventa" = 35.90). "recebi", "ganhei", "salário" = entrada; "gastei", "paguei", "comprei" = saída.',
    'Se não for um lançamento financeiro, responda {"ok": false}.',
  ].join('\n')

  const res = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: text.slice(0, 500) }],
    }),
  })
  if (!res.ok) { console.error('Groq interpretação falhou:', res.status, await res.text()); return null }

  try {
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content || '{}'
    const j = JSON.parse(content)
    // O modelo às vezes omite "ok": só descarta se disser explicitamente que não é lançamento
    if (j.ok === false) { console.log('Groq: não é lançamento:', text); return null }
    const amount = Math.round(Number(j.amount) * 100) / 100
    if (!Number.isFinite(amount) || amount <= 0 || !j.description) { console.log('Groq: resposta incompleta:', content); return null }
    const type = j.type === 'entrada' ? 'entrada' : 'saida'
    const date = /^\d{4}-\d{2}-\d{2}$/.test(j.date) && j.date <= today ? j.date : (resolveDateToken(String(j.date || ''), today) ?? today)
    const category = CATEGORY_NAMES.includes(j.category) ? j.category : type === 'entrada' ? 'Renda' : 'Geral'
    const installments = type === 'saida' ? Math.min(48, Math.max(1, Math.round(Number(j.installments) || 1))) : 1
    return { type, description: String(j.description).slice(0, 200), amount, category, categoryExplicit: false, date, installments }
  } catch (e) {
    console.error('Groq resposta inválida:', e)
    return null
  }
}
