import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cx } from '../ui'
import { formatMonthYear } from '../utils/dateFormat'
import { todayStr } from '../utils/dateUtils'

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

/** Monday-first weeks covering `month` (0-based) of `year`, incl. the neighbouring days. */
function monthCells(year: number, month: number): { date: string; day: number; inMonth: boolean }[] {
  const first = new Date(year, month, 1, 12)
  const cursor = new Date(year, month, 1 - ((first.getDay() + 6) % 7), 12)
  const cells: { date: string; day: number; inMonth: boolean }[] = []
  do {
    for (let i = 0; i < 7; i++) {
      cells.push({ date: ymd(cursor), day: cursor.getDate(), inMonth: cursor.getMonth() === month })
      cursor.setDate(cursor.getDate() + 1)
    }
  } while (cursor.getMonth() === month)
  return cells
}

/**
 * A month grid to pick one day (yyyy-MM-dd). Days outside min/max are
 * disabled; the arrows never move past a month with nothing pickable.
 */
export function DateCalendar({ value, min, max, onPick }: {
  value: string
  min?: string
  max?: string
  onPick: (iso: string) => void
}) {
  const today = todayStr()
  const start = value || (max && max < today ? max : min && min > today ? min : today)
  const [view, setView] = useState({ year: Number(start.slice(0, 4)), month: Number(start.slice(5, 7)) - 1 })
  const cells = monthCells(view.year, view.month)
  const monthKey = `${view.year}-${pad(view.month + 1)}`
  const canPrev = !min || min.slice(0, 7) < monthKey
  const canNext = !max || max.slice(0, 7) > monthKey
  const shift = (d: number) => setView(v => {
    const t = v.year * 12 + v.month + d
    return { year: Math.floor(t / 12), month: ((t % 12) + 12) % 12 }
  })
  const allowed = (d: string) => (!min || d >= min) && (!max || d <= max)

  return (
    <div className="w-[18.5rem] max-w-full select-none">
      <div className="mb-1 flex items-center justify-between">
        <button type="button" onClick={() => shift(-1)} disabled={!canPrev} aria-label="Previous month"
          className="flex h-11 w-11 items-center justify-center rounded-control text-fg-muted hover:bg-surface-hover disabled:opacity-30">
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <span className="text-ui font-semibold text-fg" aria-live="polite">{formatMonthYear(new Date(view.year, view.month, 1, 12))}</span>
        <button type="button" onClick={() => shift(1)} disabled={!canNext} aria-label="Next month"
          className="flex h-11 w-11 items-center justify-center rounded-control text-fg-muted hover:bg-surface-hover disabled:opacity-30">
          <ChevronRight className="h-5 w-5" aria-hidden />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center">
        {WEEKDAYS.map(w => <span key={w} className="pb-1 text-micro font-semibold text-fg-faint">{w}</span>)}
        {cells.map(c => {
          const ok = allowed(c.date)
          const selected = c.date === value
          return (
            <button key={c.date} type="button" disabled={!ok} onClick={() => onPick(c.date)}
              aria-label={`${c.date.slice(8)}.${c.date.slice(5, 7)}.${c.date.slice(0, 4)}`}
              aria-pressed={selected}
              className={cx(
                'mx-auto flex h-10 w-10 items-center justify-center rounded-full text-body tabular-nums transition-colors',
                selected ? 'bg-accent-500 font-semibold text-on-accent'
                  : c.date === today ? 'font-semibold text-accent-600 ring-1 ring-accent-300 hover:bg-accent-50'
                  : c.inMonth ? 'text-fg hover:bg-surface-hover' : 'text-fg-faint hover:bg-surface-hover',
                'disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent',
              )}>
              {c.day}
            </button>
          )
        })}
      </div>
      {allowed(today) && value !== today && (
        <button type="button" onClick={() => onPick(today)}
          className="mt-1 min-h-[44px] w-full rounded-control text-meta font-semibold text-accent-600 hover:bg-accent-50">
          Today
        </button>
      )}
    </div>
  )
}
