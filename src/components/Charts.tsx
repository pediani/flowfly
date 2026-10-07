'use client'

import {
  Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
  type TooltipContentProps,
} from 'recharts'
import { formatBRL, formatBRLCompact } from '../lib/format'
import type { DayPoint, FuturePoint } from '../lib/finance'

const axisTick = { fill: 'var(--muted)', fontSize: 11 }

const LABELS: Record<string, string> = {
  realizado: 'Saldo do mês', projetado: 'Projeção', entradas: 'Entradas', saidas: 'Saídas', acumulado: 'Saldo acumulado',
}

function ChartTooltip({ active, payload, label, labelFormat }: Partial<TooltipContentProps> & { labelFormat?: (l: string) => string }) {
  if (!active || !payload?.length) return null
  // Evita repetir o ponto de junção entre realizado e projetado
  const items = payload.filter((p, i, arr) => p.value !== undefined && !(p.dataKey === 'projetado' && arr.some((x) => x.dataKey === 'realizado')))
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-ink">{labelFormat ? labelFormat(String(label)) : label}</p>
      {items.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2 text-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {LABELS[String(p.dataKey)] || p.name}: <span className="tabular text-ink">{formatBRL(Number(p.value))}</span>
        </p>
      ))}
    </div>
  )
}

/** Ocupa toda a altura disponível do card (o pai precisa ter altura definida) */
export function MonthChart({ series, monthShort }: { series: DayPoint[]; monthShort: string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={series} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="ff-real" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={18} />
        <YAxis tickFormatter={formatBRLCompact} tick={axisTick} axisLine={false} tickLine={false} width={62} />
        <ReferenceLine y={0} stroke="var(--muted)" strokeOpacity={0.5} />
        <Tooltip content={(p) => <ChartTooltip {...p} labelFormat={(l) => `${l} ${monthShort}`} />} cursor={{ stroke: 'var(--line)' }} />
        <Area type="monotone" dataKey="realizado" stroke="var(--accent)" strokeWidth={2} baseValue={0} fill="url(#ff-real)" dot={false} activeDot={{ r: 4 }} isAnimationActive />
        <Line type="monotone" dataKey="projetado" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} activeDot={{ r: 4 }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function ProjectionChart({ data }: { data: FuturePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 10, right: 8, left: 0, bottom: 0 }} barGap={4}>
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={formatBRLCompact} tick={axisTick} axisLine={false} tickLine={false} width={62} />
        <ReferenceLine y={0} stroke="var(--muted)" strokeOpacity={0.5} />
        <Tooltip content={(p) => <ChartTooltip {...p} />} cursor={{ fill: 'var(--surface-2)', opacity: 0.5 }} />
        <Bar dataKey="entradas" fill="var(--income)" radius={[4, 4, 0, 0]} maxBarSize={18} />
        <Bar dataKey="saidas" fill="var(--expense)" radius={[4, 4, 0, 0]} maxBarSize={18} />
        <Line type="monotone" dataKey="acumulado" stroke="var(--accent)" strokeWidth={2} dot={{ r: 2.5, fill: 'var(--accent)', strokeWidth: 0 }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function Legend({ items }: { items: { color: string; label: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 pb-4 pt-2 text-xs text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          {i.dashed
            ? <span className="w-4 border-t-2 border-dashed" style={{ borderColor: i.color }} />
            : <span className="h-2 w-2 rounded-sm" style={{ background: i.color }} />}
          {i.label}
        </span>
      ))}
    </div>
  )
}
