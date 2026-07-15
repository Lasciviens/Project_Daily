import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
} from 'date-fns'
// react-body-highlighter (MIT, 0-deps): anterior/posterior SVG body with
// per-muscle highlighting driven by summed `frequency`.
import Model, { type IExerciseData } from 'react-body-highlighter'
import { useHevyExerciseTemplates } from '../hooks/useHevyExerciseTemplates'
import { fetchWorkoutExerciseTemplateIds } from '../api/hevyApi'

// ─────────────────────────────────────────────────────────────────────────────
//  "Worked muscles" — a front/back body heatmap of which muscle groups your
//  logged workouts hit over the selected period (day / week / month). The body
//  is ALWAYS shown (grey when nothing's logged); tap a muscle for its stats +
//  the exact exercises that worked it.
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

type Period = 'day' | 'week' | 'month'

const PERIODS: { id: Period; label: string }[] = [
  { id: 'day',   label: 'Day'   },
  { id: 'week',  label: 'Week'  },
  { id: 'month', label: 'Month' },
]

function rangeFor(period: Period, now: Date): { from: string; to: string } {
  if (period === 'day')   return { from: startOfDay(now).toISOString(),   to: endOfDay(now).toISOString() }
  if (period === 'month') return { from: startOfMonth(now).toISOString(), to: endOfMonth(now).toISOString() }
  return { from: startOfWeek(now, { weekStartsOn: 1 }).toISOString(), to: endOfWeek(now, { weekStartsOn: 1 }).toISOString() }
}

const EMPTY_HINT: Record<Period, string> = {
  day:   'No workout logged today yet.',
  week:  'No workouts logged this week yet.',
  month: 'No workouts logged this month yet.',
}

export function WorkedMuscles() {
  const [view, setView]     = useState<'anterior' | 'posterior'>('anterior')
  const [period, setPeriod] = useState<Period>('week')
  const [selected, setSelected] = useState<string | null>(null)

  const now = new Date()
  const { from, to } = rangeFor(period, now)

  const { data: templates = [] } = useHevyExerciseTemplates()
  const { data: worked, isLoading } = useQuery({
    queryKey: ['hevy', 'muscle-map', period, from, to],
    queryFn:  () => fetchWorkoutExerciseTemplateIds(from, to),
    staleTime: 5 * 60_000,
  })

  const workoutCount = worked?.workoutCount ?? 0

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
    for (const id of (worked?.templateIds ?? [])) {
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
  }, [worked, metaById])

  // Most-hit muscles, for the at-a-glance summary chips.
  const topMuscles = useMemo(
    () => Object.entries(perMuscle)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 4)
      .map(([key, e]) => ({ key, count: e.count })),
    [perMuscle],
  )

  const selectedEntry = selected ? perMuscle[selected] : undefined
  const selectedExercises = selectedEntry
    ? [...selectedEntry.exercises.entries()].sort((a, b) => b[1] - a[1])
    : []

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Controls: Front/Back + period */}
      <div className="flex items-center justify-between w-full max-w-[380px] gap-2 flex-wrap">
        <div className="flex gap-0.5 p-0.5 bg-cream-100 rounded-lg">
          {(['anterior', 'posterior'] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`px-3 min-h-[32px] rounded-md text-xs font-semibold transition-colors ${
                view === v ? 'bg-cream-50 text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
              }`}
            >
              {v === 'anterior' ? 'Front' : 'Back'}
            </button>
          ))}
        </div>
        <div className="flex gap-0.5 p-0.5 bg-cream-100 rounded-lg">
          {PERIODS.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => { setPeriod(p.id); setSelected(null) }}
              className={`px-3 min-h-[32px] rounded-md text-xs font-semibold transition-colors ${
                period === p.id ? 'bg-cream-50 text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary line */}
      <p className="text-xs text-ink-500 -mt-1">
        {workoutCount > 0
          ? <><strong className="text-ink-800">{workoutCount}</strong> workout{workoutCount !== 1 ? 's' : ''} · <strong className="text-ink-800">{total}</strong> exercises this {period}</>
          : EMPTY_HINT[period]}
      </p>

      {/* Body — ALWAYS rendered (grey when nothing logged) */}
      <div className="relative w-[240px]">
        {isLoading && <div className="absolute inset-0 z-10 rounded-xl bg-cream-100/60 animate-pulse" />}
        <Model
          data={data}
          type={view}
          bodyColor="#c9c4bb"
          highlightedColors={RAMP}
          onClick={(stats) => setSelected(stats.muscle)}
          style={{ width: '100%' }}
        />
      </div>

      {/* Intensity legend */}
      {total > 0 && (
        <div className="flex items-center gap-1.5 text-[10px] text-ink-400">
          <span>Less</span>
          {RAMP.map(c => <span key={c} className="w-3.5 h-2.5 rounded-sm" style={{ backgroundColor: c }} />)}
          <span>More</span>
        </div>
      )}

      {/* Top-worked chips */}
      {topMuscles.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5 w-full max-w-[380px]">
          {topMuscles.map(m => (
            <button
              key={m.key}
              onClick={() => setSelected(m.key)}
              className={`px-2.5 min-h-[28px] rounded-full text-[11px] font-medium capitalize transition-colors border ${
                selected === m.key
                  ? 'bg-accent-500 text-white border-accent-500'
                  : 'bg-cream-50 text-ink-600 border-ink-200 hover:border-accent-300'
              }`}
            >
              {m.key.replace('-', ' ')} · {m.count}
            </button>
          ))}
        </div>
      )}

      {/* Tap-a-muscle detail: which exercises hit it this period */}
      <div className="w-full max-w-[380px] min-h-[64px]">
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
            {total > 0
              ? 'Tap a highlighted muscle (or a chip above) to see which exercises hit it.'
              : 'Log a workout and sync — your worked muscles light up here.'}
          </p>
        )}
      </div>
    </div>
  )
}
