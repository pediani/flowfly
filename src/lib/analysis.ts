// Análises automáticas: assinaturas/recorrências, gastos fora do padrão, retrospectiva do mês e contexto para perguntas.
import { normalize } from './categories'
import { addDays, addMonths, daysInMonth, monthKeyOf, monthLabel, todayBR } from './dates'
import { formatBRL } from './format'
import { categoryBreakdown, summarize, type Budget, type Recurring, type Tx } from './finance'

const n = (v: unknown) => Number(v) || 0
const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)

/** Chave do "comerciante": "NETFLIX.COM 1234" e "Netflix" viram "netflix" */
export function merchantKey(description: string): string {
  const s = normalize(description)
    .replace(/\(\d+\/\d+\)/g, ' ')
    .replace(/https?:\/\/\S+|www\.\S+/g, ' ')
    .replace(/\.(com|br|net)\b/g, ' ')
    .replace(/[^a-z ]+/g, ' ')
    .replace(/\b(pg|pp|mp|ec|ifd|compra|pagamento|pix|enviado|para|de|do|da|no|na)\b/g, ' ')
    .replace(/\s+/g, ' ').trim()
  return s.split(' ').slice(0, 2).join(' ') || normalize(description).slice(0, 12)
}

// ---- Assinaturas ----

export type Subscription = {
  key: string
  name: string
  category: string | null
  amount: number          // última cobrança
  average: number
  monthly: number         // custo mensal estimado
  count: number
  lastDate: string
  nextDate: string
  cadenceDays: number
  increased: { from: number; to: number } | null
  duplicate: { date: string; amount: number } | null
  isRecurringRegistered: boolean
}

export function detectSubscriptions(txs: Tx[], recurring: Recurring[] = [], today = todayBR()): Subscription[] {
  const since = addDays(today, -400)
  const groups = new Map<string, Tx[]>()
  for (const t of txs) {
    if (t.type !== 'saida' || t.date < since || t.date > today) continue
    if ((t as Tx & { installment_total?: number | null }).installment_total) continue // parcelas não são assinatura
    const k = merchantKey(t.description)
    if (k.length < 3) continue
    groups.set(k, [...(groups.get(k) || []), t])
  }
  const out: Subscription[] = []
  for (const [key, list] of groups) {
    if (list.length < 2) continue
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date))
    // meses distintos com cobrança
    const months = new Set(sorted.map((t) => monthKeyOf(t.date)))
    if (months.size < 2) continue
    // assinatura cobra ~1 vez por mês; muitas compras no mesmo lugar (ex.: iFood) não são assinatura
    if (sorted.length / months.size > 1.6) continue
    const amounts = sorted.map((t) => n(t.amount))
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length
    // valores parecidos (±20%) = cobrança fixa, não compra avulsa
    const similar = amounts.filter((a) => Math.abs(a - avg) <= avg * 0.2).length / amounts.length
    if (similar < 0.75) continue
    const gaps = sorted.slice(1).map((t, i) => dayDiff(sorted[i].date, t.date)).filter((g) => g > 5)
    if (!gaps.length) continue
    const cadence = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
    if (cadence < 6 || cadence > 100) continue
    const last = sorted[sorted.length - 1]
    // compara com a cobrança do mês anterior (não com uma possível duplicada do mesmo mês)
    const prev = [...sorted].reverse().find((t) => monthKeyOf(t.date) !== monthKeyOf(last.date)) || sorted[sorted.length - 2]
    // duplicada: duas cobranças parecidas a menos de 5 dias
    let duplicate: Subscription['duplicate'] = null
    for (let i = 1; i < sorted.length; i++) {
      if (dayDiff(sorted[i - 1].date, sorted[i].date) <= 4 && Math.abs(n(sorted[i].amount) - n(sorted[i - 1].amount)) <= n(sorted[i].amount) * 0.05 && cadence > 20) {
        duplicate = { date: sorted[i].date, amount: n(sorted[i].amount) }
      }
    }
    const increased = n(last.amount) > n(prev.amount) * 1.04 && n(last.amount) - n(prev.amount) >= 1 ? { from: n(prev.amount), to: n(last.amount) } : null
    const registered = recurring.some((r) => r.type === 'saida' && merchantKey(r.description) === key)
    out.push({
      key, name: last.description.replace(/\s*\(\d+\/\d+\)$/, ''), category: last.category ?? null,
      amount: n(last.amount), average: Math.round(avg * 100) / 100,
      monthly: Math.round((avg * 30 / cadence) * 100) / 100,
      count: sorted.length, lastDate: last.date, nextDate: addDays(last.date, cadence), cadenceDays: cadence,
      increased, duplicate, isRecurringRegistered: registered,
    })
  }
  return out.sort((a, b) => b.monthly - a.monthly)
}

// ---- Fora do padrão ----

export type Anomaly = { key: string; title: string; text: string; level: 'warn' | 'info' }

/** Últimos 7 dias contra a média semanal das 8 semanas anteriores (por comerciante e por categoria) + gasto único muito alto. */
export function detectAnomalies(txs: Tx[], today = todayBR()): Anomaly[] {
  const out: Anomaly[] = []
  const weekStart = addDays(today, -6)
  const histStart = addDays(today, -62)
  const outs = txs.filter((t) => t.type === 'saida' && t.date >= histStart && t.date <= today)
  const recent = outs.filter((t) => t.date >= weekStart)
  const hist = outs.filter((t) => t.date < weekStart)
  if (!recent.length || hist.length < 5) return out

  const byKey = (list: Tx[], f: (t: Tx) => string) => {
    const m = new Map<string, { count: number; total: number; name: string }>()
    for (const t of list) { const k = f(t); const e = m.get(k) || { count: 0, total: 0, name: t.description }; e.count++; e.total += n(t.amount); m.set(k, e) }
    return m
  }
  const rM = byKey(recent, (t) => merchantKey(t.description))
  const hM = byKey(hist, (t) => merchantKey(t.description))
  for (const [k, r] of rM) {
    const h = hM.get(k)
    const weeklyAvg = (h?.count || 0) / 8
    if (r.count >= 3 && r.count >= Math.max(2, weeklyAvg * 2.5)) {
      out.push({ key: `freq:${k}`, level: 'warn', title: `${r.name}: ${r.count} vezes nesta semana`, text: `Você costuma ${weeklyAvg >= 0.5 ? `fazer ${weeklyAvg.toFixed(1).replace('.', ',')} por semana` : 'usar raramente'}. Total na semana: ${formatBRL(r.total)}.` })
    }
  }
  const rC = byKey(recent, (t) => t.category || 'Geral')
  const hC = byKey(hist, (t) => t.category || 'Geral')
  for (const [c, r] of rC) {
    const avg = (hC.get(c)?.total || 0) / 8
    if (avg > 30 && r.total >= avg * 2 && r.total - avg >= 80) {
      out.push({ key: `cat:${c}`, level: 'warn', title: `${c} acima do normal`, text: `${formatBRL(r.total)} nos últimos 7 dias, contra ${formatBRL(avg)} numa semana típica.` })
    }
  }
  // gasto único muito acima do habitual da categoria
  for (const t of recent) {
    const same = hist.filter((h) => h.category === t.category).map((h) => n(h.amount)).sort((a, b) => a - b)
    if (same.length < 4) continue
    const median = same[Math.floor(same.length / 2)]
    if (n(t.amount) >= median * 4 && n(t.amount) >= 150) {
      out.push({ key: `big:${t.id}`, level: 'info', title: `Gasto alto: ${t.description}`, text: `${formatBRL(n(t.amount))} em ${t.category}, quando o normal é ~${formatBRL(median)}.` })
    }
  }
  return out.slice(0, 5)
}

// ---- Retrospectiva ----

export type Recap = {
  key: string
  entradas: number; saidas: number; saldo: number
  prevSaidas: number
  savingsRate: number | null
  score: number
  topCategories: { category: string; total: number; delta: number | null }[]
  biggest: { description: string; amount: number; date: string }[]
  budgetsOk: number; budgetsTotal: number
  count: number
}

export function monthRecap(txs: Tx[], budgets: Budget[], key: string): Recap {
  const s = summarize(txs, key)
  const prevKey = addMonths(key, -1)
  const prev = summarize(txs, prevKey)
  const cats = categoryBreakdown(txs, key)
  const prevCats = Object.fromEntries(categoryBreakdown(txs, prevKey).map((c) => [c.category, c.total]))
  const budgetsOk = budgets.filter((b) => (cats.find((c) => c.category === b.category)?.total || 0) <= n(b.monthly_limit)).length
  const savingsRate = s.entradas > 0 ? (s.saldo / s.entradas) * 100 : null

  // Nota 0–10: poupança (até 5 pts), orçamentos (até 3 pts), gastos vs mês anterior (até 2 pts)
  let score = 0
  if (savingsRate !== null) score += Math.max(0, Math.min(5, (savingsRate / 20) * 5))
  else if (s.saidas === 0) score += 2.5
  score += budgets.length ? (budgetsOk / budgets.length) * 3 : 1.5
  score += prev.saidas > 0 ? (s.saidas <= prev.saidas ? 2 : s.saidas <= prev.saidas * 1.1 ? 1 : 0) : 1
  score = Math.round(Math.min(10, score) * 10) / 10

  const biggest = txsOfMonthLocal(txs, key).filter((t) => t.type === 'saida').sort((a, b) => n(b.amount) - n(a.amount)).slice(0, 3)
    .map((t) => ({ description: t.description, amount: n(t.amount), date: t.date }))

  return {
    key, entradas: s.entradas, saidas: s.saidas, saldo: s.saldo, prevSaidas: prev.saidas, savingsRate, score,
    topCategories: cats.slice(0, 5).map((c) => ({ category: c.category, total: c.total, delta: prevCats[c.category] ? ((c.total - prevCats[c.category]) / prevCats[c.category]) * 100 : null })),
    biggest, budgetsOk, budgetsTotal: budgets.length, count: s.count,
  }
}

function txsOfMonthLocal(txs: Tx[], key: string) { return txs.filter((t) => t.date.startsWith(key)) }

// ---- Contexto para perguntas (compacto: cabe no limite de tokens por minuto da Groq) ----

export function qaContext(txs: Tx[], budgets: Budget[], recurring: Recurring[], today = todayBR()): string {
  const cur = monthKeyOf(today)
  const keys = Array.from({ length: 6 }, (_, i) => addMonths(cur, i - 5))
  const lines: string[] = [`Hoje: ${today}. Valores em R$.`]
  lines.push('MESES (entradas | saídas | saldo | nº lançamentos):')
  for (const k of keys) { const s = summarize(txs, k); if (s.count) lines.push(`${k} (${monthLabel(k)}): ${s.entradas.toFixed(2)} | ${s.saidas.toFixed(2)} | ${s.saldo.toFixed(2)} | ${s.count}`) }
  lines.push('SAÍDAS POR CATEGORIA E MÊS:')
  const cats = new Set<string>()
  for (const k of keys) for (const c of categoryBreakdown(txs, k)) cats.add(c.category)
  for (const c of cats) lines.push(`${c}: ${keys.map((k) => `${k.slice(5)}=${(categoryBreakdown(txs, k).find((x) => x.category === c)?.total || 0).toFixed(0)}`).join(' ')}`)
  // comerciantes mais frequentes (6 meses)
  const from = `${keys[0]}-01`
  const m = new Map<string, { name: string; total: number; count: number; months: Record<string, number> }>()
  for (const t of txs) {
    if (t.type !== 'saida' || t.date < from || t.date > `${cur}-${daysInMonth(cur)}`) continue
    const k = merchantKey(t.description)
    const e = m.get(k) || { name: t.description.slice(0, 30), total: 0, count: 0, months: {} }
    e.total += n(t.amount); e.count++; e.months[t.date.slice(5, 7)] = (e.months[t.date.slice(5, 7)] || 0) + n(t.amount)
    m.set(k, e)
  }
  lines.push('PRINCIPAIS ESTABELECIMENTOS (total | vezes | por mês):')
  for (const [, e] of [...m.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 25)) {
    lines.push(`${e.name}: ${e.total.toFixed(2)} | ${e.count}x | ${Object.entries(e.months).map(([mm, v]) => `${mm}=${v.toFixed(0)}`).join(' ')}`)
  }
  if (budgets.length) lines.push(`ORÇAMENTOS MENSAIS: ${budgets.map((b) => `${b.category}=${n(b.monthly_limit)}`).join(', ')}`)
  if (recurring.length) lines.push(`CONTAS FIXAS: ${recurring.map((r) => `${r.description} (${r.type}, dia ${r.day_of_month}) ${n(r.amount)}`).join('; ')}`)
  lines.push('ÚLTIMOS 25 LANÇAMENTOS (data | tipo | valor | descrição | categoria):')
  for (const t of [...txs].filter((t) => t.date <= today).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25)) {
    lines.push(`${t.date} | ${t.type} | ${n(t.amount).toFixed(2)} | ${t.description.slice(0, 30)} | ${t.category || 'Geral'}`)
  }
  return lines.join('\n')
}
