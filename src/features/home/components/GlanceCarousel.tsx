import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Skeleton, Truncate, cx } from '../../../shared/ui'
import { useReducedMotion } from '../../../shared/hooks/useMotion'
import { readGlanceIndex, saveGlanceIndex } from './glanceIndex'

/** One screen of a glance tile: a big value + one line, or its own small body. */
export interface GlanceScreen {
  key: string
  /** What this screen shows, next to the tile's label ("Next hours"). */
  name: string
  value?: ReactNode
  hint?: ReactNode
  /** Instead of value/hint: a compact body (a strip of hours, three days…). */
  body?: ReactNode
}

interface Props {
  /** Remembers the screen you left it on (this device only). */
  id: string
  label: string
  icon: ReactNode
  screens: GlanceScreen[]
  loading?: boolean
  /** In-app route, or… */
  to?: string
  /** …an action (a popup). */
  onClick?: () => void
}

const DRAG_SLOP = 5

/**
 * A glance tile with several screens side by side (THEME.md §6.3). Swipe on
 * touch; with a mouse, hold and drag (or a trackpad's sideways scroll); with
 * the keyboard, ←/→ on the tile's header. The dots say which screen is up. A
 * plain tap or click (not a drag) opens the tile's detail, like before.
 */
export function GlanceCarousel({ id, label, icon, screens, loading, to, onClick }: Props) {
  const track = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(() => readGlanceIndex(id))
  const count = screens.length
  const current = Math.min(index, Math.max(0, count - 1))
  const reduced = useReducedMotion()
  const navigate = useNavigate()
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null)
  const swallowClick = useRef(false)

  // Start on the remembered screen, without an animation.
  useLayoutEffect(() => {
    const el = track.current
    if (el && current > 0) el.scrollLeft = current * el.clientWidth
    // Only on mount / when the screens first arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count > 1])

  const go = useCallback((i: number) => {
    const el = track.current
    if (!el || count === 0) return
    const next = Math.max(0, Math.min(count - 1, i))
    el.scrollTo({ left: next * el.clientWidth, behavior: reduced ? 'auto' : 'smooth' })
  }, [count, reduced])

  const onScroll = () => {
    const el = track.current
    if (!el || !el.clientWidth) return
    const i = Math.round(el.scrollLeft / el.clientWidth)
    if (i !== index) { setIndex(i); saveGlanceIndex(id, i) }
  }

  // Mouse: hold and drag. Touch keeps the browser's own swipe + snap.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || count < 2) return
    drag.current = { x: e.clientX, left: track.current?.scrollLeft ?? 0, moved: false }
  }
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current
      const el = track.current
      if (!d || !el) return
      const dx = e.clientX - d.x
      if (!d.moved && Math.abs(dx) < DRAG_SLOP) return
      if (!d.moved) { d.moved = true; el.style.scrollSnapType = 'none'; el.style.scrollBehavior = 'auto' }
      el.scrollLeft = d.left - dx
      e.preventDefault()
    }
    const up = (e: PointerEvent) => {
      const d = drag.current
      const el = track.current
      drag.current = null
      if (!d || !el || !d.moved) return
      swallowClick.current = true
      const w = el.clientWidth || 1
      const from = Math.round(d.left / w)
      const dx = e.clientX - d.x
      // A short flick is enough: 15 % of a screen turns the page.
      const target = Math.abs(dx) > w * 0.15 ? from + (dx < 0 ? 1 : -1) : from
      el.style.scrollSnapType = ''
      el.style.scrollBehavior = ''
      go(target)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [go])

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(current + 1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(current - 1) }
  }

  // A drag ends in a click on whatever is under the pointer — that one is not a tap.
  const onClickCapture = (e: ReactMouseEvent) => {
    if (!swallowClick.current) return
    swallowClick.current = false
    e.preventDefault()
    e.stopPropagation()
  }

  const screen = screens[current]
  const headerInner = (
    <>
      <span aria-hidden className="text-accent-600 [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
      <Truncate className="section-label min-w-0 flex-1">{label}</Truncate>
      <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
    </>
  )
  const headerCls = 'flex min-h-[28px] w-full min-w-0 items-center gap-1.5 text-left outline-none'
  const describe = count > 1 ? `${label}, ${screen?.name ?? ''}, screen ${current + 1} of ${count}. Use the left and right arrow keys for the other screens.` : label

  return (
    <div
      className="card-interactive glance-card flex min-h-[112px] min-w-0 cursor-pointer select-none flex-col p-3.5 text-left focus-within:ring-2 focus-within:ring-accent-500/40"
      onClick={e => { if (e.defaultPrevented) return; if (to) navigate(to); else onClick?.() }}
      onClickCapture={onClickCapture}
    >
      {to
        ? <Link to={to} className={headerCls} aria-label={describe} onKeyDown={onKeyDown} onClick={e => e.stopPropagation()}>{headerInner}</Link>
        : <button type="button" className={headerCls} aria-label={describe} onKeyDown={onKeyDown} onClick={e => { e.stopPropagation(); onClick?.() }}>{headerInner}</button>}

      {loading ? (
        <div className="mt-1.5">
          <Skeleton className="h-7 w-16" />
          <Skeleton className="mt-1.5 h-3 w-24" />
        </div>
      ) : (
        <div
          ref={track}
          onScroll={onScroll}
          onPointerDown={onPointerDown}
          className="scrollbar-none -mx-3.5 mt-1 flex flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
        >
          {screens.map((s, i) => (
            <div
              key={s.key}
              aria-hidden={i !== current}
              className="flex w-full min-w-0 shrink-0 snap-start flex-col px-3.5"
            >
              {s.body ?? (
                <>
                  <Truncate className="text-title font-bold tabular-nums text-fg">{s.value}</Truncate>
                  {s.hint != null && <Truncate className="mt-0.5 text-meta text-fg-muted">{s.hint}</Truncate>}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {count > 1 && !loading && (
        <div aria-hidden className="mt-1.5 flex min-w-0 items-center gap-2">
          <Truncate className="min-w-0 flex-1 text-micro font-medium text-fg-faint">{screen?.name}</Truncate>
          <span className="flex shrink-0 gap-1">
            {screens.map((s, i) => (
              <span key={s.key} className={cx('h-1.5 rounded-full transition-[width,background-color] duration-200', i === current ? 'w-3.5 bg-accent-500' : 'w-1.5 bg-line-strong')} />
            ))}
          </span>
        </div>
      )}
    </div>
  )
}
