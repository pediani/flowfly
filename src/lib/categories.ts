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
  { name: 'Saúde', emoji: '💊', icon: 'heart', color: '#14b8a6', keywords: ['farmacia', 'remedio', 'medico', 'consulta', 'exame', 'dentista', 'academia', 'plano de saude', 'hospital', 'terapia', 'psicologo', 'drogaria', 'drogasil', 'raia', 'pague menos', 'panvel'] },
  { name: 'Assinaturas', emoji: '📺', icon: 'tv', color: '#eab308', keywords: ['netflix', 'netflix.com', 'spotify', 'prime video', 'amazon prime', 'disney', 'hbo', 'youtube', 'assinatura', 'icloud', 'chatgpt', 'globoplay', 'deezer', 'streaming'] },
  { name: 'Compras', emoji: '🛍️', icon: 'bag', color: '#d946ef', keywords: ['roupa', 'shopping', 'amazon', 'mercado livre', 'shopee', 'presente', 'tenis', 'eletronico', 'magalu', 'shein', 'sapato'] },
  { name: 'Educação', emoji: '📚', icon: 'grad', color: '#06b6d4', keywords: ['curso', 'livro', 'faculdade', 'escola', 'mensalidade', 'udemy', 'alura', 'material escolar', 'idiomas', 'ingles'] },
  { name: 'Renda', emoji: '💼', icon: 'briefcase', color: '#22c55e', keywords: ['salario', 'freela', 'freelance', 'pix recebido', 'venda', 'reembolso', 'rendimento', 'dividendos', 'bonus', 'pagamento recebido', 'decimo terceiro', 'ferias'] },
  { name: 'Geral', emoji: '📌', icon: 'tag', color: '#71717a', keywords: [] },
]

// ---- Categorias personalizadas (tabela categories) ----

export type CustomCategoryRow = { id?: string; name: string; emoji?: string | null; color?: string | null; icon?: string | null; keywords?: string[] | null; type?: string | null }

let custom: CategoryDef[] = []

/** Registra as categorias do usuário (chamado pelo painel ao carregar e pelo bot a cada mensagem). */
export function setCustomCategories(rows: CustomCategoryRow[]) {
  custom = rows
    .filter((r) => r.name && !CATEGORIES.some((c) => normalize(c.name) === normalize(r.name)))
    .map((r) => ({
      name: r.name.trim(), emoji: r.emoji || '🏷️', icon: r.icon || 'tag', color: r.color || '#8b5cf6',
      keywords: [...(r.keywords || []).map((k) => normalize(k)), normalize(r.name)],
    }))
}

/** Padrões + personalizadas (Geral sempre por último). */
export function allCategories(): CategoryDef[] {
  const base = CATEGORIES.filter((c) => c.name !== 'Geral')
  return [...base, ...custom, CATEGORIES.find((c) => c.name === 'Geral')!]
}

export const categoryNames = () => allCategories().map((c) => c.name)
/** @deprecated use categoryNames() — mantido para compatibilidade */
export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name)

const FALLBACK: CategoryDef = { name: 'Geral', emoji: '📌', icon: 'tag', color: '#71717a', keywords: [] }

export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}

export function getCategory(name?: string | null): CategoryDef {
  if (!name) return FALLBACK
  const n = normalize(name)
  return allCategories().find((c) => normalize(c.name) === n) || { ...FALLBACK, name }
}

/** Detecta a categoria pela descrição. Vence a palavra-chave mais longa ("mercado livre" > "mercado"). */
export function detectCategory(description: string, type: EntryType): string {
  const text = ` ${normalize(description).replace(/[^a-z0-9 ]/g, ' ')} `
  let best: { name: string; len: number } | null = null
  for (const c of allCategories()) {
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
  return allCategories().find((c) => normalize(c.name).startsWith(t) || normalize(c.name).replace(/\s+/g, '-').startsWith(t))?.name ?? null
}
