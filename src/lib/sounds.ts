// Efeitos sonoros sintetizados com Web Audio (sem arquivos) + vibração no celular.
export type Sfx = 'tap' | 'open' | 'income' | 'expense' | 'delete' | 'success' | 'error' | 'toggle'

const KEY = 'flowfly:sound'
let ctx: AudioContext | null = null

export function isSoundOn(): boolean {
  try { return localStorage.getItem(KEY) !== 'off' } catch { return true }
}

export function setSoundOn(on: boolean) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off') } catch { /* armazenamento indisponível */ }
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

type ToneOpts = { type?: OscillatorType; gain?: number; slideTo?: number }

function tone(c: AudioContext, freq: number, start: number, dur: number, { type = 'sine', gain = 0.12, slideTo }: ToneOpts = {}) {
  const osc = c.createOscillator()
  const g = c.createGain()
  const t0 = c.currentTime + start
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

export function haptic(pattern: number | number[] = 10) {
  try { navigator.vibrate?.(pattern) } catch { /* sem suporte */ }
}

export function play(s: Sfx) {
  const vib: Record<Sfx, number | number[]> = {
    tap: 8, open: 10, toggle: 10, income: [15, 40, 25], expense: 18, delete: [30, 30, 30], success: 20, error: [40, 40, 40],
  }
  haptic(vib[s])
  if (!isSoundOn()) return
  const c = audio()
  if (!c) return

  switch (s) {
    case 'tap':
      tone(c, 1400, 0, 0.04, { gain: 0.04 })
      break
    case 'open':
      tone(c, 520, 0, 0.09, { gain: 0.06, slideTo: 880 })
      break
    case 'toggle':
      tone(c, 900, 0, 0.05, { gain: 0.05, type: 'triangle' })
      tone(c, 1200, 0.05, 0.05, { gain: 0.04, type: 'triangle' })
      break
    case 'income': // "cha-ching"
      tone(c, 988, 0, 0.09, { gain: 0.1, type: 'triangle' })
      tone(c, 1319, 0.08, 0.35, { gain: 0.12, type: 'triangle' })
      tone(c, 2637, 0.08, 0.25, { gain: 0.03 })
      break
    case 'expense':
      tone(c, 740, 0, 0.16, { gain: 0.09, slideTo: 440 })
      tone(c, 370, 0.02, 0.14, { gain: 0.04, type: 'triangle' })
      break
    case 'delete':
      tone(c, 260, 0, 0.22, { gain: 0.12, slideTo: 90 })
      break
    case 'success':
      ;[523, 659, 784].forEach((f, i) => tone(c, f, i * 0.07, 0.22, { gain: 0.07, type: 'triangle' }))
      break
    case 'error':
      tone(c, 196, 0, 0.12, { gain: 0.06, type: 'square' })
      tone(c, 165, 0.14, 0.16, { gain: 0.06, type: 'square' })
      break
  }
}
