'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, CreditCard, Landmark, Wallet } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatBRL } from '../lib/format'
import { formatDateBR, relativeTimeBR } from '../lib/dates'
import { play } from '../lib/sounds'
import type { BankBalance } from '../lib/pluggy'
import { Card, Money, cx } from './ui'

/** Visão real: saldo nas contas − faturas em aberto (dados da Pluggy). Retorna null se não há banco conectado. */
export default function RealBalanceCard({ monthResult, monthLabelText, refreshKey }: { monthResult: number; monthLabelText: string; refreshKey: number }) {
  const [accounts, setAccounts] = useState<BankBalance[] | null>(null)
  const [open, setOpen] = useState(false)

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

  if (!accounts?.length) return null

  const banks = accounts.filter((a) => a.type === 'Conta')
  const cards = accounts.filter((a) => a.type === 'Cartão')
  const inAccounts = banks.reduce((s, a) => s + a.balance, 0)
  const bills = cards.reduce((s, a) => s + a.balance, 0)
  const real = inAccounts - bills
  const updated = accounts.map((a) => a.updatedAt).filter(Boolean).sort().pop()

  return (
    <Card className="p-5 md:p-6">
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm text-muted">Disponível de verdade</p>
          <Money value={real} className={cx('mt-1 block text-4xl font-semibold tracking-tight md:text-5xl', real < 0 && 'text-expense')} />
          <p className="mt-1 text-xs text-muted">Saldo nas contas menos as faturas em aberto{updated ? ` · atualizado ${relativeTimeBR(updated)}` : ''}</p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs md:min-w-[420px]">
          <Stat icon={Landmark} label="Nas contas" value={inAccounts} />
          <Stat icon={CreditCard} label="Faturas em aberto" value={-bills} tone="text-expense" />
          <Stat icon={Wallet} label={`Resultado de ${monthLabelText}`} value={monthResult} tone={monthResult >= 0 ? 'text-income' : 'text-expense'} hint="Entradas − saídas lançadas no mês" />
        </div>
      </div>

      <button onClick={() => { play('tap'); setOpen(!open) }} className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-accent">
        <ChevronDown className={cx('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} /> {open ? 'Ocultar' : 'Ver'} contas e cartões
      </button>
      {open && (
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
                    ? <>Fatura atual{a.dueDate ? ` · vence ${formatDateBR(a.dueDate)}` : ''}{a.available != null ? ` · limite livre ${formatBRL(a.available)}` : ''}</>
                    : 'Saldo disponível'}
                </p>
              </div>
              <span className={cx('shrink-0 whitespace-nowrap tabular text-sm font-semibold', a.type === 'Cartão' ? 'text-expense' : a.balance < 0 ? 'text-expense' : 'text-ink')}>
                {a.type === 'Cartão' ? '−' : ''} {formatBRL(Math.abs(a.balance))}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function Stat({ icon: Icon, label, value, tone, hint }: { icon: typeof Landmark; label: string; value: number; tone?: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 p-2.5 sm:p-3" title={hint}>
      <p className="flex items-start gap-1 text-[10px] leading-tight text-muted sm:text-[11px]"><Icon className="mt-px h-3 w-3 shrink-0" /> {label}</p>
      <p className={cx('mt-1 whitespace-nowrap tabular text-xs font-semibold sm:text-sm', tone)}>{value < 0 ? '−' : ''} {formatBRL(Math.abs(value))}</p>
    </div>
  )
}
