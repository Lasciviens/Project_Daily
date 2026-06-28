import { useState } from 'react'
import { addDays, addWeeks, format, startOfWeek, endOfWeek, isToday, isSameDay, getISOWeek } from 'date-fns'
import { useTasksByWeek } from '../../todo/hooks/useTodos'
import { useCalendarEventDatesForRange, useCalendarList } from '../../calendar/hooks/useCalendar'
import { useCalendarStore } from '../../../app/store'
import type { Task } from '../../todo/types'

interface Props {
  onDayClick?: (date: Date) => void
  highlightDate?: Date
}

export function WeekWidget({ onDayClick, highlightDate }: Props) {
  const [weekOffset, setWeekOffset] = useState(0)
  const [showCalFilter, setShowCalFilter] = useState(false)

  const baseWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const weekStart     = weekOffset === 0 ? baseWeekStart : addWeeks(baseWeekStart, weekOffset)
  const weekEnd       = endOfWeek(weekStart, { weekStartsOn: 1 })
  const weekNumber    = getISOWeek(weekStart)
  const isCurrentWeek = weekOffset === 0

  const { data: tasks = [] } = useTasksByWeek(weekStart, weekEnd)
  const { data: calDates }   = useCalendarEventDatesForRange(weekStart, weekEnd)
  const { data: calList = [] } = useCalendarList()
  const { selectedCalendarIds, setSelectedCalendarIds } = useCalendarStore()

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  function openCountForDay(date: Date): number {
    const dateStr = format(date, 'yyyy-MM-dd')
    return tasks.filter(
      t => t.due_date === dateStr && t.status !== 'done' && t.status !== 'cancelled'
    ).length
  }

  function hasCalEventOnDay(date: Date): boolean {
    return calDates?.has(format(date, 'yyyy-MM-dd')) ?? false
  }

  function toggleCalendar(id: string) {
    const current = selectedCalendarIds ?? calList.map(c => c.id)
    const next = current.includes(id)
      ? current.filter(x => x !== id)
      : [...current, id]
    setSelectedCalendarIds(next.length === calList.length ? null : next)
  }

  function isCalSelected(id: string): boolean {
    if (!selectedCalendarIds) return true
    return selectedCalendarIds.includes(id)
  }

  const floatingTasks = tasks.filter(
    (t): t is Task => !t.due_date && t.status !== 'done'
  )

  const totalTasks  = tasks.filter(t => t.status !== 'cancelled').length
  const doneTasks   = tasks.filter(t => t.status === 'done').length
  const donePercent = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0

  return (
    <div className="card p-5">
      {/* Header with navigation */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-500">
            Week {weekNumber}
          </h2>
          {!isCurrentWeek && (
            <button
              onClick={() => setWeekOffset(0)}
              className="text-[10px] text-accent-600 hover:text-accent-700 font-medium transition-colors duration-150"
            >
              Back to now
            </button>
          )}
          {tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').length > 0 && (
            <span className="text-[10px] bg-accent-50 text-accent-600 font-semibold px-1.5 py-0.5 rounded-full">
              {tasks.filter(t => t.status !== 'done' && t.status !== 'cancelled').length} open
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {calList.length > 1 && (
            <button
              onClick={() => setShowCalFilter(p => !p)}
              className={`min-h-[44px] min-w-[44px] flex items-center justify-center text-[10px] px-1.5 py-0.5 rounded transition-colors duration-150 font-medium ${
                showCalFilter ? 'bg-accent-100 text-accent-700' : 'text-ink-400 hover:text-ink-600'
              }`}
              title="Filter calendars"
            >
              ⊞
            </button>
          )}
          <button
            onClick={() => setWeekOffset(w => w - 1)}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 rounded transition-colors duration-150 text-sm"
          >
            ‹
          </button>
          <button
            onClick={() => setWeekOffset(w => w + 1)}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 rounded transition-colors duration-150 text-sm"
          >
            ›
          </button>
        </div>
      </div>

      {/* Calendar filter checkboxes */}
      {showCalFilter && calList.length > 1 && (
        <div className="flex flex-wrap gap-1.5 mb-3 pb-3 border-b border-ink-100">
          {calList.map(cal => (
            <button
              key={cal.id}
              onClick={() => toggleCalendar(cal.id)}
              className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border transition-colors duration-150 ${
                isCalSelected(cal.id)
                  ? 'bg-green-50 border-green-200 text-green-700'
                  : 'bg-ink-50 border-ink-200 text-ink-400'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isCalSelected(cal.id) ? 'bg-green-400' : 'bg-ink-300'}`} />
              {cal.summary}
            </button>
          ))}
        </div>
      )}

      {/* Date range + completion bar */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] text-ink-400">
          {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
        </p>
        {totalTasks > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="h-1 w-16 bg-ink-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-400 rounded-full transition-all duration-300"
                style={{ width: `${donePercent}%` }}
              />
            </div>
            <span className="text-[10px] text-ink-400">{donePercent}%</span>
          </div>
        )}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map(day => {
          const current    = isToday(day)
          const selected   = highlightDate ? isSameDay(day, highlightDate) : false
          const openCount  = openCountForDay(day)
          const hasCalEvent = hasCalEventOnDay(day)
          const clickable  = !!onDayClick

          return (
            <button
              key={day.toISOString()}
              onClick={() => onDayClick?.(day)}
              disabled={!clickable}
              className={`flex flex-col items-center py-2 px-1 rounded-lg text-center transition-colors duration-150 ${
                current
                  ? 'bg-accent-500 text-white'
                  : selected
                  ? 'bg-accent-100 text-accent-700 ring-2 ring-accent-400'
                  : clickable
                  ? 'bg-cream-100 hover:bg-cream-200 cursor-pointer'
                  : 'bg-cream-100'
              }`}
            >
              <span className={`text-[9px] font-semibold uppercase ${current ? 'text-accent-100' : 'text-ink-400'}`}>
                {format(day, 'EEE')}
              </span>
              <span className={`text-sm font-bold mt-0.5 ${current ? 'text-white' : 'text-ink-800'}`}>
                {format(day, 'd')}
              </span>
              {/* Task count badge */}
              {openCount > 0 && (
                <span className={`mt-0.5 text-[10px] font-semibold px-1 rounded-sm ${
                  current ? 'bg-accent-600 text-white' : 'bg-accent-100 text-accent-700'
                }`}>
                  {openCount}
                </span>
              )}
              {/* Calendar event dot */}
              {hasCalEvent && (
                <span className={`mt-0.5 w-1 h-1 rounded-full ${
                  current ? 'bg-green-200' : 'bg-green-400'
                }`} />
              )}
            </button>
          )
        })}
      </div>

      {/* Undated "this week" tasks */}
      {floatingTasks.length > 0 && isCurrentWeek && (
        <div className="mt-4 pt-3 border-t border-ink-100">
          <p className="text-[10px] text-ink-400 uppercase font-semibold tracking-wider mb-2">
            This week — no date
          </p>
          <div>
            {floatingTasks.slice(0, 5).map(task => (
              <div key={task.id} className="flex items-center gap-2 py-1">
                <span className="w-1 h-1 rounded-full bg-accent-400 flex-shrink-0" />
                <span className="text-sm text-ink-700 truncate">{task.title}</span>
              </div>
            ))}
            {floatingTasks.length > 5 && (
              <p className="text-xs text-ink-400 mt-1">+{floatingTasks.length - 5} more</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
