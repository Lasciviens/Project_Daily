import { useEffect, useState, type ReactNode } from 'react'
import { useMotion } from '../hooks/useMotion'
import { ringShare } from './motionRules'
import { cx } from './cx'

interface ProgressRingProps {
  /** Share filled, 0..1 (clamped). */
  value: number
  /** SVG geometry basis (viewBox side); the drawn size comes from `className`. */
  size: number
  stroke: number
  /** Arc colour — a chart / tone token as a CSS colour (`rgb(var(--chart-2))`). */
  color: string
  /** Box size classes (`h-[80px] w-[80px]`); the viewBox scales the stroke with it. */
  className?: string
  /** Centre content (the number left, a label). */
  children?: ReactNode
  /** False while the real value is still loading: stays empty on first load, then keeps the last real value. */
  ready?: boolean
}

const SWEEP = 'stroke-dashoffset 600ms cubic-bezier(0.22, 1, 0.36, 1)'

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0)

/**
 * The one progress ring (calories, protein). With the "More" animations it
 * sweeps from empty when it appears and eases to a new value — and while a
 * new day loads it holds the last real value instead of draining to the
 * placeholder; otherwise it draws its value at once.
 */
export function ProgressRing({ value, size, stroke, color, className, children, ready = true }: ProgressRingProps) {
  const motion = useMotion()
  const pct = clamp01(value)
  // Mounted empty, then filled on the next frame so the transition can run.
  const [armed, setArmed] = useState(!motion)
  // The last share that came from real data.
  const [lastReal, setLastReal] = useState(pct)
  if (ready && lastReal !== pct) setLastReal(pct)
  useEffect(() => {
    if (armed || !ready) return
    const id = requestAnimationFrame(() => setArmed(true))
    return () => cancelAnimationFrame(id)
  }, [armed, ready])

  const r = (size - stroke) / 2 - 1
  const c = 2 * Math.PI * r
  const mid = size / 2
  const shown = motion ? ringShare({ armed, ready, value: pct, lastReal }) : pct
  return (
    <div className={cx('relative shrink-0', className)}>
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90" aria-hidden>
        <circle cx={mid} cy={mid} r={r} fill="none" strokeWidth={stroke} className="stroke-surface-2" />
        <circle
          cx={mid} cy={mid} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - shown)}
          style={{ stroke: color, transition: motion ? SWEEP : undefined }}
        />
      </svg>
      {children != null && <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>}
    </div>
  )
}
