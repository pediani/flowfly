'use client'

import { useState } from 'react'
import { CreditCard } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatBRL } from '../lib/format'
import { formatDateBR } from '../lib/dates'
import type { BankBalance } from '../lib/pluggy'
import { play } from '../lib/sounds'
import { Sheet, cx } from './ui'
import { refreshBankBalances } from './useBankBalances'

const d5 = (iso?: string | null) => (iso ? formatDateBR(iso).slice(0, 5) : '—')

/** Fatura de um cartão: o que está somando e os dias de fechamento/vencimento. */
export default function CardBillSheet({ card, onClose }: { card: BankBalance | null; onClose: () => void }) {
  return (
    <Sheet open={!!card} onClose={onClose} title={card ? `Fatura ${card.institution} ·${card.last4}` : 'Fatura'}>
      {card && <Body key={card.id || card.last4} card={card} />}
    </Sheet>
  )
}

function Body({ card }: { card: BankBalance }) {
  const [closeDay, setCloseDay] = useState(card.closeDay ? String(card.closeDay) : '')
  const [dueDay, setDueDay] = useState(card.dueDay ? String(card.dueDay) : '')
  const [msg, setMsg] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const items = card.items || []
  const [copied, setCopied] = useState<string | null>(null)

  async function copyDiag() {
    setCopied('Gerando…')
    const { data: s } = await supabase.auth.getSession()
    const res = await fetch('/api/pluggy/balances?debug=1', { method: 'POST', headers: { Authorization: `Bearer ${s.session?.access_token || ''}` } })
    const json = await res.json().catch(() => null)
    const mine = (json?.diag || []).find((d: { id: string }) => d.id === card.id)
    const text = JSON.stringify({ card: `${card.institution} ·${card.last4}`, ...mine })
    try { await navigator.clipboard.writeText(text); setCopied('Copiado! Cole no chat com o Claude.') }
    catch { setCopied(text) }
  }

  async function save() {
    if (!card.id) return
    const c = Number(closeDay) || null
    const d = Number(dueDay) || null
    if ((c && (c < 1 || c > 31)) || (d && (d < 1 || d > 31))) { setMsg('Use dias entre 1 e 31.'); return }
    setSaving(true); setMsg(null)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('card_settings').upsert({ user_id: user?.id, account_id: card.id, close_day: c, due_day: d, updated_at: new Date().toISOString() })
    setSaving(false)
    if (error) { play('error'); setMsg(/relation|does not exist|schema cache/i.test(error.message) ? 'Falta rodar a migração 20261014_cartoes no Supabase.' : error.message); return }
    play('success'); setMsg('Salvo. Recalculando a fatura…'); refreshBankBalances()
  }

  return (
    <div className="space-y-4 pb-2 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-surface-2 p-3">
          <p className="text-xs text-muted">Fatura aberta</p>
          <p className="tabular text-xl font-semibold text-expense">{formatBRL(card.openBill ?? 0)}</p>
          <p className="text-[11px] text-muted">fecha {d5(card.openCloses)} · vence {d5(card.openDue)}</p>
        </div>
        <div className="rounded-xl bg-surface-2 p-3">
          <p className="text-xs text-muted">Fechada a pagar</p>
          <p className="tabular text-xl font-semibold">{formatBRL(card.closedDue ?? 0)}</p>
          <p className="text-[11px] text-muted">{card.closedDue ? `vence ${d5(card.closedDueDate)}` : 'nenhuma pendente'}</p>
        </div>
      </div>

      <div className="rounded-xl border border-line p-3">
        <p className="font-medium">Datas do cartão</p>
        <p className="mt-0.5 text-[11px] text-muted">Se o banco informar errado, defina aqui (deixe em branco para usar o do banco). Atenção: <b>fechamento</b> é o dia em que a fatura fecha, geralmente ~7 dias antes do vencimento.</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">Fecha dia
            <input inputMode="numeric" value={closeDay} onChange={(e) => setCloseDay(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder={card.openCloses ? card.openCloses.slice(8, 10) : '—'} className="mt-1 block h-9 w-20 rounded-lg border border-line bg-surface px-2 text-sm text-ink" />
          </label>
          <label className="text-xs text-muted">Vence dia
            <input inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value.replace(/\D/g, '').slice(0, 2))} placeholder={card.openDue ? card.openDue.slice(8, 10) : '—'} className="mt-1 block h-9 w-20 rounded-lg border border-line bg-surface px-2 text-sm text-ink" />
          </label>
          <button type="button" onClick={save} disabled={saving || !card.id} className="h-9 rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink disabled:opacity-50">{saving ? 'Salvando…' : 'Salvar'}</button>
        </div>
        {msg && <p className="mt-2 text-xs text-muted">{msg}</p>}
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between">
          <p className="font-medium">O que está na fatura aberta</p>
          <p className="text-xs text-muted">{items.length} {items.length === 1 ? 'item' : 'itens'}</p>
        </div>
        <p className="mb-1.5 text-[11px] text-muted">Calculado {card.billMethod || 'pela previsão do banco'}. Se faltar ou sobrar algo, me avise com o nome da compra.</p>
        {items.length ? (
          <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {items.map((t, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-2">
                <span className="w-11 shrink-0 tabular text-xs text-muted">{d5(t.date)}</span>
                <CreditCard className="h-3.5 w-3.5 shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate">{t.description}{t.inst && <span className="ml-1 text-[11px] text-muted">· {t.inst}</span>}</span>
                <span className={cx('shrink-0 tabular font-medium', t.amount < 0 && 'text-income')}>{t.amount < 0 ? '+' : ''} {formatBRL(Math.abs(t.amount))}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-muted">Nenhuma compra encontrada no ciclo atual.</p>}
      </div>

      <div className="rounded-xl border border-dashed border-line p-3">
        <p className="text-[11px] text-muted">O valor não bate com o app do banco? Copie o diagnóstico (lista do que o banco enviou) e cole no chat.</p>
        <button type="button" onClick={copyDiag} className="mt-2 h-8 rounded-lg border border-line px-3 text-xs font-medium">Copiar diagnóstico</button>
        {copied && <p className="mt-2 max-h-32 overflow-auto break-all text-[11px] text-muted">{copied}</p>}
      </div>
    </div>
  )
}
