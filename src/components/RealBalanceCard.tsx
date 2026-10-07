'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, CalendarClock, ChevronDown, CreditCard, Landmark, Repeat } from 'lucide-react'
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { supabase } from '../lib/supabase'
import { formatBRL } from '../lib/format'
import { addMonths, formatDateBR, monthKeyOf, monthLabel, relativeTimeBR, todayBR } from '../lib/dates'
import { buildCashFlow, horizonDate } from '../lib/cashflow'
import type { Recurring, Tx } from '../lib/finance'
import type { BankBalance } from '../lib/pluggy'
import { play } from '../lib/sounds'
import { Card, Chip, Money, cx } from './ui'

type Horizon = 'mes' | '30d' | 'proximo'

/** Saldo previsto: saldo real nas contas + entradas previstas − faturas e contas a vencer. Some se não há banco conectado. */
export default function RealBalanceCard({ txs, recurring, refreshKey }: { txs: Tx[]; recurring: Recurring[]; refreshKey: number }) {
  const [accounts, setAccounts] = useState<BankBalance[] | null>(null)
  const [horizon, setHorizon] = useState<Horizon>('mes')
  const [showAccounts, setShowAccounts] = useState(false)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      const res = await fetch('/api/pluggy/balances', { method: 'POST', headers: { Authorization: `Bearer ${data.session?.access_token || ''}` } })
      const json = await res.json().catch(() => ({ accounts: [] }))
      if (alive) setAccounts(json.accounts || [])
    })()
    return () => { alive = false }
  }, [refreshKey])

  const today = todayBR()
  const until = horizonDate(horizon, today)
  const flow = useMemo(() => (accounts?.length ? buildCashFlow(accounts, recurring, txs, until, today) : null), [accounts, recurring, txs, until, today])

  if (!accounts?.length || !flow) return null

  const cards = accounts.filter((a) => a.type === 'Cartão')
  const banks = accounts.filter((a) => a.type === 'Conta')
  const billsInPeriod = flow.events.filter((e) => e.kind === 'fatura').reduce((s, e) => s + e.amount, 0)
  const incoming = flow.events.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0)
  const updated = accounts.map((a) => a.updatedAt).filter(Boolean).sort().pop()
  const nextMonthName = monthLabel(addMonths(monthKeyOf(today), 1))
  const visibleEvents = showAll ? flow.events : flow.events.slice(0, 6)

  return (
    <Card className="p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Saldo previsto em {formatDateBR(until).slice(0, 5)}</p>
        <div className="flex gap-1.5">
          <Chip active={horizon === 'mes'} onClick={() => setHorizon('mes')}>Fim do mês</Chip>
          <Chip active={horizon === '30d'} onClick={() => setHorizon('30d')}>30 dias</Chip>
          <Chip active={horizon === 'proximo'} onClick={() => setHorizon('proximo')}>Fim de {nextMonthName}</Chip>
        </div>
      </div>

      <div className="mt-2 grid gap-4 md:grid-cols-[1fr_1.2fr] md:items-end">
        <div>
          <Money value={flow.end} className={cx('block text-4xl font-semibold tracking-tight md:text-5xl', flow.end < 0 && 'text-expense')} />
          <p className="mt-1 text-xs text-muted">
            Hoje nas contas {formatBRL(flow.start)}
            {flow.min.value < flow.end && flow.min.date !== today && (
              <> · <span className={flow.min.value < 0 ? 'text-expense' : ''}>menor saldo {formatBRL(flow.min.value)} em {formatDateBR(flow.min.date).slice(0, 5)}</span></>
            )}
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Stat icon={Landmark} label="Nas contas" value={flow.start} />
            <Stat icon={ArrowUpRight} label="Entradas previstas" value={incoming} tone="text-income" />
            <Stat icon={CreditCard} label="Faturas no período" value={billsInPeriod} tone="text-expense" />
          </div>
        </div>
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={flow.series} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="ff-flow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
              <ReferenceLine y={0} stroke="var(--expense)" strokeOpacity={0.5} strokeDasharray="3 3" />
              <Tooltip
                cursor={{ stroke: 'var(--line)' }}
                content={({ active, payload }) => active && payload?.length ? (
                  <div className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg">
                    {String(payload[0].payload.label)} · <b className="tabular">{formatBRL(Number(payload[0].value))}</b>
                  </div>
                ) : null}
              />
              <Area type="stepAfter" dataKey="saldo" stroke="var(--accent)" strokeWidth={2} fill="url(#ff-flow)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Próximos movimentos */}
      <div className="mt-4">
        <p className="mb-1.5 text-xs font-medium text-muted">Até {formatDateBR(until).slice(0, 5)}</p>
        {flow.events.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {visibleEvents.map((e, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="w-11 shrink-0 tabular text-xs text-muted">{formatDateBR(e.date).slice(0, 5)}</span>
                <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', e.kind === 'fatura' ? 'bg-expense/10 text-expense' : e.amount > 0 ? 'bg-income/10 text-income' : 'bg-surface-2 text-muted')}>
                  {e.kind === 'fatura' ? <CreditCard className="h-3.5 w-3.5" /> : e.kind === 'fixa' ? <Repeat className="h-3.5 w-3.5" /> : e.amount > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{e.label}</span>
                <span className={cx('shrink-0 tabular font-medium', e.amount > 0 ? 'text-income' : 'text-ink')}>{e.amount > 0 ? '+' : '−'} {formatBRL(Math.abs(e.amount))}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-muted">Nenhuma entrada ou saída prevista no período.</p>}
        {flow.events.length > 6 && (
          <button onClick={() => { play('tap'); setShowAll(!showAll) }} className="mt-1.5 text-xs font-medium text-accent">{showAll ? 'Mostrar menos' : `Ver todos (${flow.events.length})`}</button>
        )}
        {horizon !== 'mes' && (
          <p className="mt-2 text-[11px] text-muted">Faturas que ainda vão fechar só entram quando o banco informar o valor; até lá a previsão do mês seguinte fica otimista.</p>
        )}
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted">
          <CalendarClock className="mt-px h-3 w-3 shrink-0" />
          Falta alguma entrada (vale, salário, freela)? Cadastre em <b className="mx-0.5">Contas fixas</b> se for todo mês, ou lance pelo <b className="mx-0.5">+</b> com a data em que vai cair.
        </p>
      </div>

      <button onClick={() => { play('tap'); setShowAccounts(!showAccounts) }} className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-accent">
        <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', showAccounts && 'rotate-180')} /> {showAccounts ? 'Ocultar' : 'Ver'} contas e cartões{updated ? ` · atualizado ${relativeTimeBR(updated)}` : ''}
      </button>
      {showAccounts && (
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 animate-fade-in">
          {[...banks, ...cards].map((a, i) => (
            <div key={i} className="flex min-w-0 items-center gap-3 rounded-xl border border-line px-3 py-2.5">
              <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', a.type === 'Cartão' ? 'bg-expense/10 text-expense' : 'bg-income/10 text-income')}>
                {a.type === 'Cartão' ? <CreditCard className="h-4 w-4" /> : <Landmark className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{a.institution} · {a.name}{a.last4 ? ` ·${a.last4}` : ''}</p>
                <p className="text-[11px] text-muted">
                  {a.type === 'Cartão'
                    ? <>
                        Fatura aberta{a.openDue ? ` · vence ${formatDateBR(a.openDue).slice(0, 5)}` : ''}
                        {a.closedDue ? <> · fechada a pagar {formatBRL(a.closedDue)}{a.closedDueDate ? ` (vence ${formatDateBR(a.closedDueDate).slice(0, 5)})` : ''}</> : null}
                        {a.usedLimit != null ? <> · limite usado {formatBRL(a.usedLimit)}</> : null}
                      </>
                    : 'Saldo disponível'}
                </p>
              </div>
              <span className={cx('shrink-0 whitespace-nowrap tabular text-sm font-semibold', a.type === 'Cartão' ? 'text-expense' : a.balance < 0 ? 'text-expense' : 'text-ink')}>
                {a.type === 'Cartão' || a.balance < 0 ? '−' : ''} {formatBRL(Math.abs(a.type === 'Cartão' ? (a.openBill ?? a.balance) : a.balance))}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof Landmark; label: string; value: number; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 p-2.5 sm:p-3">
      <p className="flex items-start gap-1 text-[10px] leading-tight text-muted sm:text-[11px]"><Icon className="mt-px h-3 w-3 shrink-0" /> {label}</p>
      <p className={cx('mt-1 whitespace-nowrap tabular text-xs font-semibold sm:text-sm', tone)}>{value < 0 ? '−' : ''} {formatBRL(Math.abs(value))}</p>
    </div>
  )
}
