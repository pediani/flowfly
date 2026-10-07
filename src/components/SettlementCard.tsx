'use client'

import { useEffect, useState } from 'react'
import { Handshake } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatBRL } from '../lib/format'
import { play } from '../lib/sounds'
import { Card, CardHeader, cx } from './ui'

/** Acerto com o parceiro: quanto eu devo, quanto me devem e o saldo líquido */
export default function SettlementCard({ partnerEmail, refreshKey, onSettled }: { partnerEmail: string; refreshKey: number; onSettled: () => void }) {
  const [data, setData] = useState<{ i_owe: number; owed_to_me: number } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    supabase.rpc('partner_settlement').then(({ data: rows }) => {
      if (alive) setData(((rows as { i_owe: number; owed_to_me: number }[]) || [])[0] || { i_owe: 0, owed_to_me: 0 })
    })
    return () => { alive = false }
  }, [refreshKey])

  async function settleAll() {
    if (!confirm(`Marcar como pagas todas as suas pendências com ${partnerEmail}?`)) return
    setBusy(true)
    const { error } = await supabase.from('transactions').update({ type: 'saida' }).eq('type', 'a_pagar')
    setBusy(false)
    play(error ? 'error' : 'success')
    if (error) alert(error.message)
    onSettled()
  }

  const owe = Number(data?.i_owe || 0), owed = Number(data?.owed_to_me || 0), net = owed - owe

  return (
    <Card delay={180}>
      <CardHeader title="Acerto com parceiro" icon={<Handshake className="h-4 w-4 text-muted" />} subtitle={partnerEmail} />
      <div className="grid grid-cols-2 gap-3 px-5">
        <div className="rounded-xl bg-surface-2 p-3">
          <p className="text-xs text-muted">Você deve</p>
          <p className="mt-1 tabular font-semibold text-expense">{formatBRL(owe)}</p>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <p className="text-xs text-muted">Te devem</p>
          <p className="mt-1 tabular font-semibold text-income">{formatBRL(owed)}</p>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 px-5 py-4">
        <p className="text-sm">
          {net === 0 ? 'Tudo certo entre vocês ✨' : net > 0 ? <>Saldo: <b className="text-income tabular">{formatBRL(net)}</b> a receber</> : <>Saldo: <b className={cx('tabular text-expense')}>{formatBRL(-net)}</b> a pagar</>}
        </p>
        {owe > 0 && (
          <button onClick={settleAll} disabled={busy} className="h-9 shrink-0 rounded-lg bg-accent px-3 text-sm font-medium text-accent-ink disabled:opacity-50">Quitar tudo</button>
        )}
      </div>
      <p className="px-5 pb-4 text-[11px] text-muted">“Te devem” considera as divisões feitas a partir de agora.</p>
    </Card>
  )
}
