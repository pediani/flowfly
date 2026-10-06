'use client'

import { useState, type ReactNode } from 'react'
import { CalendarClock, ChevronLeft, ChevronRight, Home, ListOrdered, LogOut, Moon, Plus, Send, Sun, Volume2, VolumeX, Zap } from 'lucide-react'
import { addMonths, currentMonthKey, monthLabel } from '../lib/dates'
import { isSoundOn, play, setSoundOn } from '../lib/sounds'
import { applyTheme, getTheme, type Theme } from '../lib/theme'
import { IconButton, cx } from './ui'

export type Tab = 'inicio' | 'lancamentos' | 'fixas' | 'conexoes'

const NAV: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: 'inicio', label: 'Início', icon: Home },
  { id: 'lancamentos', label: 'Lançamentos', icon: ListOrdered },
  { id: 'fixas', label: 'Fixas', icon: CalendarClock },
  { id: 'conexoes', label: 'Conexões', icon: Send },
]

const TITLES: Record<Tab, string> = { inicio: 'Visão geral', lancamentos: 'Lançamentos', fixas: 'Contas fixas', conexoes: 'Conexões' }

type Props = {
  tab: Tab
  onTab: (t: Tab) => void
  monthKey: string
  onMonth: (k: string) => void
  onNew: () => void
  onSignOut: () => void
  email?: string
  children: ReactNode
}

export default function AppShell({ tab, onTab, monthKey, onMonth, onNew, onSignOut, email, children }: Props) {
  const [sound, setSound] = useState(isSoundOn)
  const [theme, setTheme] = useState<Theme>(getTheme)
  const showMonth = tab === 'inicio' || tab === 'lancamentos'
  const cur = currentMonthKey()

  function go(t: Tab) {
    if (t === tab) return
    play('tap')
    onTab(t)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  function toggleSound() {
    setSoundOn(!sound)
    setSound(!sound)
    if (!sound) play('success')
  }
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
    play('toggle')
  }
  function shift(n: number) {
    play('tap')
    onMonth(addMonths(monthKey, n))
  }

  const toggles = (
    <>
      <IconButton onClick={toggleSound} title={sound ? 'Desligar sons' : 'Ligar sons'}>
        {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
      </IconButton>
      <IconButton onClick={toggleTheme} title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}>
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </IconButton>
    </>
  )

  const monthSelector = showMonth && (
    <div className="flex items-center gap-1 rounded-2xl border border-line bg-surface/80 p-1 backdrop-blur">
      <button onClick={() => shift(-1)} className="rounded-xl p-2 text-muted hover:text-ink active:scale-90" aria-label="Mês anterior"><ChevronLeft className="h-4 w-4" /></button>
      <span className="min-w-32 text-center font-display text-sm">{monthLabel(monthKey, 'longYear')}</span>
      <button onClick={() => shift(1)} disabled={monthKey >= addMonths(cur, 6)} className="rounded-xl p-2 text-muted hover:text-ink active:scale-90 disabled:opacity-30" aria-label="Próximo mês"><ChevronRight className="h-4 w-4" /></button>
      {monthKey !== cur && (
        <button onClick={() => { play('tap'); onMonth(cur) }} className="ml-1 rounded-xl bg-accent/15 px-2.5 py-1.5 text-xs font-medium text-accent">Hoje</button>
      )}
    </div>
  )

  return (
    <div className="relative z-10 min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      {/* SIDEBAR (desktop) */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface/60 p-5 backdrop-blur lg:flex">
        <Logo />
        <button onClick={() => { play('open'); onNew() }} className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-accent font-semibold text-accent-ink shadow-[0_10px_30px_-10px_var(--accent)] transition hover:bg-accent-strong active:scale-[0.98]">
          <Plus className="h-5 w-5" /> Novo lançamento
        </button>
        <nav className="mt-6 space-y-1">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} onClick={() => go(id)} className={cx('flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm transition', tab === id ? 'bg-accent/15 text-ink font-medium' : 'text-muted hover:bg-surface-2 hover:text-ink')}>
              <Icon className={cx('h-4 w-4', tab === id && 'text-accent')} /> {label}
            </button>
          ))}
        </nav>
        <div className="mt-auto space-y-3">
          <div className="flex gap-2">{toggles}</div>
          {email && <p className="truncate text-xs text-muted">{email}</p>}
          <button onClick={onSignOut} className="flex items-center gap-2 text-sm text-muted hover:text-ink"><LogOut className="h-4 w-4" /> Sair</button>
        </div>
      </aside>

      <div className="min-w-0">
        {/* HEADER */}
        <header className="sticky top-0 z-30 border-b border-line/60 bg-bg/75 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xl md:px-8">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 lg:hidden"><Logo compact /></div>
            <h1 className="hidden font-display text-2xl lg:block">{TITLES[tab]}</h1>
            <div className="hidden md:block">{monthSelector}</div>
            <div className="flex gap-2 lg:hidden">
              {toggles}
              <IconButton onClick={onSignOut} title="Sair"><LogOut className="h-4 w-4" /></IconButton>
            </div>
          </div>
          {showMonth && <div className="mt-3 flex justify-center md:hidden">{monthSelector}</div>}
        </header>

        <main className="mx-auto max-w-6xl px-4 pb-32 pt-5 md:px-8 lg:pb-12">
          <h1 className="mb-4 font-display text-2xl lg:hidden">{TITLES[tab]}</h1>
          <div key={tab} className="animate-fade-up">{children}</div>
        </main>
      </div>

      {/* BOTTOM NAV (celular) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5 items-end px-2 pt-1.5">
          {NAV.slice(0, 2).map((n) => <NavButton key={n.id} {...n} active={tab === n.id} onClick={() => go(n.id)} />)}
          <div className="flex justify-center">
            <button onClick={() => { play('open'); onNew() }} aria-label="Novo lançamento"
              className="-mt-7 mb-1 flex h-14 w-14 items-center justify-center rounded-[1.4rem] bg-gradient-to-br from-[#c7b3f7] via-[#9a7ae6] to-[#6c4fc4] text-white shadow-[0_12px_30px_-8px_var(--accent)] ring-4 ring-bg transition active:scale-90">
              <Plus className="h-7 w-7" />
            </button>
          </div>
          {NAV.slice(2).map((n) => <NavButton key={n.id} {...n} active={tab === n.id} onClick={() => go(n.id)} />)}
        </div>
      </nav>
    </div>
  )
}

function NavButton({ label, icon: Icon, active, onClick }: { label: string; icon: typeof Home; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cx('flex flex-col items-center gap-0.5 rounded-2xl py-2 text-[10px] transition active:scale-90', active ? 'text-accent' : 'text-muted')}>
      <Icon className={cx('h-5 w-5 transition-transform', active && 'scale-110')} />
      {label}
      <span className={cx('h-1 w-1 rounded-full bg-accent transition-opacity', active ? 'opacity-100' : 'opacity-0')} />
    </button>
  )
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#c7b3f7] via-[#9a7ae6] to-[#6c4fc4] shadow">
        <Zap className="h-5 w-5 text-[#fffaf2]" fill="#fffaf2" />
      </div>
      <div className="leading-none">
        <p className="font-display text-xl">FlowFly</p>
        {!compact && <p className="mt-1 text-[10px] uppercase tracking-[0.25em] text-muted">financeiro</p>}
      </div>
    </div>
  )
}
