'use client'

import { useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { allCategories, detectCategory, type EntryType } from '../lib/categories'
import { todayBR } from '../lib/dates'
import { formatBRL } from '../lib/format'
import type { Tx } from '../lib/finance'
import { installmentDate, splitInstallments } from '../lib/parseEntry'
import { play } from '../lib/sounds'
import type { Partnership } from './ConnectionsPanel'
import { CategoryIcon } from './CategoryIcon'
import { CategoryForm } from './CategoriesCard'
import { Segmented, Sheet, cx, inputClass, primaryButton } from './ui'
import { currentBalancesKey, useBankBalances } from './useBankBalances'

type Props = {
  open: boolean
  onClose: () => void
  userId: string
  partners: Partnership[]
  onSaved: () => void
  /** Quando definido, o formulário edita este lançamento */
  editing?: Tx | null
  onCategoriesChange?: () => Promise<void> | void
}

/** Remonta o formulário a cada abertura para carregar os valores certos */
export default function TransactionSheet(props: Props) {
  return (
    <Sheet open={props.open} onClose={props.onClose} title={props.editing ? 'Editar lançamento' : 'Novo lançamento'}>
      {props.open && <Form key={props.editing?.id || 'new'} {...props} />}
    </Sheet>
  )
}

function Form({ onClose, userId, partners, onSaved, editing, onCategoriesChange }: Props) {
  const [type, setType] = useState<EntryType>(editing?.type === 'entrada' ? 'entrada' : 'saida')
  const [amount, setAmount] = useState(editing ? Number(editing.amount).toFixed(2).replace('.', ',') : '')
  const [description, setDescription] = useState(editing?.description || '')
  const [category, setCategory] = useState(editing?.category || 'Geral')
  const [categoryTouched, setCategoryTouched] = useState(!!editing)
  const [date, setDate] = useState(editing?.date || todayBR())
  const [installments, setInstallments] = useState(1)
  const [tagsText, setTagsText] = useState((editing?.tags || []).map((t) => `@${t}`).join(' '))
  const [note, setNote] = useState(editing?.note || '')
  const [creatingCat, setCreatingCat] = useState(false)
  const fromBank = editing?.source === 'bank'
  // Pago com: débito/Pix ou um dos cartões conectados (mesmo rótulo usado na importação do banco)
  const accounts = useBankBalances(currentBalancesKey())
  const cardOptions = (accounts || []).filter((a) => a.type === 'Cartão').map((a) => ({ label: `${a.institution} · Cartão${a.last4 ? ` ${a.last4}` : ''}`, short: `${a.institution}${a.last4 ? ` ·${a.last4}` : ''}` }))
  const originalAccount = (editing as (Tx & { bank_account?: string | null }) | null | undefined)?.bank_account || ''
  const [payWith, setPayWith] = useState<string>(/Cart[aã]o/.test(originalAccount) ? originalAccount : '')
  const payField = fromBank ? {} : type === 'saida' && /Cart[aã]o/.test(payWith) ? { bank_account: payWith } : /Cart[aã]o/.test(originalAccount) ? { bank_account: null } : {}
  const [split, setSplit] = useState(false)
  const [partnerId, setPartnerId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedPartner = partners.some((p) => p.partner_id === partnerId) ? partnerId : partners[0]?.partner_id || ''
  const isIn = type === 'entrada'
  const value = Math.round(parseFloat(amount.replace(/\./g, '').replace(',', '.')) * 100) / 100

  function changeType(t: EntryType) {
    setType(t)
    if (!categoryTouched) setCategory(detectCategory(description, t))
    if (t === 'entrada') { setSplit(false); setInstallments(1) }
  }

  function changeDescription(d: string) {
    setDescription(d)
    if (!categoryTouched) setCategory(detectCategory(d, type))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!Number.isFinite(value) || value <= 0) { play('error'); setError('Informe um valor válido.'); return }
    if (!description.trim()) { play('error'); setError('Informe uma descrição.'); return }
    const doSplit = !editing && split && type === 'saida'
    if (doSplit && !selectedPartner) { play('error'); setError('Adicione um parceiro na aba Conexões.'); return }

    setSaving(true)
    setError(null)
    const desc = description.trim()
    const tags = [...new Set(tagsText.split(/[\s,]+/).map((t) => t.replace(/^@/, '').toLowerCase().trim()).filter((t) => t.length >= 2))]
    const tagField = tags.length || editing?.tags?.length ? { tags: tags.length ? tags : null } : {}
    let err: { message: string } | null = null

    if (editing) {
      ({ error: err } = await supabase.from('transactions')
        .update({ amount: value, description: desc, type, category, date, ...tagField, ...payField, ...(note.trim() || editing.note ? { note: note.trim() || null } : {}) })
        .eq('id', editing.id))
    } else if (doSplit) {
      ({ error: err } = await supabase.rpc('create_split_transaction', {
        p_amount: value, p_description: desc, p_category: category, p_partner_id: selectedPartner,
      }))
    } else if (installments > 1) {
      const group = crypto.randomUUID()
      const parts = splitInstallments(value, installments)
      ;({ error: err } = await supabase.from('transactions').insert(parts.map((amt, k) => ({
        user_id: userId, amount: amt, type, category, source: 'web', is_split: false,
        description: `${desc} (${k + 1}/${installments})`, date: installmentDate(date, k),
        installment_group: group, installment_no: k + 1, installment_total: installments, ...tagField, ...payField,
      }))))
    } else {
      ({ error: err } = await supabase.from('transactions').insert({
        user_id: userId, amount: value, description: desc, type, category, is_split: false, date, source: 'web', ...tagField, ...payField,
        ...(note.trim() ? { note: note.trim() } : {}),
      }))
    }
    setSaving(false)

    if (err) { play('error'); setError(err.message); return }
    play(editing ? 'success' : isIn ? 'income' : 'expense')
    onSaved()
    onClose()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 pb-2">
      <Segmented
        value={type}
        onChange={changeType}
        options={[
          { value: 'saida', label: <span className="inline-flex items-center gap-1.5"><ArrowDownRight className="h-4 w-4" /> Saída</span>, activeClass: 'bg-surface text-expense shadow-[var(--shadow)]' },
          { value: 'entrada', label: <span className="inline-flex items-center gap-1.5"><ArrowUpRight className="h-4 w-4" /> Entrada</span>, activeClass: 'bg-surface text-income shadow-[var(--shadow)]' },
        ]}
      />

      <label className="block text-center">
        <span className="text-xs text-muted">{installments > 1 ? 'Valor total' : 'Valor'}</span>
        <div className={cx('mt-1 flex items-baseline justify-center gap-2 font-semibold tracking-tight', isIn ? 'text-income' : 'text-expense')}>
          <span className="text-2xl opacity-70">R$</span>
          <input
            autoFocus={!editing} inputMode="decimal" placeholder="0,00" value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
            className="w-48 bg-transparent text-center tabular focus:outline-none placeholder:opacity-30"
            style={{ fontSize: '3rem' }}
          />
        </div>
        {installments > 1 && Number.isFinite(value) && value > 0 && (
          <span className="text-xs text-muted">{installments}x de {formatBRL(splitInstallments(value, installments)[1])}</span>
        )}
      </label>

      {fromBank ? (
        <div className="rounded-xl border border-line bg-surface-2/50 px-3.5 py-2.5">
          <p className="text-[11px] text-muted">Descrição do banco (mantida como veio do import)</p>
          <p className="truncate text-sm">{description}</p>
        </div>
      ) : (
        <input value={description} onChange={(e) => changeDescription(e.target.value)} placeholder={isIn ? 'Ex.: salário, freela…' : 'Ex.: mercado, uber, pizza…'} className={inputClass} maxLength={200} />
      )}
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={fromBank ? 'Sua descrição (ex.: Jantar com a Bia)' : 'Observação (opcional)'} className={inputClass} maxLength={200} />

      <div className={cx('grid gap-3', !isIn && !editing ? 'grid-cols-2' : 'grid-cols-1')}>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">{installments > 1 ? 'Data da 1ª parcela' : 'Data'}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value || todayBR())} className={inputClass} />
        </label>
        {!isIn && !editing && (
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Parcelas</span>
            <select value={installments} disabled={split} onChange={(e) => setInstallments(Number(e.target.value))} className={inputClass}>
              <option value={1}>À vista</option>
              {Array.from({ length: 23 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n}x</option>)}
            </select>
          </label>
        )}
      </div>

      {!isIn && !fromBank && (
        <div>
          <p className="mb-1.5 text-xs text-muted">Pago com</p>
          <div className="flex flex-wrap gap-1.5">
            {[{ label: '', short: '💸 Débito/Pix' }, ...cardOptions.map((c) => ({ ...c, short: `💳 ${c.short}` })), ...(!cardOptions.length ? [{ label: 'Cartão', short: '💳 Cartão' }] : [])].map((o) => (
              <button type="button" key={o.label || 'deb'} onClick={() => setPayWith(o.label)} className={cx('h-8 rounded-lg border px-2.5 text-xs font-medium transition', payWith === o.label ? 'border-accent bg-accent/10 text-ink' : 'border-line text-muted hover:text-ink')}>{o.short}</button>
            ))}
          </div>
          {/Cart[aã]o/.test(payWith) && <p className="mt-1 text-[11px] text-muted">Conta no mês em que a fatura vence. Quando o banco trouxer a compra, eu junto as duas.</p>}
        </div>
      )}

      <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="Evento (opcional): @viagem-rio @casamento" className={inputClass} />

      <div>
        <p className="mb-2 text-xs text-muted">Categoria {!categoryTouched && description && <span className="text-accent">· sugerida automaticamente</span>}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { play('tap'); setCreatingCat(!creatingCat) }}
            className="inline-flex items-center gap-1 rounded-lg border border-dashed border-line px-2.5 py-1 text-sm text-muted hover:text-ink">+ Nova</button>
          {allCategories().map((c) => (
            <button
              key={c.name} type="button"
              onClick={() => { play('tap'); setCategory(c.name); setCategoryTouched(true) }}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-lg border py-1 pl-1 pr-2.5 text-sm transition-all active:scale-95',
                category === c.name ? 'border-accent bg-accent/10 text-ink' : 'border-line text-muted hover:text-ink',
              )}
            >
              <CategoryIcon category={c.name} size="sm" />{c.name}
            </button>
          ))}
        </div>
      </div>

      {creatingCat && (
        <CategoryForm onCancel={() => setCreatingCat(false)} onSaved={async (name) => { await onCategoriesChange?.(); setCategory(name); setCategoryTouched(true); setCreatingCat(false) }} />
      )}

      {!isIn && !editing && installments === 1 && (
        <div className="rounded-xl border border-line p-3.5 space-y-3">
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
          {split && <p className="text-xs text-muted">Despesas divididas usam a data de hoje.</p>}
        </div>
      )}

      {error && <p className="text-sm text-expense">{error}</p>}

      <button type="submit" disabled={saving} className={primaryButton}>
        {saving ? 'Salvando…' : editing ? 'Salvar alterações' : isIn ? 'Registrar entrada' : installments > 1 ? `Registrar ${installments} parcelas` : 'Registrar saída'}
      </button>
    </form>
  )
}
