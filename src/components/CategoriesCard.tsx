'use client'

import { AiCategorizeButton } from './AiCategorize'
import { useState } from 'react'
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { CATEGORIES, type CustomCategoryRow } from '../lib/categories'
import { play } from '../lib/sounds'
import { CategoryIcon, ICONS, PICKER_COLORS, PICKER_ICONS } from './CategoryIcon'
import { Card, CardHeader, cx } from './ui'

export type CategoryRow = CustomCategoryRow & { id: string }

/** Formulário de categoria (usado no card e no "+ Nova" do lançamento). */
export function CategoryForm({ initial, onSaved, onCancel }: { initial?: CategoryRow | null; onSaved: (name: string) => void; onCancel?: () => void }) {
  const [name, setName] = useState(initial?.name || '')
  const [emoji, setEmoji] = useState(initial?.emoji || '🏷️')
  const [icon, setIcon] = useState(initial?.icon || 'tag')
  const [color, setColor] = useState(initial?.color || PICKER_COLORS[0])
  const [keywords, setKeywords] = useState((initial?.keywords || []).join(', '))
  const [error, setError] = useState<string | null>(null)

  // Não é <form>: este bloco aparece dentro do formulário do lançamento e um
  // form aninhado disparava o envio (e o fechamento) do lançamento junto.
  async function save(e?: React.SyntheticEvent) {
    e?.preventDefault()
    e?.stopPropagation()
    const n = name.trim()
    if (!n) return
    if (!initial && CATEGORIES.some((c) => c.name.toLowerCase() === n.toLowerCase())) { setError('Essa categoria já existe.'); return }
    const { data: { user } } = await supabase.auth.getUser()
    const row = { user_id: user?.id, name: n, emoji: emoji.trim() || '🏷️', icon, color, type: 'saida', keywords: keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean) }
    const { error: err } = initial
      ? await supabase.from('categories').update(row).eq('id', initial.id)
      : await supabase.from('categories').insert(row)
    if (err) {
      play('error')
      setError(/duplicate|unique/i.test(err.message) ? 'Essa categoria já existe.'
        : /column|schema cache|does not exist/i.test(err.message) ? 'Falta rodar a migração 20261013_categorias_notas no Supabase.'
        : err.message)
      return
    }
    // renomear: atualiza os lançamentos que usavam o nome antigo
    if (initial && initial.name !== n) await supabase.from('transactions').update({ category: n }).eq('category', initial.name)
    play('success'); onSaved(n)
  }

  return (
    <div onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') save(e) }} className="space-y-2.5 rounded-xl border border-line p-3 text-sm animate-fade-in">
      <div className="flex gap-2">
        <input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={4} className="h-9 w-12 rounded-lg border border-line bg-surface text-center" title="Emoji (usado no Telegram)" />
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (ex.: Pet)" className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 focus:border-accent focus:outline-none" />
      </div>
      <div className="flex flex-wrap gap-1">
        {PICKER_ICONS.map((k) => { const I = ICONS[k]; return (
          <button type="button" key={k} onClick={() => setIcon(k)} className={cx('flex h-8 w-8 items-center justify-center rounded-lg border', icon === k ? 'border-accent bg-accent/10' : 'border-line')} style={{ color }}><I className="h-4 w-4" /></button>
        ) })}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PICKER_COLORS.map((c) => <button type="button" key={c} onClick={() => setColor(c)} className={cx('h-6 w-6 rounded-full', color === c && 'ring-2 ring-offset-2 ring-offset-surface')} style={{ background: c, ['--tw-ring-color' as string]: c }} />)}
      </div>
      <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="Palavras-chave para reconhecer sozinho (ex.: petz, ração, veterinário)" className="h-9 w-full rounded-lg border border-line bg-surface px-3 text-xs focus:border-accent focus:outline-none" />
      {error && <p className="text-xs text-expense">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} className="h-9 flex-1 rounded-lg bg-accent text-sm font-medium text-accent-ink">{initial ? 'Salvar' : 'Criar categoria'}</button>
        {onCancel && <button type="button" onClick={onCancel} className="h-9 rounded-lg border border-line px-3 text-sm">Cancelar</button>}
      </div>
    </div>
  )
}

/** Gerenciar categorias personalizadas (aba Contas fixas). */
export default function CategoriesCard({ rows, onChange }: { rows: CategoryRow[]; onChange: () => void }) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

  async function remove(r: CategoryRow) {
    if (!confirm(`Apagar a categoria "${r.name}"? Os lançamentos dela passam para "Geral".`)) return
    await supabase.from('transactions').update({ category: 'Geral' }).eq('category', r.name)
    await supabase.from('categories').delete().eq('id', r.id)
    play('delete'); onChange()
  }

  return (
    <Card className="lg:col-span-5" delay={60}>
      <CardHeader title="Categorias" icon={<Tags className="h-4 w-4 text-muted" />} subtitle="Crie as suas além das padrão; as palavras-chave ensinam o app e o bot a reconhecer sozinhos"
        action={!adding && <button onClick={() => { play('tap'); setAdding(true) }} className="inline-flex items-center gap-1 text-xs font-medium text-accent"><Plus className="h-3.5 w-3.5" /> Nova</button>} />
      <div className="space-y-3 px-5 pb-5">
        <AiCategorizeButton onDone={onChange} />
        {adding && <CategoryForm onSaved={() => { setAdding(false); onChange() }} onCancel={() => setAdding(false)} />}
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((c) => (
            <span key={c.name} className="inline-flex items-center gap-1.5 rounded-lg border border-line py-1 pl-1 pr-2.5 text-xs text-muted"><CategoryIcon category={c.name} size="sm" />{c.name}</span>
          ))}
        </div>
        {rows.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {rows.map((r) => (
              <li key={r.id} className="px-3 py-2">
                {editing === r.id ? <CategoryForm initial={r} onSaved={() => { setEditing(null); onChange() }} onCancel={() => setEditing(null)} /> : (
                  <div className="flex items-center gap-2.5 text-sm">
                    <CategoryIcon category={r.name} size="sm" />
                    <span className="min-w-0 flex-1 truncate">{r.emoji} {r.name}{r.keywords?.length ? <span className="text-xs text-muted"> · {r.keywords.join(', ')}</span> : null}</span>
                    <button onClick={() => setEditing(r.id)} className="rounded p-1 text-muted hover:text-ink" title="Editar"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => remove(r)} className="rounded p-1 text-muted hover:text-expense" title="Apagar"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}
