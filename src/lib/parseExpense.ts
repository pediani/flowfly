/** "mercado 45,90" | "uber R$ 30" | "aluguel 1.234,56" → { description, amount } */
export function parseExpense(text: string): { description: string; amount: number } | null {
  const match = text.match(/^(.+?)\s+(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)$/i)
  if (!match) return null
 
  const description = match[1].trim()
  let raw = match[2]
  // Formato brasileiro com milhar: remove os pontos e troca vírgula por ponto
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(raw)) raw = raw.replace(/\./g, '')
  const amount = Math.round(parseFloat(raw.replace(',', '.')) * 100) / 100
 
  if (!description || !Number.isFinite(amount) || amount <= 0) return null
  return { description: description.slice(0, 200), amount }
}
 
