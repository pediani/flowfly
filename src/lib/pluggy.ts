// Cliente da API da Pluggy (servidor). Requer PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.
// Docs: https://docs.pluggy.ai/en/reference
const API = process.env.PLUGGY_API_URL || 'https://api.pluggy.ai'

let cached: { key: string; exp: number } | null = null

export function pluggyEnabled(): boolean {
  return !!(process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET)
}

async function apiKey(): Promise<string> {
  if (cached && cached.exp > Date.now()) return cached.key
  const res = await fetch(`${API}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId: process.env.PLUGGY_CLIENT_ID, clientSecret: process.env.PLUGGY_CLIENT_SECRET }),
  })
  if (!res.ok) throw new Error(`Pluggy auth falhou: ${res.status} ${await res.text()}`)
  const { apiKey: key } = await res.json()
  cached = { key, exp: Date.now() + 100 * 60 * 1000 } // a chave vale 2h
  return key
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': await apiKey(), ...(init?.headers || {}) },
  })
  if (!res.ok) throw new Error(`Pluggy ${path} → ${res.status} ${await res.text()} (x-request-id ${res.headers.get('x-request-id')})`)
  return res.json() as Promise<T>
}

export type PluggyItem = { id: string; status: string; executionStatus?: string; lastUpdatedAt?: string; connector?: { name?: string } }
export type PluggyAccount = {
  id: string
  type: 'BANK' | 'CREDIT' | string
  subtype?: string
  name?: string
  marketingName?: string
  number?: string
  owner?: string
  balance?: number
  updatedAt?: string
  creditData?: {
    creditLimit?: number | null
    availableCreditLimit?: number | null
    balanceDueDate?: string | null
    balanceCloseDate?: string | null
    brand?: string | null
  } | null
}
export type PluggyTx = {
  id: string
  description: string
  descriptionRaw?: string | null
  amount: number
  date: string
  type: 'DEBIT' | 'CREDIT'
  category?: string | null
  status?: string
  creditCardMetadata?: {
    installmentNumber?: number
    totalInstallments?: number
    billId?: string | null
    billForecastDate?: string | null // "YYYY-MM": fatura em que deve cair (Open Finance)
    purchaseDate?: string | null
  } | null
  operationType?: string | null // ex.: 'PAGAMENTO_FATURA', 'ESTORNO'
  merchant?: { name?: string; businessName?: string } | null
}

export const getItem = (id: string) => call<PluggyItem>(`/items/${encodeURIComponent(id)}`)

export async function listAccounts(itemId: string): Promise<PluggyAccount[]> {
  const r = await call<{ results: PluggyAccount[] }>(`/accounts?itemId=${encodeURIComponent(itemId)}`)
  return r.results || []
}

/** Todas as transações da conta (paginação por cursor, 500 por página). */
export async function listTransactions(accountId: string, f: { dateFrom?: string; createdAtFrom?: string }): Promise<PluggyTx[]> {
  const q = new URLSearchParams({ accountId })
  if (f.dateFrom) q.set('dateFrom', f.dateFrom)
  if (f.createdAtFrom) q.set('createdAtFrom', f.createdAtFrom)
  let next: string | null = `?${q}`
  const out: PluggyTx[] = []
  for (let page = 0; next && page < 20; page++) {
    const r: { results: PluggyTx[]; next: string | null } = await call(`/v2/transactions${next}`)
    out.push(...(r.results || []))
    next = r.next
  }
  return out
}

export type PluggyBill = {
  id: string
  dueDate: string
  billClosingDate?: string | null
  totalAmount: number
  payments?: { amount: number; paymentDate?: string }[] | null
}

export async function listBills(accountId: string): Promise<PluggyBill[]> {
  const r = await call<{ results: PluggyBill[] }>(`/bills?accountId=${encodeURIComponent(accountId)}&pageSize=12`)
  return r.results || []
}

/** Garante um webhook de "transactions/created" apontando para o FlowFly. */
export async function ensureWebhook(url: string, secret: string) {
  const r = await call<{ results?: { url: string; event: string }[] } | { url: string; event: string }[]>('/webhooks')
  const list = Array.isArray(r) ? r : r.results || []
  if (list.some((w) => w.url === url && (w.event === 'transactions/created' || w.event === 'all'))) return
  await call('/webhooks', { method: 'POST', body: JSON.stringify({ url, event: 'transactions/created', headers: { 'x-flowfly-secret': secret } }) })
}

/** Saldo exibido no painel (conta: saldo disponível · cartão: fatura atual) */
export type BankBalance = {
  institution: string
  type: 'Conta' | 'Cartão'
  name: string
  last4: string
  balance: number          // conta: saldo disponível · cartão: fatura aberta + fatura fechada a vencer
  openBill?: number
  openCloses?: string | null
  closedDue?: number
  closedDueDate?: string | null
  usedLimit?: number       // limite usado total (inclui parcelas futuras)
  billMethod?: string
  creditLimit?: number | null
  available?: number | null
  dueDate?: string | null
  closeDate?: string | null
  updatedAt?: string | null
}
