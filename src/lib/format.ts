const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const brlCompact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 })

export function formatBRL(value: number): string {
  return brl.format(value || 0)
}

/** R$ 1,2 mil — para eixos de gráfico */
export function formatBRLCompact(value: number): string {
  return Math.abs(value) < 1000 ? brl.format(Math.round(value)).replace(',00', '') : brlCompact.format(value)
}

export function formatPct(value: number): string {
  return `${Math.round(value)}%`
}
