import { useState } from 'react'
import {
  format, startOfMonth, endOfMonth,
  startOfWeek, endOfWeek, addDays,
  addMonths, subMonths, isSameMonth, isToday, isSameDay,
} from 'date-fns'
import { useTasksByMonth } from '../../todo/hooks/useTodos'
import { useCalendarEventDatesForRange } from '../../calendar/hooks/useCalendar'

interface Props {
  onDayClick?:    (date: Date) => void
  highlightDate?: Date
}

export function MonthWidget({ onDayClick, highlightDate }: Props) {
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
    <div className="card p-5">
      {/* Month nav */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-500">
          {format(viewDate, 'MMMM yyyy')}
        </h2>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setViewDate(p => subMonths(p, 1))}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 rounded transition-colors duration-150 text-sm"
          >
            ‹
          </button>
          <button
            onClick={() => setViewDate(new Date())}
            className="min-h-[44px] px-2 text-[10px] text-accent-600 hover:bg-accent-50 rounded transition-colors duration-150 font-medium"
          >
            Today
          </button>
          <button
            onClick={() => setViewDate(p => addMonths(p, 1))}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 rounded transition-colors duration-150 text-sm"
          >
            ›
          </button>
        </div>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, i) => (
          <div key={i} className="text-center text-[9px] font-semibold text-ink-400 py-1">
            {label}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map(day => {
          const inMonth  = isSameMonth(day, viewDate)
          const current  = isToday(day)
          const selected = highlightDate ? isSameDay(day, highlightDate) : false
          const hasTasks    = hasTasksOnDay(day) && inMonth
          const hasCalEvent = inMonth && (calDates?.has(format(day, 'yyyy-MM-dd')) ?? false)
          const clickable = !!onDayClick && inMonth

          return (
            <button
              key={day.toISOString()}
              onClick={() => clickable && onDayClick?.(day)}
              disabled={!clickable}
              className={`relative flex flex-col items-center justify-center aspect-square rounded-md text-xs font-medium transition-colors duration-150 ${
                current
                  ? 'bg-accent-500 text-white'
                  : selected
                  ? 'bg-accent-100 text-accent-700 ring-2 ring-accent-400'
                  : inMonth && clickable
                  ? 'text-ink-700 hover:bg-cream-200 cursor-pointer'
                  : inMonth
                  ? 'text-ink-700'
                  : 'text-ink-300 cursor-default'
              }`}
            >
              {format(day, 'd')}
              {/* Task dot (accent) and/or calendar dot (green) */}
              {(hasTasks || hasCalEvent) && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 flex gap-0.5">
                  {hasTasks && (
                    <span className={`w-1 h-1 rounded-full ${
                      current ? 'bg-accent-200' : selected ? 'bg-accent-500' : 'bg-accent-400'
                    }`} />
                  )}
                  {hasCalEvent && (
                    <span className={`w-1 h-1 rounded-full ${current ? 'bg-green-200' : 'bg-green-400'}`} />
                  )}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Summary */}
      {openCount > 0 && (
        <p className="mt-3 pt-3 border-t border-ink-100 text-xs text-ink-400">
          {openCount} open task{openCount !== 1 ? 's' : ''} this month
        </p>
      )}
    </div>
  )
}
