'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bot, Cpu, Mic, RefreshCw, Zap } from 'lucide-react'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { supabase } from '../lib/supabase'
import { estimateCostUSD } from '../lib/aiUsage'
import { addDays, formatDateTimeBR, todayBR } from '../lib/dates'
import { play } from '../lib/sounds'
import { cx } from './ui'

type Row = {
  id: number; created_at: string; provider: string; kind: string; model: string | null; purpose: string | null; status: string
  http_status: number | null; latency_ms: number | null; prompt_tokens: number | null; completion_tokens: number | null
  cached_tokens: number | null; reasoning_tokens: number | null; total_tokens: number | null; audio_seconds: number | null
  queue_time_ms: number | null; server_time_ms: number | null; result_count: number | null; input_chars: number | null
  request_id: string | null; ratelimit: Record<string, string> | null; error: string | null
}

// Limites do plano gratuito da Groq (console.groq.com/docs/rate-limits). Os valores reais da sua conta vêm nos headers.
const FREE_LIMITS: Record<string, { rpm: number; rpd: number; tpm?: number; tpd?: number; ash?: number; asd?: number }> = {
  'openai/gpt-oss-120b': { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 },
  'openai/gpt-oss-20b': { rpm: 30, rpd: 1000, tpm: 8000, tpd: 200000 },
  'whisper-large-v3-turbo': { rpm: 20, rpd: 2000, ash: 7200, asd: 28800 },
}

const card = 'flex flex-col rounded-2xl border border-line bg-surface shadow-[var(--shadow)] animate-fade-up'
const usd = (v: number) => `US$ ${v < 0.01 && v > 0 ? v.toFixed(5) : v.toFixed(4)}`
const n = (v: number | null | undefined) => Number(v || 0)
const dayOf = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso))

function pct(sorted: number[], p: number) {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

export default function AiUsageCard() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [period, setPeriod] = useState<1 | 7 | 30>(30)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const since = new Date(Date.now() - 31 * 86400000).toISOString()
    const { data } = await supabase.from('ai_usage').select('*').gte('created_at', since).order('created_at', { ascending: false }).limit(3000)
    setRows((data as Row[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const today = todayBR()
  const stats = useMemo(() => {
    if (!rows) return null
    const from = addDays(today, -(period - 1))
    const inPeriod = rows.filter((r) => dayOf(r.created_at) >= from)
    const groq = inPeriod.filter((r) => r.provider === 'groq')
    const chat = groq.filter((r) => r.kind === 'chat')
    const audio = groq.filter((r) => r.kind === 'audio')
    const local = inPeriod.filter((r) => r.provider === 'local')
    const ok = groq.filter((r) => r.status === 'ok').length
    const lat = (list: Row[]) => list.map((r) => n(r.latency_ms)).filter(Boolean).sort((a, b) => a - b)
    const cost = groq.reduce((s, r) => s + estimateCostUSD(r), 0)
    const days = Math.max(1, period)
    // Messages = text messages interpreted (local + chat) + audios
    const messages = local.length + chat.filter((r) => r.purpose !== 'áudio (interpretação)').length + audio.length

    // Uso de hoje vs limites diários, por modelo
    const todayRows = rows.filter((r) => r.provider === 'groq' && dayOf(r.created_at) === today)
    const models = [...new Set(rows.filter((r) => r.provider === 'groq' && r.model).map((r) => r.model as string))]
    const perModel = models.map((m) => {
      const t = todayRows.filter((r) => r.model === m)
      const last = rows.find((r) => r.model === m && r.ratelimit && Object.keys(r.ratelimit).length)
      return {
        model: m,
        requestsToday: t.length,
        tokensToday: t.reduce((s, r) => s + n(r.total_tokens), 0),
        audioToday: t.reduce((s, r) => s + n(r.audio_seconds), 0),
        headers: last?.ratelimit || null,
        headersAt: last?.created_at || null,
        free: FREE_LIMITS[m],
      }
    })

    // Por dia (14 dias)
    const series = Array.from({ length: 14 }, (_, i) => {
      const d = addDays(today, i - 13)
      const r = rows.filter((x) => dayOf(x.created_at) === d)
      return { dia: d.slice(8, 10) + '/' + d.slice(5, 7), 'Sem IA': r.filter((x) => x.provider === 'local').length, Texto: r.filter((x) => x.kind === 'chat').length, Áudio: r.filter((x) => x.kind === 'audio').length }
    })

    return {
      messages, local: local.length, chat: chat.length, audio: audio.length, groqCalls: groq.length,
      successRate: groq.length ? (ok / groq.length) * 100 : null,
      localRate: messages ? (local.length / Math.max(1, local.length + chat.length)) * 100 : null,
      tokensIn: groq.reduce((s, r) => s + n(r.prompt_tokens), 0),
      tokensOut: groq.reduce((s, r) => s + n(r.completion_tokens), 0),
      tokensCached: groq.reduce((s, r) => s + n(r.cached_tokens), 0),
      tokensReasoning: groq.reduce((s, r) => s + n(r.reasoning_tokens), 0),
      audioSec: audio.reduce((s, r) => s + n(r.audio_seconds), 0),
      latChat: { p50: pct(lat(chat), 50), p95: pct(lat(chat), 95) },
      latAudio: { p50: pct(lat(audio), 50), p95: pct(lat(audio), 95) },
      queueAvg: chat.length ? chat.reduce((s, r) => s + n(r.queue_time_ms), 0) / chat.length : 0,
      cost, costMonth: (cost / days) * 30,
      errors: groq.filter((r) => r.status === 'erro').slice(0, 5),
      perModel, series,
    }
  }, [rows, period, today])

  return (
    <div className={cx(card, 'lg:col-span-2')}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-3">
        <div>
          <h3 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"><Bot className="h-4 w-4 text-accent" /> Uso da IA (Groq)</h3>
          <p className="mt-1 text-xs text-muted">Cada áudio e frase livre do Telegram. Mensagens simples (“s uber 30”) são resolvidas sem IA.</p>
        </div>
        <div className="flex items-center gap-1.5">
          {([1, 7, 30] as const).map((p) => (
            <button key={p} onClick={() => { play('tap'); setPeriod(p) }} className={cx('h-8 rounded-lg border px-2.5 text-xs font-medium', period === p ? 'border-ink/80 bg-ink text-bg' : 'border-line text-muted hover:text-ink')}>
              {p === 1 ? 'Hoje' : `${p} dias`}
            </button>
          ))}
          <button onClick={() => { play('tap'); load() }} title="Atualizar" className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-ink">
            <RefreshCw className={cx('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {!stats ? <p className="px-5 pb-5 text-sm text-muted">Carregando…</p> : (
        <div className="space-y-5 px-5 pb-5">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Kpi label="Mensagens interpretadas" value={String(stats.messages)} sub={`${stats.local} sem IA · ${stats.chat} texto · ${stats.audio} áudio`} />
            <Kpi label="Chamadas à Groq" value={String(stats.groqCalls)} sub={stats.successRate == null ? '—' : `${Math.round(stats.successRate)}% com sucesso`} tone={stats.successRate != null && stats.successRate < 90 ? 'text-warn' : undefined} />
            <Kpi label="Tokens (entrada / saída)" value={`${stats.tokensIn.toLocaleString('pt-BR')} / ${stats.tokensOut.toLocaleString('pt-BR')}`} sub={`${stats.tokensReasoning.toLocaleString('pt-BR')} de raciocínio · ${stats.tokensCached.toLocaleString('pt-BR')} em cache`} />
            <Kpi label="Custo (plano gratuito)" value="R$ 0,00" sub={`equivale a ${usd(stats.cost)} · ~${usd(stats.costMonth)}/mês no pago`} />
            <Kpi label="Áudio transcrito" value={`${(stats.audioSec / 60).toFixed(1)} min`} sub={`${stats.audio} áudio(s)`} />
            <Kpi label="Latência texto (p50 / p95)" value={`${(stats.latChat.p50 / 1000).toFixed(2)}s / ${(stats.latChat.p95 / 1000).toFixed(2)}s`} sub={`fila média ${Math.round(stats.queueAvg)} ms`} />
            <Kpi label="Latência áudio (p50 / p95)" value={`${(stats.latAudio.p50 / 1000).toFixed(2)}s / ${(stats.latAudio.p95 / 1000).toFixed(2)}s`} />
            <Kpi label="Resolvidas sem IA" value={stats.localRate == null ? '—' : `${Math.round(stats.localRate)}%`} sub="das mensagens de texto" />
          </div>

          {/* Limites */}
          <div>
            <p className="mb-2 text-xs font-medium text-muted">Limites de hoje (por modelo)</p>
            {stats.perModel.length ? (
              <div className="grid gap-2 md:grid-cols-2">
                {stats.perModel.map((m) => {
                  const h = m.headers || {}
                  const rpdLimit = Number(h['x-ratelimit-limit-requests']) || m.free?.rpd || 0
                  const rpdLeft = h['x-ratelimit-remaining-requests'] != null ? Number(h['x-ratelimit-remaining-requests']) : null
                  return (
                    <div key={m.model} className="rounded-xl border border-line p-3">
                      <p className="flex items-center gap-1.5 text-sm font-medium">{m.model.includes('whisper') ? <Mic className="h-3.5 w-3.5 text-accent" /> : <Cpu className="h-3.5 w-3.5 text-accent" />}{m.model}</p>
                      <Meter label="Requisições hoje" used={m.requestsToday} limit={rpdLimit} note={rpdLeft != null ? `restam ${rpdLeft.toLocaleString('pt-BR')} (reinicia em ${h['x-ratelimit-reset-requests'] || '—'})` : undefined} />
                      {m.free?.tpd ? <Meter label="Tokens hoje" used={m.tokensToday} limit={m.free.tpd} note={h['x-ratelimit-remaining-tokens'] ? `por minuto: restam ${Number(h['x-ratelimit-remaining-tokens']).toLocaleString('pt-BR')} de ${Number(h['x-ratelimit-limit-tokens']).toLocaleString('pt-BR')}` : undefined} /> : null}
                      {m.free?.asd ? <Meter label="Segundos de áudio hoje" used={Math.round(m.audioToday)} limit={m.free.asd} /> : null}
                      {m.headersAt && <p className="mt-1.5 text-[10px] text-muted">Headers da última chamada: {formatDateTimeBR(m.headersAt)}</p>}
                    </div>
                  )
                })}
              </div>
            ) : <p className="text-xs text-muted">Nenhuma chamada à Groq ainda.</p>}
          </div>

          {/* Por dia */}
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Últimos 14 dias</p>
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.series} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <XAxis dataKey="dia" tick={{ fill: 'var(--muted)', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
                  <Tooltip cursor={{ fill: 'var(--surface-2)' }} contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="Sem IA" stackId="a" fill="var(--income)" />
                  <Bar dataKey="Texto" stackId="a" fill="var(--accent)" />
                  <Bar dataKey="Áudio" stackId="a" fill="var(--info)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Erros */}
          {stats.errors.length > 0 && (
            <div className="rounded-xl border border-warn/40 bg-warn/5 p-3">
              <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-warn"><AlertTriangle className="h-3.5 w-3.5" /> Erros recentes</p>
              <ul className="space-y-1 text-[11px] text-muted">
                {stats.errors.map((e) => (
                  <li key={e.id} className="truncate" title={e.error || ''}>{formatDateTimeBR(e.created_at)} · {e.model} · HTTP {e.http_status ?? '—'} · {e.error?.slice(0, 120)}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Chamadas recentes */}
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Chamadas recentes</p>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[640px] text-[11px]">
                <thead className="bg-surface-2 text-muted">
                  <tr>{['Quando', 'Tipo', 'Modelo', 'Status', 'Tokens in/out', 'Áudio', 'Latência', 'Itens', 'Custo eq.'].map((h) => <th key={h} className="px-2 py-1.5 text-left font-medium">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(rows || []).slice(0, 25).map((r) => (
                    <tr key={r.id} title={r.request_id ? `request id: ${r.request_id}` : ''}>
                      <td className="whitespace-nowrap px-2 py-1.5">{formatDateTimeBR(r.created_at)}</td>
                      <td className="px-2 py-1.5">{r.provider === 'local' ? <span className="inline-flex items-center gap-1"><Zap className="h-3 w-3 text-income" /> sem IA</span> : r.kind === 'audio' ? 'áudio' : 'texto'}{r.purpose ? <span className="text-muted"> · {r.purpose}</span> : null}</td>
                      <td className="px-2 py-1.5 text-muted">{r.model || '—'}</td>
                      <td className={cx('px-2 py-1.5', r.status === 'ok' ? 'text-income' : r.status === 'erro' ? 'text-expense' : 'text-warn')}>{r.status}{r.http_status && r.http_status !== 200 ? ` (${r.http_status})` : ''}</td>
                      <td className="px-2 py-1.5 tabular">{r.prompt_tokens != null ? `${r.prompt_tokens}/${r.completion_tokens ?? 0}` : '—'}</td>
                      <td className="px-2 py-1.5 tabular">{r.audio_seconds != null ? `${Number(r.audio_seconds).toFixed(1)}s` : '—'}</td>
                      <td className="px-2 py-1.5 tabular">{r.latency_ms != null ? `${r.latency_ms} ms` : '—'}</td>
                      <td className="px-2 py-1.5 tabular">{r.result_count ?? '—'}</td>
                      <td className="px-2 py-1.5 tabular">{r.provider === 'groq' ? usd(estimateCostUSD(r)) : '—'}</td>
                    </tr>
                  ))}
                  {!rows?.length && <tr><td colSpan={9} className="px-2 py-4 text-center text-muted">Nada registrado ainda. Mande um áudio ou uma frase livre ao bot.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="mt-1.5 text-[10px] text-muted">Preços de referência: gpt-oss-120b US$ 0,15/M tokens de entrada e US$ 0,60/M de saída; Whisper Turbo US$ 0,04/hora (mín. 10 s). No plano gratuito não há cobrança, só limites.</p>
          </div>
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-surface-2 p-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={cx('mt-1 truncate tabular text-sm font-semibold', tone)}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-[10px] text-muted" title={sub}>{sub}</p>}
    </div>
  )
}

function Meter({ label, used, limit, note }: { label: string; used: number; limit: number; note?: string }) {
  const p = limit ? Math.min(100, (used / limit) * 100) : 0
  return (
    <div className="mt-2">
      <div className="flex justify-between text-[11px]"><span className="text-muted">{label}</span><span className="tabular">{used.toLocaleString('pt-BR')} / {limit ? limit.toLocaleString('pt-BR') : '—'}</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2"><div className={cx('h-full rounded-full', p >= 90 ? 'bg-expense' : p >= 70 ? 'bg-warn' : 'bg-accent')} style={{ width: `${p}%` }} /></div>
      {note && <p className="mt-0.5 text-[10px] text-muted">{note}</p>}
    </div>
  )
}
