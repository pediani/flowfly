const TIMEZONE = 'America/Sao_Paulo'
 
/** Data de hoje no horário de Brasília, no formato YYYY-MM-DD (coluna `date`). */
export function todayBR(): string {
  // en-CA formata como YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date())
}
 
/** "2026-10-06" → "06/10/2026", sem passar por Date (evita voltar um dia por causa do UTC). */
export function formatDateBR(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
