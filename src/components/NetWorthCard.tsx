'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, ChevronDown, Landmark, LineChart as LineIcon } from 'lucide-react'
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { supabase } from '../lib/supabase'
import { formatBRL, formatBRLCompact } from '../lib/format'
import { daysInMonth, formatDateBR, monthKeyOf, monthLabel, todayBR } from '../lib/dates'
import { buildCashFlow } from '../lib/cashflow'
import { computeSafeToSpend } from '../lib/safeToSpend'
import type { Recurring, Tx } from '../lib/finance'
import { useBankBalances } from './useBankBalances'
import type { NetWorth } from '../lib/networth'
import { play } from '../lib/sounds'
import { Card, CardHeader, Money, cx } from './ui'

type Snap = { month: string; cash: number; investments: number; debts: number; net: number }

/** Patrimônio: contas + investimentos − dívidas, com evolução mês a mês. */
export default function NetWorthCard({ refreshKey, txs, recurring }: { refreshKey: number; txs: Tx[]; recurring: Recurring[] }) {
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

  const accounts = useBankBalances(refreshKey)
  const today = todayBR()
  const endOfMonth = `${monthKeyOf(today)}-${daysInMonth(monthKeyOf(today))}`
  // Previsão até o fim do mês: entradas e contas fixas/agendadas (faturas já estão descontadas no "hoje")
  const forecast = useMemo(() => {
    if (!accounts?.length) return null
    const unsynced = computeSafeToSpend(accounts, recurring, txs, { today })?.unsynced ?? 0
    const events = buildCashFlow(accounts, recurring, txs, endOfMonth, today).events.filter((e) => e.kind !== 'fatura')
    return {
      unsynced,
      inflow: events.filter((e) => e.amount > 0),
      outflow: events.filter((e) => e.amount < 0),
      delta: Math.round(events.reduce((sum, e) => sum + e.amount, 0) * 100) / 100,
    }
  }, [accounts, recurring, txs, today, endOfMonth])

  const c = data?.current
  if (!c) return null
  const now = Math.round((c.net + (forecast?.unsynced ?? 0)) * 100) / 100
  const end = Math.round((now + (forecast?.delta ?? 0)) * 100) / 100
  const inSum = (forecast?.inflow || []).reduce((s2, e) => s2 + e.amount, 0)
  const outSum = (forecast?.outflow || []).reduce((s2, e) => s2 + e.amount, 0)
  const hist = (data?.history || []).map((h) => ({ ...h, label: monthLabel(h.month, 'short'), net: Number(h.net) }))
  const prev = hist.length >= 2 ? hist[hist.length - 2].net : null

  return (
    <Card delay={220}>
      <CardHeader title="Patrimônio" icon={<LineIcon className="h-4 w-4 text-muted" />} subtitle="Tudo o que é seu (contas + investimentos) menos o que você já deve no cartão, e para onde isso vai até o fim do mês." />
      <div className="grid gap-4 px-5 pb-5 md:grid-cols-[1fr_1.3fr]">
        <div>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <div>
              <p className="text-[11px] text-muted">Hoje</p>
              <Money value={now} className={cx('block text-2xl font-semibold tracking-tight', now < 0 && 'text-expense')} />
            </div>
            <ArrowRight className="mb-2 h-4 w-4 text-muted" />
            <div>
              <p className="text-[11px] text-muted">Fim de {monthLabel(monthKeyOf(today))} (previsto)</p>
              <Money value={end} className={cx('block text-3xl font-semibold tracking-tight', end < 0 ? 'text-expense' : 'text-ink')} />
            </div>
          </div>
          {forecast && (
            <p className="mt-2 text-[11px] text-muted">
              <b className="text-income">+ {formatBRL(inSum)}</b> que entra{forecast.inflow.length ? ` (${forecast.inflow.slice(0, 3).map((e) => `${e.label} ${formatDateBR(e.date).slice(0, 5)}`).join(', ')})` : ''}
              {' '}<b className="text-expense">− {formatBRL(-outSum)}</b> em contas fixas e agendadas até {formatDateBR(endOfMonth).slice(0, 5)}. As faturas já estão descontadas no “hoje”.
            </p>
          )}
          {prev !== null && <p className={cx('mt-1 text-xs', c.net >= prev ? 'text-income' : 'text-expense')}>{c.net >= prev ? '▲' : '▼'} {formatBRL(Math.abs(c.net - prev))} vs mês anterior</p>}
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Box label="Contas" value={c.cash + (forecast?.unsynced ?? 0)} />
            <Box label="Investimentos" value={c.investments} tone="text-income" />
            <Box label="Faturas a pagar" value={-c.debts} tone="text-expense" />
            <Box label="Parcelas futuras" value={-c.futureInstallments} tone="text-muted" />
          </div>
          {c.futureInstallments > 0 && (
            <p className="mt-2 text-[11px] text-muted">
              Parcelas futuras são compromissos dos próximos meses: não entram no “hoje”. Se quitasse tudo agora: <b className="text-ink">{formatBRL(now - c.futureInstallments)}</b>.
            </p>
          )}
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
              <span className="shrink-0 text-right">
                <span className={cx('block tabular font-medium', x.value < 0 ? 'text-expense' : x.kind === 'inv' ? 'text-income' : '')}>{formatBRL(x.value)}</span>
                {'future' in x && Number(x.future) > 0 && <span className="block text-[10px] text-muted">+ {formatBRL(Number(x.future))} em parcelas futuras</span>}
              </span>
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
