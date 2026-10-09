'use client'

import { CheckCircle2, CreditCard, Landmark, Pencil, Send, Trash2 } from 'lucide-react'
import { formatDateBR, relativeTimeBR, todayBR } from '../lib/dates'
import { formatBRL } from '../lib/format'
import type { Tx } from '../lib/finance'
import { CategoryIcon } from './CategoryIcon'
import { cx } from './ui'

export function TransactionItem({ t, onDelete, onPay, onEdit, delay = 0 }: {
  t: Tx
  onDelete?: (t: Tx) => void
  onPay?: (t: Tx) => void
  onEdit?: (t: Tx) => void
  delay?: number
}) {
  const pending = t.type === 'a_pagar'
  const isIn = t.type === 'entrada'
  // Do banco: a data da compra/transação (não a hora em que a Pluggy enviou)
  const purchase = (t as Tx & { purchase_date?: string }).purchase_date
  const when = t.source === 'bank' || !t.created_at ? formatDateBR(purchase || t.date) : relativeTimeBR(t.created_at)
  const account = (t as Tx & { bank_account?: string }).bank_account || ''
  const onCard = /Cart[aã]o/.test(account)

  return (
    <li className="group flex items-center gap-3 py-2.5 animate-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <CategoryIcon category={t.category} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{t.note || t.description}</p>
        {t.note && <p className="truncate text-[11px] text-muted">{t.description}</p>}
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
          <span>{t.category || 'Geral'}</span>
          <span>·</span>
          <span title={t.created_at ? new Date(t.created_at).toLocaleString('pt-BR') : 'Lançamento sem hora registrada'}>{when}</span>
          {t.source === 'telegram' && (
            <span className="inline-flex items-center gap-1 rounded-md bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info">
              <Send className="h-2.5 w-2.5" /> Telegram
            </span>
          )}
          {t.source === 'bank' && (
            <span title={`${account}${(t as Tx & { bank_description?: string }).bank_description ? ` · ${(t as Tx & { bank_description?: string }).bank_description}` : ''}`} className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium', onCard ? 'bg-expense/10 text-expense' : 'bg-accent/10 text-accent')}>
              {onCard ? <CreditCard className="h-2.5 w-2.5" /> : <Landmark className="h-2.5 w-2.5" />} {onCard ? 'Cartão' : 'Conta'} {account.split(' · ')[0] || 'Banco'}
            </span>
          )}
          {onCard && t.source !== 'bank' && (
            <span className="inline-flex items-center gap-1 rounded-md bg-expense/10 px-1.5 py-0.5 text-[10px] font-medium text-expense">
              <CreditCard className="h-2.5 w-2.5" /> {account === 'Cartão' ? 'Cartão' : `Cartão ${account.replace(' · Cartão', '').replace(/ (\d{4})$/, ' ·$1')}`}
            </span>
          )}
          {(t as Tx & { external_id?: string }).external_id && t.source !== 'bank' && (
            <span title="Conferido com o extrato do banco" className="inline-flex items-center gap-1 rounded-md bg-income/10 px-1.5 py-0.5 text-[10px] font-medium text-income">
              <Landmark className="h-2.5 w-2.5" /> conferido
            </span>
          )}
          {(t.tags || []).map((tag) => <span key={tag} className="rounded-md bg-info/10 px-1.5 py-0.5 text-[10px] font-medium text-info">@{tag}</span>)}
          {t.is_split && <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">dividido</span>}
          {purchase && <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">paga na fatura de {formatDateBR(t.date).slice(0, 5)}</span>}
          {!purchase && t.date > todayBR() && <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">agendado {formatDateBR(t.date).slice(0, 5)}</span>}
          {pending && <span className="rounded-md bg-warn/10 px-1.5 py-0.5 text-[10px] font-medium text-warn">pendente</span>}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className={cx('tabular text-sm font-semibold', isIn ? 'text-income' : pending ? 'text-warn' : 'text-expense')}>
          {isIn ? '+' : '−'} {formatBRL(Number(t.amount))}
        </span>
        <div className="flex gap-1 opacity-70 transition md:opacity-0 md:group-hover:opacity-100">
          {pending && onPay && (
            <button onClick={() => onPay(t)} title="Marcar como pago" className="rounded-lg p-1 text-income hover:bg-surface-2">
              <CheckCircle2 className="h-4 w-4" />
            </button>
          )}
          {onEdit && !pending && (
            <button onClick={() => onEdit(t)} title="Editar" className="rounded-lg p-1 text-muted hover:text-ink hover:bg-surface-2">
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {onDelete && (
            <button onClick={() => onDelete(t)} title="Excluir" className="rounded-lg p-1 text-muted hover:text-expense hover:bg-surface-2">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </li>
  )
}
