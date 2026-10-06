'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { normalize } from '../lib/categories'
import { dayLabelBR, monthLabel } from '../lib/dates'
import { formatBRL } from '../lib/format'
import type { Tx } from '../lib/finance'
import { TransactionItem } from './TransactionItem'
import { Card, Chip, EmptyState, inputClass } from './ui'

type Filter = 'all' | 'entrada' | 'saida' | 'a_pagar' | 'telegram'

export default function TransactionsList({ txs, monthKey, onDelete, onPay }: {
  txs: Tx[]
  monthKey: string
  onDelete: (t: Tx) => void
  onPay: (t: Tx) => void
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [allMonths, setAllMonths] = useState(false)

  const groups = useMemo(() => {
    const q = normalize(query)
    const list = txs.filter((t) =>
      (allMonths || t.date.startsWith(monthKey)) &&
      (filter === 'all' || (filter === 'telegram' ? t.source === 'telegram' : t.type === filter)) &&
      (!q || normalize(`${t.description} ${t.category || ''}`).includes(q)))
    const map = new Map<string, Tx[]>()
    for (const t of list) map.set(t.date, [...(map.get(t.date) || []), t])
    return [...map.entries()].map(([date, items]) => ({
      date, items,
      net: items.reduce((a, t) => a + (t.type === 'entrada' ? Number(t.amount) : t.type === 'saida' ? -Number(t.amount) : 0), 0),
    }))
  }, [txs, monthKey, query, filter, allMonths])

  const count = groups.reduce((a, g) => a + g.items.length, 0)

  return (
    <div className="space-y-4">
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
          <span className="mx-1 w-px shrink-0 bg-line" />
          <Chip active={!allMonths} onClick={() => setAllMonths(false)}>{monthLabel(monthKey)}</Chip>
          <Chip active={allMonths} onClick={() => setAllMonths(true)}>Todos os meses</Chip>
        </div>
        <p className="text-xs text-muted">{count} lançamento{count === 1 ? '' : 's'}</p>
      </Card>

      {groups.length ? groups.map((g, gi) => (
        <Card key={g.date} delay={Math.min(gi, 6) * 40}>
          <div className="flex items-center justify-between px-5 pt-4 text-sm">
            <span className="font-display capitalize">{dayLabelBR(g.date)}{allMonths && ` · ${g.date.slice(0, 4)}`}</span>
            <span className={`tabular text-xs ${g.net >= 0 ? 'text-income' : 'text-expense'}`}>{g.net >= 0 ? '+' : '−'} {formatBRL(Math.abs(g.net))}</span>
          </div>
          <ul className="divide-y divide-line px-5 pb-1">
            {g.items.map((t) => <TransactionItem key={t.id} t={t} onDelete={onDelete} onPay={onPay} />)}
          </ul>
        </Card>
      )) : (
        <Card><EmptyState emoji="🔎" title="Nenhum lançamento encontrado" text="Ajuste os filtros ou a busca." /></Card>
      )}
    </div>
  )
}
