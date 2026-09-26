import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cx } from '../../../shared/ui'
import { addDays, addWeeks, format, startOfWeek, isToday, isSameDay, getISOWeek } from 'date-fns'
import { useTasksByWeek } from '../../todo/hooks/useTodos'
import { useCalendarEventDatesForRange } from '../../calendar/hooks/useCalendar'

// ─────────────────────────────────────────────────────────────────────────────
//  WeekStrip — the hero surface's top band: 7 fixed day cells for the week
//  containing the viewed date. Replaces the separate WeekWidget column in the
//  Day view (the full WeekWidget still lives under the Week tab). Chevrons
//  browse weeks WITHOUT changing the viewed day; clicking a cell commits it.
//  Fixed-slot by construction: always 7 cells, always the same geometry.
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  viewDate:   Date
  onDayClick: (d: Date) => void
}

export function WeekStrip({ viewDate, onDayClick }: Props) {
  // Browse offset relative to the viewed date's week; resets whenever the
  // viewed date changes (adjust-during-render — no setState-in-effect).
  const viewKey = format(viewDate, 'yyyy-MM-dd')
  const [nav, setNav] = useState({ key: viewKey, offset: 0 })
  if (nav.key !== viewKey) setNav({ key: viewKey, offset: 0 })
  const offset = nav.key === viewKey ? nav.offset : 0

  const weekStart = addWeeks(startOfWeek(viewDate, { weekStartsOn: 1 }), offset)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const { data: tasks = [] } = useTasksByWeek(weekStart, addDays(weekStart, 6))
  const { data: calDates }   = useCalendarEventDatesForRange(weekStart, addDays(weekStart, 6))

  function openCount(d: Date): number {
    const s = format(d, 'yyyy-MM-dd')
    return tasks.filter(t => t.due_date === s && t.status !== 'done' && t.status !== 'cancelled').length
  }

  const chevron = 'grid min-h-[44px] min-w-[32px] place-items-center rounded-control text-fg-faint transition-colors duration-150 hover:bg-surface-hover hover:text-fg'

  return (
    <div className="flex items-center gap-1 border-b border-line px-2 py-1.5 sm:px-3">
      <button type="button" onClick={() => setNav({ key: viewKey, offset: offset - 1 })} className={chevron} aria-label="Previous week">
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>

      <div className="grid max-w-[25rem] flex-1 grid-cols-7 gap-1">
        {days.map(d => {
          const viewed = isSameDay(d, viewDate)
          const today  = isToday(d)
          const count  = openCount(d)
          const hasCal = calDates?.has(format(d, 'yyyy-MM-dd')) ?? false
          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => onDayClick(d)}
              aria-pressed={viewed}
              aria-label={format(d, 'EEEE d MMMM')}
              className={cx(
                'flex min-h-[48px] flex-col items-center justify-center rounded-control px-1 py-1 transition-colors duration-150',
                viewed ? 'bg-accent-500 text-on-accent'
                  : today ? 'ring-1 ring-inset ring-accent-500/60 hover:bg-surface-hover'
                  : 'hover:bg-surface-hover',
              )}
            >
              <span className={cx('text-micro font-semibold uppercase leading-none', viewed ? 'opacity-80' : 'text-fg-faint')}>
                {format(d, 'EEE')}
              </span>
              <span className={cx('text-ui font-bold leading-tight tabular-nums', !viewed && 'text-fg')}>
                {format(d, 'd')}
              </span>
              <span className="flex min-h-[10px] items-center gap-0.5 leading-none">
                {count > 0 && (
                  <span className={cx('rounded-sm px-1 text-micro font-semibold leading-none tabular-nums', viewed ? 'bg-accent-700 text-on-accent' : 'bg-accent-50 text-accent-700')}>
                    {count}
                  </span>
                )}
                {hasCal && <span data-tone="info" className={cx('tone-dot !h-1 !w-1', viewed && 'opacity-80')} aria-hidden />}
              </span>
            </button>
          )
        })}
      </div>

      <button type="button" onClick={() => setNav({ key: viewKey, offset: offset + 1 })} className={chevron} aria-label="Next week">
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
      <span className="ml-auto hidden whitespace-nowrap pr-1 text-micro font-semibold tabular-nums text-fg-faint sm:block">
        Wk {getISOWeek(weekStart)}
      </span>
    </div>
  )
}
