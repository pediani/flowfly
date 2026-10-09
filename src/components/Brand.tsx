'use client'

import { useState } from 'react'
import { F_OUTLINE, F_PATH, F_SWOOSH } from './brandPaths'
import { cx } from './ui'

export const APP_NAME = 'FlowNanças'

/** "F" cartoon branco (com contorno e sombra) — mesmo desenho do ícone do app. */
export function FMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <g transform="rotate(-6 50 50)">
        <path d={F_PATH} transform="translate(3 4)" fill="rgba(20,8,60,0.35)" />
        <path d={F_OUTLINE} fill="none" stroke="#2a1670" strokeWidth="7" strokeLinejoin="round" />
        <path d={F_PATH} fill="#ffffff" />
        <path d={F_SWOOSH} fill="none" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" opacity="0.65" />
      </g>
    </svg>
  )
}

/** Quadradinho roxo com o F (sidebar, login, carregando). */
export function AppTile({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center bg-gradient-to-br from-[#8b6dff] to-[#5b3df5] shadow-sm', className)} style={{ width: size, height: size, borderRadius: size * 0.3 }}>
      <FMark className="h-[82%] w-[82%]" />
    </span>
  )
}

const LOW = ['l', 'o', 'w']
const NANCAS = ['N', 'a', 'n', 'ç', 'a', 's']

/**
 * Logo animado: F → Flow → FlowNanças, com as letras "escorrendo" para dentro.
 * Clique para ver de novo. Respeita "reduzir movimento" do sistema.
 */
export function Wordmark({ className, replay = true }: { className?: string; replay?: boolean }) {
  const [run, setRun] = useState(0)
  return (
    <span
      key={run}
      role="img"
      aria-label={APP_NAME}
      onClick={replay ? () => setRun((r) => r + 1) : undefined}
      className={cx('ff-wm inline-flex select-none items-baseline font-extrabold tracking-[-0.03em]', replay && 'cursor-pointer', className)}
    >
      <span className="ff-f">F</span>
      {LOW.map((c, i) => <span key={`l${i}`} className="ff-l" style={{ ['--d' as string]: 620 + i * 90 }}>{c}</span>)}
      {NANCAS.map((c, i) => <span key={`n${i}`} className="ff-l text-accent" style={{ ['--d' as string]: 1350 + i * 70 }}>{c}</span>)}
    </span>
  )
}
