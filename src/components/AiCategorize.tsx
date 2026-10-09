'use client'

import { useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatBRL } from '../lib/format'
import { formatDateBR } from '../lib/dates'
import { play } from '../lib/sounds'
import { getCategory } from '../lib/categories'
import { Sheet, cx } from './ui'

type Item = { id: string; date: string; description: string; bank: string | null; amount: number; type: string; from: string; to: string }

async function call(body: unknown) {
  const { data: s } = await supabase.auth.getSession()
  const res = await fetch('/api/ai/recategorize', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token || ''}` }, body: JSON.stringify(body) })
  return res.json().catch(() => ({ error: 'Resposta inválida' }))
}

/** Botão + painel: a IA revisa as categorias dos lançamentos do banco; você escolhe o que aplicar. */
export function AiCategorizeButton({ onDone, className }: { onDone: () => void; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => { play('tap'); setOpen(true) }} className={cx('inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-accent hover:border-accent', className)}>
        <Sparkles className="h-3.5 w-3.5" /> Revisar categorias com IA
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Revisar categorias com IA">
        {open && <Body onDone={() => { setOpen(false); onDone() }} />}
      </Sheet>
    </>
  )
}

function Body({ onDone }: { onDone: () => void }) {
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'applying'>('idle')
  const [msg, setMsg] = useState<string | null>(null)
  const [off, setOff] = useState<Set<string>>(new Set())
  const stop = useRef(false)

  async function run() {
    setStatus('running'); setMsg(null); stop.current = false
    let offset: number | null = 0
    const acc: Item[] = []
    while (offset !== null && !stop.current) {
      const r = await call({ mode: 'suggest', offset })
      if (r.error) { setMsg(r.error === 'migration' ? 'Falta rodar a migração 20261015_categorias_ia no Supabase.' : r.error); break }
      setTotal(r.total)
      acc.push(...(r.items || []))
      setItems([...acc])
      if (r.retryAfterMs && !(r.items || []).length) {
        const secs = Math.ceil(r.retryAfterMs / 1000)
        setMsg(`Limite gratuito da IA por minuto: continuando em ${secs}s…`)
        await new Promise((ok) => setTimeout(ok, r.retryAfterMs + 500))
        setMsg(null)
        continue
      }
      offset = r.next
    }
    setStatus('done')
  }

  const changes = items.filter((i) => i.to !== i.from)
  const chosen = changes.filter((i) => !off.has(i.id))

  async function apply() {
    setStatus('applying')
    const r = await call({
      mode: 'apply',
      changes: chosen.map((i) => ({ id: i.id, category: i.to })),
      keep: changes.filter((i) => off.has(i.id)).map((i) => i.id),
      confirmed: items.filter((i) => i.to === i.from).map((i) => i.id),
    })
    if (r.error) { play('error'); setMsg(r.error); setStatus('done'); return }
    play('success'); onDone()
  }

  return (
    <div className="space-y-4 pb-2 text-sm">
      <p className="text-xs text-muted">A IA lê a descrição do banco (ex.: “SUP SAO VICENTE LJ 03”, “AUTO POSTO REBOUCAS”) e sugere a categoria, usando também as suas categorias personalizadas e as correções que você já fez. <b className="text-ink">Nada muda até você aplicar.</b> Lançamentos que você já ajustou não entram.</p>

      {status === 'idle' && (
        <button type="button" onClick={run} className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-accent-ink"><Sparkles className="h-4 w-4" /> Analisar os últimos 6 meses</button>
      )}

      {status !== 'idle' && (
        <div className="rounded-xl bg-surface-2 p-3 text-xs">
          <p>Analisados <b>{items.length}</b>{total !== null ? ` de ${total}` : ''} · <b className="text-accent">{changes.length}</b> sugestões de mudança</p>
          {status === 'running' && <button type="button" onClick={() => { stop.current = true }} className="mt-1 font-medium text-accent">Parar aqui</button>}
          {msg && <p className="mt-1 text-warn">{msg}</p>}
        </div>
      )}

      {changes.length > 0 && (
        <>
          <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-xl border border-line">
            {changes.map((i) => (
              <li key={i.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                  <input type="checkbox" checked={!off.has(i.id)} onChange={() => setOff((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n })} className="h-4 w-4 accent-[var(--accent)]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{i.bank || i.description}</span>
                    <span className="text-[11px] text-muted">{formatDateBR(i.date).slice(0, 5)} · {formatBRL(i.amount)} · <s>{i.from}</s> → </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ink">{getCategory(i.to).emoji} {i.to}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {status !== 'running' && (
            <button type="button" disabled={status === 'applying' || !chosen.length} onClick={apply} className="h-10 w-full rounded-xl bg-accent text-sm font-medium text-accent-ink disabled:opacity-50">
              {status === 'applying' ? 'Aplicando…' : `Aplicar ${chosen.length} ${chosen.length === 1 ? 'mudança' : 'mudanças'}`}
            </button>
          )}
        </>
      )}
      {status === 'done' && !changes.length && !msg && <p className="text-xs text-muted">Tudo certo: a IA concorda com as categorias atuais.</p>}
    </div>
  )
}
