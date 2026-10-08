'use client'

import { useMemo } from 'react'
import { Plus, Repeat, TrendingUp, TriangleAlert } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { detectSubscriptions } from '../lib/analysis'
import { formatBRL } from '../lib/format'
import { formatDateBR } from '../lib/dates'
import type { Recurring, Tx } from '../lib/finance'
import { play } from '../lib/sounds'
import { Card, CardHeader, EmptyState } from './ui'

/** Assinaturas detectadas automaticamente nos lançamentos (estilo Rocket Money). */
export default function SubscriptionsCard({ userId, txs, recurring, onChange }: { userId: string; txs: Tx[]; recurring: Recurring[]; onChange: () => void }) {
  const subs = useMemo(() => detectSubscriptions(txs, recurring), [txs, recurring])
  const total = subs.reduce((s, x) => s + x.monthly, 0)

  async function addAsFixed(s: (typeof subs)[number]) {
    const { error } = await supabase.from('recurring_transactions').insert({
      user_id: userId, amount: s.amount, description: s.name, type: 'saida', day_of_month: Number(s.lastDate.slice(8, 10)),
    })
    play(error ? 'error' : 'success')
    if (error) alert(error.message)
    onChange()
  }

  return (
    <Card className="lg:col-span-5" delay={80}>
      <CardHeader
        title="Assinaturas detectadas"
        icon={<Repeat className="h-4 w-4 text-muted" />}
        subtitle={subs.length ? `≈ ${formatBRL(total)}/mês em ${subs.length} cobrança(s) recorrente(s), encontradas nos seus lançamentos` : 'Cobranças que se repetem todo mês aparecem aqui'}
      />
      {subs.length ? (
        <ul className="divide-y divide-line px-5 pb-3">
          {subs.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{s.name}</p>
                <p className="text-xs text-muted">
                  {formatBRL(s.amount)} · a cada ~{s.cadenceDays} dias · {s.count}x · próxima ~{formatDateBR(s.nextDate).slice(0, 5)}
                </p>
                {(s.increased || s.duplicate) && (
                  <p className="mt-0.5 flex flex-wrap gap-2 text-[11px]">
                    {s.increased && <span className="inline-flex items-center gap-1 text-warn"><TrendingUp className="h-3 w-3" /> subiu de {formatBRL(s.increased.from)} para {formatBRL(s.increased.to)}</span>}
                    {s.duplicate && <span className="inline-flex items-center gap-1 text-expense"><TriangleAlert className="h-3 w-3" /> possível duplicada em {formatDateBR(s.duplicate.date).slice(0, 5)}</span>}
                  </p>
                )}
              </div>
              <span className="tabular text-sm font-semibold">{formatBRL(s.monthly)}<span className="text-xs font-normal text-muted">/mês</span></span>
              {s.isRecurringRegistered
                ? <span className="rounded-md bg-income/10 px-2 py-1 text-[11px] text-income">nas fixas</span>
                : <button onClick={() => addAsFixed(s)} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] font-medium hover:bg-surface-2"><Plus className="h-3 w-3" /> Fixas</button>}
            </li>
          ))}
        </ul>
      ) : <EmptyState icon={Repeat} title="Nada detectado ainda" text="Depois de 2 meses de lançamentos (do banco ou do Telegram), Netflix, academia, apps etc. aparecem aqui." />}
    </Card>
  )
}
