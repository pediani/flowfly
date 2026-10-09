'use client'

import { useMemo, useState } from 'react'
import {
  ArrowDownRight, ArrowUpRight, ChevronRight, CircleCheck, Handshake, History, Info, OctagonAlert, Pencil, Plus,
  Receipt, Sparkles, Target, TrendingUp, TriangleAlert, type LucideIcon,
} from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { supabase } from '../lib/supabase'
import { addDays, addMonths, currentMonthKey, daysInMonth, formatDateBR, monthLabel, todayBR } from '../lib/dates'
import { buildCashFlow } from '../lib/cashflow'
import { computeSafeToSpend } from '../lib/safeToSpend'
import type { FuturePoint } from '../lib/finance'
import { detectAnomalies, detectSubscriptions } from '../lib/analysis'
import { formatBRL } from '../lib/format'
import { categoryNames, getCategory } from '../lib/categories'
import {
  budgetStatus, buildInsights, categoryBreakdown, futureProjection, monthProjection, monthlyHistory,
  overallBalance, pendingDebts, summarize,
  type Budget, type Installment, type Insight, type Recurring, type Tx,
} from '../lib/finance'
import { play } from '../lib/sounds'
import { CategoryIcon } from './CategoryIcon'
import { Legend, MonthChart, ProjectionChart } from './Charts'
import { TransactionItem } from './TransactionItem'
import GoalsCard, { type Goal } from './GoalsCard'
import SettlementCard from './SettlementCard'
import RealBalanceCard from './RealBalanceCard'
import NetWorthCard from './NetWorthCard'
import UpcomingCard from './UpcomingCard'
import { useBankBalances } from './useBankBalances'
import { Card, CardHeader, EmptyState, Money, Sheet, cx } from './ui'

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
  onEdit: (t: Tx) => void
  onBudgetsChange: () => void
  goals: Goal[]
  onGoalsChange: () => void
  partnerEmail?: string
  settlementKey: number
  onSettled: () => void
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
      insights: [
        ...(monthKey === currentMonthKey() ? detectAnomalies(txs, today).map((a): Insight => ({ id: a.key, level: a.level, emoji: '👀', title: a.title, text: a.text })) : []),
        ...(monthKey === currentMonthKey() ? detectSubscriptions(txs, recurring, today).filter((x) => x.duplicate && x.duplicate.date >= addDays(today, -15)).map((x): Insight => ({ id: `dup:${x.key}`, level: 'warn', emoji: '⚠️', title: `Possível cobrança duplicada: ${x.name}`, text: `${formatBRL(x.duplicate!.amount)} em ${formatDateBR(x.duplicate!.date).slice(0, 5)}. Confira com o banco.` })) : []),
        ...buildInsights(txs, recurring, budgets, monthKey, today),
      ].slice(0, 6),
      history: monthlyHistory(txs, 13).filter((m) => m.key !== monthKey).slice(0, 6),
      overall: overallBalance(txs),
      debts: pendingDebts(txs),
      recent: txs.filter((t) => t.date.startsWith(monthKey) && t.date <= today).slice(0, 6),
    }
  }, [txs, recurring, installments, budgets, monthKey, today])

  const { s, prev, mp } = data
  const [section, setSection] = useState<'resumo' | 'gastos' | 'futuro' | 'patrimonio'>('resumo')
  const accounts = useBankBalances(p.settlementKey)
  const hasBank = !!accounts?.some((a) => a.type === 'Conta')

  // Com banco conectado, toda previsão sai da mesma conta: saldo real + lançado depois + entradas − saídas (faturas, fixas, agendados)
  const bank = useMemo(() => {
    if (!isCurrent || !accounts?.some((a) => a.type === 'Conta')) return null
    const eom = `${monthKey}-${daysInMonth(monthKey)}`
    const unsynced = computeSafeToSpend(accounts, recurring, txs, { today })?.unsynced ?? 0
    const lastKey = addMonths(monthKey, 5)
    const flow = buildCashFlow(accounts, recurring, txs, `${lastKey}-${daysInMonth(lastKey)}`, today, { startOffset: unsynced })
    const atEom = flow.series.find((x) => x.date === eom)?.saldo ?? flow.start
    const lowMonth = flow.series.filter((x) => x.date <= eom).reduce((m, x) => (x.saldo < m.saldo ? x : m), { date: today, saldo: flow.start, label: '' })
    // Próximos meses pela mesma conta
    const future: FuturePoint[] = []
    for (let i = 0; i < 6; i++) {
      const k = addMonths(monthKey, i)
      const ev = flow.events.filter((e) => e.date.startsWith(k))
      const end = flow.series.filter((x) => x.date.startsWith(k)).pop()?.saldo ?? atEom
      const entradas = ev.filter((e) => e.amount > 0).reduce((a, e) => a + e.amount, 0)
      const saidas = -ev.filter((e) => e.amount < 0).reduce((a, e) => a + e.amount, 0)
      future.push({ key: k, label: monthLabel(k, 'short'), entradas: Math.round(entradas * 100) / 100, saidas: Math.round(saidas * 100) / 100, saldoMes: Math.round((entradas - saidas) * 100) / 100, acumulado: end, realizado: false })
    }
    const futureInst = accounts.filter((a) => a.type === 'Cartão').reduce((a, c) => a + Math.max(0, Number(c.usedLimit ?? 0) - Number(c.balance ?? 0)), 0)
    return { eom, atEom, lowMonth, future, futureInst }
  }, [isCurrent, accounts, recurring, txs, today, monthKey])

  // Avisos coerentes com o saldo do banco (os de projeção pelos lançamentos saem)
  const insights = useMemo(() => {
    if (!bank) return data.insights
    const base = data.insights.filter((i) => i.id !== 'neg' && i.id !== 'good-proj')
    const extra: Insight[] = bank.lowMonth.saldo < 0
      ? [{ id: 'bank-neg', level: 'danger', emoji: '🚨', title: `Conta fica negativa em ${formatDateBR(bank.lowMonth.date).slice(0, 5)}`, text: `Chega a ${formatBRL(bank.lowMonth.saldo)} com as faturas e contas previstas. Entre dinheiro antes ou adie algo.` }]
      : base.some((i) => i.level === 'danger' || i.level === 'warn') ? [] : [{ id: 'bank-ok', level: 'good', emoji: '🌱', title: 'Conta no azul até o fim do mês', text: `Previsão de ${formatBRL(bank.atEom)} na conta em ${formatDateBR(bank.eom).slice(0, 5)}, já pagando as faturas que vencem.` }]
    return [...extra, ...base].slice(0, 6)
  }, [bank, data.insights])
  const delta = prev.saidas > 0 ? ((s.saidas - prev.saidas) / prev.saidas) * 100 : null

  return (
    <div className="space-y-4">
      {/* TOPO: o que mais importa (no PC, em duas colunas) */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          {isCurrent && hasBank ? <RealBalanceCard txs={txs} recurring={recurring} refreshKey={p.settlementKey} /> : (
            <>
      {/* RESULTADO DO MÊS */}
      <Card className="p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm text-muted">Resultado de {monthLabel(monthKey)} <span className="text-xs">(entradas − saídas)</span></p>
            <Money value={s.saldo} className={cx('mt-1 block text-2xl font-semibold tracking-tight md:text-3xl', s.saldo < 0 && 'text-expense')} />
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {mp.isCurrent && (
              <Pill icon={Sparkles} className={mp.projectedSaldo >= 0 ? 'text-income' : 'text-expense'}>
                Previsão <b className="tabular">{formatBRL(mp.projectedSaldo)}</b>
              </Pill>
            )}
            {delta !== null && s.saidas > 0 && (
              <Pill icon={delta > 0 ? ArrowUpRight : ArrowDownRight} className={delta > 0 ? 'text-expense' : 'text-income'}>
                Saídas {delta > 0 ? '+' : ''}{Math.round(delta)}% vs {monthLabel(prev.key, 'short')}
              </Pill>
            )}
          </div>
        </div>
      </Card>
            </>
          )}
        </div>
        <div className="hidden space-y-4 lg:block">
          {isCurrent && <UpcomingCard txs={txs} recurring={recurring} refreshKey={p.settlementKey} />}
          {insights.length > 0 && <AlertsColumn items={insights} />}
        </div>
      </div>

      {/* celular: avisos em carrossel */}
      <div className="lg:hidden">{insights.length > 0 && <Insights items={insights} />}</div>

      {/* PC: o resto organizado em abas */}
      <div className="hidden gap-1 rounded-xl bg-surface-2 p-1 lg:inline-flex">
        {SECTIONS.map((x) => (
          <button key={x.id} onClick={() => { play('tap'); setSection(x.id) }} className={cx('h-9 rounded-lg px-4 text-sm font-medium transition', section === x.id ? 'bg-surface text-ink shadow-[var(--shadow)]' : 'text-muted hover:text-ink')}>
            {x.label}
          </button>
        ))}
      </div>

      <section className={cx('space-y-4', section !== 'resumo' && 'lg:hidden')}>
      {isCurrent && hasBank && (
        <>
      {/* RESULTADO DO MÊS */}
      <Card className="p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm text-muted">Lançamentos de {monthLabel(monthKey)} <span className="text-xs">(entradas − saídas registradas no mês)</span></p>
            <Money value={s.saldo} className={cx('mt-1 block text-2xl font-semibold tracking-tight md:text-3xl', s.saldo < 0 && 'text-expense')} />
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {bank && (
              <Pill icon={Sparkles} className={bank.atEom >= 0 ? 'text-income' : 'text-expense'}>
                Na conta em {formatDateBR(bank.eom).slice(0, 5)} <b className="tabular">{formatBRL(bank.atEom)}</b>
              </Pill>
            )}
            {delta !== null && s.saidas > 0 && (
              <Pill icon={delta > 0 ? ArrowUpRight : ArrowDownRight} className={delta > 0 ? 'text-expense' : 'text-income'}>
                Saídas {delta > 0 ? '+' : ''}{Math.round(delta)}% vs {monthLabel(prev.key, 'short')}
              </Pill>
            )}
          </div>
        </div>
      </Card>
        </>
      )}
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Entradas" value={s.entradas} icon={ArrowUpRight} color="text-income" delay={40} hint={bank ? 'Lançadas no mês (inclui as do banco)' : undefined} />
        <Kpi label="Saídas" value={s.saidas} icon={ArrowDownRight} color="text-expense" delay={70} hint={bank ? 'Gastos do mês pela data da compra (cartão incluso)' : undefined} />
        <Kpi label="A receber" value={s.aReceber} icon={Handshake} color="text-accent" delay={100} hint="Metade das despesas que você dividiu" />
        <Kpi label="A pagar" value={data.debts} icon={Handshake} color="text-warn" delay={130} hint="Pendências com seu parceiro" />
      </div>
      {/* ÚLTIMOS + CONSOLIDADO (mesma altura) */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card delay={170}>
          <CardHeader
            title="Últimos lançamentos"
            icon={<Receipt className="h-4 w-4 text-muted" />}
            subtitle={isCurrent ? 'Deste mês, com hora e origem' : `De ${monthLabel(monthKey)}`}
            action={<button onClick={() => { play('tap'); p.onSeeAll() }} className="inline-flex items-center gap-0.5 text-xs font-medium text-accent">Ver todos <ChevronRight className="h-3.5 w-3.5" /></button>}
          />
          {data.recent.length
            ? <ul className="divide-y divide-line px-5 pb-2">{data.recent.map((t, i) => <TransactionItem key={t.id} t={t} onDelete={p.onDelete} onPay={p.onPay} onEdit={p.onEdit} delay={i * 30} />)}</ul>
            : <EmptyState icon={Receipt} title="Nada por aqui ainda" text="Toque em + ou mande “s café 8” para o bot." />}
        </Card>

        <Card delay={200}>
          <CardHeader title="Consolidado por mês" icon={<History className="h-4 w-4 text-muted" />} subtitle="Toque em um mês para abrir" />
          {data.history.length ? (
            <ul className="px-3 pb-3">
              {data.history.map((m) => {
                const max = Math.max(m.entradas, m.saidas, 1)
                return (
                  <li key={m.key}>
                    <button onClick={() => { play('tap'); p.onSelectMonth(m.key) }} className="w-full rounded-xl px-2 py-2.5 text-left transition hover:bg-surface-2 active:scale-[0.99]">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="font-medium">{monthLabel(m.key, 'longYear')}</span>
                        <span className={cx('tabular font-semibold', m.saldo >= 0 ? 'text-income' : 'text-expense')}>{m.saldo >= 0 ? '+' : '−'} {formatBRL(Math.abs(m.saldo))}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted">
                        Entrou <span className="tabular text-ink">{formatBRL(m.entradas)}</span> · Saiu <span className="tabular text-ink">{formatBRL(m.saidas)}</span>
                      </p>
                      <div className="mt-2 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-surface-2">
                        <div className="rounded-full bg-income" style={{ width: `${(m.entradas / (m.entradas + m.saidas || 1)) * 100}%`, opacity: m.entradas / max }} />
                        <div className="rounded-full bg-expense" style={{ width: `${(m.saidas / (m.entradas + m.saidas || 1)) * 100}%`, opacity: Math.max(0.4, m.saidas / max) }} />
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : <EmptyState icon={History} title="Sem histórico ainda" text="Os meses anteriores aparecem aqui conforme você usa o app." />}
        </Card>
      </div>
      </section>
      <section className={cx('space-y-4', section !== 'gastos' && 'lg:hidden')}>
      {/* MÊS + CATEGORIAS (mesma altura) */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" delay={100}>
          <CardHeader
            title={`${monthLabel(monthKey)} dia a dia`}
            icon={<TrendingUp className="h-4 w-4 text-muted" />}
            subtitle={bank
              ? <>Lançamentos acumulados no mês (compras no cartão contam na data da compra). O saldo real da conta está em <b className="text-ink">Quanto posso gastar → Dia a dia</b>.</>
              : mp.isCurrent
              ? <>Projeção: lançado até hoje + contas fixas a vencer{mp.avgMonthlyVariable ? <> · gastos avulsos não são estimados (sua média: <b className="text-ink">{formatBRL(mp.avgMonthlyVariable)}/mês</b>)</> : null}</>
              : mp.isFuture ? 'Mês futuro: veja a projeção dos próximos meses.' : 'Saldo acumulado ao longo do mês.'}
          />
          {s.count || mp.isCurrent ? (
            <>
              <div className="relative min-h-[240px] flex-1 px-2">
                <div className="absolute inset-0 px-2"><MonthChart series={mp.series} monthShort={monthLabel(monthKey, 'short')} /></div>
              </div>
              <Legend items={[{ color: 'var(--accent)', label: 'Realizado' }, ...(mp.isCurrent ? [{ color: 'var(--muted)', label: 'Projeção até o fim do mês', dashed: true }] : [])]} />
            </>
          ) : <EmptyState icon={Receipt} title="Sem lançamentos neste mês" />}
        </Card>

        <CategoryCard {...p} cats={data.cats} totalOut={s.saidas} />
      </div>
      </section>
      <section className={cx('space-y-4', section !== 'futuro' && 'lg:hidden')}>
      {/* PROJEÇÃO 6 MESES */}
      <Card delay={140}>
        <CardHeader
          title="Projeção dos próximos meses"
          icon={<Sparkles className="h-4 w-4 text-muted" />}
          subtitle={bank
            ? <>Saldo previsto da conta, mês a mês: faturas já conhecidas, contas fixas e lançamentos agendados. A linha é o saldo no fim de cada mês.{bank.futureInst > 0 ? <> Parcelas futuras do cartão ({formatBRL(bank.futureInst)}) ainda não entram: o banco só informa o total.</> : null}</>
            : 'Só compromissos conhecidos: contas fixas e parcelas agendadas. A linha é o saldo acumulado.'}
        />
        <div className="h-[250px] px-2"><ProjectionChart data={bank ? bank.future : data.future} /></div>
        <Legend items={[{ color: 'var(--income)', label: 'Entradas' }, { color: 'var(--expense)', label: 'Saídas' }, { color: 'var(--accent)', label: 'Saldo acumulado' }]} />
      </Card>
      </section>
      <section className={cx('space-y-4', section !== 'patrimonio' && 'lg:hidden')}>
      {isCurrent && <NetWorthCard refreshKey={p.settlementKey} txs={txs} recurring={recurring} />}
      {/* METAS + ACERTO */}
      <div className={cx('grid gap-4', p.partnerEmail && 'lg:grid-cols-2')}>
        <GoalsCard goals={p.goals} onChange={p.onGoalsChange} />
        {p.partnerEmail && <SettlementCard partnerEmail={p.partnerEmail} refreshKey={p.settlementKey} onSettled={p.onSettled} />}
      </div>
      </section>
    </div>
  )
}

const SECTIONS = [
  { id: 'resumo', label: 'Resumo do mês' },
  { id: 'gastos', label: 'Gastos' },
  { id: 'futuro', label: 'Próximos meses' },
  { id: 'patrimonio', label: 'Patrimônio e metas' },
] as const

/** Avisos em coluna (PC): os 3 mais importantes */
function AlertsColumn({ items }: { items: Insight[] }) {
  return (
    <Card className="p-4" delay={60}>
      <p className="mb-2 text-xs font-medium text-muted">Avisos</p>
      <ul className="space-y-3">
        {items.slice(0, 3).map((i) => {
          const { icon: Icon, color } = LEVEL[i.level]
          return (
            <li key={i.id} className="flex gap-2.5">
              <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', color)}><Icon className="h-3.5 w-3.5" /></span>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight">{i.title}</p>
                <p className="mt-0.5 text-xs text-muted">{i.text}</p>
              </div>
            </li>
          )
        })}
      </ul>
      {items.length > 3 && <p className="mt-2 text-[11px] text-muted">+{items.length - 3} outro(s) aviso(s)</p>}
    </Card>
  )
}

function Pill({ icon: Icon, children, className }: { icon: LucideIcon; children: React.ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-muted', className)}>
      <Icon className="h-3.5 w-3.5" />
      <span className="[&>b]:font-medium [&>b]:text-ink">{children}</span>
    </span>
  )
}

function Kpi({ label, value, icon: Icon, color, delay, hint }: { label: string; value: number; icon: LucideIcon; color: string; delay: number; hint?: string }) {
  return (
    <Card className="p-4" delay={delay}>
      <div className="flex items-center justify-between text-muted" title={hint}>
        <span className="text-xs">{label}</span>
        <Icon className={cx('h-4 w-4', color)} />
      </div>
      <Money value={value} className="mt-2 block text-lg font-semibold tracking-tight md:text-xl" />
    </Card>
  )
}

const LEVEL: Record<Insight['level'], { icon: LucideIcon; color: string }> = {
  danger: { icon: OctagonAlert, color: 'text-expense bg-expense/10' },
  warn: { icon: TriangleAlert, color: 'text-warn bg-warn/10' },
  info: { icon: Info, color: 'text-info bg-info/10' },
  good: { icon: CircleCheck, color: 'text-income bg-income/10' },
}

function Insights({ items }: { items: Insight[] }) {
  return (
    <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 no-scrollbar md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 xl:grid-cols-3">
      {items.map((i, idx) => {
        const { icon: Icon, color } = LEVEL[i.level]
        return (
          <div key={i.id} className="flex w-[85%] shrink-0 snap-start gap-3 rounded-2xl border border-line bg-surface p-4 shadow-[var(--shadow)] animate-fade-up md:w-auto" style={{ animationDelay: `${60 + idx * 40}ms` }}>
            <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', color)}><Icon className="h-4 w-4" /></span>
            <div className="min-w-0">
              <p className="text-sm font-medium">{i.title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted">{i.text}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function CategoryCard({ userId, cats, totalOut, budgets, monthKey, onBudgetsChange, txs, onEdit, onDelete, onPay }: Props & {
  cats: ReturnType<typeof categoryBreakdown>
  totalOut: number
}) {
  const [drill, setDrill] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [adding, setAdding] = useState(false)
  const [newCat, setNewCat] = useState('')
  const limits = Object.fromEntries(budgets.map((b) => [b.category, Number(b.monthly_limit)]))
  const spent = Object.fromEntries(cats.map((c) => [c.category, c.total]))
  // Categorias com gasto ou com orçamento definido
  const rows = [...new Set([...cats.map((c) => c.category), ...budgets.map((b) => b.category)])]
  const available = categoryNames().filter((c) => !limits[c] && c !== 'Renda')

  async function save(category: string, raw: string) {
    const v = parseFloat(raw.replace(/\./g, '').replace(',', '.'))
    const { error } = Number.isFinite(v) && v > 0
      ? await supabase.from('budgets').upsert({ user_id: userId, category, monthly_limit: v }, { onConflict: 'user_id,category' })
      : await supabase.from('budgets').delete().eq('user_id', userId).eq('category', category)
    play(error ? 'error' : 'success')
    if (error) alert(error.message)
    setEditing(null); setAdding(false); setValue(''); setNewCat('')
    onBudgetsChange()
  }

  const smallInput = 'h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 focus:outline-none focus:border-accent'

  return (
    <Card className="lg:col-span-2" delay={120}>
      <CardHeader
        title="Para onde foi o dinheiro"
        icon={<Target className="h-4 w-4 text-muted" />}
        subtitle={`Saídas de ${monthLabel(monthKey)} e orçamentos`}
        action={available.length > 0 && !adding && (
          <button onClick={() => { play('tap'); setAdding(true); setNewCat(available[0]) }} className="inline-flex items-center gap-1 text-xs font-medium text-accent">
            <Plus className="h-3.5 w-3.5" /> Orçamento
          </button>
        )}
      />

      {adding && (
        <form onSubmit={(e) => { e.preventDefault(); save(newCat, value) }} className="mx-5 mb-3 flex gap-2 animate-fade-in">
          <select value={newCat} onChange={(e) => setNewCat(e.target.value)} className={smallInput}>
            {available.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input autoFocus inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Limite" className={cx(smallInput, 'max-w-24')} />
          <button className="h-9 rounded-lg bg-accent px-3 text-sm font-medium text-accent-ink">OK</button>
        </form>
      )}

      {rows.length ? (
        <div className="flex flex-1 flex-col">
          {cats.length > 0 && (
            <div className="relative mx-auto h-32 w-32">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={cats} dataKey="total" nameKey="category" innerRadius={46} outerRadius={62} paddingAngle={2} stroke="none" cornerRadius={3}
                    onClick={(_d, index) => { const c = cats[index]?.category; if (c) { play('open'); setDrill(c) } }} className="cursor-pointer">
                    {cats.map((c) => <Cell key={c.category} fill={c.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[10px] text-muted">Total</span>
                <span className="tabular text-sm font-semibold">{formatBRL(totalOut)}</span>
              </div>
            </div>
          )}
          <ul className="space-y-3 px-5 py-4">
            {rows.slice(0, 6).map((name) => {
              const def = getCategory(name)
              const limit = limits[name]
              const sp = spent[name] || 0
              const pct = limit ? (sp / limit) * 100 : totalOut ? (sp / totalOut) * 100 : 0
              return (
                <li key={name}>
                  <div className="flex items-center gap-2.5 text-sm">
                    <CategoryIcon category={name} size="sm" />
                    <button onClick={() => { play('open'); setDrill(name) }} className="min-w-0 flex-1 truncate text-left hover:text-accent hover:underline" title="Ver lançamentos">{name}</button>
                    <span className="tabular">{formatBRL(sp)}</span>
                    {limit ? <span className="tabular text-xs text-muted">/ {formatBRL(limit)}</span> : null}
                    <button onClick={() => { play('tap'); setEditing(editing === name ? null : name); setValue(limit ? String(limit).replace('.', ',') : '') }} className="rounded-md p-1 text-muted hover:text-ink" title="Definir orçamento">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="ml-[38px] mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full transition-[width] duration-700"
                      style={{ width: `${Math.min(100, pct)}%`, background: limit && pct >= 100 ? 'var(--expense)' : limit && pct >= 80 ? 'var(--warn)' : def.color }}
                    />
                  </div>
                  {editing === name && (
                    <form onSubmit={(e) => { e.preventDefault(); save(name, value) }} className="ml-[38px] mt-2 flex gap-2 animate-fade-in">
                      <input autoFocus inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Limite mensal (vazio remove)" className={smallInput} />
                      <button className="h-9 rounded-lg bg-accent px-3 text-sm font-medium text-accent-ink">Salvar</button>
                    </form>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ) : <EmptyState icon={Receipt} title="Sem saídas neste mês" text="Defina orçamentos em “+ Orçamento”." />}
      <Sheet open={!!drill} onClose={() => setDrill(null)} title={drill ? `${drill} · ${monthLabel(monthKey)}` : ''}>
        {drill && (() => {
          const list = txs.filter((t) => t.date.startsWith(monthKey) && (t.category || 'Geral') === drill && (t.type === 'saida' || t.type === 'a_pagar'))
            .sort((a, b) => Number(b.amount) - Number(a.amount))
          const sum = list.filter((t) => t.type === 'saida').reduce((a, t) => a + Number(t.amount), 0)
          const limit = limits[drill]
          return (
            <div className="pb-3">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-2xl font-semibold tabular">{formatBRL(sum)}</p>
                <p className="text-xs text-muted">{list.length} lançamento(s){totalOut ? ` · ${Math.round((sum / totalOut) * 100)}% das saídas` : ''}{limit ? ` · orçamento ${formatBRL(limit)}` : ''}</p>
              </div>
              {list.length
                ? <ul className="divide-y divide-line">{list.map((t, i) => <TransactionItem key={t.id} t={t} onEdit={(x) => { setDrill(null); onEdit(x) }} onDelete={onDelete} onPay={onPay} delay={i * 20} />)}</ul>
                : <EmptyState icon={Receipt} title="Nenhum lançamento nesta categoria" />}
            </div>
          )
        })()}
      </Sheet>
    </Card>
  )
}
