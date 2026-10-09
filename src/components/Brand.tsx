'use client'

import { F_PATH } from './brandPaths'
import { cx } from './ui'

export const APP_NAME = 'FlowNanças'

/** "F" da Pacifico em branco — mesmo desenho do ícone do app. */
export function FMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden>
      <path d={F_PATH} fill="#ffffff" />
    </svg>
  )
}

/** Quadradinho roxo com o F (sidebar, login, carregando). */
export function AppTile({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center bg-gradient-to-br from-[#8b6dff] via-[#5b3df5] to-[#3f25c9] shadow-sm', className)} style={{ width: size, height: size, borderRadius: size * 0.3 }}>
      <FMark className="h-[74%] w-[74%]" />
    </span>
  )
}

const LOW = ['l', 'o', 'w']
const NANCAS = ['N', 'a', 'n', 'ç', 'a', 's']

/**
 * Logo animado em loop: F → Flow → FlowNanças → F…
 * O F é da Pacifico; o resto, da Righteous (retrô). As letras "crescem" de baixo, como barras de um gráfico.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span role="img" aria-label={APP_NAME} className={cx('ff-wm inline-flex select-none items-baseline whitespace-nowrap', className)}>
      <span className="ff-F">F</span>
      {LOW.map((c, i) => <span key={`l${i}`} className="ff-c ff-low" style={{ animationDelay: `${0.6 + i * 0.09}s` }}>{c}</span>)}
      {NANCAS.map((c, i) => <span key={`n${i}`} className="ff-c ff-nan text-accent" style={{ animationDelay: `${1.5 + i * 0.07}s` }}>{c}</span>)}
    </span>
  )
}
