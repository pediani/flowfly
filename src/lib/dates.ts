export const TIMEZONE = 'America/Sao_Paulo'

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

/** Timestamp → data YYYY-MM-DD no horário de Brasília */
export function dateOfIsoBR(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date(iso))
}

/** Timestamp → "14:32" no horário de Brasília */
export function formatTimeBR(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

/** Timestamp → "06/10 às 14:32" */
export function formatDateTimeBR(iso: string): string {
  const d = new Intl.DateTimeFormat('pt-BR', { timeZone: TIMEZONE, day: '2-digit', month: '2-digit' }).format(new Date(iso))
  return `${d} às ${formatTimeBR(iso)}`
}

/** "agora", "há 5 min", "há 3 h", "ontem às 14:32", "06/10 às 14:32" */
export function relativeTimeBR(iso: string, now: Date = new Date()): string {
  const diffMin = Math.floor((now.getTime() - new Date(iso).getTime()) / 60000)
  if (diffMin < 1) return 'agora'
  if (diffMin < 60) return `há ${diffMin} min`
  if (diffMin < 6 * 60) return `há ${Math.floor(diffMin / 60)} h`
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date(iso))
  if (day === todayBR()) return `hoje às ${formatTimeBR(iso)}`
  if (day === addDays(todayBR(), -1)) return `ontem às ${formatTimeBR(iso)}`
  return formatDateTimeBR(iso)
}

/** Soma dias a uma data YYYY-MM-DD (aritmética em UTC, sem fuso). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** "2026-10-06" → "Hoje" | "Ontem" | "seg., 05 out." */
export function dayLabelBR(isoDate: string): string {
  const today = todayBR()
  if (isoDate === today) return 'Hoje'
  if (isoDate === addDays(today, -1)) return 'Ontem'
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short' })
    .format(new Date(Date.UTC(y, m - 1, d)))
}

// ---- Meses (chave "YYYY-MM") ----

export function monthKeyOf(isoDate: string): string {
  return isoDate.slice(0, 7)
}

export function currentMonthKey(): string {
  return monthKeyOf(todayBR())
}

export function addMonths(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export function daysInMonth(key: string): number {
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** "2026-10" → "Outubro" | "Outubro 2026" | "Out" */
export function monthLabel(key: string, style: 'long' | 'longYear' | 'short' = 'long'): string {
  const [y, m] = key.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, 15))
  const name = new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', month: style === 'short' ? 'short' : 'long' })
    .format(date).replace('.', '')
  const cap = name.charAt(0).toUpperCase() + name.slice(1)
  return style === 'longYear' ? `${cap} ${y}` : cap
}
