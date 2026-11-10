// ─────────────────────────────────────────────────────────────────────────────
//  The item screen's time wheel (owner's point 2): it opens inside the list
//  under the time tapped, as on the iPhone — hours and five-minute steps, 24 h.
//  A finger flicks a column (it snaps), a mouse wheel turns it, a mouse drags
//  it, a click picks a row, and ↑ / ↓ step it. Nothing is written until the
//  owner moves it: a saved 17:32 stays 17:32 until then.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cx } from '../../ui'
import { useMotion } from '../../hooks/useMotion'
import { minutesOf, STEP_MINUTES } from './itemScreenRules'

const ROW = 32
const pad = (n: number) => String(n).padStart(2, '0')

export function TimeWheel({ value, onChange, label }: {
  /** HH:MM */
  value: string
  onChange: (hhmm: string) => void
  /** "Starts", "Ends" — what the wheel sets. */
  label: string
}) {
  const m = minutesOf(value)
  const hour = Math.floor(m / 60)
  const minute = m % 60
  return (
    <div role="group" aria-label={`${label} time`} className="relative flex h-40 select-none items-center justify-center gap-0.5">
      <span aria-hidden className="pointer-events-none absolute left-1/2 top-16 h-8 w-36 -translate-x-1/2 rounded-control bg-surface-2" />
      <WheelColumn label={`${label}: hour`} count={24} step={1} value={hour} onPick={h => onChange(`${pad(h)}:${pad(minute)}`)} />
      <span aria-hidden className="relative text-head font-semibold text-fg">:</span>
      <WheelColumn label={`${label}: minute`} count={60 / STEP_MINUTES} step={STEP_MINUTES} value={minute} onPick={mm => onChange(`${pad(hour)}:${pad(mm)}`)} />
    </div>
  )
}

function WheelColumn({ label, count, step, value, onPick }: {
  label: string
  count: number
  step: number
  value: number
  onPick: (v: number) => void
}) {
  const motion = useMotion()
  const ref = useRef<HTMLDivElement>(null)
  // The owner is turning this column: the value follows it, never the other way round.
  const turning = useRef(false)
  const settleTimer = useRef<number | undefined>(undefined)
  const index = Math.min(count - 1, Math.round(value / step))
  const [shown, setShown] = useState(index)

  // Follow the value when it changes from outside (the timeline, the other pill, a key).
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || turning.current) return
    if (Math.abs(el.scrollTop - index * ROW) > 1) {
      el.scrollTo({ top: index * ROW, behavior: el.dataset.ready && motion ? 'smooth' : 'auto' })
    }
    el.dataset.ready = '1'
  }, [index, motion])
  useEffect(() => () => window.clearTimeout(settleTimer.current), [])

  const at = () => Math.min(count - 1, Math.max(0, Math.round((ref.current?.scrollTop ?? 0) / ROW)))
  function onScroll() {
    const i = at()
    if (i !== shown) setShown(i)
    if (!turning.current) return
    window.clearTimeout(settleTimer.current)
    settleTimer.current = window.setTimeout(() => {
      turning.current = false
      const v = at() * step
      if (v !== value) onPick(v)
    }, 140)
  }
  const touch = () => { turning.current = true }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = Math.min(count - 1, Math.max(0, index + (e.key === 'ArrowDown' ? 1 : -1)))
    if (i !== index) onPick(i * step)
  }

  // A mouse has no drag-to-scroll of its own: drag the column, then it settles on the nearest row (or the row clicked).
  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    const el = ref.current
    if (!el || e.pointerType !== 'mouse' || e.button !== 0) return
    e.preventDefault()
    const y0 = e.clientY, t0 = el.scrollTop
    let moved = false
    turning.current = true
    el.style.scrollSnapType = 'none'
    el.setPointerCapture(e.pointerId)
    const move = (ev: globalThis.PointerEvent) => {
      if (Math.abs(ev.clientY - y0) > 3) moved = true
      el.scrollTop = t0 - (ev.clientY - y0)
    }
    const up = (ev: globalThis.PointerEvent) => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.style.scrollSnapType = ''
      let i = at()
      if (!moved) {
        const row = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-i]')
        if (row && el.contains(row)) i = Number(row.dataset.i)
      }
      turning.current = false
      el.scrollTo({ top: i * ROW, behavior: motion ? 'smooth' : 'auto' })
      if (i * step !== value) onPick(i * step)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  return (
    <div
      ref={ref} role="spinbutton" tabIndex={0} aria-label={label}
      aria-valuemin={0} aria-valuemax={(count - 1) * step} aria-valuenow={value} aria-valuetext={pad(value)}
      onScroll={onScroll} onTouchStart={touch} onWheel={touch} onPointerDown={onPointerDown} onKeyDown={onKeyDown}
      className={cx(
        'relative h-40 w-16 cursor-ns-resize snap-y snap-mandatory overflow-y-scroll overscroll-contain rounded-control',
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        '[mask-image:linear-gradient(transparent,black_30%,black_70%,transparent)]',
      )}
    >
      <div aria-hidden className="h-16" />
      {Array.from({ length: count }, (_, i) => (
        <div key={i} data-i={i} aria-hidden onClick={() => { if (i !== index) onPick(i * step) }}
          className={cx('h-8 snap-center text-center text-head leading-8 tabular-nums', i === shown ? 'font-medium text-fg' : 'text-fg-muted')}>
          {pad(i * step)}
        </div>
      ))}
      <div aria-hidden className="h-16" />
    </div>
  )
}
