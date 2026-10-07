'use client'

import { useState, type ReactNode } from 'react'
import {
  CalendarClock, ChevronLeft, ChevronRight, Home, ListOrdered, LogOut, Moon, PanelLeftClose, PanelLeftOpen,
  Plus, Send, Sun, Volume2, VolumeX, Zap,
} from 'lucide-react'
import { addMonths, currentMonthKey, monthLabel } from '../lib/dates'
import { isSoundOn, play, setSoundOn } from '../lib/sounds'
import { applyTheme, getTheme, type Theme } from '../lib/theme'
import { IconButton, cx } from './ui'

export type Tab = 'inicio' | 'lancamentos' | 'fixas' | 'conexoes'

const NAV: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: 'inicio', label: 'Início', icon: Home },
  { id: 'lancamentos', label: 'Lançamentos', icon: ListOrdered },
  { id: 'fixas', label: 'Contas fixas', icon: CalendarClock },
  { id: 'conexoes', label: 'Conexões', icon: Send },
]

const TITLES: Record<Tab, string> = { inicio: 'Visão geral', lancamentos: 'Lançamentos', fixas: 'Contas fixas', conexoes: 'Conexões' }
const SIDEBAR_KEY = 'flowfly:sidebar'

function readCollapsed(): boolean {
  try { return localStorage.getItem(SIDEBAR_KEY) === 'collapsed' } catch { return false }
}

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
  const [collapsed, setCollapsed] = useState(readCollapsed)
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
  function toggleSidebar() {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem(SIDEBAR_KEY, next ? 'collapsed' : 'open') } catch { /* armazenamento indisponível */ }
    play('toggle')
  }
  function shift(n: number) {
    play('tap')
    onMonth(addMonths(monthKey, n))
  }

  const soundBtn = (
    <IconButton onClick={toggleSound} title={sound ? 'Desligar sons' : 'Ligar sons'}>
      {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
    </IconButton>
  )
  const themeBtn = (
    <IconButton onClick={toggleTheme} title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}>
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </IconButton>
  )

  const monthSelector = showMonth && (
    <div className="flex items-center gap-0.5 rounded-xl border border-line bg-surface p-0.5">
      <button onClick={() => shift(-1)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink active:scale-90" aria-label="Mês anterior"><ChevronLeft className="h-4 w-4" /></button>
      <span className="min-w-28 text-center text-sm font-medium tabular">{monthLabel(monthKey, 'longYear')}</span>
      <button onClick={() => shift(1)} disabled={monthKey >= addMonths(cur, 6)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink active:scale-90 disabled:opacity-30" aria-label="Próximo mês"><ChevronRight className="h-4 w-4" /></button>
      {monthKey !== cur && (
        <button onClick={() => { play('tap'); onMonth(cur) }} className="ml-0.5 rounded-lg bg-accent/10 px-2 py-1 text-xs font-medium text-accent">Hoje</button>
      )}
    </div>
  )

  return (
    <div className={cx('min-h-dvh lg:grid lg:transition-[grid-template-columns] lg:duration-300', collapsed ? 'lg:grid-cols-[68px_1fr]' : 'lg:grid-cols-[232px_1fr]')}>
      {/* SIDEBAR (desktop, ocultável) */}
      <aside className="sticky top-0 hidden h-dvh flex-col overflow-hidden border-r border-line bg-surface px-3 py-4 lg:flex">
        <div className={cx('flex items-center', collapsed ? 'justify-center' : 'justify-between px-1')}>
          {!collapsed && <Logo />}
          <IconButton onClick={toggleSidebar} title={collapsed ? 'Expandir menu' : 'Recolher menu'}>
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </IconButton>
        </div>

        <button
          onClick={() => { play('open'); onNew() }} title="Novo lançamento"
          className={cx('mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-accent text-sm font-medium text-accent-ink transition hover:bg-accent-strong active:scale-[0.98]', collapsed && 'mx-auto w-10')}
        >
          <Plus className="h-4 w-4 shrink-0" /> {!collapsed && 'Novo lançamento'}
        </button>

        <nav className="mt-4 space-y-0.5">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id} onClick={() => go(id)} title={collapsed ? label : undefined}
              className={cx(
                'flex h-9 w-full items-center gap-3 rounded-lg text-sm transition',
                collapsed ? 'justify-center' : 'px-3',
                tab === id ? 'bg-surface-2 font-medium text-ink' : 'text-muted hover:bg-surface-2/60 hover:text-ink',
              )}
            >
              <Icon className={cx('h-4 w-4 shrink-0', tab === id && 'text-accent')} /> {!collapsed && label}
            </button>
          ))}
        </nav>

        <div className={cx('mt-auto flex gap-1', collapsed ? 'flex-col items-center' : 'items-center')}>
          {soundBtn}
          {themeBtn}
          <IconButton onClick={onSignOut} title={`Sair${email ? ` (${email})` : ''}`} className={collapsed ? '' : 'ml-auto'}><LogOut className="h-4 w-4" /></IconButton>
        </div>
        {!collapsed && email && <p className="mt-2 truncate px-1 text-xs text-muted">{email}</p>}
      </aside>

      <div className="min-w-0">
        {/* HEADER */}
        <header className="sticky top-0 z-30 border-b border-line bg-bg/80 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-xl md:px-8">
          <div className="flex h-9 items-center justify-between gap-3">
            <div className="lg:hidden"><Logo /></div>
            <h1 className="hidden text-lg font-semibold tracking-tight lg:block">{TITLES[tab]}</h1>
            <div className="hidden md:block">{monthSelector}</div>
            <div className="flex gap-1 lg:hidden">
              {soundBtn}
              {themeBtn}
              <IconButton onClick={onSignOut} title="Sair"><LogOut className="h-4 w-4" /></IconButton>
            </div>
          </div>
          {showMonth && <div className="mt-3 flex justify-center md:hidden">{monthSelector}</div>}
        </header>

        <main className="mx-auto max-w-6xl px-4 pb-32 pt-5 md:px-8 lg:pb-12">
          <h1 className="mb-4 text-xl font-semibold tracking-tight lg:hidden">{TITLES[tab]}</h1>
          <div key={tab} className="animate-fade-up">{children}</div>
        </main>
      </div>

      {/* BOTTOM NAV (celular) */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5 items-center px-2 py-1">
          {NAV.slice(0, 2).map((n) => <NavButton key={n.id} {...n} active={tab === n.id} onClick={() => go(n.id)} />)}
          <div className="flex justify-center">
            <button onClick={() => { play('open'); onNew() }} aria-label="Novo lançamento"
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-white transition active:scale-90">
              <Plus className="h-5 w-5" />
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
    <button onClick={onClick} className={cx('flex flex-col items-center gap-1 rounded-xl py-1.5 text-[10px] font-medium transition active:scale-90', active ? 'text-ink' : 'text-muted')}>
      <Icon className={cx('h-5 w-5', active && 'text-accent')} strokeWidth={active ? 2.25 : 1.75} />
      {label === 'Contas fixas' ? 'Fixas' : label}
    </button>
  )
}

function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent">
        <Zap className="h-4 w-4 text-white" fill="currentColor" />
      </div>
      <p className="text-[15px] font-semibold tracking-tight">FlowFly</p>
    </div>
  )
}
