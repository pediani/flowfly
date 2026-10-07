'use client'

import { useState } from 'react'
import { Flag, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatBRL } from '../lib/format'
import { formatDateBR, todayBR } from '../lib/dates'
import { play } from '../lib/sounds'
import { Card, CardHeader, EmptyState, cx } from './ui'

export type Goal = { id: string; title: string; target_amount: number; saved_amount: number; deadline?: string | null }

const small = 'h-9 min-w-0 rounded-lg border border-line bg-surface px-3 text-sm focus:outline-none focus:border-accent'
const money = (s: string) => Math.round(parseFloat(s.replace(/\./g, '').replace(',', '.')) * 100) / 100

function monthsUntil(deadline: string): number {
  const [y, m] = todayBR().split('-').map(Number)
  const [dy, dm] = deadline.split('-').map(Number)
  return Math.max(1, (dy - y) * 12 + (dm - m) + 1)
}

export default function GoalsCard({ goals, onChange }: { goals: Goal[]; onChange: () => void }) {
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [target, setTarget] = useState('')
  const [deadline, setDeadline] = useState('')
  const [depositFor, setDepositFor] = useState<string | null>(null)
  const [deposit, setDeposit] = useState('')

  async function create(e: React.FormEvent) {
    e.preventDefault()
    const v = money(target)
    if (!title.trim() || !(v > 0)) { play('error'); return }
    const { error } = await supabase.from('goals').insert({ title: title.trim(), target_amount: v, saved_amount: 0, deadline: deadline || null })
    play(error ? 'error' : 'success')
    if (error) { alert(error.message); return }
    setAdding(false); setTitle(''); setTarget(''); setDeadline('')
    onChange()
  }

  async function addMoney(g: Goal, sign: 1 | -1) {
    const v = money(deposit)
    if (!(v > 0)) { play('error'); return }
    const saved = Math.max(0, Number(g.saved_amount) + sign * v)
    const { error } = await supabase.from('goals').update({ saved_amount: saved }).eq('id', g.id)
    if (error) { play('error'); alert(error.message); return }
    play(saved >= Number(g.target_amount) ? 'success' : sign > 0 ? 'income' : 'expense')
    setDepositFor(null); setDeposit('')
    onChange()
  }

  async function remove(g: Goal) {
    if (!confirm(`Excluir a meta "${g.title}"?`)) return
    await supabase.from('goals').delete().eq('id', g.id)
    play('delete')
    onChange()
  }

  return (
    <Card delay={160}>
      <CardHeader
        title="Metas"
        icon={<Flag className="h-4 w-4 text-muted" />}
        subtitle="Quanto falta e quanto guardar por mês"
        action={!adding && <button onClick={() => { play('tap'); setAdding(true) }} className="inline-flex items-center gap-1 text-xs font-medium text-accent"><Plus className="h-3.5 w-3.5" /> Nova meta</button>}
      />
      {adding && (
        <form onSubmit={create} className="mx-5 mb-3 grid grid-cols-2 gap-2 animate-fade-in">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Viagem" className={cx(small, 'col-span-2')} />
          <input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Valor (R$)" className={small} />
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={small} title="Prazo (opcional)" />
          <button className="col-span-2 h-9 rounded-lg bg-accent text-sm font-medium text-accent-ink">Criar meta</button>
        </form>
      )}
      {goals.length ? (
        <ul className="space-y-4 px-5 pb-5">
          {goals.map((g) => {
            const saved = Number(g.saved_amount), tgt = Number(g.target_amount)
            const pct = tgt ? Math.min(100, (saved / tgt) * 100) : 0
            const left = Math.max(0, tgt - saved)
            const perMonth = g.deadline && left > 0 ? left / monthsUntil(g.deadline) : null
            return (
              <li key={g.id} className="group">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">{g.title}</span>
                  <span className="tabular text-xs text-muted"><b className="text-ink">{formatBRL(saved)}</b> / {formatBRL(tgt)}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
                  <div className={cx('h-full rounded-full transition-[width] duration-700', pct >= 100 ? 'bg-income' : 'bg-accent')} style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted">
                  <span>
                    {pct >= 100 ? '🎉 Meta atingida!' : `Faltam ${formatBRL(left)}`}
                    {perMonth ? ` · ${formatBRL(perMonth)}/mês até ${formatDateBR(g.deadline!)}` : ''}
                  </span>
                  <span className="flex gap-1">
                    <button onClick={() => { play('tap'); setDepositFor(depositFor === g.id ? null : g.id); setDeposit('') }} className="rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-surface-2">Guardar</button>
                    <button onClick={() => remove(g)} title="Excluir" className="rounded-md p-0.5 hover:text-expense"><Trash2 className="h-3.5 w-3.5" /></button>
                  </span>
                </div>
                {depositFor === g.id && (
                  <div className="mt-2 flex gap-2 animate-fade-in">
                    <input autoFocus inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="Valor" className={cx(small, 'flex-1')} />
                    <button onClick={() => addMoney(g, 1)} className="h-9 rounded-lg bg-accent px-3 text-sm font-medium text-accent-ink">+ Guardar</button>
                    <button onClick={() => addMoney(g, -1)} className="h-9 rounded-lg border border-line px-3 text-sm">Retirar</button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      ) : !adding && <EmptyState icon={Flag} title="Nenhuma meta ainda" text="Crie uma meta, como “Reserva de emergência”, e acompanhe o progresso." />}
    </Card>
  )
}
