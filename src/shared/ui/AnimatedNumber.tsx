import { useEffect, useRef, useState } from 'react'
import { useMotion } from '../hooks/useMotion'
import { easeOutCubic, formatTweenNumber, tweenValue, widerText } from './motionRules'
import { cx } from './cx'

interface AnimatedNumberProps {
  value: number
  /** Decimal places shown (while counting too). */
  decimals?: number
  /** Custom text for a value (units, thousands separators); gets the in-between values too. */
  format?: (value: number) => string
  durationMs?: number
  /** False while the real value is still loading: keeps showing the last number (0 on first load). */
  ready?: boolean
  /** Where the number sits in the room kept for its widest step: `end` next to text, `center` alone (a ring). */
  align?: 'end' | 'center'
  className?: string
}

/**
 * A number that counts up when it first appears and eases to a new value when
 * it really changes (a refetch of the same value does nothing). Under reduced
 * motion it just shows the value. The painted number is the source of truth: it holds while a new value
 * loads and every count starts from what is on screen, so nothing flickers.
 * The box keeps the width of the wider end of the count, so text next to it
 * doesn't move while the digit count changes.
 */
export function AnimatedNumber({ value, decimals = 0, format, durationMs = 500, ready = true, align = 'end', className }: AnimatedNumberProps) {
  const motion = useMotion()
  const finite = Number.isFinite(value)
  const fmt = (n: number) => (format ? format(n) : formatTweenNumber(n, decimals))

  // What is on screen. Starts at 0 when it will count up, so the first frame
  // never flashes the final number.
  const [painted, setPainted] = useState(() => (motion && finite ? 0 : value))
  // Where the running count started (for the reserved width); null at rest.
  const [from, setFrom] = useState<number | null>(null)
  const paintedRef = useRef(painted)
  useEffect(() => { paintedRef.current = painted }, [painted])

  // Without motion the painted number simply follows the value, so switching
  // the setting on later never counts from a stale number.
  if (!motion && finite && painted !== value) setPainted(value)

  useEffect(() => {
    if (!motion || !ready || !finite) return
    const start = paintedRef.current
    if (start === value || !Number.isFinite(start)) return
    let raf = 0
    const t0 = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / durationMs)
      const v = tweenValue(start, value, easeOutCubic(t))
      paintedRef.current = v
      setPainted(v)
      setFrom(t >= 1 ? null : start)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, motion, ready, finite, durationMs])

  if (!motion || !finite) return <span className={cx('tabular-nums', className)}>{fmt(value)}</span>

  const text = fmt(painted)
  // Room for both ends of the count (until its first frame `painted` is the
  // start); while a new value loads only what is shown counts.
  const room = widerText(fmt(ready ? value : painted), fmt(from ?? painted))
  return (
    <span className={cx('inline-grid tabular-nums', align === 'center' ? 'justify-items-center' : 'justify-items-end', className)}>
      <span aria-hidden className="invisible [grid-area:1/1]">{room}</span>
      <span className="[grid-area:1/1]">{text}</span>
    </span>
  )
}
