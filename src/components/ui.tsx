'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Inbox, X, type LucideIcon } from 'lucide-react'
import { formatBRL } from '../lib/format'
import { play } from '../lib/sounds'

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ')
}

export function Card({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <section
      className={cx('flex flex-col rounded-2xl border border-line bg-surface shadow-[var(--shadow)] animate-fade-up', className)}
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </section>
  )
}

export function CardHeader({ title, subtitle, icon, action }: { title: string; subtitle?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
      <div className="min-w-0">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          {icon}
          {title}
        </h3>
        {subtitle && <p className="text-xs text-muted mt-1">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

/** Valor em reais com animação de contagem */
export function Money({ value, className, signed = false, animate = true }: { value: number; className?: string; signed?: boolean; animate?: boolean }) {
  const shown = useCountUp(value, animate ? 650 : 0)
  const text = formatBRL(Math.abs(shown))
  const prefix = value < 0 ? '− ' : signed && value > 0 ? '+ ' : ''
  return <span className={cx('tabular', className)}>{prefix}{text}</span>
}

export function useCountUp(target: number, duration = 650): number {
  const [value, setValue] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    if (!duration) {
      from.current = target
      const id = requestAnimationFrame(() => setValue(target))
      return () => cancelAnimationFrame(id)
    }
    const start = performance.now()
    const initial = from.current
    let raf = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(initial + (target - initial) * eased)
      if (t < 1) raf = requestAnimationFrame(step)
      else from.current = target
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}

export function Segmented<T extends string>({ options, value, onChange, className }: {
  options: { value: T; label: ReactNode; activeClass?: string }[]
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={cx('grid gap-1 rounded-xl bg-surface-2 p-1', className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => { if (o.value !== value) { play('toggle'); onChange(o.value) } }}
          className={cx(
            'h-9 rounded-lg text-sm font-medium transition-all active:scale-[0.97]',
            o.value === value ? (o.activeClass || 'bg-surface text-ink shadow-[var(--shadow)]') : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => { play('tap'); onClick() }}
      className={cx(
        'shrink-0 rounded-lg border px-3 h-8 text-xs font-medium transition-all active:scale-95',
        active ? 'border-ink/80 bg-ink text-bg' : 'border-line text-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  )
}

export function IconButton({ onClick, title, children, className }: { onClick: () => void; title: string; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cx('inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-all hover:bg-surface-2 hover:text-ink active:scale-90', className)}
    >
      {children}
    </button>
  )
}

export const inputClass =
  'flex h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-ink placeholder:text-muted/70 focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/15 transition'

export const primaryButton =
  'inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 font-medium text-accent-ink transition-all hover:bg-accent-strong active:scale-[0.98] disabled:opacity-50'

export const ghostButton =
  'inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line px-3 text-sm font-medium text-ink transition-all hover:bg-surface-2 active:scale-[0.97]'

/** Painel que sobe de baixo no celular e vira modal centralizado no desktop */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60 animate-fade-in" onClick={onClose} />
      <div className="relative w-full max-h-[92dvh] overflow-y-auto rounded-t-3xl border border-line bg-surface pb-[max(1.25rem,env(safe-area-inset-bottom))] animate-sheet-up md:max-w-md md:rounded-2xl md:animate-pop">
        <div className="sticky top-0 z-10 bg-surface px-5 pt-3 pb-2">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line md:hidden" />
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-full p-2 text-muted hover:text-ink hover:bg-surface-2">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div className="px-5">{children}</div>
      </div>
    </div>
  )
}

export function EmptyState({ icon: Icon = Inbox, title, text }: { icon?: LucideIcon; title: string; text?: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 py-10 text-center">
      <span className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-muted"><Icon className="h-5 w-5" /></span>
      <p className="text-sm font-medium">{title}</p>
      {text && <p className="text-sm text-muted max-w-xs">{text}</p>}
    </div>
  )
}
