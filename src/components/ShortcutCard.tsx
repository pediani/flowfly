'use client'

import { useCallback, useEffect, useState } from 'react'
import { Copy, Mic, Smartphone, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { relativeTimeBR } from '../lib/dates'
import { play } from '../lib/sounds'
import { cx } from './ui'

type Tok = { id: string; label: string | null; created_at: string; last_used_at: string | null }
const card = 'flex flex-col rounded-2xl border border-line bg-surface shadow-[var(--shadow)] animate-fade-up'

/** Atalho da Siri (iPhone) / Android: lançar falando, sem abrir o Telegram. */
export default function ShortcutCard() {
  const [tokens, setTokens] = useState<Tok[]>([])
  const [newToken, setNewToken] = useState<string | null>(null)
  const [os, setOs] = useState<'ios' | 'android'>('ios')
  const [err, setErr] = useState<string | null>(null)
  const url = typeof window !== 'undefined' ? `${window.location.origin}/api/quick` : '/api/quick'

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('api_tokens').select('id, label, created_at, last_used_at').order('created_at')
    setErr(error ? error.message : null)
    setTokens((data as Tok[]) || [])
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  async function create() {
    const { data } = await supabase.auth.getSession()
    const res = await fetch('/api/quick/token', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token || ''}` }, body: JSON.stringify({ label: os === 'ios' ? 'Siri (iPhone)' : 'Android' }) })
    const json = await res.json()
    if (!res.ok) { play('error'); setErr(json.error); return }
    play('success'); setNewToken(json.token); load()
  }

  async function remove(t: Tok) {
    if (!confirm('Revogar este token? O atalho que usa ele para de funcionar.')) return
    await supabase.from('api_tokens').delete().eq('id', t.id)
    play('delete'); load()
  }

  const copy = (v: string) => { navigator.clipboard.writeText(v); play('tap') }

  return (
    <div className={card}>
      <div className="px-5 pt-5 pb-3">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"><Mic className="h-4 w-4 text-accent" /> Atalho de voz (Siri / Android)</h3>
        <p className="mt-1 text-xs text-muted">“E aí Siri, FlowNanças” → “gastei 30 no uber” e pronto: lança e avisa no Telegram.</p>
      </div>
      <div className="space-y-3 px-5 pb-5 text-xs">
        {err && <p className="rounded-lg border border-warn/40 bg-warn/5 p-2 text-warn">Rode o SQL de tags/atalhos no Supabase para ativar ({err}).</p>}
        <div className="inline-flex rounded-xl bg-surface-2 p-1">
          {(['ios', 'android'] as const).map((o) => (
            <button key={o} onClick={() => setOs(o)} className={cx('h-7 rounded-lg px-3 font-medium', os === o ? 'bg-surface text-ink shadow-[var(--shadow)]' : 'text-muted')}>{o === 'ios' ? 'iPhone (Siri)' : 'Android'}</button>
          ))}
        </div>

        {newToken ? (
          <div className="space-y-1 rounded-lg border border-accent/40 bg-accent/5 p-2.5">
            <p className="font-medium">Seu token (copie agora, ele não aparece de novo):</p>
            <div className="flex items-center gap-2"><code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1">{newToken}</code><button onClick={() => copy(newToken)} className="rounded p-1 hover:bg-surface-2"><Copy className="h-3.5 w-3.5" /></button></div>
          </div>
        ) : (
          <button onClick={create} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 font-medium text-accent-ink"><Smartphone className="h-3.5 w-3.5" /> Gerar token para o atalho</button>
        )}

        <ol className="list-decimal space-y-1.5 pl-4 text-muted">
          {os === 'ios' ? (<>
            <li>Abra o app <b className="text-ink">Atalhos</b> → <b className="text-ink">+</b> → nomeie como <b className="text-ink">FlowNanças</b> (é o que você vai falar para a Siri).</li>
            <li>Ação <b className="text-ink">Ditar texto</b> (idioma Português).</li>
            <li>Ação <b className="text-ink">Obter conteúdo do URL</b>: URL <code className="text-ink">{url}</code> <button onClick={() => copy(url)} className="align-middle"><Copy className="inline h-3 w-3" /></button>, Método <b className="text-ink">POST</b>, Cabeçalho <code className="text-ink">Authorization</code> = <code className="text-ink">Bearer SEU_TOKEN</code>, Corpo <b className="text-ink">JSON</b> com chave <code className="text-ink">text</code> = <i>Texto ditado</i>.</li>
            <li>Ação <b className="text-ink">Mostrar resultado</b> (ou <b className="text-ink">Falar texto</b>) com o <i>Conteúdo do URL</i>.</li>
            <li>Diga: <b className="text-ink">“E aí Siri, FlowNanças”</b>. Dá para pôr na tela de início ou no botão de Ação.</li>
          </>) : (<>
            <li>Instale o app <b className="text-ink">HTTP Shortcuts</b> (Play Store, gratuito).</li>
            <li>Novo atalho → Método <b className="text-ink">POST</b>, URL <code className="text-ink">{url}</code> <button onClick={() => copy(url)} className="align-middle"><Copy className="inline h-3 w-3" /></button>.</li>
            <li>Cabeçalho <code className="text-ink">Authorization</code> = <code className="text-ink">Bearer SEU_TOKEN</code>; Corpo JSON <code className="text-ink">{'{"text": "{texto}"}'}</code> com a variável <i>texto</i> do tipo “entrada de texto/voz”.</li>
            <li>Mostrar a resposta como notificação/toast e adicionar o atalho na tela inicial.</li>
          </>)}
        </ol>

        {tokens.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 px-2.5 py-2">
                <span>{t.label || 'Atalho'} · <span className="text-muted">{t.last_used_at ? `usado ${relativeTimeBR(t.last_used_at)}` : 'nunca usado'}</span></span>
                <button onClick={() => remove(t)} title="Revogar" className="rounded p-1 text-muted hover:text-expense"><Trash2 className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
