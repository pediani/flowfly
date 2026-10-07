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
export function resolveDateToken(token: string, today = todayBR()): string | null {
  const t = strip(token.trim())
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
