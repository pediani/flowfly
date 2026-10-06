export type EntryType = 'entrada' | 'saida'

export type CategoryDef = {
  name: string
  emoji: string
  color: string
  keywords: string[]
}

// Cores pastel que funcionam nos temas claro e escuro
export const CATEGORIES: CategoryDef[] = [
  { name: 'Alimentação', emoji: '🍽️', color: '#f2b8a0', keywords: ['mercado', 'supermercado', 'ifood', 'almoco', 'jantar', 'lanche', 'restaurante', 'padaria', 'cafe', 'pizza', 'hamburguer', 'acougue', 'feira', 'rappi', 'comida', 'delivery', 'hortifruti', 'sorvete', 'doces'] },
  { name: 'Transporte', emoji: '🚗', color: '#a8c8f0', keywords: ['uber', '99', 'taxi', 'gasolina', 'combustivel', 'posto', 'estacionamento', 'pedagio', 'onibus', 'metro', 'passagem', 'ipva', 'oficina', 'mecanico', 'lavagem', 'bicicleta'] },
  { name: 'Casa', emoji: '🏠', color: '#c9b8f0', keywords: ['aluguel', 'condominio', 'luz', 'energia', 'agua', 'gas', 'internet', 'iptu', 'faxina', 'diarista', 'moveis', 'reforma', 'limpeza', 'enel', 'sabesp'] },
  { name: 'Lazer', emoji: '🎉', color: '#f5c6e0', keywords: ['cinema', 'bar', 'show', 'viagem', 'festa', 'cerveja', 'balada', 'ingresso', 'passeio', 'hotel', 'airbnb', 'jogo', 'teatro', 'praia'] },
  { name: 'Saúde', emoji: '💊', color: '#9fdcc4', keywords: ['farmacia', 'remedio', 'medico', 'consulta', 'exame', 'dentista', 'academia', 'plano de saude', 'hospital', 'terapia', 'psicologo', 'drogaria'] },
  { name: 'Assinaturas', emoji: '📺', color: '#f2d38b', keywords: ['netflix', 'spotify', 'prime video', 'amazon prime', 'disney', 'hbo', 'youtube', 'assinatura', 'icloud', 'chatgpt', 'globoplay', 'deezer', 'streaming'] },
  { name: 'Compras', emoji: '🛍️', color: '#f0b4c4', keywords: ['roupa', 'shopping', 'amazon', 'mercado livre', 'shopee', 'presente', 'tenis', 'eletronico', 'magalu', 'shein', 'sapato'] },
  { name: 'Educação', emoji: '📚', color: '#b5d8f2', keywords: ['curso', 'livro', 'faculdade', 'escola', 'mensalidade', 'udemy', 'alura', 'material escolar', 'idiomas', 'ingles'] },
  { name: 'Renda', emoji: '💼', color: '#a6e3c4', keywords: ['salario', 'freela', 'freelance', 'pix recebido', 'venda', 'reembolso', 'rendimento', 'dividendos', 'bonus', 'pagamento recebido', 'decimo terceiro', 'ferias'] },
  { name: 'Geral', emoji: '📌', color: '#cfc6dc', keywords: [] },
]

export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name)

const FALLBACK: CategoryDef = { name: 'Geral', emoji: '📌', color: '#cfc6dc', keywords: [] }

export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

export function getCategory(name?: string | null): CategoryDef {
  if (!name) return FALLBACK
  const n = normalize(name)
  return CATEGORIES.find((c) => normalize(c.name) === n) || { ...FALLBACK, name }
}

/** Detecta a categoria pela descrição. Vence a palavra-chave mais longa ("mercado livre" > "mercado"). */
export function detectCategory(description: string, type: EntryType): string {
  const text = ` ${normalize(description).replace(/[^a-z0-9 ]/g, ' ')} `
  let best: { name: string; len: number } | null = null
  for (const c of CATEGORIES) {
    for (const k of c.keywords) {
      if (text.includes(` ${k} `) && (!best || k.length > best.len)) best = { name: c.name, len: k.length }
    }
  }
  if (type === 'entrada') return best?.name === 'Renda' || !best ? 'Renda' : best.name
  return best && best.name !== 'Renda' ? best.name : 'Geral'
}

/** "#lazer", "#alim", "#saude" → nome oficial da categoria (prefixo de 3+ letras, sem acento). */
export function resolveCategoryTag(tag: string): string | null {
  const t = normalize(tag.replace(/^#/, ''))
  if (t.length < 3) return null
  return CATEGORIES.find((c) => normalize(c.name).startsWith(t))?.name ?? null
}
