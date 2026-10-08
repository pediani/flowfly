'use client'

import { useMemo, useState } from 'react'
import { addMonths, daysInMonth, formatDateBR, monthKeyOf, todayBR } from '../lib/dates'
import { buildCashFlow, type CashEvent } from '../lib/cashflow'
import { formatBRL, formatBRLCompact } from '../lib/format'
import type { Recurring, Tx } from '../lib/finance'
import { play } from '../lib/sounds'
import { Card, cx } from './ui'
import { EventList } from './RealBalanceCard'
import { useBankBalances } from './useBankBalances'

const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/** Calendário financeiro: o que aconteceu (lançamentos) e o que vai acontecer (faturas, fixas, agendados) em cada dia. */
export default function CalendarView({ txs, recurring, monthKey, refreshKey }: { txs: Tx[]; recurring: Recurring[]; monthKey: string; refreshKey: number }) {
  const accounts = useBankBalances(refreshKey)
  const today = todayBR()
  const [selected, setSelected] = useState<string | null>(null)

  const data = useMemo(() => {
    const total = daysInMonth(monthKey)
    const first = new Date(`${monthKey}-01T12:00:00Z`).getUTCDay()
    const end = `${monthKey}-${String(total).padStart(2, '0')}`
    // futuro: fluxo previsto a partir de hoje (precisa de banco conectado para o saldo)
    const flow = accounts?.length && end >= today && monthKey <= addMonths(monthKeyOf(today), 2)
      ? buildCashFlow(accounts, recurring, txs, end, today) : null
    const futureByDay = new Map<string, CashEvent[]>()
    for (const e of flow?.events || []) futureByDay.set(e.date, [...(futureByDay.get(e.date) || []), e])
    const balanceByDay = new Map(flow?.series.map((p) => [p.date, p.saldo]) || [])

    const days = Array.from({ length: total }, (_, i) => {
      const date = `${monthKey}-${String(i + 1).padStart(2, '0')}`
      const done = txs.filter((t) => t.date === date && (date <= today || t.source !== 'bank'))
      const inc = done.filter((t) => t.type === 'entrada').reduce((s, t) => s + Number(t.amount), 0)
      const out = done.filter((t) => t.type === 'saida').reduce((s, t) => s + Number(t.amount), 0)
      const future = date > today ? futureByDay.get(date) || [] : []
      return { date, day: i + 1, inc, out, done, future, balance: date >= today ? balanceByDay.get(date) : undefined }
    })
    return { first, days }
  }, [monthKey, accounts, recurring, txs, today])

  const sel = data.days.find((d) => d.date === selected)

  return (
    <Card className="p-4">
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-medium text-muted">
        {WEEK.map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {Array.from({ length: data.first }, (_, i) => <span key={`e${i}`} />)}
        {data.days.map((d) => {
          const bill = d.future.some((e) => e.kind === 'fatura')
          const futureIn = d.future.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0)
          const futureOut = d.future.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0)
          return (
            <button
              key={d.date}
              onClick={() => { play('tap'); setSelected(selected === d.date ? null : d.date) }}
              className={cx(
                'flex min-h-16 flex-col items-stretch rounded-lg border p-1 text-left transition md:min-h-20',
                d.date === today ? 'border-accent' : 'border-line',
                selected === d.date ? 'bg-accent/10' : 'hover:bg-surface-2',
                d.date > today && 'bg-surface-2/40',
              )}
            >
              <span className={cx('text-[11px] font-medium', d.date === today && 'text-accent')}>{d.day}</span>
              <span className="mt-auto space-y-0.5 text-[9px] leading-tight tabular md:text-[10px]">
                {d.inc > 0 && <span className="block truncate text-income">+{formatBRLCompact(d.inc)}</span>}
                {d.out > 0 && <span className="block truncate text-expense">−{formatBRLCompact(d.out)}</span>}
                {futureIn > 0 && <span className="block truncate text-income/80">↗ {formatBRLCompact(futureIn)}</span>}
                {futureOut > 0 && <span className={cx('block truncate', bill ? 'font-semibold text-expense' : 'text-expense/80')}>{bill ? '💳' : '↘'} {formatBRLCompact(futureOut)}</span>}
                {d.balance !== undefined && (d.future.length > 0 || d.date === today) && (
                  <span className={cx('block truncate text-muted', d.balance < 0 && 'text-expense')}>= {formatBRLCompact(d.balance)}</span>
                )}
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-[10px] text-muted">Valores realizados em verde/vermelho · ↗ ↘ previstos · 💳 fatura · “=” saldo previsto no dia (com banco conectado).</p>

      {sel && (
        <div className="mt-3 animate-fade-in">
          <p className="text-sm font-medium">{formatDateBR(sel.date)}{sel.balance !== undefined ? <span className="text-muted"> · saldo previsto {formatBRL(sel.balance)}</span> : null}</p>
          {sel.done.length > 0 && (
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
              {sel.done.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate">{t.description} <span className="text-xs text-muted">· {t.category}</span></span>
                  <span className={cx('shrink-0 tabular font-medium', t.type === 'entrada' ? 'text-income' : 'text-ink')}>{t.type === 'entrada' ? '+' : '−'} {formatBRL(Number(t.amount))}</span>
                </li>
              ))}
            </ul>
          )}
          {sel.future.length > 0 && <EventList events={sel.future} />}
          {!sel.done.length && !sel.future.length && <p className="mt-1 text-xs text-muted">Nada neste dia.</p>}
        </div>
      )}
    </Card>
  )
}
