import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { startOfWeek, endOfWeek } from 'date-fns'
// react-body-highlighter (MIT, 0-deps): anterior/posterior SVG body with
// per-muscle highlighting driven by summed `frequency`.
import Model, { type IExerciseData } from 'react-body-highlighter'
import { useHevyExerciseTemplates } from '../hooks/useHevyExerciseTemplates'
import { fetchWorkoutExerciseTemplateIds } from '../api/hevyApi'

// ─────────────────────────────────────────────────────────────────────────────
//  "Worked muscles this week" — TEST view. Aggregates this week's Hevy workout
//  exercises → primary_muscle_group → an intensity heatmap on a front/back body.
//  Click a muscle to see how many exercise-instances hit it this week.
//  (Test-grade: react-body-highlighter is click-only, no hover; a durable
//  version would hand-roll the SVG for hover tooltips + a per-muscle exercise
//  list — see the research notes.)
// ─────────────────────────────────────────────────────────────────────────────

// Hevy primary_muscle_group → react-body-highlighter muscle key(s). Array-valued
// because "shoulders" spans front+back deltoids. Groups with no body region
// (cardio/full_body/other) are omitted → simply not highlighted.
const HEVY_TO_BODY: Record<string, string[]> = {
  chest:       ['chest'],
  abdominals:  ['abs'],
  abs:         ['abs'],
  biceps:      ['biceps'],
  triceps:     ['triceps'],
  forearms:    ['forearm'],
  shoulders:   ['front-deltoids', 'back-deltoids'],
  lats:        ['upper-back'],
  upper_back:  ['upper-back'],
  lower_back:  ['lower-back'],
  traps:       ['trapezius'],
  quadriceps:  ['quadriceps'],
  hamstrings:  ['hamstring'],
  glutes:      ['gluteal'],
  calves:      ['calves'],
  abductors:   ['abductors'],
  adductors:   ['adductor'],
  neck:        ['neck'],
}

// Light→dark intensity ramp (5 bands). Fixed amber (data-viz intensity, not UI
// chrome) — reads on both themes.
const RAMP = ['#fde68a', '#fcd34d', '#fbbf24', '#f59e0b', '#b45309']
const BANDS = RAMP.length

export function WorkedMuscles() {
  const [view, setView] = useState<'anterior' | 'posterior'>('anterior')
  const [selected, setSelected] = useState<{ muscle: string; count: number } | null>(null)

  const now = new Date()
  const from = startOfWeek(now, { weekStartsOn: 1 }).toISOString()
  const to = endOfWeek(now, { weekStartsOn: 1 }).toISOString()

  const { data: templates = [] } = useHevyExerciseTemplates()
  const { data: ids = [], isLoading } = useQuery({
    queryKey: ['hevy', 'muscle-week', from, to],
    queryFn: () => fetchWorkoutExerciseTemplateIds(from, to),
    staleTime: 5 * 60_000,
  })

  // template id → Hevy primary_muscle_group
  const muscleById = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of templates) if (t.primary_muscle_group) m.set(t.id, t.primary_muscle_group.toLowerCase())
    return m
  }, [templates])

  // Count exercise-instances per body-muscle key, then band 1..BANDS.
  const { data, perMuscleCount, total } = useMemo(() => {
    const counts: Record<string, number> = {}
    let total = 0
    for (const id of ids) {
      const hevy = muscleById.get(id)
      if (!hevy) continue
      const keys = HEVY_TO_BODY[hevy]
      if (!keys) continue
      total++
      for (const k of keys) counts[k] = (counts[k] ?? 0) + 1
    }
    const max = Math.max(1, ...Object.values(counts))
    const data: IExerciseData[] = Object.entries(counts).map(([key, c]) => ({
      name: key,
      muscles: [key] as IExerciseData['muscles'],
      frequency: Math.max(1, Math.ceil((c / max) * BANDS)),
    }))
    return { data, perMuscleCount: counts, total }
  }, [ids, muscleById])

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center justify-between w-full max-w-[360px]">
        <p className="text-sm font-semibold text-ink-800">Worked this week</p>
        <div className="flex gap-0.5 p-0.5 bg-cream-100 rounded-lg">
          {(['anterior', 'posterior'] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`px-2.5 min-h-[28px] rounded-md text-[11px] font-semibold capitalize transition-colors ${
                view === v ? 'bg-cream-50 text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
              }`}
            >
              {v === 'anterior' ? 'Front' : 'Back'}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="h-[320px] w-[240px] rounded-xl bg-cream-200 animate-pulse" />
      ) : total === 0 ? (
        <p className="text-sm text-ink-400 py-10 text-center max-w-[360px]">
          No workouts logged this week yet — train and sync, then your worked muscles light up here.
        </p>
      ) : (
        <>
          <div className="w-[240px]">
            <Model
              data={data}
              type={view}
              bodyColor="#c9c4bb"
              highlightedColors={RAMP}
              onClick={(stats) => setSelected({ muscle: stats.muscle, count: perMuscleCount[stats.muscle] ?? 0 })}
              style={{ width: '100%' }}
            />
          </div>
          <p className="text-xs text-ink-500 h-4">
            {selected
              ? `${selected.muscle.replace('-', ' ')}: ${selected.count} exercise${selected.count !== 1 ? 's' : ''} this week`
              : 'Tap a muscle for its count'}
          </p>
        </>
      )}
    </div>
  )
}
