export type EntryType = 'entrada' | 'saida'

export type CategoryDef = {
  name: string
  emoji: string // usado nas mensagens do Telegram
  icon: string // nome do ícone lucide usado no painel (ver components/CategoryIcon.tsx)
  color: string
  keywords: string[]
}

// Cores vivas que funcionam nos temas claro e escuro
export const CATEGORIES: CategoryDef[] = [
  { name: 'Alimentação', emoji: '🍽️', icon: 'utensils', color: '#f97316', keywords: ['mercado', 'supermercado', 'ifood', 'almoco', 'jantar', 'lanche', 'restaurante', 'padaria', 'cafe', 'pizza', 'hamburguer', 'acougue', 'feira', 'rappi', 'comida', 'delivery', 'hortifruti', 'sorvete', 'doces'] },
  { name: 'Transporte', emoji: '🚗', icon: 'car', color: '#3b82f6', keywords: ['uber', '99', 'taxi', 'gasolina', 'combustivel', 'posto', 'estacionamento', 'pedagio', 'onibus', 'metro', 'passagem', 'ipva', 'oficina', 'mecanico', 'lavagem', 'bicicleta'] },
  { name: 'Casa', emoji: '🏠', icon: 'home', color: '#8b5cf6', keywords: ['aluguel', 'condominio', 'luz', 'energia', 'agua', 'gas', 'internet', 'iptu', 'faxina', 'diarista', 'moveis', 'reforma', 'limpeza', 'enel', 'sabesp'] },
  { name: 'Lazer', emoji: '🎉', icon: 'party', color: '#ec4899', keywords: ['cinema', 'bar', 'show', 'viagem', 'festa', 'cerveja', 'balada', 'ingresso', 'passeio', 'hotel', 'airbnb', 'jogo', 'teatro', 'praia'] },
  { name: 'Saúde', emoji: '💊', icon: 'heart', color: '#14b8a6', keywords: ['farmacia', 'remedio', 'medico', 'consulta', 'exame', 'dentista', 'academia', 'plano de saude', 'hospital', 'terapia', 'psicologo', 'drogaria'] },
  { name: 'Assinaturas', emoji: '📺', icon: 'tv', color: '#eab308', keywords: ['netflix', 'spotify', 'prime video', 'amazon prime', 'disney', 'hbo', 'youtube', 'assinatura', 'icloud', 'chatgpt', 'globoplay', 'deezer', 'streaming'] },
  { name: 'Compras', emoji: '🛍️', icon: 'bag', color: '#d946ef', keywords: ['roupa', 'shopping', 'amazon', 'mercado livre', 'shopee', 'presente', 'tenis', 'eletronico', 'magalu', 'shein', 'sapato'] },
  { name: 'Educação', emoji: '📚', icon: 'grad', color: '#06b6d4', keywords: ['curso', 'livro', 'faculdade', 'escola', 'mensalidade', 'udemy', 'alura', 'material escolar', 'idiomas', 'ingles'] },
  { name: 'Renda', emoji: '💼', icon: 'briefcase', color: '#22c55e', keywords: ['salario', 'freela', 'freelance', 'pix recebido', 'venda', 'reembolso', 'rendimento', 'dividendos', 'bonus', 'pagamento recebido', 'decimo terceiro', 'ferias'] },
  { name: 'Geral', emoji: '📌', icon: 'tag', color: '#71717a', keywords: [] },
]

export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name)

const FALLBACK: CategoryDef = { name: 'Geral', emoji: '📌', icon: 'tag', color: '#71717a', keywords: [] }

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
