'use client'

import { useState } from 'react'
import { CalendarClock, CalendarX, CircleCheck, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatBRL } from '../lib/format'
import { pendingRecurring, type Recurring, type Tx } from '../lib/finance'
import { currentMonthKey, todayBR } from '../lib/dates'
import { detectCategory } from '../lib/categories'
import { play } from '../lib/sounds'
import { Card, CardHeader, EmptyState, Segmented, cx, inputClass, primaryButton } from './ui'
import SubscriptionsCard from './SubscriptionsCard'
import CategoriesCard, { type CategoryRow } from './CategoriesCard'

export default function RecurringPanel({ userId, recurring, txs, onChange, onPaid, categories = [], onCategoriesChange = () => {} }: {
  userId: string
  recurring: Recurring[]
  txs: Tx[]
  onChange: () => void
  onPaid: () => void
  categories?: CategoryRow[]
  onCategoriesChange?: () => void
}) {
  const [type, setType] = useState<'saida' | 'entrada'>('saida')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [day, setDay] = useState('5')
  const [saving, setSaving] = useState(false)

  const pendingIds = new Set(pendingRecurring(txs, recurring, currentMonthKey()).map((r) => r.id))
  const totalIn = recurring.filter((r) => r.type === 'entrada').reduce((a, r) => a + Number(r.amount), 0)
  const totalOut = recurring.filter((r) => r.type === 'saida').reduce((a, r) => a + Number(r.amount), 0)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const value = parseFloat(amount.replace(/\./g, '').replace(',', '.'))
    if (!Number.isFinite(value) || value <= 0 || !description.trim()) { play('error'); return }
    setSaving(true)
    const { error } = await supabase.from('recurring_transactions').insert({
      user_id: userId, amount: value, description: description.trim(), type, day_of_month: Math.min(31, Math.max(1, parseInt(day) || 1)),
    })
    setSaving(false)
    if (error) { play('error'); alert(error.message); return }
    play('success')
    setAmount(''); setDescription(''); setDay('5')
    onChange()
  }

  async function handlePaid(r: Recurring) {
    const { error } = await supabase.from('transactions').insert({
      user_id: userId, amount: r.amount, type: r.type, description: r.description, source: 'web', is_split: false,
      category: detectCategory(r.description, r.type === 'entrada' ? 'entrada' : 'saida'), date: todayBR(),
    })
    if (error) { play('error'); alert(error.message); return }
    play(r.type === 'entrada' ? 'income' : 'expense')
    onPaid()
  }

  async function handleDelete(r: Recurring) {
    if (!confirm(`Excluir a conta fixa "${r.description}"?`)) return
    await supabase.from('recurring_transactions').delete().eq('id', r.id)
    play('delete')
    onChange()
  }

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <Card className="lg:col-span-2">
        <CardHeader title="Nova conta fixa" icon={<CalendarClock className="h-4 w-4 text-accent" />} subtitle="Compromissos mensais entram na projeção automaticamente." />
        <form onSubmit={handleAdd} className="space-y-3 px-5 pb-5">
          <Segmented value={type} onChange={setType} options={[
            { value: 'saida', label: 'Gasto fixo', activeClass: 'bg-surface text-expense shadow-[var(--shadow)]' },
            { value: 'entrada', label: 'Renda fixa', activeClass: 'bg-surface text-income shadow-[var(--shadow)]' },
          ]} />
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Aluguel, Salário, Netflix" className={inputClass} />
          <div className="grid grid-cols-2 gap-3">
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Valor (R$)" className={inputClass} />
            <input type="number" min={1} max={31} value={day} onChange={(e) => setDay(e.target.value)} placeholder="Dia" className={inputClass} />
          </div>
          <button disabled={saving} className={primaryButton}>{saving ? 'Salvando…' : 'Adicionar'}</button>
        </form>
      </Card>

      <Card className="lg:col-span-3" delay={60}>
        <CardHeader title="Contas fixas" subtitle={<>Renda <b className="text-income tabular">{formatBRL(totalIn)}</b> · Gastos <b className="text-expense tabular">{formatBRL(totalOut)}</b> por mês</>} />
        <ul className="divide-y divide-line px-5 pb-2">
          {recurring.length ? recurring.map((r, i) => (
            <li key={r.id} className="flex items-center gap-3 py-3 animate-fade-up" style={{ animationDelay: `${i * 40}ms` }}>
              <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-xl bg-surface-2 leading-none">
                <span className="text-[9px] uppercase text-muted">dia</span>
                <span className="text-base font-semibold tabular">{r.day_of_month}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{r.description}</p>
                <p className="text-xs text-muted">
                  {r.type === 'entrada' ? 'Renda fixa' : 'Gasto fixo'} · {pendingIds.has(r.id) ? 'ainda não lançado este mês' : <span className="text-income">lançado este mês</span>}
                </p>
              </div>
              <span className={cx('tabular text-sm font-semibold', r.type === 'entrada' ? 'text-income' : 'text-expense')}>{formatBRL(Number(r.amount))}</span>
              {pendingIds.has(r.id) && (
                <button onClick={() => handlePaid(r)} title={r.type === 'entrada' ? 'Recebi — lançar hoje' : 'Paguei — lançar hoje'}
                  className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-surface-2 active:scale-95">
                  <CircleCheck className="h-3.5 w-3.5 text-income" /> {r.type === 'entrada' ? 'Recebi' : 'Paguei'}
                </button>
              )}
              <button onClick={() => handleDelete(r)} title="Excluir" className="rounded-lg p-1.5 text-muted hover:text-expense hover:bg-surface-2"><Trash2 className="h-4 w-4" /></button>
            </li>
          )) : <EmptyState icon={CalendarX} title="Nenhuma conta fixa" text="Cadastre aluguel, salário e assinaturas para melhorar a projeção." />}
        </ul>
      </Card>
      <SubscriptionsCard userId={userId} txs={txs} recurring={recurring} onChange={onChange} />
      <CategoriesCard rows={categories} onChange={onCategoriesChange} />
    </div>
  )
}
