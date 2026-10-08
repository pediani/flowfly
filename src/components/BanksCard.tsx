'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, CreditCard, ExternalLink, Landmark, Pencil, RefreshCw, Trash2, Wallet } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { formatDateTimeBR, relativeTimeBR } from '../lib/dates'
import { play } from '../lib/sounds'
import { EmptyState, cx } from './ui'

type Conn = { id: string; item_id: string; institution: string | null; last_sync_at: string | null; status: string | null }

async function authed(path: string, body?: unknown) {
  const { data } = await supabase.auth.getSession()
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` },
    body: JSON.stringify(body ?? {}),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, json }
}

const card = 'flex flex-col rounded-2xl border border-line bg-surface shadow-[var(--shadow)] animate-fade-up'

/** Bancos conectados via Meu Pluggy (Open Finance) */
export default function BanksCard({ onSynced }: { onSynced: () => void }) {
  const [conns, setConns] = useState<Conn[]>([])
  const [itemId, setItemId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [showHelp, setShowHelp] = useState(false)
  const [accounts, setAccounts] = useState<Record<string, { type: string; name: string; last4: string }[]>>({})
  const [renaming, setRenaming] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [diag, setDiag] = useState<string | null>(null)
  const [itemStatus, setItemStatus] = useState<Record<string, { status: string; lastUpdatedAt?: string | null; nextAutoSyncAt?: string | null; error?: string | null }>>({})
  const [refreshing, setRefreshing] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase.from('bank_connections').select('id, item_id, institution, last_sync_at, status').order('created_at')
    setConns((data as Conn[]) || [])
    if (data?.length) {
      const [acc, st] = await Promise.all([authed('/api/pluggy/accounts'), authed('/api/pluggy/status')])
      if (acc.ok) setAccounts(acc.json)
      if (st.ok) setItemStatus(st.json.items || {})
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  async function connect(e: React.FormEvent) {
    e.preventDefault()
    setBusy('connect'); setMsg(null)
    const { ok, json } = await authed('/api/pluggy/connect', { itemId })
    setBusy(null)
    if (!ok) { play('error'); setMsg({ ok: false, text: json.error || 'Não foi possível conectar.' }); return }
    play('success')
    setMsg({ ok: true, text: json.warning || `${json.institution || 'Banco'} conectado! ${json.imported} lançamento(s) importado(s)${json.matched ? `, ${json.matched} juntado(s) com os que você já tinha` : ''}.` })
    setItemId('')
    load(); onSynced()
  }

  async function syncNow() {
    setBusy('sync'); setMsg(null)
    const { ok, json } = await authed('/api/pluggy/sync')
    setBusy(null)
    if (!ok) { play('error'); setMsg({ ok: false, text: json.error || 'Falha ao sincronizar.' }); return }
    play(json.imported ? 'income' : 'success')
    setMsg({ ok: !json.errors?.length, text: `${json.imported} novo(s), ${json.matched} juntado(s)${json.errors?.length ? ` · falhou: ${json.errors.join(', ')}` : ''}.` })
    load(); onSynced()
  }

  /** Pede ao banco dados novos e acompanha até terminar (máx. ~3 min), depois importa. */
  async function refreshNow() {
    setRefreshing('Pedindo atualização aos bancos…'); setMsg(null)
    const { ok, json } = await authed('/api/pluggy/refresh')
    if (!ok) { setRefreshing(null); play('error'); setMsg({ ok: false, text: json.error || 'Falha ao pedir atualização.' }); return }
    const failed = (json.results || []).filter((r: { ok: boolean; error?: string }) => !r.ok && r.error !== 'meupluggy')
    const viaMeuPluggy = (json.results || []).filter((r: { error?: string }) => r.error === 'meupluggy').length
    const started = (json.results || []).filter((r: { ok: boolean }) => r.ok).length
    for (let i = 0; i < (started ? 36 : 0); i++) {
      await new Promise((r) => setTimeout(r, 5000))
      const st = await authed('/api/pluggy/status')
      const items = (st.json.items || {}) as typeof itemStatus
      setItemStatus(items)
      const updating = Object.values(items).filter((x) => x.status === 'UPDATING').length
      setRefreshing(updating ? `Atualizando ${updating} banco(s)… ${(i + 1) * 5}s` : 'Importando lançamentos…')
      if (!updating) break
    }
    const sync = await authed('/api/pluggy/sync')
    setRefreshing(null)
    play(sync.json.imported ? 'income' : 'success')
    setMsg({
      ok: !failed.length,
      text: `Importado o que já estava disponível: ${sync.json.imported ?? 0} novo(s), ${sync.json.matched ?? 0} juntado(s).` +
        (viaMeuPluggy ? ' Conexões pelo Meu Pluggy (gratuito) não aceitam atualização sob demanda: o banco é consultado 1 vez por dia, no horário indicado em cada banco. Quando os dados novos chegam, o FlowFly importa sozinho e avisa no Telegram.' : '') +
        (failed.length ? ` Não atualizou: ${failed.map((f: { institution: string; error: string }) => `${f.institution} (${f.error})`).join('; ')}.` : ''),
    })
    load(); onSynced()
  }

  async function rename(c: Conn) {
    const { ok, json } = await authed('/api/pluggy/rename', { connectionId: c.id, name: newName })
    play(ok ? 'success' : 'error')
    if (!ok) { setMsg({ ok: false, text: json.error || 'Erro ao renomear.' }); return }
    setRenaming(null)
    load(); onSynced()
  }

  async function remove(c: Conn) {
    if (!confirm(`Desconectar ${c.institution || 'este banco'}? Os lançamentos já importados continuam no app.`)) return
    await supabase.from('bank_connections').delete().eq('id', c.id)
    play('delete'); load()
  }

  return (
    <div className={cx(card, 'lg:col-span-2')}>
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
        <div>
          <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"><Landmark className="h-4 w-4 text-accent" /> Bancos (Open Finance)</h3>
          <p className="mt-1 text-xs text-muted">Importa entradas e saídas dos seus bancos todo dia, sem duplicar o que você já lançou.</p>
        </div>
        {conns.length > 0 && (
          <div className="flex shrink-0 gap-1.5">
            <button onClick={() => { play('tap'); refreshNow() }} disabled={!!busy || !!refreshing} title="Pede dados novos ao banco e importa o que estiver disponível" className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-ink disabled:opacity-50">
              <RefreshCw className={cx('h-3.5 w-3.5', refreshing && 'animate-spin')} /> Atualizar agora
            </button>
            <button onClick={syncNow} disabled={!!busy || !!refreshing} title="Só reimporta o que a Pluggy já tem" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium hover:bg-surface-2 disabled:opacity-50">
              <RefreshCw className={cx('h-3.5 w-3.5', busy === 'sync' && 'animate-spin')} /> Importar
            </button>
          </div>
        )}
      </div>

      <div className="space-y-4 px-5 pb-5">
        {conns.length ? (
          <ul className="divide-y divide-line">
            {conns.map((c) => (
              <li key={c.id} className="py-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><Landmark className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    {renaming === c.id ? (
                      <form onSubmit={(e) => { e.preventDefault(); rename(c) }} className="flex gap-1.5">
                        <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex.: Itaú"
                          className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-sm focus:border-accent focus:outline-none" />
                        <button className="rounded-lg bg-accent px-2 text-accent-ink" title="Salvar"><Check className="h-4 w-4" /></button>
                      </form>
                    ) : (
                      <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                        {c.institution || 'Banco'}
                        <button onClick={() => { play('tap'); setRenaming(c.id); setNewName(/meu\s?pluggy/i.test(c.institution || '') ? '' : c.institution || '') }} title="Renomear" className="rounded p-0.5 text-muted hover:text-ink"><Pencil className="h-3 w-3" /></button>
                      </p>
                    )}
                    <p className="text-xs text-muted">
                      {itemStatus[c.id]?.status === 'UPDATING' ? <span className="text-accent">Atualizando com o banco…</span>
                        : itemStatus[c.id]?.lastUpdatedAt ? `Dados do banco de ${relativeTimeBR(itemStatus[c.id].lastUpdatedAt!)}`
                        : c.last_sync_at ? `Importado ${relativeTimeBR(c.last_sync_at)}` : 'Aguardando primeira sincronização'}
                      {itemStatus[c.id]?.nextAutoSyncAt ? ` · próxima automática ${formatDateTimeBR(itemStatus[c.id].nextAutoSyncAt!)}` : ''}
                      {itemStatus[c.id]?.status && !['UPDATED', 'UPDATING'].includes(itemStatus[c.id].status) ? <span className="text-expense"> · {itemStatus[c.id].status}{itemStatus[c.id].error ? `: ${itemStatus[c.id].error}` : ''}</span> : null}
                    </p>
                  </div>
                  <button onClick={() => remove(c)} title="Desconectar" className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-expense"><Trash2 className="h-4 w-4" /></button>
                </div>
                {!!accounts[c.id]?.length && (
                  <div className="ml-12 mt-2 flex flex-wrap gap-1.5">
                    {accounts[c.id].map((a, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-[11px] text-muted">
                        {a.type === 'Cartão' ? <CreditCard className="h-3 w-3" /> : <Wallet className="h-3 w-3" />}
                        {a.name || a.type}{a.last4 ? ` ·${a.last4}` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={Landmark} title="Nenhum banco conectado" text="Conecte Itaú, Mercado Pago, Santander e outros pelo Meu Pluggy (gratuito)." />}

        <form onSubmit={connect} className="flex gap-2">
          <input value={itemId} onChange={(e) => setItemId(e.target.value)} placeholder="Cole o Item ID da Pluggy"
            className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-sm focus:border-accent focus:outline-none" />
          <button disabled={!!busy || !itemId.trim()} className="h-10 shrink-0 rounded-xl bg-accent px-4 text-sm font-medium text-accent-ink disabled:opacity-50">
            {busy === 'connect' ? 'Conectando…' : 'Conectar'}
          </button>
        </form>
        {refreshing && <p className="text-xs text-accent">{refreshing}</p>}
        {msg && <p className={cx('text-xs', msg.ok ? 'text-income' : 'text-expense')}>{msg.text}</p>}

        <div className="flex flex-wrap gap-3">
          <button onClick={() => setShowHelp(!showHelp)} className="text-xs font-medium text-accent">{showHelp ? 'Ocultar' : 'Como obter o Item ID?'}</button>
          {conns.length > 0 && (
            <button
              onClick={async () => {
                setDiag('Carregando…')
                const { json } = await authed('/api/pluggy/balances?debug=1')
                setDiag(JSON.stringify(json.diag ?? json, null, 1))
              }}
              className="text-xs text-muted hover:text-ink"
            >
              Diagnóstico das faturas
            </button>
          )}
        </div>
        {diag && <pre id="ff-diag" className="max-h-80 overflow-auto rounded-lg bg-surface-2 p-3 text-[10px] leading-snug">{diag}</pre>}
        {showHelp && (
          <ol className="list-decimal space-y-1.5 pl-5 text-xs text-muted animate-fade-in">
            <li>Em <a className="text-accent" href="https://meu.pluggy.ai" target="_blank" rel="noreferrer">meu.pluggy.ai <ExternalLink className="inline h-3 w-3" /></a>, conecte seus bancos pelo Open Finance.</li>
            <li>No <a className="text-accent" href="https://dashboard.pluggy.ai" target="_blank" rel="noreferrer">dashboard da Pluggy <ExternalLink className="inline h-3 w-3" /></a>, abra sua aplicação → <b>Ir para Demo</b>.</li>
            <li>No Demo, conecte o <b>MeuPluggy</b> (uma vez por banco) e use <b>⋮ → Copiar Item ID</b>.</li>
            <li>Cole aqui e toque em Conectar. Repita para cada banco.</li>
          </ol>
        )}
      </div>
    </div>
  )
}
