import { addDays, format, isToday, startOfWeek, getWeek } from 'date-fns'
import type { TrainingSession } from '../types'

const TYPE_DOT: Record<string, string> = {
  strength: 'bg-purple-400',
  run:      'bg-green-400',
  cycling:  'bg-blue-400',
  walk:     'bg-teal-400',
  yoga:     'bg-pink-400',
  swim:     'bg-cyan-400',
  other:    'bg-ink-300',
}

interface Props {
  sessions:     TrainingSession[]
  weekStart:    Date
  selectedDay?: string | null
  onDayClick:   (date: string) => void
  onPrevWeek:   () => void
  onNextWeek:   () => void
  onToday:      () => void
}

export function TrainingWeekView({ sessions, weekStart, selectedDay, onDayClick, onPrevWeek, onNextWeek, onToday }: Props) {
  const days        = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const currentWeek = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const shownWeek   = format(weekStart, 'yyyy-MM-dd')
  const isThisWeek  = shownWeek === currentWeek
  const weekNumber  = getWeek(weekStart, { weekStartsOn: 1 })

  function sessionsForDay(date: Date): TrainingSession[] {
    const ds = format(date, 'yyyy-MM-dd')
    return sessions.filter(s => {
      const d = s.planned_date ?? s.completed_at?.slice(0, 10)
      return d === ds
    })
  }

  return (
    <div className="mb-6">
      {/* Week header */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={onPrevWeek}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 rounded hover:bg-ink-100 transition-colors duration-150"
        >
          ‹
        </button>

        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-widest text-ink-400">
              Week {weekNumber}
            </span>
            {!isThisWeek && (
              <button
                onClick={onToday}
                className="text-[10px] px-2.5 py-1 rounded-full bg-accent-500 text-white hover:bg-accent-600 transition-colors duration-150 font-semibold min-h-[28px]"
              >
                Today
              </button>
            )}
          </div>
          <span className="text-xs font-semibold text-ink-600">
            {format(weekStart, 'd MMM')} – {format(addDays(weekStart, 6), 'd MMM yyyy')}
          </span>
        </div>

        <button
          onClick={onNextWeek}
          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-400 hover:text-ink-700 rounded hover:bg-ink-100 transition-colors duration-150"
        >
          ›
        </button>
      </div>

      {/* Day columns */}
      <div className="grid grid-cols-7 gap-1.5">
        {days.map(day => {
          const ds         = format(day, 'yyyy-MM-dd')
          const daySess    = sessionsForDay(day)
          const today      = isToday(day)
          const isSelected = selectedDay === ds
          const isPast     = day < new Date() && !today

          return (
            <button
              key={ds}
              onClick={() => onDayClick(ds)}
              className={`flex flex-col items-center gap-1 py-2 px-1 rounded-xl border-2 transition-all duration-150 ${
                isSelected && !today
                  ? 'bg-accent-100 border-accent-400 ring-2 ring-accent-400/30'
                  : today && isSelected
                  ? 'bg-accent-600 border-accent-600 ring-2 ring-accent-400/40'
                  : today
                  ? 'bg-accent-500 border-accent-500'
                  : 'border-ink-100 hover:border-accent-300 hover:bg-accent-50 bg-white'
              }`}
            >
              <span className={`text-[9px] font-bold uppercase tracking-wider ${
                today || (today && isSelected) ? 'text-white/80' : isSelected ? 'text-accent-600' : 'text-ink-400'
              }`}>
                {format(day, 'EEE')}
              </span>
              <span className={`text-sm font-bold leading-none ${
                today ? 'text-white' : isSelected ? 'text-accent-700' : isPast ? 'text-ink-400' : 'text-ink-800'
              }`}>
                {format(day, 'd')}
              </span>
              <div className="flex gap-0.5 min-h-[8px]">
                {daySess.slice(0, 3).map((s, i) => (
                  <div
                    key={i}
                    className={`w-1.5 h-1.5 rounded-full ${today ? 'bg-white/70' : (TYPE_DOT[s.type] ?? 'bg-ink-300')}`}
                  />
                ))}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
