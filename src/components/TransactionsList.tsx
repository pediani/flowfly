'use client'

import { useMemo, useState } from 'react'
import { Download, Search, SearchX } from 'lucide-react'
import { normalize } from '../lib/categories'
import { dayLabelBR, formatDateBR, formatTimeBR, monthLabel } from '../lib/dates'
import { play } from '../lib/sounds'
import { formatBRL } from '../lib/format'
import type { Recurring, Tx } from '../lib/finance'
import CalendarView from './CalendarView'
import { TransactionItem } from './TransactionItem'
import { Card, Chip, EmptyState, cx, inputClass } from './ui'

type Filter = 'all' | 'entrada' | 'saida' | 'a_pagar' | 'telegram' | 'bank'

const TYPE_LABEL: Record<string, string> = { entrada: 'Entrada', saida: 'Saída', a_pagar: 'A pagar' }

/** CSV com ";" e vírgula decimal, que o Excel em português abre direto */
function exportCsv(rows: Tx[], name: string) {
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`
  const lines = [['Data', 'Hora', 'Tipo', 'Descrição', 'Categoria', 'Valor', 'Origem'].join(';')]
  for (const t of rows) {
    const signed = (t.type === 'entrada' ? 1 : -1) * Number(t.amount)
    lines.push([
      formatDateBR(t.date), t.created_at ? formatTimeBR(t.created_at) : '', TYPE_LABEL[t.type] || t.type,
      esc(t.description), esc(t.category || 'Geral'), signed.toFixed(2).replace('.', ','), t.source === 'telegram' ? 'Telegram' : t.source === 'bank' ? 'Banco' : 'Painel',
    ].join(';'))
  }
  const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `flowfly-${name}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export default function TransactionsList({ txs, monthKey, onDelete, onPay, onEdit, recurring = [], refreshKey = 0 }: {
  txs: Tx[]
  monthKey: string
  onDelete: (t: Tx) => void
  onPay: (t: Tx) => void
  onEdit: (t: Tx) => void
  recurring?: Recurring[]
  refreshKey?: number
}) {
  const [view, setView] = useState<'lista' | 'calendario'>('lista')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [allMonths, setAllMonths] = useState(false)

  const groups = useMemo(() => {
    const q = normalize(query)
    const list = txs.filter((t) =>
      (allMonths || t.date.startsWith(monthKey)) &&
      (filter === 'all' || (filter === 'telegram' || filter === 'bank' ? t.source === filter : t.type === filter)) &&
      (!q || normalize(`${t.description} ${t.category || ''}`).includes(q)))
    const map = new Map<string, Tx[]>()
    for (const t of list) map.set(t.date, [...(map.get(t.date) || []), t])
    return [...map.entries()].map(([date, items]) => ({
      date, items,
      net: items.reduce((a, t) => a + (t.type === 'entrada' ? Number(t.amount) : t.type === 'saida' ? -Number(t.amount) : 0), 0),
    }))
  }, [txs, monthKey, query, filter, allMonths])

  const count = groups.reduce((a, g) => a + g.items.length, 0)

  const switcher = (
    <div className="inline-flex rounded-xl bg-surface-2 p-1">
      {(['lista', 'calendario'] as const).map((v) => (
        <button key={v} onClick={() => { play('toggle'); setView(v) }} className={cx('h-8 rounded-lg px-3 text-xs font-medium', view === v ? 'bg-surface text-ink shadow-[var(--shadow)]' : 'text-muted')}>
          {v === 'lista' ? 'Lista' : 'Calendário'}
        </button>
      ))}
    </div>
  )

  if (view === 'calendario') {
    return (
      <div className="space-y-4">
        {switcher}
        <CalendarView txs={txs} recurring={recurring} monthKey={monthKey} refreshKey={refreshKey} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {switcher}
      <Card className="p-4 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por descrição ou categoria" className={`${inputClass} pl-11`} />
        </div>
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 no-scrollbar">
          <Chip active={filter === 'all'} onClick={() => setFilter('all')}>Todos</Chip>
          <Chip active={filter === 'saida'} onClick={() => setFilter('saida')}>Saídas</Chip>
          <Chip active={filter === 'entrada'} onClick={() => setFilter('entrada')}>Entradas</Chip>
          <Chip active={filter === 'a_pagar'} onClick={() => setFilter('a_pagar')}>Pendentes</Chip>
          <Chip active={filter === 'telegram'} onClick={() => setFilter('telegram')}>Via Telegram</Chip>
          <Chip active={filter === 'bank'} onClick={() => setFilter('bank')}>Do banco</Chip>
          <span className="mx-1 w-px shrink-0 bg-line" />
          <Chip active={!allMonths} onClick={() => setAllMonths(false)}>{monthLabel(monthKey)}</Chip>
          <Chip active={allMonths} onClick={() => setAllMonths(true)}>Todos os meses</Chip>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted">{count} lançamento{count === 1 ? '' : 's'}</p>
          <button
            disabled={!count}
            onClick={() => { play('success'); exportCsv(groups.flatMap((g) => g.items), allMonths ? 'todos' : monthKey) }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2 disabled:opacity-40"
          >
            <Download className="h-3.5 w-3.5" /> Exportar Excel (CSV)
          </button>
        </div>
      </Card>

      {groups.length ? groups.map((g, gi) => (
        <Card key={g.date} delay={Math.min(gi, 6) * 40}>
          <div className="flex items-center justify-between px-5 pt-4 text-sm">
            <span className="font-medium capitalize">{dayLabelBR(g.date)}{allMonths && ` · ${g.date.slice(0, 4)}`}</span>
            <span className={`tabular text-xs ${g.net >= 0 ? 'text-income' : 'text-expense'}`}>{g.net >= 0 ? '+' : '−'} {formatBRL(Math.abs(g.net))}</span>
          </div>
          <ul className="divide-y divide-line px-5 pb-1">
            {g.items.map((t) => <TransactionItem key={t.id} t={t} onDelete={onDelete} onPay={onPay} onEdit={onEdit} />)}
          </ul>
        </Card>
      )) : (
        <Card><EmptyState icon={SearchX} title="Nenhum lançamento encontrado" text="Ajuste os filtros ou a busca." /></Card>
      )}
    </div>
  )
}
