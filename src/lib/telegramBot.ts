// Mensagens do bot (HTML do Telegram). Funções puras: o route.ts faz o I/O.
import { CATEGORIES, getCategory } from './categories'
import { formatBRL } from './format'
import { formatDateBR, formatDateTimeBR, monthLabel } from './dates'
import {
  budgetStatus, categoryBreakdown, monthProjection, summarize,
  type Budget, type Recurring, type Tx,
} from './finance'
import type { ParsedEntry } from './parseEntry'

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function bar(pct: number, size = 10): string {
  const filled = Math.max(0, Math.min(size, Math.round((pct / 100) * size)))
  return '▰'.repeat(filled) + '▱'.repeat(size - filled)
}

function signed(t: { type: string; amount: number }): string {
  return t.type === 'entrada' ? `+ ${formatBRL(t.amount)}` : `− ${formatBRL(t.amount)}`
}

function monthBlock(txs: Tx[], key: string, title: string): string {
  const s = summarize(txs, key)
  return [
    `📊 <b>${title}</b>`,
    `⬆️ Entradas: ${formatBRL(s.entradas)}`,
    `⬇️ Saídas: ${formatBRL(s.saidas)}`,
    `${s.saldo >= 0 ? '💰' : '🔻'} Saldo: <b>${formatBRL(s.saldo)}</b>`,
  ].join('\n')
}

function budgetLine(txs: Tx[], budgets: Budget[], key: string, category: string): string | null {
  const b = budgetStatus(txs, budgets.filter((x) => x.category === category), key)[0]
  if (!b) return null
  const icon = b.pct >= 100 ? '🚨' : b.pct >= 80 ? '⚠️' : '🎯'
  const extra = b.pct >= 100 ? ' — orçamento estourado!' : b.pct >= 80 ? ` — restam ${formatBRL(b.limit - b.spent)}` : ''
  return `${icon} Orçamento: ${bar(b.pct)} ${Math.round(b.pct)}% de ${formatBRL(b.limit)}${extra}`
}

export function savedMessage(
  entry: ParsedEntry, nowIso: string, monthTxs: Tx[], budgets: Budget[], key: string
): string {
  const cat = getCategory(entry.category)
  const isIn = entry.type === 'entrada'
  const catTotal = categoryBreakdown(monthTxs, key).find((c) => c.category === entry.category)?.total ?? 0

  const lines = [
    `✅ <b>${isIn ? 'Entrada' : 'Saída'} registrada</b>`,
    '',
    `${cat.emoji} <b>${escapeHtml(cap(entry.description))}</b>`,
    `<b>${signed(entry)}</b> · ${escapeHtml(entry.category)}`,
    `🕒 ${formatDateTimeBR(nowIso)}`,
    '',
    monthBlock(monthTxs, key, `${monthLabel(key)} até agora`),
  ]

  if (!isIn) {
    lines.push('', `${cat.emoji} ${escapeHtml(entry.category)} no mês: <b>${formatBRL(catTotal)}</b>`)
    const b = budgetLine(monthTxs, budgets, key, entry.category)
    if (b) lines.push(b)
  }

  lines.push('', entry.category === 'Geral' && !entry.categoryExplicit
    ? '💡 <i>Dica: classifique com #categoria, ex.: <code>s pizza 60 #lazer</code></i>'
    : '<i>Errou? Envie /desfazer</i>')
  return lines.join('\n')
}

export function summaryMessage(
  txs: Tx[], recurring: Recurring[], budgets: Budget[], key: string, today: string
): string {
  const s = summarize(txs, key)
  const mp = monthProjection(txs, recurring, key, today)
  const cats = categoryBreakdown(txs, key).slice(0, 6)
  const lines = [`🗓️ <b>Resumo de ${monthLabel(key, 'longYear')}</b>`, '', monthBlock(txs, key, 'Até hoje')]

  if (mp.isCurrent) {
    lines.push(
      '',
      `🔮 <b>Projeção de fechamento</b>`,
      `Saídas previstas: ${formatBRL(mp.projectedSaidas)}`,
      `Saldo previsto: <b>${formatBRL(mp.projectedSaldo)}</b> ${mp.projectedSaldo >= 0 ? '🟢' : '🔴'}`,
    )
    if (mp.remainingRecurring.length) {
      lines.push(`Contas fixas a vencer: ${mp.remainingRecurring.map((r) => `${escapeHtml(r.description)} (dia ${r.day_of_month})`).join(', ')}`)
    }
  }

  if (cats.length) {
    lines.push('', '🏷️ <b>Gastos por categoria</b>')
    for (const c of cats) lines.push(`${c.emoji} ${escapeHtml(c.category)}: ${formatBRL(c.total)} (${Math.round(c.pct)}%)`)
  }

  const bs = budgetStatus(txs, budgets, key)
  if (bs.length) {
    lines.push('', '🎯 <b>Orçamentos</b>')
    for (const b of bs) lines.push(`${getCategory(b.category).emoji} ${escapeHtml(b.category)} ${bar(b.pct, 8)} ${Math.round(b.pct)}%`)
  }

  if (s.aPagar > 0) lines.push('', `🤝 Pendente com parceiro: <b>${formatBRL(s.aPagar)}</b>`)
  if (!s.count) lines.push('', '<i>Nenhum lançamento neste mês ainda.</i>')
  return lines.join('\n')
}

export function lastEntriesMessage(txs: Tx[]): string {
  if (!txs.length) return '📭 Nenhum lançamento ainda. Experimente: <code>s café 8,50</code>'
  const lines = ['🧾 <b>Últimos lançamentos</b>', '']
  for (const t of txs) {
    const cat = getCategory(t.category)
    const when = t.created_at ? formatDateTimeBR(t.created_at) : formatDateBR(t.date)
    const via = t.source === 'telegram' ? ' · 📱' : ''
    const label = t.type === 'a_pagar' ? `⏳ ${formatBRL(t.amount)}` : signed(t)
    lines.push(`${cat.emoji} <b>${escapeHtml(cap(t.description))}</b> ${label}`, `<i>${when}${via}</i>`)
  }
  return lines.join('\n')
}

export function undoMessage(t: Tx, monthTxs: Tx[], key: string): string {
  return [
    `↩️ <b>Lançamento removido</b>`,
    '',
    `${getCategory(t.category).emoji} ${escapeHtml(cap(t.description))} · ${signed(t)}`,
    '',
    monthBlock(monthTxs, key, `${monthLabel(key)} atualizado`),
  ].join('\n')
}

export function helpMessage(): string {
  return [
    '⚡ <b>FlowFly</b> — seu financeiro no bolso',
    '',
    '<b>Registrar</b>',
    '• <code>s uber 50,40</code> → saída',
    '• <code>e salário 1000</code> → entrada',
    '• <code>mercado 120</code> → sem prefixo = saída',
    '• <code>pizza 60 #lazer</code> → força a categoria',
    '',
    '<b>Comandos</b>',
    '/resumo — balanço do mês e projeção',
    '/ultimos — últimos lançamentos',
    '/desfazer — remove o último lançamento feito aqui',
    '/ajuda — esta mensagem',
    '',
    `<b>Categorias:</b> ${CATEGORIES.map((c) => `${c.emoji} ${c.name}`).join(' · ')}`,
  ].join('\n')
}

export const INVALID_FORMAT =
  '🤔 Não entendi. Use <code>s descrição valor</code> ou <code>e descrição valor</code>.\nEx.: <code>s uber 50,40</code> · <code>e salário 1000</code>\n\nEnvie /ajuda para ver tudo.'
