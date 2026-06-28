import type { HevyWorkout } from '../types.hevy'

interface Props {
  workout: HevyWorkout
  onClick: () => void
}

function fmtDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '—'
  const mins = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000)
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins / 60)}h ${mins % 60}m`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function getDayAccent(iso: string | null): string {
  if (!iso) return 'bg-ink-300'
  const day = new Date(iso).getDay()
  // Mon–Fri = accent, Sat–Sun = muted
  const colors = [
    'bg-ink-300',    // Sun
    'bg-accent-500', // Mon
    'bg-accent-400', // Tue
    'bg-accent-500', // Wed
    'bg-accent-400', // Thu
    'bg-accent-500', // Fri
    'bg-ink-300',    // Sat
  ]
  return colors[day] ?? 'bg-accent-400'
}

function getMuscleGroups(workout: HevyWorkout): string[] {
  if (!workout.exercises?.length) return []
  const seen = new Set<string>()
  const groups: string[] = []
  for (const ex of workout.exercises) {
    const mg = ex.template?.primary_muscle_group
    if (mg && !seen.has(mg)) {
      seen.add(mg)
      groups.push(mg)
    }
    if (groups.length >= 3) break
  }
  return groups
}

export function HevyWorkoutCard({ workout, onClick }: Props) {
  const muscleGroups  = getMuscleGroups(workout)
  const exerciseCount = workout.exercises?.length ?? null
  const duration      = fmtDuration(workout.start_time, workout.end_time)
  const date          = fmtDate(workout.start_time)
  const time          = fmtTime(workout.start_time)
  const accentBar     = getDayAccent(workout.start_time)

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border border-ink-100 bg-white min-h-[60px] cursor-pointer hover:border-accent-200 hover:shadow-sm transition-all duration-150 flex overflow-hidden"
    >
      {/* Left accent bar */}
      <div className={`w-1 shrink-0 ${accentBar}`} />

      <div className="flex-1 px-3 py-2 flex flex-col gap-1 min-w-0">
        {/* Title row */}
        <div className="flex items-start justify-between gap-3">
          <span className="text-sm font-bold text-ink-900 truncate">{workout.title}</span>
          <span className="text-sm font-semibold text-ink-700 whitespace-nowrap shrink-0">{duration}</span>
        </div>

        {/* Date + exercise count */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-ink-500">{date}{time ? ` · ${time}` : ''}</span>
          {exerciseCount !== null && (
            <span className="text-[11px] font-medium bg-ink-100 text-ink-500 rounded-full px-2 py-0.5 whitespace-nowrap">
              {exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'}
            </span>
          )}
        </div>

        {/* Muscle group tags */}
        {muscleGroups.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {muscleGroups.map((mg, i) => (
              <span
                key={mg}
                className={`text-[11px] font-medium rounded-full px-2 py-0.5 capitalize ${
                  i === 0
                    ? 'bg-accent-100 text-accent-700'
                    : 'bg-ink-100 text-ink-500'
                }`}
              >
                {mg}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  )
}
