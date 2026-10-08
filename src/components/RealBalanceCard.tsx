'use client'

import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight, CreditCard, Hourglass, Landmark, Repeat, Send, ShoppingBag, Sparkles, TriangleAlert, Wallet } from 'lucide-react'
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { formatBRL } from '../lib/format'
import { formatDateBR, relativeTimeBR, todayBR } from '../lib/dates'
import { bestCardTimeline, cardsForPurchase, computeSafeToSpend, daysBetween, purchaseEvents, type SafeToSpend } from '../lib/safeToSpend'
import type { BankBalance } from '../lib/pluggy'
import type { Recurring, Tx } from '../lib/finance'
import { play } from '../lib/sounds'
import { Card, Money, Sheet, cx } from './ui'
import { useBankBalances } from './useBankBalances'
import CardBillSheet from './CardBillSheet'

const RESERVE_KEY = 'flowfly:reserve'
const readReserve = () => { try { return Number(localStorage.getItem(RESERVE_KEY)) || 0 } catch { return 0 } }
const d5 = (iso: string) => formatDateBR(iso).slice(0, 5)

/** "Quanto posso gastar": topo da dashboard quando há banco conectado. */
export default function RealBalanceCard({ txs, recurring, refreshKey }: { txs: Tx[]; recurring: Recurring[]; refreshKey: number }) {
  const accounts = useBankBalances(refreshKey)
  const [reserve, setReserve] = useState(readReserve)
  const [editingReserve, setEditingReserve] = useState(false)
  const [showHow, setShowHow] = useState(false)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [bestOpen, setBestOpen] = useState(false)
  const [cardOpen, setCardOpen] = useState<string | null>(null)
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
          : <>sobra até <b className="text-ink">{d5(safe.until)}</b>{safe.nextIncome ? <> (véspera de {safe.nextIncome.label})</> : null} · cerca de <b className="text-ink">{formatBRL(safe.perDay)}/dia</b></>}
      </p>

      {!safe.shortfall && safe.safeNow < safe.available - 0.01 && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-warn/40 bg-warn/5 p-3 text-sm">
          <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
          <span>Agora, use no máximo <b>{formatBRL(Math.max(0, safe.safeNow))}</b>. O resto depende do que ainda vai entrar{(() => { const n = safe.flow.events.find((e) => e.amount > 0); return n ? <> (próxima entrada: {n.label} em {d5(n.date)})</> : null })()}.</span>
        </p>
      )}

      {safe.shortfall && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-expense/40 bg-expense/5 p-3 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-expense" />
          <span>Em <b>{d5(safe.shortfall.date)}</b> o saldo fica em <b className="text-expense">{formatBRL(safe.shortfall.value)}</b>. Antes disso, entre dinheiro ou adie algum pagamento.</span>
        </p>
      )}

      {/* Como chegamos nesse número */}
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Step onClick={() => setDetail('banco')} icon={Landmark} label="No banco agora" value={safe.bankBalance} hint={safe.bankDate ? `atualizado ${relativeTimeBR(accounts.map((a) => a.updatedAt).filter(Boolean).sort().pop()!)}` : undefined} />
        <Step onClick={() => setDetail('lancado')} icon={Send} label="Lançado depois" value={safe.unsynced} hint={safe.unsyncedCount ? `${safe.unsyncedCount} fora do banco ainda` : 'nada pendente'} />
        <Step onClick={() => setDetail('entra')} icon={ArrowUpRight} label={`Entra até ${d5(safe.until)}`} value={safe.incoming} tone="text-income" hint={`${safe.flow.events.filter((e) => e.amount > 0).length} entradas · ver`} />
        <Step onClick={() => setDetail('sai')} icon={ArrowDownRight} label={`Sai até ${d5(safe.until)}`} value={safe.outgoing} tone="text-expense" hint={`${safe.flow.events.filter((e) => e.amount < 0).length} saídas · ver`} />
      </div>
      <button onClick={() => setShowHow(!showHow)} className="mt-2 text-[11px] font-medium text-accent">{showHow ? 'Ocultar' : 'Como chegamos nesse número?'}</button>
      {showHow && <p className="mt-1 text-[11px] text-muted">
        <b>{formatBRL(safe.bankBalance)}</b> no banco {safe.unsynced >= 0 ? '+' : '−'} {formatBRL(Math.abs(safe.unsynced))} lançado depois
        {' '}+ <b className="text-income">{formatBRL(safe.incoming)}</b> que entra − <b className="text-expense">{formatBRL(-safe.outgoing)}</b> que sai até {d5(safe.until)}
        {' '}= {formatBRL(safe.flow.end)}, menos a reserva de segurança de{' '}
        {editingReserve ? (
          <input autoFocus inputMode="decimal" defaultValue={reserve || ''} onBlur={(e) => { const v = Math.max(0, parseFloat(e.target.value.replace(',', '.')) || 0); setReserve(v); try { localStorage.setItem(RESERVE_KEY, String(v)) } catch {} setEditingReserve(false) }}
            className="w-20 rounded border border-line bg-surface px-1 text-[11px]" />
        ) : <button onClick={() => setEditingReserve(true)} className="font-medium text-accent underline-offset-2 hover:underline">{formatBRL(reserve)}</button>}.
        {' '}O menor saldo no caminho é {formatBRL(safe.low.value)} em {d5(safe.low.date)}. Clique em cada bloco para ver os itens.
        {' '}Gastou? Lance no Telegram e o valor já desconta aqui.
      </p>}

      {/* Melhor cartão */}
      {cards[0] && (
        <button onClick={() => { play('tap'); setBestOpen(true) }} className="group mt-3 flex w-full items-center gap-3 rounded-xl bg-surface-2 p-3 text-left text-xs transition hover:bg-accent/10">
          <BestCardIcon />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] text-muted">Melhor cartão hoje</span>
            <span className="block truncate"><b>{cards[0].institution} ·{cards[0].last4}</b> · vence {d5(cards[0].due)} · <b className="text-accent">{daysBetween(today, cards[0].due)} dias</b> para pagar</span>
          </span>
          <span className="flex shrink-0 items-center gap-0.5 text-[11px] font-medium text-accent">por data <ChevronRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span>
        </button>
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
            <div className={cx('rounded-lg p-3 text-sm', sim.available >= 0 && sim.safeNow >= 0 ? 'bg-income/10' : 'bg-expense/10')}>
              {sim.available >= 0 && sim.safeNow >= 0
                ? <>✅ <b>Cabe.</b> Depois da compra, ainda sobrariam <b>{formatBRL(sim.available)}</b> até {d5(sim.until)} (hoje: {formatBRL(safe.available)}).</>
                : <>⚠️ <b>Não cabe agora.</b> Faltariam <b>{formatBRL(-Math.min(sim.available, sim.safeNow))}</b>{sim.shortfall ? <> — o saldo ficaria em {formatBRL(sim.shortfall.value)} em {d5(sim.shortfall.date)}</> : null}.</>}
              {chosenCard && <p className="mt-1 text-xs text-muted">{simInst > 1 ? `${simInst}x de ${formatBRL(simValue / simInst)}` : 'À vista'} no {chosenCard.institution} ·{chosenCard.last4}, 1ª parcela na fatura de {d5(chosenCard.due)}. Parcelas depois de {d5(sim.until)} não entram nesta conta.</p>}
            </div>
          ) : <p className="text-xs text-muted">Digite um valor para ver o impacto no seu saldo até {d5(safe.until)}.</p>}
        </div>
      )}

      <DetailSheet detail={detail} onClose={() => setDetail(null)} safe={safe} accounts={accounts} />
      <CardBillSheet card={accounts.find((a) => (a.id || a.last4) === cardOpen) ?? null} onClose={() => setCardOpen(null)} />
      <BestCardSheet open={bestOpen} onClose={() => setBestOpen(false)} accounts={accounts} today={today} />

      {open === 'contas' && (
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 animate-fade-in">
          {accounts.map((a, i) => (
            <button type="button" key={i} disabled={a.type !== 'Cartão'} onClick={() => { play('tap'); setCardOpen(a.id || a.last4) }} className="flex min-w-0 items-center gap-3 rounded-xl border border-line px-3 py-2.5 text-left transition enabled:hover:border-accent">
              <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', a.type === 'Cartão' ? 'bg-expense/10 text-expense' : 'bg-income/10 text-income')}>
                {a.type === 'Cartão' ? <CreditCard className="h-4 w-4" /> : <Landmark className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{a.institution} · {a.name}{a.last4 ? ` ·${a.last4}` : ''}</p>
                <p className="text-[11px] text-muted">
                  {a.type === 'Cartão'
                    ? <>Fatura aberta · ver itens{a.openCloses ? ` · fecha ${d5(a.openCloses)}` : ''}{a.openDue ? ` · vence ${d5(a.openDue)}` : ''}{a.closedDue ? ` · fechada a pagar ${formatBRL(a.closedDue)}` : ''}</>
                    : 'Saldo disponível'}
                </p>
              </div>
              <span className={cx('shrink-0 whitespace-nowrap tabular text-sm font-semibold', a.type === 'Cartão' || a.balance < 0 ? 'text-expense' : 'text-ink')}>
                {a.type === 'Cartão' || a.balance < 0 ? '−' : ''} {formatBRL(Math.abs(a.type === 'Cartão' ? (a.openBill ?? a.balance) : a.balance))}
              </span>
            </button>
          ))}
        </div>
      )}
    </Card>
  )
}

function Step({ icon: Icon, label, value, hint, tone, onClick }: { icon: typeof Landmark; label: string; value: number; hint?: string; tone?: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={() => { play('tap'); onClick?.() }} className="min-w-0 rounded-xl bg-surface-2 p-2.5 text-left transition hover:bg-accent/10 sm:p-3" title={hint}>
      <p className="flex items-start gap-1 text-[10px] leading-tight text-muted sm:text-[11px]"><Icon className="mt-px h-3 w-3 shrink-0" /> {label}</p>
      <p className={cx('mt-1 whitespace-nowrap tabular text-xs font-semibold sm:text-sm', tone)}>{value < 0 ? '−' : value > 0 && tone ? '+' : ''} {formatBRL(Math.abs(value))}</p>
      {hint && <p className="mt-0.5 truncate text-[10px] text-muted">{hint}</p>}
    </button>
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

type Detail = 'banco' | 'lancado' | 'entra' | 'sai'

const KIND_LABEL: Record<string, string> = { fatura: 'Faturas de cartão', fixa: 'Contas fixas', agendado: 'Lançamentos com data futura', simulado: 'Simulação' }
const KIND_HINT: Record<string, string> = {
  fatura: 'Valor da fatura informado pelo banco (Open Finance), no dia do vencimento.',
  fixa: 'Cadastradas na aba Fixas e ainda não lançadas neste mês.',
  agendado: 'Lançamentos com data depois de hoje (parcelas, Telegram, painel).',
  simulado: '',
}

function DetailSheet({ detail, onClose, safe, accounts }: { detail: Detail | null; onClose: () => void; safe: SafeToSpend; accounts: BankBalance[] }) {
  const until = d5(safe.until)
  const title = detail === 'banco' ? 'No banco agora' : detail === 'lancado' ? 'Lançado depois do banco' : detail === 'entra' ? `O que entra até ${until}` : `O que sai até ${until}`
  const events = safe.flow.events.filter((e) => (detail === 'entra' ? e.amount > 0 : e.amount < 0))
  const groups = ['fatura', 'fixa', 'agendado', 'simulado'].map((k) => ({ k, items: events.filter((e) => e.kind === k) })).filter((g) => g.items.length)
  const total = (detail === 'entra' || detail === 'sai') ? events.reduce((s, e) => s + e.amount, 0) : detail === 'banco' ? safe.bankBalance : safe.unsynced

  return (
    <Sheet open={!!detail} onClose={onClose} title={title}>
      <div className="space-y-4 pb-2 text-sm">
        <div className="rounded-xl bg-surface-2 p-3">
          <p className="text-xs text-muted">Total</p>
          <p className={cx('tabular text-2xl font-semibold', detail === 'entra' ? 'text-income' : detail === 'sai' ? 'text-expense' : 'text-ink')}>{total < 0 ? '−' : ''} {formatBRL(Math.abs(total))}</p>
          <p className="mt-1 text-[11px] text-muted">
            {formatBRL(safe.bankBalance)} {safe.unsynced >= 0 ? '+' : '−'} {formatBRL(Math.abs(safe.unsynced))} + {formatBRL(safe.incoming)} − {formatBRL(-safe.outgoing)}{safe.reserve ? ` − ${formatBRL(safe.reserve)} reserva` : ''} = <b className="text-ink">{formatBRL(safe.available)}</b> para gastar
          </p>
        </div>

        {detail === 'banco' && (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {accounts.filter((a) => a.type === 'Conta').map((a, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-2.5">
                <Landmark className="h-4 w-4 shrink-0 text-income" />
                <span className="min-w-0 flex-1"><span className="block truncate">{a.institution} · {a.name}</span>{a.updatedAt && <span className="text-[11px] text-muted">atualizado {relativeTimeBR(a.updatedAt)}</span>}</span>
                <span className="tabular font-medium">{formatBRL(Number(a.balance))}</span>
              </li>
            ))}
          </ul>
        )}

        {detail === 'lancado' && (safe.pending.length ? (
          <>
            <p className="text-xs text-muted">Lançados no Telegram ou no painel desde a última atualização do banco{safe.bankDate ? ` (${d5(safe.bankDate)})` : ''}. Quando o banco atualizar, eles somem daqui e passam a contar no saldo.</p>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {safe.pending.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-11 shrink-0 tabular text-xs text-muted">{d5(t.date)}</span>
                  <span className="min-w-0 flex-1 truncate">{t.description}<span className="ml-1 text-[11px] text-muted">· {t.source === 'telegram' ? 'Telegram' : 'painel'}</span></span>
                  <span className={cx('tabular font-medium', t.type === 'entrada' ? 'text-income' : 'text-ink')}>{t.type === 'entrada' ? '+' : '−'} {formatBRL(Number(t.amount))}</span>
                </li>
              ))}
            </ul>
          </>
        ) : <p className="text-xs text-muted">Nada lançado fora do banco desde a última atualização.</p>)}

        {(detail === 'entra' || detail === 'sai') && (groups.length ? groups.map((g) => (
          <div key={g.k}>
            <div className="mb-1 flex items-baseline justify-between">
              <p className="font-medium">{KIND_LABEL[g.k]}</p>
              <p className="tabular text-xs text-muted">{formatBRL(Math.abs(g.items.reduce((s, e) => s + e.amount, 0)))}</p>
            </div>
            <p className="mb-1.5 text-[11px] text-muted">{KIND_HINT[g.k]}</p>
            <EventList events={g.items} />
          </div>
        )) : <p className="text-xs text-muted">Nada previsto até {until}.</p>)}
      </div>
    </Sheet>
  )
}

/** Ícone animado do melhor cartão */
function BestCardIcon() {
  return (
    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-accent to-accent/60 text-accent-ink shadow-sm">
      <CreditCard className="h-4.5 w-4.5 animate-card-float" />
      <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-shine bg-white/35" />
      <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-white">
        <span className="absolute inset-0 animate-ping rounded-full bg-white" />
      </span>
    </span>
  )
}

function BestCardSheet({ open, onClose, accounts, today }: { open: boolean; onClose: () => void; accounts: BankBalance[]; today: string }) {
  const ranges = useMemo(() => bestCardTimeline(accounts, today, 45), [accounts, today])
  const cards = useMemo(() => cardsForPurchase(accounts, today), [accounts, today])
  return (
    <Sheet open={open} onClose={onClose} title="Melhor cartão por data">
      <div className="space-y-4 pb-2 text-sm">
        <p className="text-xs text-muted">O melhor cartão é o que joga a compra para a fatura com vencimento mais distante: você ganha mais dias até pagar. Muda sempre que um cartão fecha a fatura.</p>
        <ol className="relative space-y-2 border-l border-line pl-4">
          {ranges.map((r, i) => (
            <li key={i} className="relative">
              <span className={cx('absolute -left-[21px] top-3 h-2.5 w-2.5 rounded-full border-2 border-surface', i === 0 ? 'bg-accent' : 'bg-line')} />
              <div className={cx('rounded-xl border p-3', i === 0 ? 'border-accent bg-accent/5' : 'border-line')}>
                <p className="text-[11px] text-muted">{r.from === r.to ? d5(r.from) : `${d5(r.from)} a ${d5(r.to)}`}{i === 0 ? ' · agora' : ''}</p>
                <p className="mt-0.5 flex items-center gap-1.5 font-medium"><CreditCard className="h-3.5 w-3.5 text-accent" /> {r.card.institution} ·{r.card.last4}</p>
                <p className="mt-0.5 text-xs text-muted">Fatura fecha {d5(r.card.closes)} e vence <b className="text-ink">{d5(r.card.due)}</b> · até <b className="text-accent">{r.days} dias</b> para pagar{r.from !== r.to ? ` (comprando em ${d5(r.from)})` : ''}</p>
              </div>
            </li>
          ))}
        </ol>
        {cards.length > 1 && (
          <div>
            <p className="mb-1.5 font-medium">Comprando hoje em cada cartão</p>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {cards.map((c, i) => (
                <li key={i} className="flex items-center gap-3 px-3 py-2">
                  <CreditCard className={cx('h-4 w-4 shrink-0', i === 0 ? 'text-accent' : 'text-muted')} />
                  <span className="min-w-0 flex-1 truncate">{c.institution} ·{c.last4}</span>
                  <span className="text-xs text-muted">vence {d5(c.due)} · {daysBetween(today, c.due)} dias</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Sheet>
  )
}
