'use client'

import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, ChevronDown, CreditCard, Landmark, Repeat, Send, ShoppingBag, Sparkles, TriangleAlert, Wallet } from 'lucide-react'
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { formatBRL } from '../lib/format'
import { formatDateBR, relativeTimeBR, todayBR } from '../lib/dates'
import { cardsForPurchase, computeSafeToSpend, purchaseEvents } from '../lib/safeToSpend'
import type { Recurring, Tx } from '../lib/finance'
import { play } from '../lib/sounds'
import { Card, Money, cx } from './ui'
import { useBankBalances } from './useBankBalances'

const RESERVE_KEY = 'flowfly:reserve'
const readReserve = () => { try { return Number(localStorage.getItem(RESERVE_KEY)) || 0 } catch { return 0 } }
const d5 = (iso: string) => formatDateBR(iso).slice(0, 5)

/** "Quanto posso gastar": topo da dashboard quando há banco conectado. */
export default function RealBalanceCard({ txs, recurring, refreshKey }: { txs: Tx[]; recurring: Recurring[]; refreshKey: number }) {
  const accounts = useBankBalances(refreshKey)
  const [reserve, setReserve] = useState(readReserve)
  const [editingReserve, setEditingReserve] = useState(false)
  const [open, setOpen] = useState<'dias' | 'comprar' | 'contas' | null>(null)
  // simulador
  const [simAmount, setSimAmount] = useState('')
  const [simInst, setSimInst] = useState(1)
  const [simCard, setSimCard] = useState<string>('auto')

  const today = todayBR()
  const cards = useMemo(() => (accounts ? cardsForPurchase(accounts, today) : []), [accounts, today])
  const safe = useMemo(() => (accounts?.length ? computeSafeToSpend(accounts, recurring, txs, { today, reserve }) : null), [accounts, recurring, txs, today, reserve])

  const simValue = parseFloat(simAmount.replace(/\./g, '').replace(',', '.'))
  const chosenCard = simCard === 'pix' ? null : simCard === 'auto' ? cards[0] ?? null : cards.find((c) => `${c.institution}${c.last4}` === simCard) ?? null
  const sim = useMemo(() => {
    if (!accounts?.length || !(simValue > 0)) return null
    return computeSafeToSpend(accounts, recurring, txs, { today, reserve, extra: purchaseEvents(simValue, chosenCard ? simInst : 1, chosenCard, today) })
  }, [accounts, recurring, txs, today, reserve, simValue, simInst, chosenCard])

  if (!accounts?.length || !safe) return null
  const negative = safe.available < 0
  const toggle = (k: typeof open) => { play('tap'); setOpen(open === k ? null : k) }

  return (
    <Card className="p-5 md:p-6">
      <p className="text-sm text-muted">Quanto posso gastar</p>
      <Money value={safe.available} className={cx('mt-1 block text-5xl font-semibold tracking-tight md:text-6xl', negative ? 'text-expense' : 'text-ink')} />
      <p className="mt-2 text-sm text-muted">
        {negative
          ? <>Faltam <b className="text-expense">{formatBRL(-safe.available)}</b> para cobrir tudo até {d5(safe.until)}.</>
          : <>até <b className="text-ink">{d5(safe.until)}</b>{safe.nextIncome ? <> (véspera de {safe.nextIncome.label})</> : null} · cerca de <b className="text-ink">{formatBRL(safe.perDay)}/dia</b></>}
      </p>

      {safe.shortfall && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-expense/40 bg-expense/5 p-3 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-expense" />
          <span>Em <b>{d5(safe.shortfall.date)}</b> o saldo fica em <b className="text-expense">{formatBRL(safe.shortfall.value)}</b>. Antes disso, entre dinheiro ou adie algum pagamento.</span>
        </p>
      )}

      {/* Como chegamos nesse número */}
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Step icon={Landmark} label="No banco agora" value={safe.bankBalance} hint={safe.bankDate ? `atualizado ${relativeTimeBR(accounts.map((a) => a.updatedAt).filter(Boolean).sort().pop()!)}` : undefined} />
        <Step icon={Send} label="Lançado depois" value={safe.unsynced} hint={safe.unsyncedCount ? `${safe.unsyncedCount} no Telegram/painel, ainda fora do banco` : 'nada pendente'} />
        <Step icon={ArrowUpRight} label={`Entra até ${d5(safe.until)}`} value={safe.incoming} tone="text-income" hint="contas fixas e lançamentos agendados" />
        <Step icon={ArrowDownRight} label={`Sai até ${d5(safe.until)}`} value={safe.outgoing} tone="text-expense" hint="faturas, contas fixas e agendados" />
      </div>
      <p className="mt-2 text-[11px] text-muted">
        É o <b>menor saldo</b> que sua conta terá até {d5(safe.until)} ({formatBRL(safe.flow.min.value)} em {d5(safe.flow.min.date)})
        {' '}menos a reserva de segurança de{' '}
        {editingReserve ? (
          <input autoFocus inputMode="decimal" defaultValue={reserve || ''} onBlur={(e) => { const v = Math.max(0, parseFloat(e.target.value.replace(',', '.')) || 0); setReserve(v); try { localStorage.setItem(RESERVE_KEY, String(v)) } catch {} setEditingReserve(false) }}
            className="w-20 rounded border border-line bg-surface px-1 text-[11px]" />
        ) : <button onClick={() => setEditingReserve(true)} className="font-medium text-accent underline-offset-2 hover:underline">{formatBRL(reserve)}</button>}.
        {' '}Gastou? Lance no Telegram e o valor já desconta aqui.
      </p>

      {/* Melhor cartão */}
      {cards[0] && (
        <p className="mt-3 flex items-start gap-2 rounded-xl bg-surface-2 p-3 text-xs">
          <CreditCard className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
          <span>Comprando no cartão hoje, o melhor é o <b>{cards[0].institution} ·{cards[0].last4}</b>: cai na fatura que vence em <b>{d5(cards[0].due)}</b>.
            {cards.length > 1 && <span className="text-muted"> Depois: {cards.slice(1).map((c) => `${c.institution} ·${c.last4} (${d5(c.due)})`).join(', ')}.</span>}
          </span>
        </p>
      )}

      {/* Abas */}
      <div className="mt-4 flex flex-wrap gap-2">
        <Tab active={open === 'dias'} onClick={() => toggle('dias')} icon={Sparkles}>Dia a dia</Tab>
        <Tab active={open === 'comprar'} onClick={() => toggle('comprar')} icon={ShoppingBag}>Posso comprar?</Tab>
        <Tab active={open === 'contas'} onClick={() => toggle('contas')} icon={Wallet}>Contas e cartões</Tab>
      </div>

      {open === 'dias' && (
        <div className="mt-3 animate-fade-in">
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={safe.flow.series} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                <defs><linearGradient id="ff-safe" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} /><stop offset="100%" stopColor="var(--accent)" stopOpacity={0} /></linearGradient></defs>
                <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
                <ReferenceLine y={0} stroke="var(--expense)" strokeOpacity={0.5} strokeDasharray="3 3" />
                <Tooltip cursor={{ stroke: 'var(--line)' }} content={({ active, payload }) => active && payload?.length ? (
                  <div className="rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg">{String(payload[0].payload.label)} · <b className="tabular">{formatBRL(Number(payload[0].value))}</b></div>
                ) : null} />
                <Area type="stepAfter" dataKey="saldo" stroke="var(--accent)" strokeWidth={2} fill="url(#ff-safe)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <EventList events={safe.flow.events} />
        </div>
      )}

      {open === 'comprar' && (
        <div className="mt-3 space-y-3 rounded-xl border border-line p-3 animate-fade-in">
          <div className="grid grid-cols-3 gap-2">
            <input inputMode="decimal" value={simAmount} onChange={(e) => setSimAmount(e.target.value)} placeholder="Valor (R$)" className="h-10 rounded-lg border border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none" />
            <select value={simCard} onChange={(e) => setSimCard(e.target.value)} className="h-10 rounded-lg border border-line bg-surface px-2 text-sm">
              <option value="auto">Melhor cartão</option>
              {cards.map((c) => <option key={c.institution + c.last4} value={`${c.institution}${c.last4}`}>{c.institution} ·{c.last4}</option>)}
              <option value="pix">Pix / débito</option>
            </select>
            <select value={simInst} onChange={(e) => setSimInst(Number(e.target.value))} disabled={simCard === 'pix'} className="h-10 rounded-lg border border-line bg-surface px-2 text-sm">
              {[1, 2, 3, 4, 5, 6, 8, 10, 12, 18, 24].map((n) => <option key={n} value={n}>{n === 1 ? 'À vista' : `${n}x`}</option>)}
            </select>
          </div>
          {sim ? (
            <div className={cx('rounded-lg p-3 text-sm', sim.available >= 0 ? 'bg-income/10' : 'bg-expense/10')}>
              {sim.available >= 0
                ? <>✅ <b>Cabe.</b> Depois da compra, você ainda poderia gastar <b>{formatBRL(sim.available)}</b> até {d5(sim.until)} (hoje: {formatBRL(safe.available)}).</>
                : <>⚠️ <b>Não cabe agora.</b> Faltariam <b>{formatBRL(-sim.available)}</b>{sim.shortfall ? <> — o saldo ficaria em {formatBRL(sim.shortfall.value)} em {d5(sim.shortfall.date)}</> : null}.</>}
              {chosenCard && <p className="mt-1 text-xs text-muted">{simInst > 1 ? `${simInst}x de ${formatBRL(simValue / simInst)}` : 'À vista'} no {chosenCard.institution} ·{chosenCard.last4}, 1ª parcela na fatura de {d5(chosenCard.due)}. Parcelas depois de {d5(sim.until)} não entram nesta conta.</p>}
            </div>
          ) : <p className="text-xs text-muted">Digite um valor para ver o impacto no seu saldo até {d5(safe.until)}.</p>}
        </div>
      )}

      {open === 'contas' && (
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 animate-fade-in">
          {accounts.map((a, i) => (
            <div key={i} className="flex min-w-0 items-center gap-3 rounded-xl border border-line px-3 py-2.5">
              <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', a.type === 'Cartão' ? 'bg-expense/10 text-expense' : 'bg-income/10 text-income')}>
                {a.type === 'Cartão' ? <CreditCard className="h-4 w-4" /> : <Landmark className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{a.institution} · {a.name}{a.last4 ? ` ·${a.last4}` : ''}</p>
                <p className="text-[11px] text-muted">
                  {a.type === 'Cartão'
                    ? <>Fatura aberta{a.openCloses ? ` · fecha ${d5(a.openCloses)}` : ''}{a.openDue ? ` · vence ${d5(a.openDue)}` : ''}{a.closedDue ? ` · fechada a pagar ${formatBRL(a.closedDue)}` : ''}</>
                    : 'Saldo disponível'}
                </p>
              </div>
              <span className={cx('shrink-0 whitespace-nowrap tabular text-sm font-semibold', a.type === 'Cartão' || a.balance < 0 ? 'text-expense' : 'text-ink')}>
                {a.type === 'Cartão' || a.balance < 0 ? '−' : ''} {formatBRL(Math.abs(a.type === 'Cartão' ? (a.openBill ?? a.balance) : a.balance))}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function Step({ icon: Icon, label, value, hint, tone }: { icon: typeof Landmark; label: string; value: number; hint?: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 p-2.5 sm:p-3" title={hint}>
      <p className="flex items-start gap-1 text-[10px] leading-tight text-muted sm:text-[11px]"><Icon className="mt-px h-3 w-3 shrink-0" /> {label}</p>
      <p className={cx('mt-1 whitespace-nowrap tabular text-xs font-semibold sm:text-sm', tone)}>{value < 0 ? '−' : value > 0 && tone ? '+' : ''} {formatBRL(Math.abs(value))}</p>
      {hint && <p className="mt-0.5 truncate text-[10px] text-muted">{hint}</p>}
    </div>
  )
}

function Tab({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof Landmark; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={cx('inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition', active ? 'border-accent bg-accent/10 text-ink' : 'border-line text-muted hover:text-ink')}>
      <Icon className="h-3.5 w-3.5" /> {children}
      <ChevronDown className={cx('h-3 w-3 transition-transform', active && 'rotate-180')} />
    </button>
  )
}

export function EventList({ events }: { events: { date: string; label: string; amount: number; kind: string }[] }) {
  if (!events.length) return <p className="mt-2 text-xs text-muted">Nada previsto no período.</p>
  return (
    <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
      {events.map((e, i) => (
        <li key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
          <span className="w-11 shrink-0 tabular text-xs text-muted">{d5(e.date)}</span>
          <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', e.kind === 'fatura' ? 'bg-expense/10 text-expense' : e.amount > 0 ? 'bg-income/10 text-income' : 'bg-surface-2 text-muted')}>
            {e.kind === 'fatura' ? <CreditCard className="h-3.5 w-3.5" /> : e.kind === 'fixa' ? <Repeat className="h-3.5 w-3.5" /> : e.amount > 0 ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
          </span>
          <span className="min-w-0 flex-1 truncate">{e.label}</span>
          <span className={cx('shrink-0 tabular font-medium', e.amount > 0 ? 'text-income' : 'text-ink')}>{e.amount > 0 ? '+' : '−'} {formatBRL(Math.abs(e.amount))}</span>
        </li>
      ))}
    </ul>
  )
}
