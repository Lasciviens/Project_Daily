import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { cx } from '../ui'
import { formatMonthYear } from '../utils/dateFormat'
import { todayStr } from '../utils/dateUtils'
import {
  MONTH_SHORT, canShift, monthAllowed, monthCells, moveToYear, shiftMonth, startView, yearAllowed, yearForKey, yearRange,
  type MonthView,
} from './dateCalendarMath'

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const monthName = (v: MonthView) => formatMonthYear(new Date(v.year, v.month, 1, 12))

/**
 * A month grid to pick one day (yyyy-MM-dd). Days outside min/max are
 * disabled; the arrows never move past a month with nothing pickable. The
 * heading opens a year list + month grid, so going back ten years is three
 * taps (heading, year, month) instead of 120 arrow taps.
 * With `selected` it marks several days (the caller toggles them in onPick);
 * `value` then only picks the month it opens on.
 * `compact`: 36px days and arrows (a chip's picker in the Add sheet).
 */
export function DateCalendar({ value, min, max, onPick, selected, compact = false }: {
  value: string
  min?: string
  max?: string
  onPick: (iso: string) => void
  selected?: readonly string[]
  compact?: boolean
}) {
  const today = todayStr()
  const [view, setView] = useState(() => startView(value, min, max, today))
  const [picking, setPicking] = useState(false)
  // In the month/year picker the arrows step a year, else a month.
  const go = (dir: -1 | 1) => setView(v => (picking ? moveToYear(v, v.year + dir, min, max) : shiftMonth(v, dir)))
  const canGo = (dir: -1 | 1) => (picking ? yearAllowed(view.year + dir, min, max) : canShift(view, dir, min, max))
  const allowed = (d: string) => (!min || d >= min) && (!max || d <= max)

  // Escape leaves the picker first (the popup it sits in closes on the next one).
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (picking && e.key === 'Escape') {
      e.stopPropagation()
      setPicking(false)
    }
  }

  const navCls = cx('flex items-center justify-center rounded-control text-fg-muted hover:bg-surface-hover disabled:opacity-30', compact ? 'h-9 w-9' : 'h-11 w-11')
  return (
    <div className={cx('max-w-full select-none', compact ? 'w-[17rem]' : 'w-[18.5rem]')} onKeyDown={onKeyDown}>
      <div className="mb-1 flex items-center justify-between">
        <button type="button" onClick={() => go(-1)} disabled={!canGo(-1)} aria-label={picking ? 'Previous year' : 'Previous month'}
          className={navCls}>
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <button type="button" onClick={() => setPicking(p => !p)} aria-expanded={picking}
          aria-label={`${monthName(view)}, ${picking ? 'back to the days' : 'pick a month and year'}`}
          title={picking ? 'Back to the days' : 'Pick a month and year'}
          className={cx('flex min-w-0 items-center gap-1 rounded-control px-2 font-semibold text-fg hover:bg-surface-hover', compact ? 'h-9 text-body' : 'h-11 text-ui')}>
          {monthName(view)}
          <ChevronDown className={cx('h-4 w-4 shrink-0 text-fg-muted transition-transform', picking && 'rotate-180')} aria-hidden />
        </button>
        {/* A button's own content is not announced as it changes; this is. */}
        <span className="sr-only" aria-live="polite">{monthName(view)}</span>
        <button type="button" onClick={() => go(1)} disabled={!canGo(1)} aria-label={picking ? 'Next year' : 'Next month'}
          className={navCls}>
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      </div>
      {picking ? (
        <MonthYearPicker view={view} today={today} min={min} max={max}
          onYear={year => setView(v => moveToYear(v, year, min, max))}
          onMonth={month => { setView(v => ({ ...v, month })); setPicking(false) }} />
      ) : (
        <div className="grid grid-cols-7 text-center">
          {WEEKDAYS.map(w => <span key={w} className="pb-1 text-micro font-semibold text-fg-faint">{w}</span>)}
          {monthCells(view.year, view.month).map(c => {
            const ok = allowed(c.date)
            const isSelected = selected ? selected.includes(c.date) : c.date === value
            return (
              <button key={c.date} type="button" disabled={!ok} onClick={() => onPick(c.date)}
                aria-label={`${c.date.slice(8)}.${c.date.slice(5, 7)}.${c.date.slice(0, 4)}`}
                aria-pressed={isSelected}
                className={cx(
                  'mx-auto flex items-center justify-center rounded-full text-body tabular-nums transition-colors',
                  compact ? 'h-9 w-9' : 'h-10 w-10',
                  isSelected ? 'bg-accent-500 font-semibold text-on-accent'
                    : c.date === today ? 'font-semibold text-accent-600 ring-1 ring-accent-300 hover:bg-accent-50'
                    : c.inMonth ? 'text-fg hover:bg-surface-hover' : 'text-fg-faint hover:bg-surface-hover',
                  'disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent',
                )}>
                {c.day}
              </button>
            )
          })}
        </div>
      )}
      {!selected && allowed(today) && value !== today && (
        // Picking today also brings its month into view (a host that keeps the calendar open shows it).
        <button type="button" onClick={() => { setView(startView(today, min, max, today)); setPicking(false); onPick(today) }}
          className={cx('mt-1 w-full rounded-control text-meta font-semibold text-accent-600 hover:bg-accent-50', compact ? 'min-h-[36px]' : 'min-h-[44px]')}>
          Today
        </button>
      )}
    </div>
  )
}

/**
 * The heading's picker: a scrolling year list (opened on the shown year) beside
 * the twelve months. A year changes the shown month's year at once; a month
 * goes back to the days.
 */
function MonthYearPicker({ view, today, min, max, onYear, onMonth }: {
  view: MonthView
  today: string
  min?: string
  max?: string
  onYear: (year: number) => void
  onMonth: (month: number) => void
}) {
  const todayYear = Number(today.slice(0, 4))
  const todayMonth = Number(today.slice(5, 7)) - 1
  const years = yearRange(view.year, todayYear, min, max)
  // The list's one Tab stop: the shown year (the first when it lies outside min–max).
  const tabYear = years.includes(view.year) ? view.year : years[0]
  const listRef = useRef<HTMLDivElement>(null)

  // Keep the shown year in sight: centred when it is out of view (opening, the
  // arrows), left alone when it was just tapped (the list never jumps under a finger).
  useLayoutEffect(() => {
    const list = listRef.current
    const item = list?.querySelector<HTMLElement>(`[data-year="${view.year}"]`)
    if (!list || !item) return
    const top = item.offsetTop
    const bottom = top + item.offsetHeight
    if (top < list.scrollTop || bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - (list.clientHeight - item.offsetHeight) / 2
    }
  }, [view.year])

  // Keyboard: one Tab stop (the shown year); ↑/↓, Page Up/Down, Home/End move it.
  function onYearKey(e: KeyboardEvent<HTMLDivElement>) {
    const next = yearForKey(years, view.year, e.key)
    if (next === null) return
    e.preventDefault()
    onYear(next)
    listRef.current?.querySelector<HTMLElement>(`[data-year="${next}"]`)?.focus({ preventScroll: true })
  }

  return (
    <div className="flex h-52 gap-2">
      <div ref={listRef} role="group" aria-label="Year" onKeyDown={onYearKey}
        className="relative w-[4.5rem] shrink-0 overflow-y-auto overscroll-contain rounded-row border border-line">
        {years.map(y => {
          const selected = y === view.year
          return (
            <button key={y} type="button" data-year={y} aria-pressed={selected} tabIndex={y === tabYear ? 0 : -1} onClick={() => onYear(y)}
              className={cx(
                'block h-8 w-full text-body tabular-nums transition-colors',
                selected ? 'bg-accent-500 font-semibold text-on-accent'
                  : y === todayYear ? 'font-semibold text-accent-600 hover:bg-accent-50'
                  : 'text-fg hover:bg-surface-hover',
              )}>
              {y}
            </button>
          )
        })}
      </div>
      <div role="group" aria-label={`Months of ${view.year}`} className="grid min-w-0 flex-1 grid-cols-3 grid-rows-4 gap-1">
        {MONTH_SHORT.map((m, i) => {
          const selected = i === view.month
          return (
            <button key={m} type="button" disabled={!monthAllowed(view.year, i, min, max)} aria-pressed={selected}
              aria-label={monthName({ year: view.year, month: i })} onClick={() => onMonth(i)}
              className={cx(
                'rounded-control text-body transition-colors',
                selected ? 'bg-accent-500 font-semibold text-on-accent'
                  : view.year === todayYear && i === todayMonth ? 'font-semibold text-accent-600 ring-1 ring-inset ring-accent-300 hover:bg-accent-50'
                  : 'text-fg hover:bg-surface-hover',
                'disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent',
              )}>
              {m}
            </button>
          )
        })}
      </div>
    </div>
  )
}
