'use client'

import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, ChevronRight, Handshake, Pencil, Sparkles, Target, TrendingUp, Wallet } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { supabase } from '../lib/supabase'
import { addMonths, currentMonthKey, monthLabel, todayBR } from '../lib/dates'
import { formatBRL } from '../lib/format'
import { CATEGORY_NAMES, getCategory } from '../lib/categories'
import {
  budgetStatus, buildInsights, categoryBreakdown, futureProjection, monthProjection, monthlyHistory,
  overallBalance, pendingDebts, summarize,
  type Budget, type Installment, type Insight, type Recurring, type Tx,
} from '../lib/finance'
import { play } from '../lib/sounds'
import { Legend, MonthChart, ProjectionChart } from './Charts'
import { TransactionItem } from './TransactionItem'
import { Card, CardHeader, EmptyState, Money, cx } from './ui'

type Props = {
  userId: string
  txs: Tx[]
  recurring: Recurring[]
  installments: Installment[]
  budgets: Budget[]
  monthKey: string
  onSelectMonth: (key: string) => void
  onSeeAll: () => void
  onDelete: (t: Tx) => void
  onPay: (t: Tx) => void
  onBudgetsChange: () => void
}

export default function Dashboard(p: Props) {
  const { txs, recurring, installments, budgets, monthKey } = p
  const today = todayBR()
  const isCurrent = monthKey === currentMonthKey()

  const data = useMemo(() => {
    const s = summarize(txs, monthKey)
    const prev = summarize(txs, addMonths(monthKey, -1))
    return {
      s, prev,
      mp: monthProjection(txs, recurring, monthKey, today),
      future: futureProjection(txs, recurring, installments, 6, today),
      cats: categoryBreakdown(txs, monthKey),
      budgets: budgetStatus(txs, budgets, monthKey),
      insights: buildInsights(txs, recurring, budgets, monthKey, today),
      history: monthlyHistory(txs, 13).filter((m) => m.key !== monthKey).slice(0, 12),
      overall: overallBalance(txs),
      debts: pendingDebts(txs),
      recent: txs.filter((t) => t.date.startsWith(monthKey)).slice(0, 6),
    }
  }, [txs, recurring, installments, budgets, monthKey, today])

  const { s, prev, mp } = data
  const delta = prev.saidas > 0 ? ((s.saidas - prev.saidas) / prev.saidas) * 100 : null

  return (
    <div className="space-y-5">
      {/* HERO */}
      <Card className="relative overflow-hidden p-5 md:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-accent/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-10 h-48 w-48 rounded-full bg-income/10 blur-3xl" />
        <div className="relative">
          <p className="text-xs uppercase tracking-[0.2em] text-muted">Saldo de {monthLabel(monthKey)}</p>
          <Money value={s.saldo} className={cx('mt-1 block font-display text-[2.6rem] leading-none md:text-6xl', s.saldo < 0 && 'text-expense')} />
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2/60 px-3 py-1.5">
              <Wallet className="h-3.5 w-3.5 text-accent" /> Saldo geral <b className="tabular">{formatBRL(data.overall)}</b>
            </span>
            {mp.isCurrent && (
              <span className={cx('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5', mp.projectedSaldo >= 0 ? 'border-income/40 text-income' : 'border-expense/40 text-expense')}>
                <Sparkles className="h-3.5 w-3.5" /> Previsão de fechamento <b className="tabular">{formatBRL(mp.projectedSaldo)}</b>
              </span>
            )}
            {delta !== null && s.saidas > 0 && (
              <span className={cx('inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5', delta > 0 ? 'text-expense' : 'text-income')}>
                {delta > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
                Saídas {delta > 0 ? '+' : ''}{Math.round(delta)}% vs {monthLabel(prev.key, 'short')}
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Entradas" value={s.entradas} tone="income" icon={<ArrowUpRight className="h-4 w-4" />} delay={60} />
        <Kpi label="Saídas" value={s.saidas} tone="expense" icon={<ArrowDownRight className="h-4 w-4" />} delay={100} />
        <Kpi label="A receber" value={s.aReceber} tone="accent" icon={<Handshake className="h-4 w-4" />} delay={140} hint="metade das despesas divididas" />
        <Kpi label="A pagar" value={data.debts} tone="warn" icon={<Handshake className="h-4 w-4" />} delay={180} hint="pendências com parceiro" />
      </div>

      {/* AVISOS */}
      {data.insights.length > 0 && <Insights items={data.insights} />}

      <div className="grid gap-5 lg:grid-cols-5 lg:items-start">
        {/* MÊS DIA A DIA */}
        <Card className="lg:col-span-3" delay={120}>
          <CardHeader
            title={`${monthLabel(monthKey)} dia a dia`}
            icon={<TrendingUp className="h-4 w-4 text-accent" />}
            subtitle={mp.isCurrent
              ? <>Projeção = lançado até hoje + contas fixas a vencer + gasto variável médio de <b className="text-ink">{formatBRL(mp.dailyVariable)}/dia</b></>
              : mp.isFuture ? 'Mês futuro: veja a projeção dos próximos meses abaixo.' : 'Saldo acumulado ao longo do mês.'}
          />
          {s.count || mp.isCurrent ? (
            <>
              <div className="px-2"><MonthChart series={mp.series} monthShort={monthLabel(monthKey, 'short')} /></div>
              <Legend items={[{ color: 'var(--accent)', label: 'Realizado' }, ...(mp.isCurrent ? [{ color: 'var(--accent)', label: 'Projeção até o fim do mês', dashed: true }] : [])]} />
            </>
          ) : <EmptyState emoji="🗓️" title="Sem lançamentos neste mês" />}
        </Card>

        {/* CATEGORIAS + ORÇAMENTOS */}
        <CategoryCard {...p} cats={data.cats} totalOut={s.saidas} statuses={data.budgets} />
      </div>

      {/* PROJEÇÃO 6 MESES */}
      <Card delay={160}>
        <CardHeader
          title="Projeção dos próximos meses"
          icon={<Sparkles className="h-4 w-4 text-accent" />}
          subtitle="Contas fixas + média dos seus gastos variáveis + parcelas. A linha mostra o saldo acumulado."
        />
        <div className="px-2"><ProjectionChart data={data.future} /></div>
        <Legend items={[{ color: 'var(--income)', label: 'Entradas previstas' }, { color: 'var(--expense)', label: 'Saídas previstas' }, { color: 'var(--accent)', label: 'Saldo acumulado' }]} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        {/* ÚLTIMOS LANÇAMENTOS */}
        <Card delay={200}>
          <CardHeader
            title="Últimos lançamentos"
            subtitle={isCurrent ? 'Deste mês, com hora e origem' : `De ${monthLabel(monthKey)}`}
            action={<button onClick={() => { play('tap'); p.onSeeAll() }} className="inline-flex items-center gap-1 text-sm text-accent">Ver todos <ChevronRight className="h-4 w-4" /></button>}
          />
          <ul className="divide-y divide-line px-5 pb-2">
            {data.recent.length
              ? data.recent.map((t, i) => <TransactionItem key={t.id} t={t} onDelete={p.onDelete} onPay={p.onPay} delay={i * 40} />)
              : <EmptyState emoji="✨" title="Nada por aqui ainda" text="Toque em + ou mande “s café 8” para o bot." />}
          </ul>
        </Card>

        {/* MESES ANTERIORES */}
        <Card delay={240}>
          <CardHeader title="Consolidado por mês" subtitle="Toque em um mês para abrir" />
          <ul className="px-3 pb-3">
            {data.history.length ? data.history.map((m) => {
              const max = Math.max(m.entradas, m.saidas, 1)
              return (
                <li key={m.key}>
                  <button onClick={() => { play('tap'); p.onSelectMonth(m.key) }} className="w-full rounded-2xl px-2 py-2.5 text-left transition hover:bg-surface-2 active:scale-[0.99]">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-display">{monthLabel(m.key, 'longYear')}</span>
                      <span className={cx('tabular text-sm font-semibold', m.saldo >= 0 ? 'text-income' : 'text-expense')}>{m.saldo >= 0 ? '+' : '−'} {formatBRL(Math.abs(m.saldo))}</span>
                    </div>
                    <p className="text-xs text-muted mt-0.5">
                      Entrou <span className="tabular text-income">{formatBRL(m.entradas)}</span> · Saiu <span className="tabular text-expense">{formatBRL(m.saidas)}</span>
                    </p>
                    <div className="mt-1.5 space-y-1">
                      <div className="h-1.5 rounded-full bg-income/80" style={{ width: `${(m.entradas / max) * 100}%` }} />
                      <div className="h-1.5 rounded-full bg-expense/80" style={{ width: `${(m.saidas / max) * 100}%` }} />
                    </div>
                  </button>
                </li>
              )
            }) : <EmptyState emoji="📚" title="Sem histórico ainda" text="Os meses anteriores aparecem aqui conforme você usa o app." />}
          </ul>
        </Card>
      </div>
    </div>
  )
}

function Kpi({ label, value, tone, icon, delay, hint }: { label: string; value: number; tone: 'income' | 'expense' | 'accent' | 'warn'; icon: React.ReactNode; delay: number; hint?: string }) {
  const color = { income: 'text-income bg-income/15', expense: 'text-expense bg-expense/15', accent: 'text-accent bg-accent/15', warn: 'text-warn bg-warn/15' }[tone]
  return (
    <Card className="p-4" delay={delay}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted" title={hint}>{label}</span>
        <span className={cx('rounded-xl p-1.5', color)}>{icon}</span>
      </div>
      <Money value={value} className="mt-2 block text-lg font-semibold md:text-xl" />
    </Card>
  )
}

const LEVEL_STYLE: Record<Insight['level'], string> = {
  danger: 'border-expense/50 bg-expense/10',
  warn: 'border-warn/50 bg-warn/10',
  info: 'border-info/40 bg-info/10',
  good: 'border-income/40 bg-income/10',
}

function Insights({ items }: { items: Insight[] }) {
  return (
    <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 no-scrollbar md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 xl:grid-cols-3">
      {items.map((i, idx) => (
        <div key={i.id} className={cx('w-[85%] shrink-0 snap-start rounded-3xl border p-4 animate-fade-up md:w-auto', LEVEL_STYLE[i.level])} style={{ animationDelay: `${80 + idx * 50}ms` }}>
          <p className="flex items-center gap-2 font-medium"><span className="text-lg">{i.emoji}</span>{i.title}</p>
          <p className="mt-1 text-sm text-muted">{i.text}</p>
        </div>
      ))}
    </div>
  )
}

function CategoryCard({ userId, cats, totalOut, statuses, budgets, monthKey, onBudgetsChange }: Props & {
  cats: ReturnType<typeof categoryBreakdown>
  totalOut: number
  statuses: ReturnType<typeof budgetStatus>
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const limits = Object.fromEntries(budgets.map((b) => [b.category, Number(b.monthly_limit)]))
  const spent = Object.fromEntries(cats.map((c) => [c.category, c.total]))
  // Categorias com gasto ou orçamento definido aparecem na lista
  const rows = [...new Set([...cats.map((c) => c.category), ...statuses.map((b) => b.category)])]

  async function save(category: string) {
    const v = parseFloat(value.replace(/\./g, '').replace(',', '.'))
    const { error } = Number.isFinite(v) && v > 0
      ? await supabase.from('budgets').upsert({ user_id: userId, category, monthly_limit: v }, { onConflict: 'user_id,category' })
      : await supabase.from('budgets').delete().eq('user_id', userId).eq('category', category)
    play(error ? 'error' : 'success')
    if (error) alert(error.message)
    setEditing(null)
    onBudgetsChange()
  }

  const unbudgeted = CATEGORY_NAMES.filter((c) => !rows.includes(c) && c !== 'Renda')

  return (
    <Card className="lg:col-span-2" delay={140}>
      <CardHeader title="Para onde foi o dinheiro" icon={<Target className="h-4 w-4 text-accent" />} subtitle={`Saídas de ${monthLabel(monthKey)} e orçamentos`} />
      {cats.length > 0 && (
        <div className="relative mx-auto h-44 w-44">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={cats} dataKey="total" nameKey="category" innerRadius={58} outerRadius={80} paddingAngle={3} stroke="none" cornerRadius={6}>
                {cats.map((c) => <Cell key={c.category} fill={c.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[10px] uppercase tracking-widest text-muted">Total</span>
            <span className="tabular font-semibold">{formatBRL(totalOut)}</span>
          </div>
        </div>
      )}
      <ul className="space-y-3 px-5 py-4">
        {rows.map((name) => {
          const def = getCategory(name)
          const limit = limits[name]
          const s = spent[name] || 0
          const pct = limit ? (s / limit) * 100 : totalOut ? (s / totalOut) * 100 : 0
          return (
            <li key={name}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-2 min-w-0"><span>{def.emoji}</span><span className="truncate">{name}</span></span>
                <span className="flex items-center gap-2">
                  <span className="tabular">{formatBRL(s)}</span>
                  {limit ? <span className="text-xs text-muted tabular">/ {formatBRL(limit)}</span> : null}
                  <button onClick={() => { play('tap'); setEditing(name); setValue(limit ? String(limit).replace('.', ',') : '') }} className="rounded-lg p-1 text-muted hover:text-ink" title="Definir orçamento">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full transition-[width] duration-700"
                  style={{ width: `${Math.min(100, pct)}%`, background: limit && pct >= 100 ? 'var(--expense)' : limit && pct >= 80 ? 'var(--warn)' : def.color }}
                />
              </div>
              {editing === name && (
                <form onSubmit={(e) => { e.preventDefault(); save(name) }} className="mt-2 flex gap-2 animate-fade-in">
                  <input autoFocus inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Limite mensal (vazio remove)"
                    className="h-9 flex-1 rounded-xl border border-line bg-surface-2/60 px-3 focus:outline-none focus:ring-2 focus:ring-accent/60" />
                  <button className="h-9 rounded-xl bg-accent px-3 text-sm font-medium text-accent-ink">Salvar</button>
                </form>
              )}
            </li>
          )
        })}
        {!rows.length && <EmptyState emoji="🧾" title="Sem saídas neste mês" />}
      </ul>
      {unbudgeted.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-5 pb-5">
          <span className="w-full text-xs text-muted">Definir orçamento para:</span>
          {unbudgeted.map((c) => (
            <button key={c} onClick={() => { play('tap'); setEditing(c); setValue('') }} className="rounded-full border border-dashed border-line px-2.5 py-1 text-xs text-muted hover:text-ink">
              {getCategory(c).emoji} {c}
            </button>
          ))}
          {editing && !rows.includes(editing) && (
            <form onSubmit={(e) => { e.preventDefault(); save(editing) }} className="mt-2 flex w-full gap-2 animate-fade-in">
              <input autoFocus inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={`Limite de ${editing}`}
                className="h-9 flex-1 rounded-xl border border-line bg-surface-2/60 px-3 focus:outline-none focus:ring-2 focus:ring-accent/60" />
              <button className="h-9 rounded-xl bg-accent px-3 text-sm font-medium text-accent-ink">Salvar</button>
            </form>
          )}
        </div>
      )}
    </Card>
  )
}
