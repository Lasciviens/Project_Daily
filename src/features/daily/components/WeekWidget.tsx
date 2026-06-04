import { useState } from 'react'
import { addDays, addWeeks, format, startOfWeek, endOfWeek, isToday, isSameDay, getISOWeek } from 'date-fns'
import { useTasksByWeek } from '../../todo/hooks/useTodos'
import type { Task } from '../../todo/types'

interface Props {
  onDayClick?: (date: Date) => void
  highlightDate?: Date
}

export function WeekWidget({ onDayClick, highlightDate }: Props) {
  const [weekOffset, setWeekOffset] = useState(0)

  const baseWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 })
  const weekStart     = weekOffset === 0 ? baseWeekStart : addWeeks(baseWeekStart, weekOffset)
  const weekEnd       = endOfWeek(weekStart, { weekStartsOn: 1 })
  const weekNumber    = getISOWeek(weekStart)
  const isCurrentWeek = weekOffset === 0

  const { data: tasks = [] } = useTasksByWeek(weekStart, weekEnd)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  function openCountForDay(date: Date): number {
    const dateStr = format(date, 'yyyy-MM-dd')
    return tasks.filter(
      t => t.due_date === dateStr && t.status !== 'done' && t.status !== 'cancelled'
    ).length
  }

  const floatingTasks = tasks.filter(
    (t): t is Task => !t.due_date && t.status !== 'done'
  )

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
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setWeekOffset(w => w - 1)}
            className="w-6 h-6 flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 rounded transition-colors duration-150 text-sm"
          >
            ‹
          </button>
          <button
            onClick={() => setWeekOffset(w => w + 1)}
            className="w-6 h-6 flex items-center justify-center text-ink-400 hover:text-ink-700 hover:bg-ink-100 rounded transition-colors duration-150 text-sm"
          >
            ›
          </button>
        </div>
      </div>

      {/* Date range label */}
      <p className="text-[10px] text-ink-400 mb-3">
        {format(weekStart, 'MMM d')} – {format(weekEnd, 'MMM d, yyyy')}
      </p>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map(day => {
          const current    = isToday(day)
          const selected   = highlightDate ? isSameDay(day, highlightDate) : false
          const openCount  = openCountForDay(day)
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
              {openCount > 0 && (
                <span className={`mt-1 text-[10px] font-semibold px-1 rounded-sm ${
                  current ? 'bg-accent-600 text-white' : 'bg-accent-100 text-accent-700'
                }`}>
                  {openCount}
                </span>
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
