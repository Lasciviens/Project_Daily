import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
} from 'date-fns'
import Body, { type ExtendedBodyPart, type Slug } from 'react-muscle-highlighter'
import { useHevyExerciseTemplates } from '../hooks/useHevyExerciseTemplates'
import { fetchWorkoutExerciseTemplateIds } from '../api/hevyApi'
import { slugForHevyGroup, RAMP, BANDS, BASE_MUSCLE_COLOR, labelForSlug } from '../muscleMap'

// ─────────────────────────────────────────────────────────────────────────────
//  "Worked muscles" — a clean stylised front/back body (react-muscle-highlighter,
//  MIT) heat-mapped by which muscle groups your logged workouts hit over the
//  selected period (day / week / month). Body is ALWAYS shown (grey when nothing
//  logged); tap a muscle for the exact exercises that worked it.
//
//  Every Hevy primary_muscle_group maps to a body slug via muscleMap's
//  HEVY_TO_SLUG (the full Hevy enum), so every exercise is accounted for.
// ─────────────────────────────────────────────────────────────────────────────

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
  const [side, setSide]     = useState<'front' | 'back'>('front')
  const [period, setPeriod] = useState<Period>('week')
  const [selected, setSelected] = useState<Slug | null>(null)

  const now = new Date()
  const { from, to } = rangeFor(period, now)

  const { data: templates = [] } = useHevyExerciseTemplates()
  const { data: worked, isLoading } = useQuery({
    queryKey: ['hevy', 'muscle-map', period, from, to],
    queryFn:  () => fetchWorkoutExerciseTemplateIds(from, to),
    staleTime: 5 * 60_000,
  })

  const workoutCount = worked?.workoutCount ?? 0

  // template id → { slug, title } (Hevy primary_muscle_group resolved to a body slug)
  const metaById = useMemo(() => {
    const m = new Map<string, { slug: Slug; title: string }>()
    for (const t of templates) {
      const slug = slugForHevyGroup(t.primary_muscle_group)
      if (slug) m.set(t.id, { slug, title: t.title })
    }
    return m
  }, [templates])

  // Per body slug: total exercise-instances + distinct exercise names.
  const { perSlug, total } = useMemo(() => {
    const acc: Record<string, { count: number; exercises: Map<string, number> }> = {}
    let total = 0
    for (const id of (worked?.templateIds ?? [])) {
      const meta = metaById.get(id)
      if (!meta) continue
      total++
      const entry = acc[meta.slug] ?? (acc[meta.slug] = { count: 0, exercises: new Map() })
      entry.count++
      entry.exercises.set(meta.title, (entry.exercises.get(meta.title) ?? 0) + 1)
    }
    return { perSlug: acc, total }
  }, [worked, metaById])

  // Slug → intensity band (1..BANDS); fed to the body as `intensity`.
  const bodyData = useMemo<ExtendedBodyPart[]>(() => {
    const max = Math.max(1, ...Object.values(perSlug).map(e => e.count))
    return Object.entries(perSlug).map(([slug, e]) => ({
      slug: slug as Slug,
      intensity: Math.max(1, Math.ceil((e.count / max) * BANDS)),
    }))
  }, [perSlug])

  const topSlugs = useMemo(
    () => Object.entries(perSlug)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([slug, e]) => ({ slug: slug as Slug, count: e.count })),
    [perSlug],
  )

  const selectedEntry = selected ? perSlug[selected] : undefined
  const selectedExercises = selectedEntry
    ? [...selectedEntry.exercises.entries()].sort((a, b) => b[1] - a[1])
    : []

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Controls: Front/Back + period */}
      <div className="flex items-center justify-between w-full max-w-[380px] gap-2 flex-wrap">
        <div className="flex gap-0.5 p-0.5 bg-cream-100 rounded-lg">
          {(['front', 'back'] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setSide(v)}
              className={`px-3 min-h-[32px] rounded-md text-xs font-semibold capitalize transition-colors ${
                side === v ? 'bg-cream-50 text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
              }`}
            >
              {v}
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
      <p className="text-xs text-ink-500 -mt-1 text-center">
        {workoutCount > 0
          ? <><strong className="text-ink-800">{workoutCount}</strong> workout{workoutCount !== 1 ? 's' : ''} · <strong className="text-ink-800">{total}</strong> exercises this {period} · tap a muscle</>
          : EMPTY_HINT[period]}
      </p>

      {/* Body — ALWAYS rendered (grey when nothing logged), on a dark panel so
          the teal→red activation colours pop (matches the reference look). */}
      <div className="relative w-full max-w-[320px] flex justify-center rounded-2xl bg-gradient-to-b from-ink-800 to-ink-950 p-4">
        {isLoading && <div className="absolute inset-0 z-10 rounded-2xl bg-ink-900/40 animate-pulse" />}
        <Body
          data={bodyData}
          side={side}
          gender="male"
          scale={1.15}
          colors={RAMP}
          defaultFill={BASE_MUSCLE_COLOR}
          border="#ffffff1f"
          onBodyPartPress={(part) => setSelected(part.slug ?? null)}
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
      {topSlugs.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5 w-full max-w-[380px]">
          {topSlugs.map(m => (
            <button
              key={m.slug}
              onClick={() => setSelected(m.slug)}
              className={`px-2.5 min-h-[28px] rounded-full text-[11px] font-medium transition-colors border ${
                selected === m.slug
                  ? 'bg-accent-500 text-white border-accent-500'
                  : 'bg-cream-50 text-ink-600 border-ink-200 hover:border-accent-300'
              }`}
            >
              {labelForSlug(m.slug)} · {m.count}
            </button>
          ))}
        </div>
      )}

      {/* Selected-muscle detail: which exercises hit it this period */}
      <div className="w-full max-w-[380px] min-h-[64px]">
        {selectedEntry ? (
          <div className="rounded-xl border border-ink-200 bg-cream-50 p-3">
            <div className="flex items-baseline justify-between mb-1.5">
              <p className="text-sm font-semibold text-ink-800">{labelForSlug(selected!)}</p>
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
