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
  const [selected, setSelected] = useState<string | null>(null)

  const now = new Date()
  const from = startOfWeek(now, { weekStartsOn: 1 }).toISOString()
  const to = endOfWeek(now, { weekStartsOn: 1 }).toISOString()

  const { data: templates = [] } = useHevyExerciseTemplates()
  const { data: ids = [], isLoading } = useQuery({
    queryKey: ['hevy', 'muscle-week', from, to],
    queryFn: () => fetchWorkoutExerciseTemplateIds(from, to),
    staleTime: 5 * 60_000,
  })

  // template id → { muscle, title }
  const metaById = useMemo(() => {
    const m = new Map<string, { muscle: string; title: string }>()
    for (const t of templates) {
      if (t.primary_muscle_group) m.set(t.id, { muscle: t.primary_muscle_group.toLowerCase(), title: t.title })
    }
    return m
  }, [templates])

  // Per body-muscle key: total exercise-instances + distinct exercise names
  // (with their own instance counts), then band the totals 1..BANDS.
  const { data, perMuscle, total } = useMemo(() => {
    const acc: Record<string, { count: number; exercises: Map<string, number> }> = {}
    let total = 0
    for (const id of ids) {
      const meta = metaById.get(id)
      if (!meta) continue
      const keys = HEVY_TO_BODY[meta.muscle]
      if (!keys) continue
      total++
      for (const k of keys) {
        const entry = acc[k] ?? (acc[k] = { count: 0, exercises: new Map() })
        entry.count++
        entry.exercises.set(meta.title, (entry.exercises.get(meta.title) ?? 0) + 1)
      }
    }
    const max = Math.max(1, ...Object.values(acc).map(e => e.count))
    const data: IExerciseData[] = Object.entries(acc).map(([key, e]) => ({
      name: key,
      muscles: [key] as IExerciseData['muscles'],
      frequency: Math.max(1, Math.ceil((e.count / max) * BANDS)),
    }))
    return { data, perMuscle: acc, total }
  }, [ids, metaById])

  const selectedEntry = selected ? perMuscle[selected] : undefined
  const selectedExercises = selectedEntry
    ? [...selectedEntry.exercises.entries()].sort((a, b) => b[1] - a[1])
    : []

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
              onClick={(stats) => setSelected(stats.muscle)}
              style={{ width: '100%' }}
            />
          </div>

          {/* Tap-a-muscle detail: which exercises hit it this week */}
          <div className="w-full max-w-[360px] min-h-[64px]">
            {selectedEntry ? (
              <div className="rounded-xl border border-ink-200 bg-cream-50 p-3">
                <div className="flex items-baseline justify-between mb-1.5">
                  <p className="text-sm font-semibold text-ink-800 capitalize">{selected!.replace('-', ' ')}</p>
                  <p className="text-[11px] text-ink-400">
                    {selectedExercises.length} exercise{selectedExercises.length !== 1 ? 's' : ''} · {selectedEntry.count} time{selectedEntry.count !== 1 ? 's' : ''}
                  </p>
                </div>
                <ul className="flex flex-col gap-1">
                  {selectedExercises.map(([name, c]) => (
                    <li key={name} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-ink-700 truncate">{name}</span>
                      <span className="text-ink-400 shrink-0">×{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-xs text-ink-400 text-center py-4">
                Tap a highlighted muscle to see which exercises hit it this week.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}
