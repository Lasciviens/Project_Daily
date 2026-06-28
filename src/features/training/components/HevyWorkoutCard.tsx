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

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${date} · ${time}`
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
  const muscleGroups = getMuscleGroups(workout)
  const exerciseCount = workout.exercises?.length ?? null
  const duration = fmtDuration(workout.start_time, workout.end_time)
  const dateTime = fmtDateTime(workout.start_time)

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-xl border border-ink-100 bg-white px-4 py-3 min-h-[44px] cursor-pointer hover:bg-cream-50 transition-colors duration-150 flex flex-col gap-2"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[11px] text-ink-400">{dateTime}</span>
          <span className="text-sm font-semibold text-ink-900 truncate">{workout.title}</span>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-sm font-medium text-ink-700 whitespace-nowrap">{duration}</span>
          {exerciseCount !== null && (
            <span className="text-[11px] font-medium bg-ink-100 text-ink-500 rounded-full px-2 py-0.5 whitespace-nowrap">
              {exerciseCount} {exerciseCount === 1 ? 'exercise' : 'exercises'}
            </span>
          )}
        </div>
      </div>

      {muscleGroups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
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
    </button>
  )
}
