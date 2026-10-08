'use client'

import { useMemo } from 'react'
import { CalendarClock } from 'lucide-react'
import { addDays, todayBR } from '../lib/dates'
import { buildCashFlow } from '../lib/cashflow'
import type { Recurring, Tx } from '../lib/finance'
import { Card } from './ui'
import { EventList } from './RealBalanceCard'
import { useBankBalances } from './useBankBalances'

/** Próximos 10 dias: faturas, contas fixas e lançamentos agendados. */
export default function UpcomingCard({ txs, recurring, refreshKey }: { txs: Tx[]; recurring: Recurring[]; refreshKey: number }) {
  const accounts = useBankBalances(refreshKey)
  const today = todayBR()
  const events = useMemo(() => buildCashFlow(accounts || [], recurring, txs, addDays(today, 10), today).events.slice(0, 7), [accounts, recurring, txs, today])
  return (
    <Card className="p-4" delay={40}>
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted"><CalendarClock className="h-3.5 w-3.5" /> Próximos 10 dias</p>
      <EventList events={events} />
    </Card>
  )
}
