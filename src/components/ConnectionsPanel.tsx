'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { Send, UserPlus, Check, X, Copy, RefreshCw } from 'lucide-react'

const BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || 'flowly_financeirobot'

export type Partnership = {
  id: string
  partner_id: string
  partner_email: string
  status: 'pending' | 'accepted'
  incoming: boolean
}

const card = 'rounded-xl border border-zinc-800 bg-zinc-900 shadow-sm h-fit'
const btn = 'inline-flex items-center justify-center gap-2 rounded-md px-3 h-9 text-sm font-medium transition-colors disabled:opacity-50'
const btnPrimary = `${btn} bg-blue-600 text-white hover:bg-blue-500`
const btnGhost = `${btn} border border-zinc-800 text-zinc-300 hover:bg-zinc-800`

export default function ConnectionsPanel({ onPartnersChange }: { onPartnersChange: () => void }) {
  // --- Telegram ---
  const [chatId, setChatId] = useState<number | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const [tgLoading, setTgLoading] = useState(false)

  // --- Parcerias ---
  const [partnerships, setPartnerships] = useState<Partnership[]>([])
  const [email, setEmail] = useState('')
  const [pLoading, setPLoading] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const fetchConnection = useCallback(async () => {
    const { data } = await supabase.from('telegram_connections').select('telegram_chat_id').maybeSingle()
    setChatId(data?.telegram_chat_id ?? null)
    if (data) setCode(null)
  }, [])

  const fetchPartnerships = useCallback(async () => {
    const { data } = await supabase.rpc('list_partnerships')
    setPartnerships((data as Partnership[]) || [])
  }, [])

  useEffect(() => {
    // Carga inicial dos dados do Supabase ao montar o painel
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchConnection()
    fetchPartnerships()
  }, [fetchConnection, fetchPartnerships])

  async function handleGenerateCode() {
    setTgLoading(true)
    const { data, error } = await supabase.rpc('create_telegram_link_code')
    if (error) alert(error.message)
    else setCode(data as string)
    setTgLoading(false)
  }

  async function handleUnlink() {
    if (!confirm('Desvincular o Telegram desta conta?')) return
    await supabase.from('telegram_connections').delete().eq('telegram_chat_id', chatId)
    fetchConnection()
  }

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setPLoading(true)
    setMessage(null)
    const { data, error } = await supabase.rpc('invite_partner', { p_email: email })
    if (error) {
      setMessage({ ok: false, text: error.message })
    } else {
      setMessage({ ok: true, text: data === 'accepted' ? 'Parceria aceita!' : 'Convite enviado. Peça para a pessoa aceitar no painel.' })
      setEmail('')
      afterPartnersChange()
    }
    setPLoading(false)
  }

  async function handleAccept(id: string) {
    const { error } = await supabase.rpc('accept_partner', { p_id: id })
    if (error) alert(error.message)
    afterPartnersChange()
  }

  async function handleRemove(id: string, label: string) {
    if (!confirm(label)) return
    await supabase.from('partnerships').delete().eq('id', id)
    afterPartnersChange()
  }

  function afterPartnersChange() {
    fetchPartnerships()
    onPartnersChange()
  }

  const link = code ? `https://t.me/${BOT_USERNAME}?start=${code}` : null

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* TELEGRAM */}
      <div className={card}>
        <div className="p-6 border-b border-zinc-800">
          <h3 className="font-semibold leading-none tracking-tight flex items-center gap-2">
            <Send className="h-4 w-4 text-blue-400" /> Telegram
          </h3>
          <p className="text-sm text-zinc-400 mt-2">Registre despesas mandando mensagem para @{BOT_USERNAME}.</p>
        </div>
        <div className="p-6 space-y-4">
          {chatId ? (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-emerald-400 flex items-center gap-2">
                <Check className="h-4 w-4" /> Conectado (chat {chatId})
              </p>
              <button onClick={handleUnlink} className={btnGhost}>Desvincular</button>
            </div>
          ) : link ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-300">Abra o link no celular e toque em <b>Iniciar</b>. Ele vale por 10 minutos.</p>
              <a href={link} target="_blank" rel="noreferrer" className={`${btnPrimary} w-full`}>
                <Send className="h-4 w-4" /> Abrir @{BOT_USERNAME}
              </a>
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <span>Ou envie ao bot:</span>
                <code className="rounded bg-zinc-950 border border-zinc-800 px-2 py-1 text-zinc-200">/start {code}</code>
                <button onClick={() => navigator.clipboard.writeText(`/start ${code}`)} title="Copiar" className="p-1 hover:text-zinc-100">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              <button onClick={fetchConnection} className={`${btnGhost} w-full`}>
                <RefreshCw className="h-4 w-4" /> Já vinculei
              </button>
            </div>
          ) : (
            <button onClick={handleGenerateCode} disabled={tgLoading} className={`${btnPrimary} w-full`}>
              {tgLoading ? 'Gerando...' : 'Conectar Telegram'}
            </button>
          )}
        </div>
      </div>

      {/* PARCERIAS */}
      <div className={card}>
        <div className="p-6 border-b border-zinc-800">
          <h3 className="font-semibold leading-none tracking-tight flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-blue-400" /> Parceiros de divisão
          </h3>
          <p className="text-sm text-zinc-400 mt-2">Só parceiros aceitos aparecem em &quot;Dividir despesa&quot;.</p>
        </div>
        <div className="p-6 space-y-4">
          <form onSubmit={handleInvite} className="flex gap-2">
            <input
              type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="e-mail do parceiro"
              className="flex h-9 w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button type="submit" disabled={pLoading} className={btnPrimary}>Convidar</button>
          </form>
          {message && <p className={`text-xs ${message.ok ? 'text-emerald-400' : 'text-red-400'}`}>{message.text}</p>}

          <ul className="divide-y divide-zinc-800">
            {partnerships.length === 0 && <li className="py-3 text-sm text-zinc-500">Nenhum parceiro ainda.</li>}
            {partnerships.map((p) => (
              <li key={p.id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-zinc-100 truncate">{p.partner_email}</p>
                  <p className="text-xs text-zinc-500">
                    {p.status === 'accepted' ? 'Parceria ativa' : p.incoming ? 'Convidou você' : 'Aguardando aceite'}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  {p.status === 'pending' && p.incoming && (
                    <button onClick={() => handleAccept(p.id)} className={`${btn} text-emerald-400 hover:bg-zinc-800`} title="Aceitar">
                      <Check className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => handleRemove(p.id, p.status === 'accepted' ? 'Desfazer esta parceria?' : 'Remover este convite?')}
                    className={`${btn} text-zinc-500 hover:text-red-400 hover:bg-zinc-800`} title="Remover"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
