'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, Copy, Plus, Trash2, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatBRL } from '../lib/format'
import { formatDateBR, todayBR } from '../lib/dates'
import { pixCopiaECola } from '../lib/pix'
import { balances, computeShares, simplifyDebts, type SExpense, type SMember, type SSettlement, type SShare } from '../lib/splitwise'
import { play } from '../lib/sounds'
import type { Partnership } from './ConnectionsPanel'
import { Card, CardHeader, EmptyState, cx, inputClass } from './ui'

type Group = { id: string; name: string; owner_id: string; created_at: string }
const small = 'h-9 min-w-0 rounded-lg border border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none'

/** Grupos de divisão (estilo Splitwise): viagens, casa, amigos — com acerto por Pix. */
export default function GroupsPanel({ userId, partners }: { userId: string; partners: Partnership[] }) {
  const [groups, setGroups] = useState<Group[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const loadGroups = useCallback(async () => {
    const { data, error } = await supabase.from('split_groups').select('*').eq('archived', false).order('created_at', { ascending: false })
    setErr(error ? error.message : null)
    setGroups((data as Group[]) || [])
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadGroups()
  }, [loadGroups])

  async function createGroup(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    const { data, error } = await supabase.from('split_groups').insert({ name: newName.trim(), owner_id: userId }).select('id').single()
    if (error || !data) { play('error'); setErr(error?.message || 'Erro'); return }
    await supabase.from('split_members').insert({ group_id: data.id, name: 'Eu', user_id: userId })
    play('success'); setNewName(''); await loadGroups(); setSelected(data.id)
  }

  const group = groups.find((g) => g.id === selected)

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader title="Grupos" icon={<Users className="h-4 w-4 text-muted" />} subtitle="Viagens, casa, amigos: quem pagou, quem deve e o acerto por Pix" />
        <div className="space-y-3 px-5 pb-5">
          {err && <p className="rounded-lg border border-warn/40 bg-warn/5 p-2 text-[11px] text-warn">Rode o SQL de grupos/patrimônio no Supabase para ativar ({err}).</p>}
          <form onSubmit={createGroup} className="flex gap-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Novo grupo (ex.: Viagem Rio)" className={cx(small, 'flex-1')} />
            <button className="h-9 rounded-lg bg-accent px-3 text-sm font-medium text-accent-ink"><Plus className="h-4 w-4" /></button>
          </form>
          {groups.length ? (
            <ul className="space-y-1">
              {groups.map((g) => (
                <li key={g.id}>
                  <button onClick={() => { play('tap'); setSelected(g.id) }} className={cx('flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm', selected === g.id ? 'bg-accent/10 font-medium' : 'hover:bg-surface-2')}>
                    {g.name} <ArrowRight className="h-3.5 w-3.5 text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={Users} title="Nenhum grupo ainda" text="Crie um para dividir as contas de uma viagem ou da casa." />}
        </div>
      </Card>
      <div className="lg:col-span-2">
        {group ? <GroupDetail key={group.id} group={group} userId={userId} partners={partners} onDeleted={() => { setSelected(null); loadGroups() }} />
          : <Card className="p-5"><EmptyState icon={Users} title="Selecione um grupo" /></Card>}
      </div>
    </div>
  )
}

function GroupDetail({ group, userId, partners, onDeleted }: { group: Group; userId: string; partners: Partnership[]; onDeleted: () => void }) {
  const [members, setMembers] = useState<SMember[]>([])
  const [expenses, setExpenses] = useState<SExpense[]>([])
  const [shares, setShares] = useState<SShare[]>([])
  const [settlements, setSettlements] = useState<SSettlement[]>([])
  // novo membro
  const [mName, setMName] = useState('')
  const [mPix, setMPix] = useState('')
  // nova despesa
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState('')
  const [paidBy, setPaidBy] = useState('')
  const [mode, setMode] = useState<'igual' | 'percentual' | 'valor'>('igual')
  const [involved, setInvolved] = useState<Record<string, boolean>>({})
  const [custom, setCustom] = useState<Record<string, string>>({})
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [m, e, st] = await Promise.all([
      supabase.from('split_members').select('id, name, user_id, pix_key').eq('group_id', group.id).order('created_at'),
      supabase.from('split_expenses').select('id, paid_by, amount, description, date').eq('group_id', group.id).order('date', { ascending: false }),
      supabase.from('split_settlements').select('id, from_member, to_member, amount, date').eq('group_id', group.id),
    ])
    const ms = (m.data as SMember[]) || []
    const ex = (e.data as SExpense[]) || []
    setMembers(ms); setExpenses(ex); setSettlements((st.data as SSettlement[]) || [])
    const { data: sh } = ex.length ? await supabase.from('split_shares').select('expense_id, member_id, share').in('expense_id', ex.map((x) => x.id)) : { data: [] }
    setShares((sh as SShare[]) || [])
  }, [group.id])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const me = members.find((m) => m.user_id === userId)
  const bal = useMemo(() => balances(members, expenses, shares, settlements), [members, expenses, shares, settlements])
  const debts = useMemo(() => simplifyDebts(bal), [bal])
  const name = (id: string) => members.find((m) => m.id === id)?.name || '?'
  const total = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const payer = paidBy || me?.id || members[0]?.id || ''
  const involvedIds = members.filter((m) => involved[m.id] ?? true).map((m) => m.id)

  async function addMember(e: React.FormEvent, partner?: Partnership) {
    e.preventDefault()
    const row: { group_id: string; name: string; user_id?: string; pix_key?: string | null } = partner
      ? { group_id: group.id, name: partner.partner_email.split('@')[0], user_id: partner.partner_id }
      : { group_id: group.id, name: mName.trim(), pix_key: mPix.trim() || null }
    if (!row.name) return
    const { error } = await supabase.from('split_members').insert(row)
    play(error ? 'error' : 'success'); if (error) alert(error.message)
    setMName(''); setMPix(''); load()
  }

  async function savePix(m: SMember, pix: string) {
    await supabase.from('split_members').update({ pix_key: pix.trim() || null }).eq('id', m.id)
    load()
  }

  async function addExpense(e: React.FormEvent) {
    e.preventDefault()
    const value = parseFloat(amount.replace(/\./g, '').replace(',', '.'))
    if (!(value > 0) || !desc.trim() || !payer || !involvedIds.length) { play('error'); return }
    const customNum = Object.fromEntries(Object.entries(custom).map(([k, v]) => [k, parseFloat(String(v).replace(',', '.')) || 0]))
    const sh = computeShares(value, involvedIds, mode, customNum)
    const sum = Object.values(sh).reduce((a, b) => a + b, 0)
    if (Math.abs(sum - value) > 0.02) { play('error'); alert(`As partes somam ${formatBRL(sum)}, mas a despesa é ${formatBRL(value)}.`); return }
    const { data, error } = await supabase.from('split_expenses').insert({ group_id: group.id, paid_by: payer, amount: value, description: desc.trim(), date: todayBR() }).select('id').single()
    if (error || !data) { play('error'); alert(error?.message); return }
    await supabase.from('split_shares').insert(Object.entries(sh).filter(([, v]) => v > 0).map(([member_id, share]) => ({ expense_id: data.id, member_id, share })))
    play('expense'); setDesc(''); setAmount(''); setCustom({}); load()
  }

  async function removeExpense(id: string) {
    if (!confirm('Excluir esta despesa do grupo?')) return
    await supabase.from('split_expenses').delete().eq('id', id)
    play('delete'); load()
  }

  async function settle(d: { from: string; to: string; amount: number }) {
    if (!confirm(`${name(d.from)} pagou ${formatBRL(d.amount)} para ${name(d.to)}?`)) return
    await supabase.from('split_settlements').insert({ group_id: group.id, from_member: d.from, to_member: d.to, amount: d.amount, date: todayBR() })
    play('income'); load()
  }

  function copyPix(d: { from: string; to: string; amount: number }) {
    const to = members.find((m) => m.id === d.to)
    if (!to?.pix_key) return
    const code = pixCopiaECola({ key: to.pix_key, name: to.name, amount: d.amount, description: group.name })
    navigator.clipboard.writeText(code)
    play('success'); setCopied(`${d.from}${d.to}`); setTimeout(() => setCopied(null), 2500)
  }

  async function deleteGroup() {
    if (!confirm(`Apagar o grupo "${group.name}" e todas as despesas dele?`)) return
    await supabase.from('split_groups').delete().eq('id', group.id)
    play('delete'); onDeleted()
  }

  const availablePartners = partners.filter((p) => !members.some((m) => m.user_id === p.partner_id))

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={group.name} subtitle={`${members.length} pessoa(s) · ${formatBRL(total)} em ${expenses.length} despesa(s)`}
          action={group.owner_id === userId && <button onClick={deleteGroup} className="rounded-lg p-1.5 text-muted hover:text-expense" title="Apagar grupo"><Trash2 className="h-4 w-4" /></button>} />
        {/* Saldos e acerto */}
        <div className="grid gap-4 px-5 pb-5 md:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Saldo de cada um</p>
            <ul className="space-y-1 text-sm">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2">
                  <span>{m.name}{m.user_id === userId ? ' (você)' : ''}</span>
                  <span className={cx('tabular font-medium', bal[m.id] > 0 ? 'text-income' : bal[m.id] < 0 ? 'text-expense' : 'text-muted')}>
                    {bal[m.id] > 0 ? `recebe ${formatBRL(bal[m.id])}` : bal[m.id] < 0 ? `deve ${formatBRL(-bal[m.id])}` : 'quite'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Para acertar tudo</p>
            {debts.length ? (
              <ul className="space-y-2 text-sm">
                {debts.map((d) => {
                  const to = members.find((m) => m.id === d.to)
                  return (
                    <li key={d.from + d.to} className="rounded-lg border border-line p-2">
                      <p><b>{name(d.from)}</b> paga <b className="tabular">{formatBRL(d.amount)}</b> para <b>{name(d.to)}</b></p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {to?.pix_key
                          ? <button onClick={() => copyPix(d)} className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11px] font-medium text-accent-ink"><Copy className="h-3 w-3" /> {copied === d.from + d.to ? 'Copiado!' : 'Pix copia e cola'}</button>
                          : <span className="text-[11px] text-muted">Adicione a chave Pix de {to?.name} para gerar o código</span>}
                        <button onClick={() => settle(d)} className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-[11px] font-medium hover:bg-surface-2"><Check className="h-3 w-3" /> Marcar como pago</button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : <p className="text-sm text-income">Tudo acertado ✨</p>}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Nova despesa */}
        <Card>
          <CardHeader title="Nova despesa" />
          <form onSubmit={addExpense} className="space-y-2 px-5 pb-5">
            <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Descrição (ex.: Jantar)" className={inputClass} />
            <div className="grid grid-cols-2 gap-2">
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Valor (R$)" className={inputClass} />
              <select value={payer} onChange={(e) => setPaidBy(e.target.value)} className={inputClass}>
                {members.map((m) => <option key={m.id} value={m.id}>Pago por {m.name}</option>)}
              </select>
            </div>
            <div className="inline-flex rounded-lg bg-surface-2 p-0.5 text-xs">
              {(['igual', 'percentual', 'valor'] as const).map((md) => (
                <button type="button" key={md} onClick={() => setMode(md)} className={cx('h-7 rounded-md px-2.5', mode === md ? 'bg-surface font-medium shadow-[var(--shadow)]' : 'text-muted')}>{md === 'igual' ? 'Igual' : md === 'percentual' ? '%' : 'R$'}</button>
              ))}
            </div>
            <ul className="space-y-1 text-sm">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={involved[m.id] ?? true} onChange={(e) => setInvolved({ ...involved, [m.id]: e.target.checked })} className="h-4 w-4 accent-[var(--accent)]" />
                  <span className="flex-1">{m.name}</span>
                  {mode !== 'igual' && (involved[m.id] ?? true) && (
                    <input inputMode="decimal" value={custom[m.id] || ''} onChange={(e) => setCustom({ ...custom, [m.id]: e.target.value })} placeholder={mode === 'percentual' ? '%' : 'R$'} className="h-7 w-20 rounded border border-line bg-surface px-2 text-xs" />
                  )}
                </li>
              ))}
            </ul>
            <button className="h-10 w-full rounded-xl bg-accent text-sm font-medium text-accent-ink">Adicionar despesa</button>
          </form>
        </Card>

        {/* Pessoas */}
        <Card>
          <CardHeader title="Pessoas" subtitle="Chave Pix de quem recebe gera o código de pagamento" />
          <div className="space-y-2 px-5 pb-5">
            <ul className="space-y-1.5">
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-sm">
                  <span className="w-24 shrink-0 truncate">{m.name}</span>
                  <input defaultValue={m.pix_key || ''} onBlur={(e) => e.target.value !== (m.pix_key || '') && savePix(m, e.target.value)} placeholder="Chave Pix (opcional)" className={cx(small, 'h-8 flex-1 text-xs')} />
                </li>
              ))}
            </ul>
            <form onSubmit={(e) => addMember(e)} className="flex gap-2 pt-1">
              <input value={mName} onChange={(e) => setMName(e.target.value)} placeholder="Nome" className={cx(small, 'flex-1')} />
              <input value={mPix} onChange={(e) => setMPix(e.target.value)} placeholder="Pix" className={cx(small, 'w-28')} />
              <button className="h-9 rounded-lg border border-line px-3 text-sm"><Plus className="h-4 w-4" /></button>
            </form>
            {availablePartners.map((p) => (
              <button key={p.partner_id} onClick={(e) => addMember(e as unknown as React.FormEvent, p)} className="text-xs font-medium text-accent">+ Adicionar {p.partner_email}</button>
            ))}
          </div>
        </Card>
      </div>

      {/* Despesas */}
      <Card>
        <CardHeader title="Despesas do grupo" />
        {expenses.length ? (
          <ul className="divide-y divide-line px-5 pb-3">
            {expenses.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="w-11 shrink-0 tabular text-xs text-muted">{formatDateBR(e.date).slice(0, 5)}</span>
                <span className="min-w-0 flex-1 truncate">{e.description} <span className="text-xs text-muted">· pago por {name(e.paid_by)} · {shares.filter((s) => s.expense_id === e.id).map((s) => `${name(s.member_id)} ${formatBRL(Number(s.share))}`).join(', ')}</span></span>
                <span className="tabular font-medium">{formatBRL(Number(e.amount))}</span>
                <button onClick={() => removeExpense(e.id)} className="rounded p-1 text-muted hover:text-expense"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={Users} title="Nenhuma despesa ainda" />}
      </Card>
    </div>
  )
}
