'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, Landmark, LineChart as LineIcon } from 'lucide-react'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '../lib/supabase'
import { formatBRL, formatBRLCompact } from '../lib/format'
import { monthLabel } from '../lib/dates'
import type { NetWorth } from '../lib/networth'
import { play } from '../lib/sounds'
import { Card, CardHeader, Money, cx } from './ui'

type Snap = { month: string; cash: number; investments: number; debts: number; net: number }

/** Patrimônio: contas + investimentos − dívidas, com evolução mês a mês. */
export default function NetWorthCard({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<{ current: NetWorth | null; history: Snap[] } | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data: s } = await supabase.auth.getSession()
      const res = await fetch('/api/pluggy/networth', { method: 'POST', headers: { Authorization: `Bearer ${s.session?.access_token || ''}` } })
      const json = await res.json().catch(() => null)
      if (alive) setData(json)
    })()
    return () => { alive = false }
  }, [refreshKey])

  const c = data?.current
  if (!c) return null
  const hist = (data?.history || []).map((h) => ({ ...h, label: monthLabel(h.month, 'short'), net: Number(h.net) }))
  const prev = hist.length >= 2 ? hist[hist.length - 2].net : null

  return (
    <Card delay={220}>
      <CardHeader title="Patrimônio" icon={<LineIcon className="h-4 w-4 text-muted" />} subtitle="Contas + investimentos − dívidas no cartão (inclui parcelas futuras)" />
      <div className="grid gap-4 px-5 pb-5 md:grid-cols-[1fr_1.3fr]">
        <div>
          <Money value={c.net} className={cx('block text-3xl font-semibold tracking-tight', c.net < 0 && 'text-expense')} />
          {prev !== null && <p className={cx('mt-1 text-xs', c.net >= prev ? 'text-income' : 'text-expense')}>{c.net >= prev ? '▲' : '▼'} {formatBRL(Math.abs(c.net - prev))} vs mês anterior</p>}
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <Box label="Contas" value={c.cash} />
            <Box label="Investimentos" value={c.investments} tone="text-income" />
            <Box label="Dívidas" value={-c.debts} tone="text-expense" />
          </div>
        </div>
        <div className="h-36">
          {hist.length >= 2 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={hist} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={formatBRLCompact} tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} width={56} />
                <Tooltip formatter={(v) => formatBRL(Number(v))} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="net" name="Patrimônio" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <p className="flex h-full items-center justify-center text-center text-xs text-muted">O gráfico de evolução aparece a partir do 2º mês — a foto é guardada todo dia.</p>}
        </div>
      </div>
      <button onClick={() => { play('tap'); setOpen(!open) }} className="mx-5 mb-4 inline-flex items-center gap-1 text-xs font-medium text-accent">
        <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} /> {open ? 'Ocultar' : 'Ver'} detalhes
      </button>
      {open && (
        <ul className="mx-5 mb-5 divide-y divide-line rounded-xl border border-line text-sm animate-fade-in">
          {[...c.details.investments.map((i) => ({ ...i, kind: 'inv' })), ...c.details.accounts.map((a) => ({ ...a, kind: a.type }))].map((x, i) => (
            <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="flex min-w-0 items-center gap-2 truncate"><Landmark className="h-3.5 w-3.5 shrink-0 text-muted" />{x.institution} · {x.name}{x.kind === 'inv' && x.type ? <span className="text-xs text-muted"> · {x.type}</span> : null}</span>
              <span className={cx('shrink-0 tabular font-medium', x.value < 0 ? 'text-expense' : x.kind === 'inv' ? 'text-income' : '')}>{formatBRL(x.value)}</span>
            </li>
          ))}
          {!c.details.investments.length && <li className="px-3 py-2 text-xs text-muted">Nenhum investimento encontrado nas conexões do Meu Pluggy.</li>}
        </ul>
      )}
    </Card>
  )
}

function Box({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 p-2.5">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={cx('mt-1 truncate tabular text-sm font-semibold', tone)}>{value < 0 ? '−' : ''} {formatBRL(Math.abs(value))}</p>
    </div>
  )
}
