// Mensagens do bot (HTML do Telegram). Funções puras: o route.ts faz o I/O.
import { allCategories, getCategory } from './categories'
import { formatBRL } from './format'
import { dateOfIsoBR, formatDateBR, formatDateTimeBR, monthLabel } from './dates'
import {
  budgetStatus, categoryBreakdown, monthProjection, summarize,
  type Budget, type Recurring, type Tx,
} from './finance'
import { installmentDate, splitInstallments, type ParsedEntry } from './parseEntry'

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
  entry: ParsedEntry, nowIso: string, monthTxs: Tx[], budgets: Budget[], key: string, opts: { compact?: boolean; index?: string } = {}
): string {
  const cat = getCategory(entry.category)
  const isIn = entry.type === 'entrada'
  const catTotal = categoryBreakdown(monthTxs, key).find((c) => c.category === entry.category)?.total ?? 0

  const parcel = entry.installments > 1
  const lines = [
    `✅ <b>${isIn ? 'Entrada' : 'Saída'} registrada</b>`,
    '',
    `${cat.emoji} <b>${escapeHtml(cap(entry.description))}</b>`,
    `<b>${signed(entry)}</b> · ${escapeHtml(entry.category)}`,
    entry.date === dateOfIsoBR(nowIso)
      ? `🕒 ${formatDateTimeBR(nowIso)}`
      : `📅 ${formatDateBR(entry.date)} <i>(registrado ${formatDateTimeBR(nowIso)})</i>`,
  ]
  if (entry.tags?.length) lines.push(`🏷️ ${entry.tags.map((t) => `@${escapeHtml(t)}`).join(' ')}`)
  if (entry.bankAccount) lines.push(`💳 ${entry.bankAccount === 'Cartão' ? 'No cartão' : `Cartão ${escapeHtml(entry.bankAccount.replace(' · Cartão', '').replace(/ (\d{4})$/, ' ·$1'))}`} · entra na fatura`)
  else if (entry.payment?.method === 'debito') lines.push('💸 Débito/Pix')
  if (parcel) {
    const parts = splitInstallments(entry.amount, entry.installments)
    lines.push(`💳 ${entry.installments}x de ${formatBRL(parts[1])} · última em ${formatDateBR(installmentDate(entry.date, entry.installments - 1))}`)
  }
  // Vários lançamentos na mesma mensagem: cada um sai enxuto e o resumo do mês vem no fim
  if (opts.compact) {
    if (opts.index) lines[0] = `${lines[0]} <i>(${opts.index})</i>`
    return lines.join('\n')
  }
  lines.push('', monthBlock(monthTxs, key, `${monthLabel(key)} até agora`))

  if (!isIn) {
    lines.push('', `${cat.emoji} ${escapeHtml(entry.category)} no mês: <b>${formatBRL(catTotal)}</b>`)
    const b = budgetLine(monthTxs, budgets, key, entry.category)
    if (b) lines.push(b)
  }

  if (entry.category === 'Geral' && !entry.categoryExplicit) lines.push('', '💡 <i>Use o botão “Categoria” abaixo para classificar.</i>')
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

export function multiSummaryMessage(count: number, monthTxs: Tx[], key: string): string {
  return [`🧾 <b>${count} lançamentos registrados</b>`, '', monthBlock(monthTxs, key, `${monthLabel(key)} até agora`), '', '<i>Use os botões de cada um para ajustar ou desfazer.</i>'].join('\n')
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

export function helpMessage(voice = false): string {
  return [
    '💜 <b>FlowNanças</b> — seu financeiro no bolso',
    '',
    '<b>Registrar</b>',
    '• <code>s uber 50,40</code> → saída',
    '• <code>e salário 1000</code> → entrada',
    '• <code>mercado 120 ontem</code> → com data (<code>ontem</code>, <code>dia 3</code>, <code>05/10</code>)',
    '• <code>s tv 1200 10x</code> → parcelado (cria as 10 parcelas)',
    '• <code>s camisa 120 cartao</code> → no cartão (pergunto qual) · <code>s camisa 120 cartao santander</code> → direto · <code>s uber 30 pix</code> → débito',
    '• <code>pizza 60 #lazer</code> → força a categoria',
    '• <code>jantar 120 @viagem-rio</code> → marca um evento (veja o total no painel)',
    '• 📷 Mande a <b>foto de um comprovante</b> ou nota e eu lanço',
    ...(voice ? ['• 🎙️ Mande um <b>áudio</b> ou escreva livre: “gastei 45 no mercado ontem”, “paguei 200 de luz dia 5”, “pizza 60 sexta passada”'] : []),
    '',
    'Depois de registrar, use os botões para trocar a categoria, mudar para ontem, dividir ou desfazer.',
    '',
    '<b>Comandos</b>',
    '/hoje — quanto você pode gastar até o próximo recebimento',
    '/posso 2400 10x — simula uma compra',
    '/resumo — balanço do mês e projeção',
    '/semana — resumo dos últimos 7 dias',
    '/mes — retrospectiva do mês (/mes anterior)',
    '/assinaturas — cobranças recorrentes e aumentos',
    '/p quanto gastei de ifood? — pergunte às suas finanças (ou termine a mensagem com ?)',
    '/ultimos — últimos lançamentos',
    '/desfazer — remove o último lançamento feito aqui',
    '/ajuda — esta mensagem',
    '',
    '⏰ Todo dia às 9h aviso as contas fixas que vencem e, aos domingos, mando o resumo da semana.',
  ].join('\n')
}

// ---- Botões (inline keyboards) ----

export type InlineButton = { text: string; callback_data: string }
export type Keyboard = { inline_keyboard: InlineButton[][] }

export function entryKeyboard(txId: string, opts: { canSplit: boolean; isIn: boolean }): Keyboard {
  const row1: InlineButton[] = [{ text: '🏷️ Categoria', callback_data: `c:${txId}` }, { text: '📅 Foi ontem', callback_data: `y:${txId}` }]
  const row2: InlineButton[] = [{ text: '↩️ Desfazer', callback_data: `u:${txId}` }]
  if (opts.canSplit && !opts.isIn) row2.unshift({ text: '👥 Dividir 50%', callback_data: `d:${txId}` })
  if (!opts.isIn) row1.push({ text: '💳 Cartão', callback_data: `K:${txId}` })
  return { inline_keyboard: [row1, row2] }
}

/** Escolha do cartão (k:<id>:<índice> · k:<id>:x = débito/Pix) */
export function cardChoiceKeyboard(txId: string, cards: { label: string; institution: string; last4: string; name: string }[], back = false): Keyboard {
  const rows: InlineButton[][] = []
  cards.forEach((c, i) => {
    if (i % 2 === 0) rows.push([])
    rows[rows.length - 1].push({ text: `💳 ${c.institution}${c.last4 ? ` ·${c.last4}` : ''}`, callback_data: `k:${txId}:${i}${back ? '' : ':p'}` })
  })
  rows.push([{ text: '💸 Débito/Pix', callback_data: `k:${txId}:x${back ? '' : ':p'}` }, ...(back ? [{ text: '← Voltar', callback_data: `b:${txId}` }] : [])])
  return { inline_keyboard: rows }
}

export function categoryKeyboard(txId: string): Keyboard {
  const rows: InlineButton[][] = []
  allCategories().forEach((c, i) => {
    if (i % 2 === 0) rows.push([])
    rows[rows.length - 1].push({ text: `${c.emoji} ${c.name}`, callback_data: `s:${txId}:${i}` })
  })
  rows.push([{ text: '← Voltar', callback_data: `b:${txId}` }])
  return { inline_keyboard: rows }
}

// ---- Mensagens automáticas (cron) ----

export function reminderMessage(items: { r: Recurring; when: 'hoje' | 'amanhã' }[]): { text: string; keyboard: Keyboard } {
  const lines = ['⏰ <b>Contas fixas chegando</b>', '']
  for (const { r, when } of items) {
    lines.push(`${r.type === 'entrada' ? '💼' : '🧾'} <b>${escapeHtml(r.description)}</b> — ${formatBRL(Number(r.amount))} · vence <b>${when}</b> (dia ${r.day_of_month})`)
  }
  lines.push('', '<i>Toque em “Paguei” para lançar.</i>')
  return {
    text: lines.join('\n'),
    keyboard: { inline_keyboard: items.map(({ r }) => [{ text: `✅ ${r.type === 'entrada' ? 'Recebi' : 'Paguei'}: ${r.description.slice(0, 24)}`, callback_data: `p:${r.id}` }]) },
  }
}

export function weeklyMessage(txs: Tx[], from: string, to: string): string {
  const week = txs.filter((t) => t.date >= from && t.date <= to)
  const entradas = week.filter((t) => t.type === 'entrada').reduce((a, t) => a + Number(t.amount), 0)
  const saidas = week.filter((t) => t.type === 'saida').reduce((a, t) => a + Number(t.amount), 0)
  const byCat: Record<string, number> = {}
  for (const t of week) if (t.type === 'saida') byCat[t.category || 'Geral'] = (byCat[t.category || 'Geral'] || 0) + Number(t.amount)
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 4)
  const biggest = week.filter((t) => t.type === 'saida').sort((a, b) => Number(b.amount) - Number(a.amount))[0]

  const lines = [
    `🗞️ <b>Sua semana</b> (${formatDateBR(from).slice(0, 5)} a ${formatDateBR(to).slice(0, 5)})`,
    '',
    `⬆️ Entradas: ${formatBRL(entradas)}`,
    `⬇️ Saídas: ${formatBRL(saidas)}`,
    `${entradas - saidas >= 0 ? '💰' : '🔻'} Saldo da semana: <b>${formatBRL(entradas - saidas)}</b>`,
    `🧾 ${week.length} lançamento${week.length === 1 ? '' : 's'}`,
  ]
  if (top.length) {
    lines.push('', '🏷️ <b>O que mais pesou</b>')
    for (const [c, v] of top) lines.push(`${getCategory(c).emoji} ${escapeHtml(c)}: ${formatBRL(v)}`)
  }
  if (biggest) lines.push('', `🔝 Maior gasto: ${escapeHtml(cap(biggest.description))} (${formatBRL(Number(biggest.amount))})`)
  if (!week.length) lines.push('', '<i>Nenhum lançamento nesta semana. Que tal registrar os gastos de hoje?</i>')
  return lines.join('\n')
}

export function budgetAlertMessage(category: string, spent: number, limit: number, level: number): string {
  const def = getCategory(category)
  return level >= 100
    ? `🚨 <b>Orçamento de ${escapeHtml(category)} estourado</b>\n${def.emoji} ${formatBRL(spent)} de ${formatBRL(limit)} (${Math.round((spent / limit) * 100)}%)`
    : `⚠️ <b>${escapeHtml(category)} chegou a ${Math.round((spent / limit) * 100)}% do orçamento</b>\n${def.emoji} ${formatBRL(spent)} de ${formatBRL(limit)} · restam ${formatBRL(limit - spent)}`
}

export const INVALID_FORMAT =
  '🤔 Não entendi. Use <code>s descrição valor</code> ou <code>e descrição valor</code>.\nEx.: <code>s uber 50,40</code> · <code>e salário 1000</code> · <code>mercado 80 ontem</code>\n\nEnvie /ajuda para ver tudo.'

// ---- Quanto posso gastar ----

export function todayMessage(safe: import('./safeToSpend').SafeToSpend, best: import('./safeToSpend').CardPick | null): string {
  const d5 = (iso: string) => formatDateBR(iso).slice(0, 5)
  const lines = safe.available >= 0
    ? [`💸 <b>Você pode gastar ${formatBRL(safe.available)}</b>`, `até ${d5(safe.until)}${safe.nextIncome ? ` (véspera de ${escapeHtml(safe.nextIncome.label)})` : ''} · ~<b>${formatBRL(safe.perDay)}/dia</b>`]
    : [`🚨 <b>Faltam ${formatBRL(-safe.available)}</b> para cobrir tudo até ${d5(safe.until)}`]
  if (safe.shortfall) lines.push(`⚠️ Em ${d5(safe.shortfall.date)} o saldo fica em ${formatBRL(safe.shortfall.value)}.`)
  else if (safe.safeNow < safe.available) { const n = safe.flow.events.find((e) => e.amount > 0); lines.push(`⏳ Agora, use no máximo <b>${formatBRL(Math.max(0, safe.safeNow))}</b>; o resto depende do que vai entrar${n ? ` (${escapeHtml(n.label)} em ${d5(n.date)})` : ''}.`) }
  lines.push(
    '',
    `🏦 No banco: ${formatBRL(safe.bankBalance)}`,
    ...(safe.unsyncedCount ? [`📱 Lançado depois: ${formatBRL(safe.unsynced)} (${safe.unsyncedCount})`] : []),
    `⬆️ Entra até ${d5(safe.until)}: ${formatBRL(safe.incoming)}`,
    `⬇️ Sai até ${d5(safe.until)}: ${formatBRL(-safe.outgoing)}`,
    `📉 Menor saldo: ${formatBRL(safe.flow.min.value)} em ${d5(safe.flow.min.date)}`,
  )
  const next = safe.flow.events.slice(0, 5)
  if (next.length) {
    lines.push('', '<b>Próximos</b>')
    for (const e of next) lines.push(`${d5(e.date)} ${e.kind === 'fatura' ? '💳' : e.amount > 0 ? '⬆️' : '⬇️'} ${escapeHtml(e.label)} ${e.amount > 0 ? '+' : '−'}${formatBRL(Math.abs(e.amount))}`)
  }
  if (best) lines.push('', `💳 Comprando no cartão hoje, use o <b>${escapeHtml(best.institution)} ·${best.last4}</b> (vence ${d5(best.due)}).`)
  lines.push('', '<i>Simule uma compra: /posso 2400 10x</i>')
  return lines.join('\n')
}

export function canBuyMessage(amount: number, installments: number, card: import('./safeToSpend').CardPick | null, before: import('./safeToSpend').SafeToSpend, after: import('./safeToSpend').SafeToSpend): string {
  const d5 = (iso: string) => formatDateBR(iso).slice(0, 5)
  const how = card ? `${installments > 1 ? `${installments}x de ${formatBRL(amount / installments)}` : 'à vista'} no ${escapeHtml(card.institution)} ·${card.last4} (1ª fatura ${d5(card.due)})` : 'à vista (Pix/débito)'
  return after.available >= 0 && after.safeNow >= 0
    ? [`✅ <b>Cabe!</b> Compra de ${formatBRL(amount)} ${how}.`, '', `Depois dela, você ainda pode gastar <b>${formatBRL(after.available)}</b> até ${d5(after.until)} (hoje: ${formatBRL(before.available)}).`].join('\n')
    : [`⚠️ <b>Não cabe agora.</b> Compra de ${formatBRL(amount)} ${how}.`, '', `Faltariam <b>${formatBRL(-Math.min(after.available, after.safeNow))}</b>${after.shortfall ? ` — o saldo ficaria em ${formatBRL(after.shortfall.value)} em ${d5(after.shortfall.date)}` : ''}.`].join('\n')
}

// ---- Assinaturas, fora do padrão, retrospectiva ----

export function subscriptionsMessage(subs: import('./analysis').Subscription[]): string {
  if (!subs.length) return '🔁 Não encontrei cobranças recorrentes ainda. Elas aparecem depois de 2 meses de lançamentos (do banco ou do Telegram).'
  const total = subs.reduce((s, x) => s + x.monthly, 0)
  const lines = [`🔁 <b>Assinaturas e cobranças recorrentes</b>`, `≈ <b>${formatBRL(total)}/mês</b> em ${subs.length} serviço(s)`, '']
  for (const s of subs.slice(0, 15)) {
    const flags = [s.increased ? `📈 subiu de ${formatBRL(s.increased.from)}` : '', s.duplicate ? `⚠️ cobrança duplicada em ${formatDateBR(s.duplicate.date).slice(0, 5)}` : ''].filter(Boolean).join(' · ')
    lines.push(`• <b>${escapeHtml(s.name)}</b> ${formatBRL(s.amount)} · próxima ~${formatDateBR(s.nextDate).slice(0, 5)}${flags ? `\n   ${flags}` : ''}`)
  }
  lines.push('', '<i>Cancelou algo? Ignore a próxima cobrança pelo botão quando ela chegar.</i>')
  return lines.join('\n')
}

export function subscriptionAlert(s: import('./analysis').Subscription, kind: 'aumento' | 'duplicada'): string {
  return kind === 'aumento'
    ? `📈 <b>${escapeHtml(s.name)} ficou mais cara</b>\nDe ${formatBRL(s.increased!.from)} para ${formatBRL(s.increased!.to)} (+${formatBRL(s.increased!.to - s.increased!.from)}/mês).`
    : `⚠️ <b>Possível cobrança duplicada: ${escapeHtml(s.name)}</b>\n${formatBRL(s.duplicate!.amount)} em ${formatDateBR(s.duplicate!.date)}, poucos dias depois de outra igual. Vale conferir com o banco.`
}

export function anomalyAlert(a: import('./analysis').Anomaly): string {
  return `${a.level === 'warn' ? '👀' : '💡'} <b>${escapeHtml(a.title)}</b>\n${escapeHtml(a.text)}`
}

export function recapMessage(r: import('./analysis').Recap, goals: { title: string; saved_amount: number; target_amount: number }[] = []): string {
  const stars = '★'.repeat(Math.round(r.score / 2)) + '☆'.repeat(5 - Math.round(r.score / 2))
  const delta = r.prevSaidas ? ((r.saidas - r.prevSaidas) / r.prevSaidas) * 100 : null
  const lines = [
    `📅 <b>Retrospectiva de ${monthLabel(r.key, 'longYear')}</b>`,
    `Nota do mês: <b>${String(r.score).replace('.', ',')}/10</b> ${stars}`,
    '',
    `⬆️ Entrou ${formatBRL(r.entradas)}`,
    `⬇️ Saiu ${formatBRL(r.saidas)}${delta !== null ? ` (${delta > 0 ? '+' : ''}${Math.round(delta)}% vs mês anterior)` : ''}`,
    `${r.saldo >= 0 ? '💰' : '🔻'} Sobrou <b>${formatBRL(r.saldo)}</b>${r.savingsRate !== null ? ` (${Math.round(r.savingsRate)}% do que entrou)` : ''}`,
  ]
  if (r.topCategories.length) {
    lines.push('', '🏷️ <b>Onde mais gastou</b>')
    for (const c of r.topCategories) lines.push(`${getCategory(c.category).emoji} ${escapeHtml(c.category)}: ${formatBRL(c.total)}${c.delta !== null ? ` (${c.delta > 0 ? '↑' : '↓'}${Math.abs(Math.round(c.delta))}%)` : ''}`)
  }
  if (r.biggest.length) {
    lines.push('', '🔝 <b>Maiores gastos</b>')
    for (const b of r.biggest) lines.push(`${formatDateBR(b.date).slice(0, 5)} ${escapeHtml(b.description)} — ${formatBRL(b.amount)}`)
  }
  if (r.budgetsTotal) lines.push('', `🎯 Orçamentos respeitados: ${r.budgetsOk}/${r.budgetsTotal}`)
  if (goals.length) {
    lines.push('', '🚩 <b>Metas</b>')
    for (const g of goals.slice(0, 4)) lines.push(`${escapeHtml(g.title)}: ${Math.round((Number(g.saved_amount) / Math.max(1, Number(g.target_amount))) * 100)}%`)
  }
  lines.push('', r.score >= 8 ? '🌟 Mês excelente, continue assim!' : r.score >= 5 ? '👍 Bom mês. Dá para melhorar nas categorias que subiram.' : '💪 Mês puxado. Que tal definir orçamentos para as categorias que mais pesaram?')
  return lines.join('\n')
}
