'use client'

import { useState } from 'react'
import { Zap, Mail } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { play } from '../lib/sounds'
import { inputClass, primaryButton } from './ui'

export default function AuthScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMsg(null)
    const { error } = isSignUp
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      play('error')
      setMsg({ ok: false, text: error.message })
    } else if (isSignUp) {
      play('success')
      setMsg({ ok: true, text: 'Conta criada! Agora é só entrar.' })
      setIsSignUp(false)
    } else {
      play('success')
    }
    setLoading(false)
  }

  async function handleMagicLink() {
    setLoading(true)
    const { error } = await supabase.auth.signInWithOtp({ email })
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: 'Link mágico enviado! Confira seu e-mail.' })
    play(error ? 'error' : 'success')
    setLoading(false)
  }

  return (
    <div className="relative z-10 flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent animate-pop">
            <Zap className="h-6 w-6 text-white" fill="currentColor" />
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">FlowFly</h1>
          <p className="text-sm text-muted mt-2">Seu dinheiro fluindo, do painel ao Telegram.</p>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-6 shadow-[var(--shadow)]">
          <form onSubmit={handlePassword} className="space-y-3">
            <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" className={inputClass} />
            <input type="password" required autoComplete={isSignUp ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha" className={inputClass} />
            <button type="submit" disabled={loading} className={primaryButton}>
              {loading ? 'Processando…' : isSignUp ? 'Criar conta' : 'Entrar'}
            </button>
          </form>

          {msg && <p className={`mt-3 text-sm ${msg.ok ? 'text-income' : 'text-expense'}`}>{msg.text}</p>}

          <button type="button" onClick={() => { play('tap'); setIsSignUp(!isSignUp); setMsg(null) }} className="mt-4 w-full text-sm text-accent hover:underline">
            {isSignUp ? 'Já tem conta? Entrar' : 'Não tem conta? Cadastre-se'}
          </button>

          <div className="my-5 flex items-center gap-3 text-xs text-muted">
            <div className="h-px flex-1 bg-line" /> ou <div className="h-px flex-1 bg-line" />
          </div>
          <button type="button" onClick={handleMagicLink} disabled={loading || !email} className="flex w-full items-center justify-center gap-2 text-sm text-muted hover:text-ink disabled:opacity-40">
            <Mail className="h-4 w-4" /> Receber link mágico por e-mail
          </button>
        </div>
      </div>
    </div>
  )
}
