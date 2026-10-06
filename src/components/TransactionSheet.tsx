'use client'

import { useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { CATEGORIES, detectCategory, type EntryType } from '../lib/categories'
import { todayBR } from '../lib/dates'
import { play } from '../lib/sounds'
import type { Partnership } from './ConnectionsPanel'
import { Segmented, Sheet, cx, inputClass, primaryButton } from './ui'

type Props = {
  open: boolean
  onClose: () => void
  userId: string
  partners: Partnership[]
  onSaved: () => void
}

export default function TransactionSheet({ open, onClose, userId, partners, onSaved }: Props) {
  const [type, setType] = useState<EntryType>('saida')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Geral')
  const [categoryTouched, setCategoryTouched] = useState(false)
  const [split, setSplit] = useState(false)
  const [partnerId, setPartnerId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedPartner = partners.some((p) => p.partner_id === partnerId) ? partnerId : partners[0]?.partner_id || ''

  function reset() {
    setAmount(''); setDescription(''); setCategory('Geral'); setCategoryTouched(false); setSplit(false); setError(null)
  }

  function changeType(t: EntryType) {
    setType(t)
    if (!categoryTouched) setCategory(detectCategory(description, t))
    if (t === 'entrada') setSplit(false)
  }

  function changeDescription(d: string) {
    setDescription(d)
    if (!categoryTouched) setCategory(detectCategory(d, type))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const value = Math.round(parseFloat(amount.replace(/\./g, '').replace(',', '.')) * 100) / 100
    if (!Number.isFinite(value) || value <= 0) { play('error'); setError('Informe um valor válido.'); return }
    if (!description.trim()) { play('error'); setError('Informe uma descrição.'); return }
    const doSplit = split && type === 'saida'
    if (doSplit && !selectedPartner) { play('error'); setError('Adicione um parceiro na aba Conexões.'); return }

    setSaving(true)
    setError(null)
    const { error: err } = doSplit
      ? await supabase.rpc('create_split_transaction', {
          p_amount: value, p_description: description.trim(), p_category: category, p_partner_id: selectedPartner,
        })
      : await supabase.from('transactions').insert({
          user_id: userId, amount: value, description: description.trim(), type, category,
          is_split: false, date: todayBR(), source: 'web',
        })
    setSaving(false)

    if (err) { play('error'); setError(err.message); return }
    play(type === 'entrada' ? 'income' : 'expense')
    reset()
    onSaved()
    onClose()
  }

  const isIn = type === 'entrada'

  return (
    <Sheet open={open} onClose={onClose} title="Novo lançamento">
      <form onSubmit={handleSubmit} className="space-y-5 pb-2">
        <Segmented
          value={type}
          onChange={changeType}
          options={[
            { value: 'saida', label: <span className="inline-flex items-center gap-1.5"><ArrowDownRight className="h-4 w-4" /> Saída</span>, activeClass: 'bg-expense text-[#2a1620] shadow' },
            { value: 'entrada', label: <span className="inline-flex items-center gap-1.5"><ArrowUpRight className="h-4 w-4" /> Entrada</span>, activeClass: 'bg-income text-[#10261c] shadow' },
          ]}
        />

        <label className="block text-center">
          <span className="text-xs uppercase tracking-[0.2em] text-muted">Valor</span>
          <div className={cx('mt-1 flex items-baseline justify-center gap-2 font-display', isIn ? 'text-income' : 'text-expense')}>
            <span className="text-2xl opacity-70">R$</span>
            <input
              autoFocus inputMode="decimal" placeholder="0,00" value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
              className="w-48 bg-transparent text-center text-5xl tabular focus:outline-none placeholder:opacity-30"
              style={{ fontSize: '3rem' }}
            />
          </div>
        </label>

        <input value={description} onChange={(e) => changeDescription(e.target.value)} placeholder={isIn ? 'Ex.: salário, freela…' : 'Ex.: mercado, uber, pizza…'} className={inputClass} maxLength={200} />

        <div>
          <p className="mb-2 text-xs text-muted">Categoria {!categoryTouched && description && <span className="text-accent">· sugerida automaticamente</span>}</p>
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.name} type="button"
                onClick={() => { play('tap'); setCategory(c.name); setCategoryTouched(true) }}
                className={cx(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 h-9 text-sm transition-all active:scale-95',
                  category === c.name ? 'border-transparent text-[#1e1828] shadow' : 'border-line text-muted hover:text-ink',
                )}
                style={category === c.name ? { background: c.color } : undefined}
              >
                <span>{c.emoji}</span>{c.name}
              </button>
            ))}
          </div>
        </div>

        {!isIn && (
          <div className="rounded-2xl border border-line bg-surface-2/50 p-4 space-y-3">
            <label className="flex items-center justify-between gap-3 cursor-pointer">
              <span className="flex items-center gap-2 text-sm"><Users className="h-4 w-4 text-accent" /> Dividir 50% com parceiro</span>
              <input type="checkbox" checked={split} onChange={(e) => { play('toggle'); setSplit(e.target.checked) }} className="h-5 w-5 accent-[var(--accent)]" />
            </label>
            {split && (
              partners.length ? (
                <select value={selectedPartner} onChange={(e) => setPartnerId(e.target.value)} className={inputClass}>
                  {partners.map((p) => <option key={p.partner_id} value={p.partner_id}>{p.partner_email}</option>)}
                </select>
              ) : <p className="text-xs text-muted">Nenhum parceiro ainda — adicione na aba Conexões.</p>
            )}
          </div>
        )}

        {error && <p className="text-sm text-expense">{error}</p>}

        <button type="submit" disabled={saving} className={primaryButton}>
          {saving ? 'Salvando…' : isIn ? 'Registrar entrada' : 'Registrar saída'}
        </button>
      </form>
    </Sheet>
  )
}
