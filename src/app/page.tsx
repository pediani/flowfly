'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Zap } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { currentMonthKey } from '../lib/dates'
import { play } from '../lib/sounds'
import type { Budget, Installment, Recurring, Tx } from '../lib/finance'
import AppShell, { type Tab } from '../components/AppShell'
import AuthScreen from '../components/AuthScreen'
import ConnectionsPanel, { type Partnership } from '../components/ConnectionsPanel'
import Dashboard from '../components/Dashboard'
import RecurringPanel from '../components/RecurringPanel'
import TransactionSheet from '../components/TransactionSheet'
import TransactionsList from '../components/TransactionsList'

export default function Home() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [tab, setTab] = useState<Tab>('inicio')
  const [monthKey, setMonthKey] = useState(currentMonthKey)
  const [sheetOpen, setSheetOpen] = useState(false)

  const [txs, setTxs] = useState<Tx[]>([])
  const [recurring, setRecurring] = useState<Recurring[]>([])
  const [installments, setInstallments] = useState<Installment[]>([])
  const [budgets, setBudgets] = useState<Budget[]>([])
  const [partners, setPartners] = useState<Partnership[]>([])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s || null))
    return () => subscription.unsubscribe()
  }, [])

  const loadTransactions = useCallback(async () => {
    const { data } = await supabase.from('transactions').select('*')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false, nullsFirst: false })
    setTxs((data as Tx[]) || [])
  }, [])

  const loadRecurring = useCallback(async () => {
    const { data } = await supabase.from('recurring_transactions').select('*').order('day_of_month', { ascending: true })
    setRecurring((data as Recurring[]) || [])
  }, [])

  const loadBudgets = useCallback(async () => {
    const { data } = await supabase.from('budgets').select('category, monthly_limit')
    setBudgets((data as Budget[]) || [])
  }, [])

  const loadPartners = useCallback(async () => {
    const { data } = await supabase.rpc('list_partnerships')
    setPartners(((data as Partnership[]) || []).filter((p) => p.status === 'accepted'))
  }, [])

  const loadAll = useCallback(async () => {
    const { data: inst } = await supabase.from('installments').select('*')
    setInstallments((inst as Installment[]) || [])
    await Promise.all([loadTransactions(), loadRecurring(), loadBudgets(), loadPartners()])
  }, [loadTransactions, loadRecurring, loadBudgets, loadPartners])

  useEffect(() => {
    if (!session) return
    // Busca assíncrona: o setState acontece depois do await, não de forma síncrona
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAll()
    // Ao voltar para o app (ex.: depois de lançar pelo Telegram), atualiza os dados
    const onVisible = () => { if (document.visibilityState === 'visible') loadTransactions() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [session, loadAll, loadTransactions])

  async function handleDelete(t: Tx) {
    if (!confirm(`Excluir "${t.description}"?`)) return
    const { error } = await supabase.from('transactions').delete().eq('id', t.id)
    play(error ? 'error' : 'delete')
    loadTransactions()
  }

  async function handlePay(t: Tx) {
    const { error } = await supabase.from('transactions').update({ type: 'saida' }).eq('id', t.id)
    play(error ? 'error' : 'success')
    loadTransactions()
  }

  if (session === undefined) {
    return (
      <div className="relative z-10 flex min-h-dvh items-center justify-center">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent animate-pulse">
            <Zap className="h-6 w-6 text-white" fill="currentColor" />
          </div>
          <p className="text-xs uppercase tracking-[0.3em] text-muted">FlowFly</p>
        </div>
      </div>
    )
  }

  if (session === null) return <AuthScreen />

  const userId = session.user.id

  return (
    <>
      <AppShell
        tab={tab} onTab={setTab}
        monthKey={monthKey} onMonth={setMonthKey}
        onNew={() => setSheetOpen(true)}
        onSignOut={() => supabase.auth.signOut()}
        email={session.user.email}
      >
        {tab === 'inicio' && (
          <Dashboard
            userId={userId} txs={txs} recurring={recurring} installments={installments} budgets={budgets}
            monthKey={monthKey} onSelectMonth={setMonthKey} onSeeAll={() => setTab('lancamentos')}
            onDelete={handleDelete} onPay={handlePay} onBudgetsChange={loadBudgets}
          />
        )}
        {tab === 'lancamentos' && <TransactionsList txs={txs} monthKey={monthKey} onDelete={handleDelete} onPay={handlePay} />}
        {tab === 'fixas' && <RecurringPanel userId={userId} recurring={recurring} txs={txs} onChange={loadRecurring} />}
        {tab === 'conexoes' && <ConnectionsPanel onPartnersChange={loadPartners} />}
      </AppShell>

      <TransactionSheet
        open={sheetOpen} onClose={() => setSheetOpen(false)}
        userId={userId} partners={partners} onSaved={loadTransactions}
      />
    </>
  )
}
