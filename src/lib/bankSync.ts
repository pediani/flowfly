// Sincroniza lançamentos do banco (Pluggy) com o FlowNanças, juntando com o que já foi registrado à mão.
import { detectCategory, getCategory, normalize } from './categories'
import { addDays, formatDateBR, todayBR } from './dates'
import { formatBRL } from './format'
import { TX_COLS, loadUserCategories, type Db, type TxRow } from './botData'
import { classifyWithAI, loadRules, ruleKey } from './aiCategorize'
import { getItem, listAccounts, listTransactions, type PluggyAccount, type PluggyTx } from './pluggy'
import { escapeHtml, type Keyboard } from './telegramBot'
import { sendMessage } from './telegramApi'

export type BankConnection = { id: string; user_id: string; item_id: string; institution: string | null; last_sync_at: string | null; created_at?: string | null }

// Movimentações que não são gasto/receita de verdade (evita contar duas vezes)
const SKIP_CATEGORY = /credit card payment|same person|transfer.*(own|same)|investment|savings/i
const SKIP_DESC = /(pagamento|pgto|pag)\.?\s*(de\s*)?(da\s*)?fatura|pagto\.? cart|aplica[cç][aã]o|resgate|transf.*mesma titularidade/i

export function shouldSkip(t: PluggyTx, account: PluggyAccount): boolean {
  if (SKIP_CATEGORY.test(t.category || '')) return true
  // transferência para você mesmo (outra conta sua): o nome do titular aparece na descrição
  if (account.owner) {
    const parts = normalize(account.owner).split(/\s+/).filter((w) => w.length > 2)
    const d = normalize(`${t.description} ${t.descriptionRaw || ''}`)
    if (parts.length >= 2 && d.includes(parts[0]) && d.includes(parts[parts.length - 1])) return true
  }
  const d = `${t.description} ${t.descriptionRaw || ''}`
  if (SKIP_DESC.test(d)) return true
  // No cartão, crédito "pagamento recebido" é o pagamento da fatura
  if (account.type === 'CREDIT' && t.type === 'CREDIT' && /pagamento|pgto/i.test(d)) return true
  return false
}

/** "COMPRA CARTAO - PADARIA SAO JOSE 07/10" → "Padaria São José" (o melhor possível) */
export function cleanDescription(t: PluggyTx): string {
  const base = t.merchant?.name || t.merchant?.businessName || t.description || t.descriptionRaw || 'Lançamento do banco'
  const s = base
    .replace(/^(compra( no)?( cart[aã]o)?( de)?( d[eé]bito| cr[eé]dito)?|pix (enviado|recebido)( para| de)?|transf(er[eê]ncia)? (enviada|recebida)|(ted|doc) (enviada|recebida|enviado|recebido)|pagamento( de)?|d[eé]bito autom[aá]tico)\s*[-:]?\s*/i, '')
    .replace(/^(ifd|pg|pp|mp|ec|sum|pag)\s*\*/i, '') // prefixos de maquininha (IFD*, PG*, MP*)
    .replace(/\*/g, ' ')
    .replace(/\b\d{2}\/\d{2}(\/\d{2,4})?\b/g, '')
    .split(/\s+/)
    .filter((w, i, all) => !(all.length > 1 && /\.(com|br|net)/i.test(w)) && !(all.length > 1 && i > 0 && /^\d+$/.test(w)) && !/^(ltda|me|eireli|s\/?a)$/i.test(w))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  const nice = (s || base).toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())
  return nice.slice(0, 120)
}

const CAT_MAP: [RegExp, string][] = [
  [/food|grocer|restaurant|eating|bakery|deliver/i, 'Alimentação'],
  [/transport|taxi|ride|gas station|fuel|parking|toll|automotive|vehicle/i, 'Transporte'],
  [/housing|rent|utilit|electric|water|internet|telecom|home/i, 'Casa'],
  [/leisure|entertain|travel|bar|hotel|tourism|culture/i, 'Lazer'],
  [/health|pharm|drug|hospital|clinic|gym|wellness/i, 'Saúde'],
  [/digital service|subscription|stream|software/i, 'Assinaturas'],
  [/shopping|clothing|electronic|online|store|retail/i, 'Compras'],
  [/education|school|course|book/i, 'Educação'],
  [/income|salary|wage|refund|cashback|interest/i, 'Renda'],
]

export function mapCategory(t: PluggyTx, description: string, type: 'entrada' | 'saida'): string {
  const ours = detectCategory(`${description} ${t.description}`, type)
  if (ours !== 'Geral' && ours !== 'Renda') return ours
  for (const [re, cat] of CAT_MAP) if (re.test(t.category || '')) return type === 'entrada' && cat !== 'Renda' ? 'Renda' : cat
  return ours
}

function dayDiff(a: string, b: string): number {
  return Math.abs((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000)
}

const BANKS: [RegExp, string][] = [
  [/ita[uú]|personnalit|uniclass/i, 'Itaú'],
  [/santander/i, 'Santander'],
  [/mercado\s?pago|mercadopago/i, 'Mercado Pago'],
  [/nubank|nu pagamentos|ultravioleta/i, 'Nubank'],
  [/bradesco/i, 'Bradesco'],
  [/banco do brasil|ourocard/i, 'Banco do Brasil'],
  [/caixa/i, 'Caixa'],
  [/\binter\b/i, 'Inter'],
  [/\bc6\b/i, 'C6 Bank'],
  [/\bbtg\b/i, 'BTG Pactual'],
  [/\bxp\b/i, 'XP'],
  [/picpay/i, 'PicPay'],
  [/pagbank|pagseguro/i, 'PagBank'],
  [/sicoob/i, 'Sicoob'],
  [/sicredi/i, 'Sicredi'],
  [/\bneon\b/i, 'Neon'],
]

const GENERIC_CONNECTOR = /meu\s?pluggy/i

/** Descobre o banco pelos nomes das contas/cartões (o conector MeuPluggy não informa o banco). */
export function detectInstitution(accounts: PluggyAccount[]): string | null {
  const text = accounts.map((a) => `${a.marketingName || ''} ${a.name || ''}`).join(' ')
  for (const [re, name] of BANKS) if (re.test(text)) return name
  return null
}

/** Nome a usar: o que o usuário definiu > banco detectado > nome do conector (se não for genérico). */
export function resolveInstitution(current: string | null, connectorName: string | undefined, accounts: PluggyAccount[]): string | null {
  if (current && !GENERIC_CONNECTOR.test(current)) return current
  return detectInstitution(accounts) || (connectorName && !GENERIC_CONNECTOR.test(connectorName) ? connectorName : current || connectorName || null)
}

/** Atualiza o rótulo "Banco · Cartão 1234" dos lançamentos já importados desta conexão. */
export async function relabel(db: Db, userId: string, accounts: PluggyAccount[], from: string | null, to: string | null) {
  if (!from || from === to) return
  for (const a of accounts) {
    await db.from('transactions').update({ bank_account: accountLabel(to, a) })
      .eq('user_id', userId).eq('bank_account', accountLabel(from, a))
  }
}

export function accountLabel(institution: string | null, a: PluggyAccount): string {
  const kind = a.type === 'CREDIT' ? 'Cartão' : 'Conta'
  return `${institution || 'Banco'} · ${kind}${a.number ? ` ${String(a.number).slice(-4)}` : ''}`
}

export type SyncResult = { imported: TxRow[]; matched: number; skipped: number; institution: string | null }

export async function syncConnection(db: Db, conn: BankConnection, opts: { initialDays?: number } = {}): Promise<SyncResult> {
  await loadUserCategories(db, conn.user_id)
  const item = await getItem(conn.item_id)
  const accounts = await listAccounts(conn.item_id)
  const institution = resolveInstitution(conn.institution, item.connector?.name, accounts)
  // Transferências entre contas suas importadas antes desta regra: marca como ignoradas
  const owner = accounts.find((a) => a.owner)?.owner
  if (owner) {
    const parts = normalize(owner).split(/\s+/).filter((w) => w.length > 2)
    if (parts.length >= 2) {
      await db.from('transactions').update({ type: 'ignorado' })
        .eq('user_id', conn.user_id).eq('source', 'bank').in('type', ['saida', 'entrada'])
        .ilike('description', `%${parts[0]}%${parts[parts.length - 1]}%`)
    }
  }
  // Corrige lançamentos importados antes com o nome genérico ("MeuPluggy · Conta 1234")
  if (conn.institution !== institution) await relabel(db, conn.user_id, accounts, conn.institution, institution)

  // Nunca importa nada anterior a 30 dias antes da conexão. Sem isso, como a Pluggy "cria" todo o
  // histórico (até 12 meses) no dia em que o banco é conectado, o filtro por createdAt traria tudo.
  const connectedOn = conn.created_at ? conn.created_at.slice(0, 10) : todayBR()
  const floor = addDays(connectedOn, -(opts.initialDays ?? 30))
  // Depois da 1ª sincronização: janela dos últimos 45 dias inteira. Assim dá para ver compras que saíram de
  // "pendente" para "lançada" (o banco troca o id e corrige a data para a data real da compra).
  const windowStart = conn.last_sync_at ? (addDays(todayBR(), -45) > floor ? addDays(todayBR(), -45) : floor) : floor

  const incoming: { t: PluggyTx; a: PluggyAccount }[] = []
  for (const a of accounts) for (const t of await listTransactions(a.id, { dateFrom: windowStart })) if (t.date.slice(0, 10) >= floor) incoming.push({ t, a })

  const result: SyncResult = { imported: [], matched: 0, skipped: 0, institution }
  if (conn.last_sync_at && incoming.length) await reconcile(db, conn.user_id, institution, accounts, incoming, windowStart)
  if (incoming.length) {
    // Já importados antes
    const ids = incoming.map(({ t }) => t.id)
    const known = new Set<string>()
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db.from('transactions').select('external_id').in('external_id', ids.slice(i, i + 200))
      for (const r of data || []) known.add(r.external_id)
    }

    // Candidatos para juntar: lançamentos manuais sem vínculo no período
    const dates = incoming.map(({ t }) => t.date.slice(0, 10)).sort()
    const { data: manual } = await db.from('transactions').select(TX_COLS + ', external_id')
      .eq('user_id', conn.user_id).is('external_id', null).in('source', ['web', 'telegram'])
      .gte('date', addDays(dates[0], -35)).lte('date', addDays(dates[dates.length - 1], 7))
    const candidates = ((manual || []) as unknown as (TxRow & { external_id: string | null })[])
    const used = new Set<string>()

    const toInsert: Record<string, unknown>[] = []
    for (const { t, a } of incoming.sort((x, y) => x.t.date.localeCompare(y.t.date))) {
      if (known.has(t.id)) continue
      if (shouldSkip(t, a)) { result.skipped++; continue }
      const type: 'entrada' | 'saida' = t.type === 'CREDIT' ? 'entrada' : 'saida'
      const amount = Math.round(Math.abs(Number(t.amount)) * 100) / 100
      const date = t.date.slice(0, 10)
      const label = accountLabel(institution, a)

      // Lançado à mão no cartão: só junta com o mesmo cartão (ou "Cartão" sem nome); compra pendente pode vir com
      // a data da atualização (até 7 dias) e parcelas futuras chegam no início do ciclo (até 35 dias)
      const onCard = a.type === 'CREDIT'
      const match = candidates.find((c) => {
        if (used.has(c.id) || c.type !== type || Math.abs(Number(c.amount) - amount) >= 0.01) return false
        const cAcc = c.bank_account || ''
        const cCard = /Cart[aã]o/.test(cAcc)
        if (cCard !== onCard && cAcc) return false
        if (cCard && cAcc !== 'Cartão' && cAcc !== label && !cAcc.startsWith(`${institution} `)) return false
        const max = cCard ? ((c.installment_no || 1) > 1 ? 35 : 7) : 3
        return dayDiff(c.date, date) <= max
      })
      if (match) {
        used.add(match.id)
        await db.from('transactions').update({ external_id: t.id, bank_description: t.descriptionRaw || t.description, bank_account: label }).eq('id', match.id)
        result.matched++
        continue
      }
      const description = cleanDescription(t)
      const meta = t.creditCardMetadata
      toInsert.push({
        user_id: conn.user_id, amount, type, date, description, source: 'bank', is_split: false,
        category: mapCategory(t, description, type), category_by: 'auto', _hint: t.category || null,
        external_id: t.id, bank_description: t.descriptionRaw || t.description, bank_account: label,
        ...(meta?.totalInstallments && meta.totalInstallments > 1 ? { installment_no: meta.installmentNumber, installment_total: meta.totalInstallments } : {}),
      })
    }
    if (toInsert.length) {
      await categorizeNew(db, conn.user_id, toInsert)
      let { data, error } = await db.from('transactions').insert(toInsert).select(TX_COLS)
      if (error && /category_by/.test(error.message)) {   // migração 20261015 ainda não rodada
        for (const r of toInsert) delete r.category_by
        ;({ data, error } = await db.from('transactions').insert(toInsert).select(TX_COLS))
      }
      if (error) throw new Error(`Erro ao gravar lançamentos do banco: ${error.message}`)
      result.imported = (data || []) as TxRow[]
    }
  }

  await db.from('bank_connections').update({ last_sync_at: new Date().toISOString(), institution, status: item.status }).eq('id', conn.id)
  return result
}

/** Categoria dos novos: regra que você ensinou > IA > regra fixa (palavras-chave + categoria da Pluggy). */
async function categorizeNew(db: Db, userId: string, rows: Record<string, unknown>[]) {
  const rules = await loadRules(db, userId)
  const pending: Record<string, unknown>[] = []
  for (const r of rows) {
    const rule = rules.get(ruleKey(String(r.description), r.bank_description as string | null))
    if (rule) { r.category = rule; r.category_by = 'rule' } else pending.push(r)
  }
  const examples = [...rules.entries()]
  for (let i = 0; i < pending.length && i < 120; i += 40) {
    const batch = pending.slice(i, i + 40)
    const { categories, retryAfterMs } = await classifyWithAI(batch.map((r) => ({
      description: String(r.description), bankDescription: r.bank_description as string | null, amount: Number(r.amount),
      type: r.type as 'entrada' | 'saida', hint: r._hint as string | null, account: r.bank_account as string | null,
    })), { userId, examples, db, purpose: 'categorias (importação)' })
    batch.forEach((r, k) => { if (categories[k]) { r.category = categories[k]; r.category_by = 'ai' } })
    if (retryAfterMs) break   // limite da IA: o resto fica com a regra fixa
  }
  for (const r of rows) delete r._hint
}

type BankRow = { id: string; external_id: string | null; date: string; type: string; amount: number; bank_description: string | null; bank_account: string | null; category: string | null; note?: string | null }

const descKey = (s?: string | null) => normalize(s || '').replace(/[^a-z0-9]/g, '').slice(0, 10)

/**
 * Compras pendentes viram "lançadas" com outro id e a data real. Aqui o lançamento antigo é atualizado
 * (mantendo sua categoria e observação) em vez de duplicar; datas alteradas pelo banco são corrigidas.
 */
export async function reconcile(db: Db, userId: string, institution: string | null, accounts: PluggyAccount[], incoming: { t: PluggyTx; a: PluggyAccount }[], windowStart: string) {
  const labels = accounts.map((a) => accountLabel(institution, a))
  const { data } = await db.from('transactions').select('id, external_id, date, type, amount, bank_description, bank_account, category, note')
    .eq('user_id', userId).eq('source', 'bank').in('bank_account', labels).gte('date', addDays(windowStart, -10))
  const rows = (data || []) as BankRow[]
  const byExt = new Map(rows.filter((r) => r.external_id).map((r) => [r.external_id!, r]))
  const ids = new Set(incoming.map(({ t }) => t.id))
  const orphans = rows.filter((r) => r.external_id && !ids.has(r.external_id) && r.date >= windowStart && r.type !== 'ignorado')
  const used = new Set<string>()
  const same = (r: BankRow, t: PluggyTx, label: string) =>
    r.bank_account === label && r.type === (t.type === 'CREDIT' ? 'entrada' : 'saida') &&
    Math.abs(Number(r.amount) - Math.abs(Number(t.amount))) < 0.01 && dayDiff(r.date, t.date.slice(0, 10)) <= 10 &&
    descKey(r.bank_description) === descKey(t.descriptionRaw || t.description)

  for (const { t, a } of incoming) {
    const date = t.date.slice(0, 10)
    const label = accountLabel(institution, a)
    const known = byExt.get(t.id)
    if (known) {
      if (known.date !== date) await db.from('transactions').update({ date }).eq('id', known.id)
      continue
    }
    // id novo: é a versão "lançada" de uma compra que estava pendente?
    const o = orphans.find((r) => !used.has(r.id) && same(r, t, label))
    if (o) {
      used.add(o.id)
      await db.from('transactions').update({ external_id: t.id, date, bank_description: t.descriptionRaw || t.description }).eq('id', o.id)
      byExt.set(t.id, { ...o, external_id: t.id, date })
    }
  }

  // Pendentes que sumiram: se já existe a versão lançada (importada antes desta regra), fica só uma
  for (const o of orphans.filter((r) => !used.has(r.id))) {
    const survivor = [...byExt.values()].find((r) => r.id !== o.id && ids.has(r.external_id!) && r.bank_account === o.bank_account && r.type === o.type &&
      Math.abs(Number(r.amount) - Number(o.amount)) < 0.01 && dayDiff(r.date, o.date) <= 10 && descKey(r.bank_description) === descKey(o.bank_description))
    if (survivor) {
      const patch: Record<string, unknown> = {}
      if (o.note && !survivor.note) patch.note = o.note
      if (o.category && o.category !== 'Geral' && (!survivor.category || survivor.category === 'Geral')) patch.category = o.category
      if (Object.keys(patch).length) await db.from('transactions').update(patch).eq('id', survivor.id)
      await db.from('transactions').update({ type: 'ignorado' }).eq('id', o.id)
    } else if (o.date < addDays(todayBR(), -7)) {
      // sumiu do banco há mais de uma semana sem substituto: compra pendente cancelada
      await db.from('transactions').update({ type: 'ignorado' }).eq('id', o.id)
    }
  }
}

// ---- Telegram ----

export function bankKeyboard(txId: string, canSplit: boolean, isIn: boolean): Keyboard {
  const row: { text: string; callback_data: string }[] = [{ text: '🏷️ Categoria', callback_data: `c:${txId}` }]
  if (canSplit && !isIn) row.push({ text: '👥 Dividir', callback_data: `d:${txId}` })
  row.push({ text: '🙈 Ignorar', callback_data: `i:${txId}` })
  return { inline_keyboard: [row] }
}

export function bankEntryMessage(t: TxRow & { bank_description?: string | null; bank_account?: string | null }): string {
  const cat = getCategory(t.category)
  const isIn = t.type === 'entrada'
  return [
    `🏦 <b>${isIn ? 'Entrada' : 'Saída'} no banco</b>${t.bank_account ? ` · ${escapeHtml(t.bank_account)}` : ''}`,
    '',
    `${cat.emoji} <b>${escapeHtml(t.description)}</b>`,
    `<b>${isIn ? '+' : '−'} ${formatBRL(Number(t.amount))}</b> · ${escapeHtml(t.category || 'Geral')} · ${formatDateBR(t.date)}`,
    ...(t.bank_description && normalize(t.bank_description) !== normalize(t.description) ? [`<i>${escapeHtml(t.bank_description)}</i>`] : []),
    ...(t.type === 'ignorado' ? ['', '🙈 <i>Ignorado — não entra nos totais.</i>'] : []),
  ].join('\n')
}

/** Avisa no Telegram os lançamentos novos (até 6 mensagens; o resto vai num resumo). */
export async function notifyImported(db: Db, userId: string, rows: TxRow[], canSplit: boolean) {
  if (!rows.length) return
  const { data: conn } = await db.from('telegram_connections').select('telegram_chat_id').eq('user_id', userId).maybeSingle()
  if (!conn) return
  const chatId = Number(conn.telegram_chat_id)
  const recent = rows.filter((r) => r.date >= addDays(todayBR(), -7)).sort((a, b) => b.date.localeCompare(a.date))
  for (const r of recent.slice(0, 6)) await sendMessage(chatId, bankEntryMessage(r), bankKeyboard(r.id, canSplit, r.type === 'entrada'))
  const rest = rows.length - Math.min(6, recent.length)
  if (rest > 0) await sendMessage(chatId, `🏦 +${rest} lançamento${rest === 1 ? '' : 's'} do banco importado${rest === 1 ? '' : 's'}. Confira na aba <b>Lançamentos</b> do painel.`)
}
