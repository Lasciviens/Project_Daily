import { useState } from 'react'
import {
  format, startOfMonth, endOfMonth,
  startOfWeek, endOfWeek, addDays,
  addMonths, subMonths, isSameMonth, isToday, isSameDay,
} from 'date-fns'
import { useTasksByMonth } from '../../todo/hooks/useTodos'
import { useCalendarEventDatesForRange } from '../../calendar/hooks/useCalendar'
import { DateNav } from '../../../shared/components/DateNav'
import { Card, TonePill, cx } from '../../../shared/ui'

interface Props {
  onDayClick?:    (date: Date) => void
  highlightDate?: Date
  /** Larger day cells + type — used by the Month tab's two-pane view. */
  big?:           boolean
}

export function MonthWidget({ onDayClick, highlightDate, big }: Props) {
  const [viewDate, setViewDate] = useState(new Date())

  // Structurally independent of the day view, but its position still follows
  // it: jump to the month containing highlightDate whenever it lands outside
  // the month currently on screen (adjust-during-render pattern — React's
  // recommended replacement for setState-in-effect).
  const highlightKey = highlightDate ? format(highlightDate, 'yyyy-MM') : null
  const [seenHighlightKey, setSeenHighlightKey] = useState(highlightKey)
  if (highlightKey !== seenHighlightKey) {
    setSeenHighlightKey(highlightKey)
    if (highlightDate) setViewDate(highlightDate)
  }

  const monthStart = startOfMonth(viewDate)
  const monthEnd   = endOfMonth(viewDate)
  const calStart   = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calEnd     = endOfWeek(monthEnd,     { weekStartsOn: 1 })

  const { data: tasks    = [] } = useTasksByMonth(monthStart, monthEnd)
  const { data: calDates     } = useCalendarEventDatesForRange(monthStart, monthEnd)

  const days: Date[] = []
  let d = calStart
  while (d <= calEnd) {
    days.push(d)
    d = addDays(d, 1)
  }

  function hasTasksOnDay(date: Date): boolean {
    const dateStr = format(date, 'yyyy-MM-dd')
    return tasks.some(t => t.due_date === dateStr && t.status !== 'cancelled')
  }

  const openCount = tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').length

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <DateNav
          label={format(viewDate, 'MMMM yyyy')}
          onPrev={() => setViewDate(p => subMonths(p, 1))}
          onNext={() => setViewDate(p => addMonths(p, 1))}
          onToday={() => setViewDate(new Date())}
          isToday={isSameMonth(viewDate, new Date())}
          labelClassName="min-w-[120px] text-lead font-semibold text-fg"
        />
        {openCount > 0 && <TonePill tone="accent">{openCount} open</TonePill>}
      </div>

      <div className="mb-1 grid grid-cols-7">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, i) => (
          <div key={i} className="py-1 text-center text-micro font-semibold text-fg-faint">{label}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {days.map(day => {
          const inMonth     = isSameMonth(day, viewDate)
          const current     = isToday(day)
          const selected    = highlightDate ? isSameDay(day, highlightDate) : false
          const hasTasks    = hasTasksOnDay(day) && inMonth
          const hasCalEvent = inMonth && (calDates?.has(format(day, 'yyyy-MM-dd')) ?? false)
          const clickable   = !!onDayClick && inMonth

          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => clickable && onDayClick?.(day)}
              disabled={!clickable}
              aria-pressed={selected}
              aria-label={format(day, 'EEEE d MMMM')}
              className={cx(
                'relative flex aspect-square min-h-[40px] flex-col items-center justify-center rounded-control font-medium tabular-nums transition-colors duration-150',
                big ? 'text-ui' : 'text-body',
                current ? 'bg-accent-500 text-on-accent'
                  : selected ? 'bg-accent-50 text-accent-700 ring-2 ring-inset ring-accent-500'
                  : inMonth && clickable ? 'text-fg-2 hover:bg-surface-hover'
                  : inMonth ? 'text-fg-2'
                  : 'cursor-default text-fg-faint opacity-50',
              )}
            >
              {format(day, 'd')}
              {(hasTasks || hasCalEvent) && (
                <span className="absolute bottom-1 left-1/2 flex -translate-x-1/2 gap-0.5">
                  {hasTasks && <span className={cx('h-1 w-1 rounded-full', current ? 'bg-on-accent/80' : 'bg-accent-500')} />}
                  {hasCalEvent && <span data-tone="info" className={cx('tone-dot !h-1 !w-1', current && 'opacity-80')} />}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </Card>
  )
}
