import { addDays, format, startOfWeek, endOfWeek, isToday } from 'date-fns'
import { useTasksByWeek } from '../../todo/hooks/useTodos'
import type { Task } from '../../todo/types'

export function WeekWidget() {
  const now       = new Date()
  const weekStart = startOfWeek(now, { weekStartsOn: 1 })
  const weekEnd   = endOfWeek(now,   { weekStartsOn: 1 })
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
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-500 mb-4">This Week</h2>

      <div className="grid grid-cols-7 gap-1">
        {days.map(day => {
          const current    = isToday(day)
          const openCount  = openCountForDay(day)

          return (
            <div
              key={day.toISOString()}
              className={`flex flex-col items-center py-2 px-1 rounded-lg text-center ${
                current ? 'bg-amber-500 text-white' : 'bg-cream-100'
              }`}
            >
              <span className={`text-[9px] font-semibold uppercase ${current ? 'text-amber-100' : 'text-ink-400'}`}>
                {format(day, 'EEE')}
              </span>
              <span className={`text-sm font-bold mt-0.5 ${current ? 'text-white' : 'text-ink-800'}`}>
                {format(day, 'd')}
              </span>
              {openCount > 0 && (
                <span className={`mt-1 text-[10px] font-semibold px-1 rounded-sm ${
                  current ? 'bg-amber-600 text-white' : 'bg-amber-100 text-amber-700'
                }`}>
                  {openCount}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Undated "this week" tasks */}
      {floatingTasks.length > 0 && (
        <div className="mt-4 pt-3 border-t border-ink-100">
          <p className="text-[10px] text-ink-400 uppercase font-semibold tracking-wider mb-2">
            This week — no date
          </p>
          <div>
            {floatingTasks.slice(0, 5).map(task => (
              <div key={task.id} className="flex items-center gap-2 py-1">
                <span className="w-1 h-1 rounded-full bg-amber-400 flex-shrink-0" />
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
