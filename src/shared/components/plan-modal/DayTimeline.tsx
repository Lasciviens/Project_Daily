// ─────────────────────────────────────────────────────────────────────────────
//  The item screen's timeline (owner's point 1): the whole day, 00:00–24:00,
//  one pixel a minute. The day's other things sit on top (two lanes where they
//  overlap each other), this item below them: drag it to move it, drag its
//  ends to change its times — touch and mouse, five-minute steps, the arrow
//  keys too (Shift + arrows change the end). Move along the day by swiping or
//  dragging empty space, with a mouse wheel, or with the day strip under it,
//  a scrollbar that shows the day. The pills above follow every move.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useLayoutEffect, useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import { cx, Truncate } from '../../ui'
import { useMotion } from '../../hooks/useMotion'
import { todayStr } from '../../utils/dateUtils'
import { formatDurationMinutes } from '../../utils/formatDuration'
import { buildDaySchedule } from '../../../features/daily/daySchedule'
import { addDaysIso } from '../../../features/daily/recurrence'
import { useScheduleBlocks, useTimeBlocks } from '../../../features/daily/hooks/useSchedule'
import { useCalendarEventsForDay } from '../../../features/calendar/hooks/useCalendar'
import { displayDate } from './planModal.config'
import {
  DAY_MINUTES, dragTimes, endOf, nudgeTimes, overlapsOf, spanLanes, timeOfMinutes, timelineCentre,
  type DaySpan, type DragMode,
} from './itemScreenRules'

/** Pixels per minute: a day is 1440 px, so five minutes is a finger's width. */
const PPM = 1
const HOURS = Array.from({ length: 24 }, (_, h) => h)
const pad = (n: number) => String(n).padStart(2, '0')

/** The strip's thumb follows the scroll without a re-render. */
function placeThumb(el: HTMLDivElement | null, s: HTMLDivElement | null, t: HTMLSpanElement | null) {
  if (!el || !s || !t) return
  const f = s.clientWidth / el.scrollWidth
  t.style.left = `${el.scrollLeft * f}px`
  t.style.width = `${Math.max(16, el.clientWidth * f)}px`
  s.setAttribute('aria-valuenow', String(Math.round((el.scrollLeft / Math.max(1, el.scrollWidth - el.clientWidth)) * 100)))
}

/** What else is on the day, without this item (its slot, its repeat's day). */
function useDaySpans(day: string, own: { blockId?: string | null; scheduleBlockId?: string | null }) {
  const blocks = useTimeBlocks(day)
  const prevBlocks = useTimeBlocks(addDaysIso(day, -1))
  const templates = useScheduleBlocks()
  const events = useCalendarEventsForDay(day)
  const answered = blocks.isSuccess && templates.isSuccess
  const spans = useMemo<DaySpan[]>(() => {
    if (!blocks.data || !templates.data) return []
    const items = buildDaySchedule({
      date: day, blocks: blocks.data, prevBlocks: prevBlocks.data ?? [], templates: templates.data, events: events.data ?? [],
    })
    return items
      .filter(i => !i.allDay && i.startHour >= 0)
      .filter(i => i.canonicalId !== own.blockId && i.canonicalId !== own.scheduleBlockId
        && !(own.scheduleBlockId && i.block?.schedule_block_id === own.scheduleBlockId))
      .map(i => ({ id: i.id, title: i.title, start: Math.round(i.startHour * 60), end: Math.max(Math.round(i.endHour * 60), Math.round(i.startHour * 60) + 10) }))
  }, [day, blocks.data, prevBlocks.data, templates.data, events.data, own.blockId, own.scheduleBlockId])
  return { spans, answered }
}

export function DayTimeline({ day, start, length, allDay, onChange, own, dayNote, locked = false }: {
  /** The day shown (a repeat's next day). */
  day: string
  /** Minutes from midnight; null with no time (all day). */
  start: number | null
  length: number | null
  allDay: boolean
  onChange: (start: number, length: number | null) => void
  /** The item's own rows, left out of "the day's other things". */
  own: { blockId?: string | null; scheduleBlockId?: string | null }
  /** Said before the right-hand note ("Next Thu 12.11.2026"). */
  dayNote?: string
  /** The times can't move here (an end held struck through). */
  locked?: boolean
}) {
  const motion = useMotion()
  const scroller = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLSpanElement>(null)
  const drag = useRef<{ mode: DragMode; x0: number; sc0: number; s0: number; l0: number | null } | null>(null)
  const centred = useRef<string | null>(null)
  const { spans, answered } = useDaySpans(day, own)
  const { lanes, two } = useMemo(() => spanLanes(spans), [spans])
  const timed = !allDay && start !== null
  const hits = timed ? overlapsOf(spans, start, length) : []
  const end = timed ? start + (length ?? 0) : 0
  const crosses = timed && end > DAY_MINUTES
  const today = todayStr()
  const nowMin = (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() })()

  const syncThumb = () => placeThumb(scroller.current, strip.current, thumb.current)

  // Opens on the item (centred); a time changed elsewhere (the pills, the wheel) brings the bar into view.
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (centred.current !== day) {
      centred.current = day
      el.scrollLeft = Math.max(0, timelineCentre(timed ? start : null, length) * PPM - el.clientWidth / 2)
    } else if (timed && !drag.current) {
      const l = start * PPM, r = Math.min(end, DAY_MINUTES) * PPM
      if (l < el.scrollLeft + 8 || r > el.scrollLeft + el.clientWidth - 8) {
        el.scrollTo({ left: Math.max(0, (l + r) / 2 - el.clientWidth / 2), behavior: motion ? 'smooth' : 'auto' })
      }
    }
    placeThumb(el, strip.current, thumb.current)
  }, [day, timed, start, length, end, motion])

  // A mouse wheel moves along the day; at either end it lets the screen scroll on. The thumb follows a resize.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      const max = el.scrollWidth - el.clientWidth
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max - 1)) return
      el.scrollLeft += e.deltaY
      e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    const ro = new ResizeObserver(() => placeThumb(el, strip.current, thumb.current))
    ro.observe(el)
    return () => { el.removeEventListener('wheel', onWheel); ro.disconnect() }
  }, [])

  function startDrag(e: PointerEvent<HTMLElement>, mode: DragMode) {
    if ((e.pointerType === 'mouse' && e.button !== 0) || !timed || locked) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { mode, x0: e.clientX, sc0: scroller.current?.scrollLeft ?? 0, s0: start, l0: length }
  }
  function moveDrag(e: PointerEvent<HTMLElement>) {
    const d = drag.current, el = scroller.current
    if (!d || !el) return
    const box = el.getBoundingClientRect()
    if (e.clientX < box.left + 28) el.scrollLeft -= 10
    else if (e.clientX > box.right - 28) el.scrollLeft += 10
    const next = dragTimes(d.mode, d.s0, d.l0, (e.clientX - d.x0 + el.scrollLeft - d.sc0) / PPM)
    if (next.start !== start || next.length !== length) onChange(next.start, next.length)
  }
  const endDrag = () => { drag.current = null }

  function onBarKey(e: KeyboardEvent<HTMLDivElement>) {
    if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || !timed || locked) return
    e.preventDefault()
    const next = nudgeTimes(start, length, e.key === 'ArrowLeft' ? -1 : 1, e.shiftKey)
    onChange(next.start, next.length)
  }

  // A mouse drags empty space to move along the day (a finger scrolls it natively).
  function panStart(e: PointerEvent<HTMLDivElement>) {
    const el = scroller.current
    if (!el || e.pointerType !== 'mouse' || e.button !== 0) return
    const x0 = e.clientX, s0 = el.scrollLeft
    el.setPointerCapture(e.pointerId)
    const move = (ev: globalThis.PointerEvent) => { el.scrollLeft = s0 - (ev.clientX - x0) }
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up) }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }

  // The strip: a tap or a drag puts that part of the day in the middle.
  function stripStart(e: PointerEvent<HTMLDivElement>) {
    const el = scroller.current, s = strip.current
    if (!el || !s) return
    e.preventDefault()
    const go = (x: number) => {
      const r = s.getBoundingClientRect()
      el.scrollLeft = ((x - r.left) / r.width) * el.scrollWidth - el.clientWidth / 2
    }
    go(e.clientX)
    s.setPointerCapture(e.pointerId)
    const move = (ev: globalThis.PointerEvent) => go(ev.clientX)
    const up = () => { s.removeEventListener('pointermove', move); s.removeEventListener('pointerup', up); s.removeEventListener('pointercancel', up) }
    s.addEventListener('pointermove', move)
    s.addEventListener('pointerup', up)
    s.addEventListener('pointercancel', up)
  }
  function onStripKey(e: KeyboardEvent<HTMLDivElement>) {
    const el = scroller.current
    if (!el || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
    e.preventDefault()
    el.scrollBy({ left: (e.key === 'ArrowLeft' ? -60 : 60) * PPM, behavior: motion ? 'smooth' : 'auto' })
  }

  const width = timed ? Math.max(Math.min(end, DAY_MINUTES) - start, 0) * PPM : 0
  const narrow = width < 46
  const endText = timed && length ? (crosses ? `${displayDate(endOf(day, timeOfMinutes(start), length).date)} ${timeOfMinutes(end)}` : timeOfMinutes(end)) : ''
  const left = allDay ? 'All day'
    : !timed ? ''
    : !length ? `At ${timeOfMinutes(start)} · doesn't block time`
    : crosses ? `${timeOfMinutes(start)} → ${endText}`
    : `${timeOfMinutes(start)}–${timeOfMinutes(end)} · ${formatDurationMinutes(length)}`
  const others = spans.length
  const right = !answered ? ''
    : allDay ? (others ? `${others} other ${others === 1 ? 'thing' : 'things'} that day` : 'Nothing else that day')
    : hits.length ? `Overlaps ${hits[0].title}${hits.length > 1 ? ` +${hits.length - 1}` : ''}`
    : others ? 'Nothing else then' : 'Nothing else that day'
  const gripCls = 'absolute inset-y-0 w-3.5 cursor-ew-resize touch-none after:absolute after:inset-y-1.5 after:left-1.5 after:w-0.5 after:rounded-full'

  return (
    <div className="py-2">
      <div ref={scroller} onScroll={syncThumb} onPointerDown={panStart}
        className="cursor-grab overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="relative h-[82px] select-none" style={{ width: DAY_MINUTES * PPM }}>
          {HOURS.map(h => (
            <span key={h} aria-hidden>
              <i className="absolute inset-y-0 w-px bg-line" style={{ left: h * 60 * PPM }} />
              <span className="absolute top-px translate-x-1 text-micro tabular-nums text-fg-faint" style={{ left: h * 60 * PPM }}>{pad(h)}:00</span>
            </span>
          ))}
          {spans.map(s => {
            const lane = lanes.get(s.id) ?? 0
            const hit = hits.some(h => h.id === s.id)
            return (
              <div key={s.id} title={`${s.title} ${timeOfMinutes(s.start)}–${timeOfMinutes(s.end)}`}
                className={cx('absolute flex items-center overflow-hidden rounded-md border-l-2 border-line-strong bg-surface-2 px-1.5 text-meta text-fg-2',
                  two ? 'h-[17px]' : 'h-9', hit && 'ring-1 ring-inset ring-warn')}
                style={{ left: s.start * PPM, width: Math.max(s.end - s.start, 6) * PPM, top: two ? 16 + lane * 19 : 16 }}>
                <Truncate className="min-w-0">{s.title}</Truncate>
              </div>
            )
          })}
          {allDay && (
            <div aria-hidden className="absolute inset-x-0 top-[55px] h-[25px] rounded-md bg-accent-50" />
          )}
          {timed && (
            <div role="slider" tabIndex={0} aria-label="This item on the day: drag it, or use the arrows; Shift and the arrows change its end"
              aria-valuemin={0} aria-valuemax={DAY_MINUTES - 5} aria-valuenow={start}
              aria-valuetext={length ? `${timeOfMinutes(start)} to ${endText}` : `At ${timeOfMinutes(start)}`}
              onKeyDown={onBarKey} onPointerDown={e => startDrag(e, 'move')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
              className={cx('absolute top-[55px] h-[25px] touch-none rounded-md bg-accent-500 text-center text-meta font-semibold leading-[25px] text-on-accent shadow-float',
                locked ? 'cursor-default opacity-60' : 'cursor-grab active:cursor-grabbing', narrow ? 'px-0' : 'px-3')}
              style={{ left: start * PPM, width: Math.max(width, 6) }}>
              {!locked && (
                <span aria-hidden onPointerDown={e => startDrag(e, 'start')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
                  className={cx(gripCls, narrow ? '-left-3.5 after:bg-accent-500' : 'left-0 after:bg-on-accent/75')} />
              )}
              {width >= 86 && <span className="pointer-events-none block overflow-hidden whitespace-nowrap">{timeOfMinutes(start)}–{timeOfMinutes(end)}</span>}
              {!locked && !crosses && (
                <span aria-hidden onPointerDown={e => startDrag(e, 'end')} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
                  className={cx(gripCls, narrow ? '-right-3.5 after:bg-accent-500' : 'right-0 after:bg-on-accent/75')} />
              )}
            </div>
          )}
          {day === today && <i aria-hidden className="pointer-events-none absolute bottom-0 top-3.5 w-0.5 rounded-full bg-danger" style={{ left: nowMin * PPM }} />}
        </div>
      </div>
      <div ref={strip} role="scrollbar" tabIndex={0} aria-label="The day: drag to move along it" aria-orientation="horizontal"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} onPointerDown={stripStart} onKeyDown={onStripKey}
        className="relative mx-3.5 mt-2 h-3 cursor-pointer touch-none rounded-full bg-surface-2">
        {spans.map(s => (
          <i key={s.id} aria-hidden className="absolute top-1 h-1 rounded-full bg-line-strong"
            style={{ left: `${(s.start / DAY_MINUTES) * 100}%`, width: `${Math.max(((s.end - s.start) / DAY_MINUTES) * 100, 0.6)}%` }} />
        ))}
        {timed && (
          <i aria-hidden className="absolute top-0.5 h-2 rounded-full bg-accent-500"
            style={{ left: `${(start / DAY_MINUTES) * 100}%`, width: `${Math.max(((Math.min(end, DAY_MINUTES) - start) / DAY_MINUTES) * 100, 0.6)}%` }} />
        )}
        <span ref={thumb} aria-hidden className="absolute -inset-y-0.5 rounded-full border-[1.5px] border-accent-500 bg-accent-500/10" />
      </div>
      <div className="mx-3.5 mt-1.5 flex h-4 justify-between gap-2.5 text-meta tabular-nums text-fg-muted">
        <span className="shrink-0 whitespace-nowrap">{left}</span>
        <span data-tone={hits.length && !allDay ? 'warn' : undefined} className={cx('min-w-0 text-right', hits.length > 0 && !allDay && 'tone-text')}>
          <Truncate>{[dayNote, right].filter(Boolean).join(' · ')}</Truncate>
        </span>
      </div>
    </div>
  )
}
