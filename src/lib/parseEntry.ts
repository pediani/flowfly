import { detectCategory, resolveCategoryTag, type EntryType } from './categories'

export type ParsedEntry = {
  type: EntryType
  description: string
  amount: number
  category: string
  categoryExplicit: boolean
}

const PREFIXES: Record<string, EntryType> = {
  s: 'saida', saida: 'saida', gasto: 'saida', '-': 'saida',
  e: 'entrada', entrada: 'entrada', '+': 'entrada',
}

/**
 * "s uber 50,40"            → saída de R$ 50,40 (Transporte)
 * "e salário 1.000"         → entrada de R$ 1.000,00 (Renda)
 * "pizza 60 #lazer"         → saída (sem prefixo = saída), categoria forçada
 * "aluguel R$ 1.234,56"     → milhar no formato brasileiro
 */
export function parseEntry(text: string): ParsedEntry | null {
  let rest = text.trim().replace(/\s+/g, ' ')

  // Prefixo de tipo
  let type: EntryType = 'saida'
  const prefix = rest.match(/^(\S+)\s+/)
  if (prefix) {
    const key = prefix[1].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    if (key in PREFIXES) {
      type = PREFIXES[key]
      rest = rest.slice(prefix[0].length)
    }
  }

  // #categoria em qualquer posição
  let explicit = null as string | null
  rest = rest.replace(/(^|\s)#(\S+)/g, (_m, sp: string, tag: string) => {
    explicit = explicit ?? resolveCategoryTag(tag)
    return sp
  }).trim()

  const match = rest.match(/^(.+?)\s+(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)$/i)
  if (!match) return null

  const description = match[1].trim()
  let raw = match[2]
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(raw)) raw = raw.replace(/\./g, '')
  const amount = Math.round(parseFloat(raw.replace(',', '.')) * 100) / 100
  if (!description || !Number.isFinite(amount) || amount <= 0) return null

  const desc = description.slice(0, 200)
  return {
    type,
    description: desc,
    amount,
    category: explicit ?? detectCategory(desc, type),
    categoryExplicit: explicit !== null,
  }
}
