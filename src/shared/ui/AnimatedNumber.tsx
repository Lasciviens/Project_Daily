import { useEffect, useRef, useState } from 'react'
import { useMotion } from '../hooks/useMotion'
import { easeOutCubic, formatTweenNumber, shouldTween, tweenValue } from './motionRules'
import { cx } from './cx'

interface AnimatedNumberProps {
  value: number
  /** Decimal places shown (while counting too). */
  decimals?: number
  /** Custom text for a value (units, thousands separators); gets the in-between values too. */
  format?: (value: number) => string
  durationMs?: number
  /** False while the real value is still loading: holds at the start (0) instead of counting to a placeholder. */
  ready?: boolean
  className?: string
}

/**
 * A number that counts up when it first appears and eases to a new value when
 * it really changes (a refetch of the same value does nothing). Only with the
 * "More" animations on and reduced motion off; otherwise it just shows the
 * value. Tabular digits keep its width steady while it counts.
 */
export function AnimatedNumber({ value, decimals = 0, format, durationMs = 500, ready = true, className }: AnimatedNumberProps) {
  const motion = useMotion()
  // null = not counting → show `value` itself. Starts at 0 when it will count
  // up, so the first frame never flashes the final number.
  const [shown, setShown] = useState<number | null>(() => (motion && Number.isFinite(value) && value !== 0 ? 0 : null))
  const lastShown = useRef<number>(0)

  useEffect(() => {
    if (!ready) return
    const from = lastShown.current
    if (!shouldTween(from, value, motion)) {
      lastShown.current = value
      return
    }
    let raf = 0
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      const v = tweenValue(from, value, easeOutCubic(t))
      lastShown.current = v
      setShown(t >= 1 ? null : v)
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, motion, durationMs, ready])

  // Not ready on first mount: `shown` still holds the starting 0.
  const n = motion ? (shown ?? value) : value
  return <span className={cx('tabular-nums', className)}>{format ? format(n) : formatTweenNumber(n, decimals)}</span>
}
