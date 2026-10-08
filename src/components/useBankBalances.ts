'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { BankBalance } from '../lib/pluggy'

// Cache simples para o painel e o calendário não buscarem duas vezes
let cache: { key: number; at: number; data: BankBalance[] } | null = null

export function useBankBalances(refreshKey: number): BankBalance[] | null {
  const [data, setData] = useState<BankBalance[] | null>(cache?.key === refreshKey ? cache.data : null)
  useEffect(() => {
    let alive = true
    if (cache && cache.key === refreshKey && Date.now() - cache.at < 60000) return
    ;(async () => {
      const { data: s } = await supabase.auth.getSession()
      const res = await fetch('/api/pluggy/balances', { method: 'POST', headers: { Authorization: `Bearer ${s.session?.access_token || ''}` } })
      const json = await res.json().catch(() => ({ accounts: [] }))
      cache = { key: refreshKey, at: Date.now(), data: json.accounts || [] }
      if (alive) setData(cache.data)
    })()
    return () => { alive = false }
  }, [refreshKey])
  return data
}
