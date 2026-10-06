'use client'

import { CheckCircle2, Send, Trash2 } from 'lucide-react'
import { getCategory } from '../lib/categories'
import { formatDateBR, relativeTimeBR } from '../lib/dates'
import { formatBRL } from '../lib/format'
import type { Tx } from '../lib/finance'
import { cx } from './ui'

export function TransactionItem({ t, onDelete, onPay, delay = 0 }: {
  t: Tx
  onDelete?: (t: Tx) => void
  onPay?: (t: Tx) => void
  delay?: number
}) {
  const cat = getCategory(t.category)
  const pending = t.type === 'a_pagar'
  const isIn = t.type === 'entrada'
  const when = t.created_at ? relativeTimeBR(t.created_at) : formatDateBR(t.date)

  return (
    <li className="group flex items-center gap-3 py-3 animate-fade-up" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-lg" style={{ background: `${cat.color}33` }}>
        {cat.emoji}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{t.description}</p>
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
          <span>{t.category || 'Geral'}</span>
          <span>·</span>
          <span title={t.created_at ? new Date(t.created_at).toLocaleString('pt-BR') : 'Lançamento sem hora registrada'}>{when}</span>
          {t.source === 'telegram' && (
            <span className="inline-flex items-center gap-1 rounded-full bg-info/15 px-1.5 py-0.5 text-[10px] font-medium text-info">
              <Send className="h-2.5 w-2.5" /> Telegram
            </span>
          )}
          {t.is_split && <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">dividido</span>}
          {pending && <span className="rounded-full bg-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-warn">pendente</span>}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className={cx('tabular font-semibold', isIn ? 'text-income' : pending ? 'text-warn' : 'text-expense')}>
          {isIn ? '+' : '−'} {formatBRL(Number(t.amount))}
        </span>
        <div className="flex gap-1 opacity-70 transition md:opacity-0 md:group-hover:opacity-100">
          {pending && onPay && (
            <button onClick={() => onPay(t)} title="Marcar como pago" className="rounded-lg p-1 text-income hover:bg-surface-2">
              <CheckCircle2 className="h-4 w-4" />
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
