'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { BankBalance } from '../lib/pluggy'

// Cache compartilhado: painel, calendário e patrimônio usam a mesma busca
let cache: { key: number; at: number; data: BankBalance[] } | null = null
let inflight: { key: number; p: Promise<void> } | null = null
const listeners = new Set<(d: BankBalance[]) => void>()

function load(key: number, force = false) {
  if (!force && cache && cache.key === key && Date.now() - cache.at < 60000) return
  if (!force && inflight?.key === key) return
  const p = (async () => {
    const { data: s } = await supabase.auth.getSession()
    const res = await fetch('/api/pluggy/balances', { method: 'POST', headers: { Authorization: `Bearer ${s.session?.access_token || ''}` } })
    const json = await res.json().catch(() => ({ accounts: [] }))
    cache = { key, at: Date.now(), data: json.accounts || [] }
    listeners.forEach((l) => l(cache!.data))
  })().finally(() => { if (inflight?.p === p) inflight = null })
  inflight = { key, p }
}

/** Chave da última busca (para componentes que só querem ler o que já foi carregado). */
export function currentBalancesKey(): number {
  return cache?.key ?? 0
}

/** Busca de novo (ex.: depois de mudar o fechamento de um cartão) e atualiza todos os cards. */
export function refreshBankBalances() {
  load(cache?.key ?? 0, true)
}

export function useBankBalances(refreshKey: number): BankBalance[] | null {
  const [data, setData] = useState<BankBalance[] | null>(cache?.key === refreshKey ? cache.data : null)
  useEffect(() => {
    const l = (d: BankBalance[]) => setData(d)
    listeners.add(l)
    load(refreshKey)
    return () => { listeners.delete(l) }
  }, [refreshKey])
  return data
}
