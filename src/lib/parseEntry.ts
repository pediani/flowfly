import { detectCategory, resolveCategoryTag, type EntryType } from './categories'
import { addDays, todayBR } from './dates'

export type ParsedEntry = {
  type: EntryType
  description: string
  amount: number
  category: string
  categoryExplicit: boolean
  /** YYYY-MM-DD */
  date: string
  /** Número de parcelas (1 = à vista) */
  installments: number
}

const PREFIXES: Record<string, EntryType> = {
  s: 'saida', saida: 'saida', gasto: 'saida', '-': 'saida',
  e: 'entrada', entrada: 'entrada', '+': 'entrada',
}

const strip = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/** "ontem", "anteontem", "hoje", "dia 3", "03/10", "3/10/2026" → YYYY-MM-DD (datas passadas por padrão) */
const NUM_WORDS: Record<string, number> = {
  um: 1, primeiro: 1, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18,
  dezenove: 19, vinte: 20, trinta: 30,
}
const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']

/** "três" → 3, "vinte e cinco" → 25, "12" → 12 */
function dayNumber(s: string): number | null {
  const t = strip(s).replace(/-feira/g, '')
  if (/^\d{1,2}$/.test(t)) return Number(t)
  const parts = t.split(/\s+e\s+/)
  let total = 0
  for (const p of parts) { if (!(p in NUM_WORDS)) return null; total += NUM_WORDS[p] }
  return total >= 1 && total <= 31 ? total : null
}

/** Regex (texto sem acento) que encontra expressões de data em frases faladas */
export const SPOKEN_DATE = new RegExp(
  '\\b(?:(?:no |na |em )?(?:dia |no dia )?(?:\\d{1,2}|(?:vinte|trinta)(?: e (?:um|dois|tres|quatro|cinco|seis|sete|oito|nove))?|' + Object.keys(NUM_WORDS).join('|') + ')(?: de (?:' + MONTHS.join('|') + '))?' +
  '|(?:na |no )?(?:' + WEEKDAYS.join('|') + ')(?:-feira)?(?: passad[ao])?|\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?|hoje|ontem|anteontem|antes de ontem)\\b', 'i')

export function resolveDateToken(token: string, today = todayBR()): string | null {
  const t = strip(token.trim()).replace(/^(?:no |na |em )/, '').replace(/^no dia /, 'dia ')
  if (t === 'antes de ontem') return addDays(today, -2)
  // dia da semana: a ocorrência mais recente (hoje não conta: "sexta" numa sexta = semana passada)
  const wd = t.match(/^(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:-feira)?(?: passad[ao])?$/)
  if (wd) {
    const [y, mo, d] = today.split('-').map(Number)
    const cur = new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
    const diff = (cur - WEEKDAYS.indexOf(wd[1]) + 7) % 7 || 7
    return addDays(today, -diff)
  }
  // "5 de outubro", "dia cinco de outubro", "vinte e cinco de setembro"
  const dm = t.match(/^(?:dia )?(.+?) de (janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)$/)
  if (dm) {
    const day = dayNumber(dm[1])
    if (day) return resolveDateToken(`${day}/${MONTHS.indexOf(dm[2]) + 1}`, today)
  }
  // "dia três", "dia vinte e cinco"
  const dw = t.match(/^dia (.+)$/)
  if (dw && !/^\d+$/.test(dw[1])) {
    const day = dayNumber(dw[1])
    if (day) return resolveDateToken(`dia ${day}`, today)
  }
  if (t === 'hoje') return today
  if (t === 'ontem') return addDays(today, -1)
  if (t === 'anteontem') return addDays(today, -2)
  const [ty, tm, td] = today.split('-').map(Number)
  const valid = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d))
    return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null
  }
  let m = t.match(/^dia (\d{1,2})$/)
  if (m) {
    const d = Number(m[1])
    // "dia 25" no dia 7 → dia 25 do mês passado
    return d <= td ? valid(ty, tm, d) : valid(tm === 1 ? ty - 1 : ty, tm === 1 ? 12 : tm - 1, d)
  }
  m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
  if (m) {
    const d = Number(m[1]), mo = Number(m[2])
    let y = m[3] ? Number(m[3]) : ty
    if (y < 100) y += 2000
    const iso = valid(y, mo, d)
    // Sem ano e no futuro → ano passado
    if (iso && !m[3] && iso > today) return valid(y - 1, mo, d)
    return iso
  }
  return null
}

/**
 * "s uber 50,40"              → saída de R$ 50,40 (Transporte), hoje
 * "e salário 1.000"           → entrada (Renda)
 * "pizza 60 #lazer ontem"     → categoria forçada, data de ontem
 * "s tv 1200 10x"             → 10 parcelas de R$ 120,00
 * "farmácia 45 dia 3"         → dia 3 (deste mês, ou do anterior se ainda não chegou)
 */
export function parseEntry(text: string, today = todayBR()): ParsedEntry | null {
  let rest = text.trim().replace(/\s+/g, ' ')

  let type: EntryType = 'saida'
  const prefix = rest.match(/^(\S+)\s+/)
  if (prefix) {
    const key = strip(prefix[1])
    if (key in PREFIXES) {
      type = PREFIXES[key]
      rest = rest.slice(prefix[0].length)
    }
  }

  let explicit = null as string | null
  rest = rest.replace(/(^|\s)#(\S+)/g, (_m, sp: string, tag: string) => {
    explicit = explicit ?? resolveCategoryTag(tag)
    return sp
  }).trim()

  // Modificadores no fim, em qualquer ordem: data e parcelas
  let date = today
  let installments = 1
  for (let guard = 0; guard < 3; guard++) {
    const inst = rest.match(/\s(?:em\s)?(\d{1,2})\s?x$/i)
    if (inst && Number(inst[1]) >= 2 && Number(inst[1]) <= 48) {
      installments = Number(inst[1]); rest = rest.slice(0, inst.index).trim(); continue
    }
    const dm = rest.match(/\s((?:dia \d{1,2})|(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)|hoje|ontem|anteontem)$/i)
    const resolved = dm ? resolveDateToken(dm[1], today) : null
    if (dm && resolved) { date = resolved; rest = rest.slice(0, dm.index).trim(); continue }
    break
  }

  const match = rest.match(/^(.+?)\s+(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)$/i)
  if (!match) return null

  const description = match[1].trim()
  let raw = match[2]
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(raw)) raw = raw.replace(/\./g, '')
  const amount = Math.round(parseFloat(raw.replace(',', '.')) * 100) / 100
  if (!description || !Number.isFinite(amount) || amount <= 0) return null
  if (type === 'entrada') installments = 1

  const desc = description.slice(0, 200)
  return {
    type, description: desc, amount, date, installments,
    category: explicit ?? detectCategory(desc, type),
    categoryExplicit: explicit !== null,
  }
}

/** Divide o total em parcelas; centavos de diferença vão para a 1ª. */
export function splitInstallments(total: number, n: number): number[] {
  const base = Math.floor((total / n) * 100) / 100
  const first = Math.round((total - base * (n - 1)) * 100) / 100
  return [first, ...Array(n - 1).fill(base)]
}

/** Data da parcela k (0 = primeira), mesmo dia nos meses seguintes (ajusta fim de mês). */
export function installmentDate(start: string, k: number): string {
  const [y, m, d] = start.split('-').map(Number)
  const target = new Date(Date.UTC(y, m - 1 + k, 1))
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10)
}

// ---- Frases livres (sem IA) ----

const IN_WORDS = /\b(recebi|ganhei|entrou|caiu|salario|salário|freela|reembolso|vendi|pix recebido)\b/i
const FILLER = new Set(['gastei', 'paguei', 'comprei', 'gasto', 'gastos', 'foi', 'deu', 'custou', 'recebi', 'ganhei', 'entrou', 'caiu', 'vendi',
  'reais', 'real', 'r$', 'conto', 'contos', 'pila', 'pilas', 'no', 'na', 'nos', 'nas', 'de', 'do', 'da', 'dos', 'das', 'em', 'com',
  'um', 'uma', 'o', 'a', 'os', 'as', 'pro', 'pra', 'para', 'por', 'e', 'eu', 'hoje', 'ontem', 'anteontem', 'mais', 'só', 'so', 'tipo', 'uns', 'umas', 'centavos'])

/**
 * "Gastei 30 reais no Uber" · "paguei 45,90 de farmácia ontem" · "recebi 1.500 de salário"
 * Procura o valor em qualquer posição e usa o resto (sem palavras de ligação) como descrição.
 */
export function parseNatural(text: string, today = todayBR()): ParsedEntry | null {
  let clean = text.trim().replace(/[.!?]+$/, '').replace(/\s+/g, ' ')

  // 1. Data primeiro (para o "5" de "dia 5" não virar valor). strip() mantém o mesmo tamanho sem os acentos.
  let date = today
  const plain = strip(clean)
  for (const cand of plain.matchAll(new RegExp(SPOKEN_DATE.source, 'gi'))) {
    const txt = cand[0].trim()
    if (/^(?:(?:no|na|em) )?\d+$/.test(txt)) continue // número solto = provavelmente o valor
    const iso = resolveDateToken(txt, today)
    if (iso) {
      date = iso
      clean = (clean.slice(0, cand.index) + ' ' + clean.slice(cand.index! + cand[0].length)).replace(/\s+/g, ' ').trim()
      break
    }
  }

  // 2. Parcelas: "10x", "em 10 vezes"
  let installments = 1
  const inst = clean.match(/\b(?:em )?(\d{1,2})\s?(?:x|vezes)\b/i)
  if (inst && Number(inst[1]) >= 2 && Number(inst[1]) <= 48) {
    installments = Number(inst[1])
    clean = (clean.slice(0, inst.index) + ' ' + clean.slice(inst.index! + inst[0].length)).trim()
  }

  // 3. Valor em qualquer posição: "30", "30,50", "1.500", "R$ 30", "12 reais e 50 centavos"
  const m = clean.match(/(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?:\s*(?:reais|real|conto|contos|pila)?(?:\s+e\s+(\d{1,2})\s+centavos)?)?/i)
  if (!m) return null
  let raw = m[1]
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(raw)) raw = raw.replace(/\./g, '')
  let amount = parseFloat(raw.replace(',', '.'))
  if (m[2]) amount += Number(m[2]) / 100
  amount = Math.round(amount * 100) / 100
  if (!Number.isFinite(amount) || amount <= 0) return null

  const type: EntryType = IN_WORDS.test(strip(text)) ? 'entrada' : 'saida'
  if (type === 'entrada') installments = 1

  const rest = clean.slice(0, m.index) + ' ' + clean.slice((m.index || 0) + m[0].length)
  const words = rest.split(/\s+/).filter((w) => w && !FILLER.has(strip(w)) && !/^\d+$/.test(w))
  const description = words.join(' ').trim().slice(0, 200)
  if (!description) return null

  return {
    type, description, amount, date, installments,
    category: detectCategory(description, type),
    categoryExplicit: false,
  }
}
