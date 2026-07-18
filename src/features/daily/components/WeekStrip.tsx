import { useState } from 'react'
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

  const chevron = 'min-w-[28px] min-h-[44px] flex items-center justify-center rounded-lg text-ink-400 hover:text-ink-700 hover:bg-cream-100 transition-colors text-sm'

  return (
    <div className="flex items-center gap-1 px-2 sm:px-3 py-1.5 border-b border-ink-100">
      <button onClick={() => setNav({ key: viewKey, offset: offset - 1 })} className={chevron} aria-label="Previous week">‹</button>

      <div className="grid grid-cols-7 gap-1 flex-1 max-w-[25rem]">
        {days.map(d => {
          const viewed = isSameDay(d, viewDate)
          const today  = isToday(d)
          const count  = openCount(d)
          return (
            <button
              key={d.toISOString()}
              onClick={() => onDayClick(d)}
              className={`flex flex-col items-center justify-center min-h-[48px] rounded-lg px-1 py-1 transition-colors ${
                viewed ? 'bg-accent-500 text-white'
                : today ? 'ring-1 ring-accent-400 hover:bg-cream-100'
                : 'hover:bg-cream-100'
              }`}
            >
              <span className={`text-[10px] font-semibold uppercase leading-none ${viewed ? 'text-accent-100' : 'text-ink-400'}`}>
                {format(d, 'EEE')}
              </span>
              <span className={`text-sm font-bold leading-tight ${viewed ? 'text-white' : 'text-ink-800'}`}>
                {format(d, 'd')}
              </span>
              <span className="flex items-center gap-0.5 min-h-[10px] leading-none">
                {count > 0 && (
                  <span className={`text-[9px] font-semibold px-1 rounded-sm ${viewed ? 'bg-accent-600 text-white' : 'bg-accent-100 text-accent-700'}`}>
                    {count}
                  </span>
                )}
                {(calDates?.has(format(d, 'yyyy-MM-dd')) ?? false) && (
                  <span className={`w-1 h-1 rounded-full ${viewed ? 'bg-green-200' : 'bg-green-400'}`} />
                )}
              </span>
            </button>
          )
        })}
      </div>

      <button onClick={() => setNav({ key: viewKey, offset: offset + 1 })} className={chevron} aria-label="Next week">›</button>
      <span className="ml-auto text-[10px] font-semibold text-ink-400 whitespace-nowrap pr-1 hidden sm:block">
        Wk {getISOWeek(weekStart)}
      </span>
    </div>
  )
}
