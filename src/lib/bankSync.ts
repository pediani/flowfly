// Sincroniza lançamentos do banco (Pluggy) com o FlowFly, juntando com o que já foi registrado à mão.
import { detectCategory, getCategory, normalize } from './categories'
import { addDays, formatDateBR, todayBR } from './dates'
import { formatBRL } from './format'
import { TX_COLS, loadUserCategories, type Db, type TxRow } from './botData'
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
  const filter = conn.last_sync_at
    ? { dateFrom: floor, createdAtFrom: new Date(Date.parse(conn.last_sync_at) - 2 * 86400000).toISOString() }
    : { dateFrom: floor }

  const incoming: { t: PluggyTx; a: PluggyAccount }[] = []
  for (const a of accounts) for (const t of await listTransactions(a.id, filter)) if (t.date.slice(0, 10) >= floor) incoming.push({ t, a })

  const result: SyncResult = { imported: [], matched: 0, skipped: 0, institution }
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
      .gte('date', addDays(dates[0], -3)).lte('date', addDays(dates[dates.length - 1], 3))
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

      const match = candidates.find((c) => !used.has(c.id) && c.type === type && Math.abs(Number(c.amount) - amount) < 0.01 && dayDiff(c.date, date) <= 3)
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
        category: mapCategory(t, description, type),
        external_id: t.id, bank_description: t.descriptionRaw || t.description, bank_account: label,
        ...(meta?.totalInstallments && meta.totalInstallments > 1 ? { installment_no: meta.installmentNumber, installment_total: meta.totalInstallments } : {}),
      })
    }
    if (toInsert.length) {
      const { data, error } = await db.from('transactions').insert(toInsert).select(TX_COLS)
      if (error) throw new Error(`Erro ao gravar lançamentos do banco: ${error.message}`)
      result.imported = (data || []) as TxRow[]
    }
  }

  await db.from('bank_connections').update({ last_sync_at: new Date().toISOString(), institution, status: item.status }).eq('id', conn.id)
  return result
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
