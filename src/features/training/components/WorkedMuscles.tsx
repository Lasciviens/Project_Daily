import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  formatDistanceToNow, format,
} from 'date-fns'
import Body, { type ExtendedBodyPart, type Slug } from 'react-muscle-highlighter'
import { useHevyExerciseTemplates } from '../hooks/useHevyExerciseTemplates'
import { useHevyWorkouts } from '../hooks/useHevyWorkouts'
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
  // Most recent workout — for the "last trained" line.
  const { data: recentWorkouts = [] } = useHevyWorkouts({ limit: 1 })
  const lastAt = recentWorkouts[0]?.start_time ?? recentWorkouts[0]?.hevy_created_at ?? null

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
    <div className="flex flex-col lg:flex-row gap-5 lg:gap-8 w-full items-start">
      {/* ── LEFT: the body, standalone + large ─────────────────────────── */}
      <div className="w-full lg:w-[400px] shrink-0 flex flex-col items-center gap-3">
        {/* Front/Back toggle */}
        <div className="flex gap-0.5 p-0.5 bg-cream-100 rounded-lg">
          {(['front', 'back'] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setSide(v)}
              className={`px-4 min-h-[36px] rounded-md text-sm font-semibold capitalize transition-colors ${
                side === v ? 'bg-cream-50 text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {/* Body — ALWAYS rendered (grey when nothing logged), on a dark panel
            so the teal→red activation colours pop. The inner <svg> is forced to
            fill the container width (it otherwise renders at a small fixed px
            size), so the body is large. */}
        <div className="relative w-full flex justify-center rounded-2xl bg-gradient-to-b from-ink-800 to-ink-950 p-5">
          {isLoading && <div className="absolute inset-0 z-10 rounded-2xl bg-ink-900/40 animate-pulse" />}
          <div className="w-full max-w-[340px] [&>svg]:w-full [&>svg]:h-auto">
            <Body
              data={bodyData}
              side={side}
              gender="male"
              scale={1}
              colors={RAMP}
              defaultFill={BASE_MUSCLE_COLOR}
              border="#ffffff1f"
              onBodyPartPress={(part) => setSelected(part.slug ?? null)}
            />
          </div>
        </div>

        {/* Intensity legend */}
        {total > 0 && (
          <div className="flex items-center gap-1.5 text-[10px] text-ink-400">
            <span>Less</span>
            {RAMP.map(c => <span key={c} className="w-4 h-2.5 rounded-sm" style={{ backgroundColor: c }} />)}
            <span>More</span>
          </div>
        )}
      </div>

      {/* ── RIGHT: stats ───────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 w-full flex flex-col gap-4">
        {/* Last workout */}
        {lastAt && (
          <div className="flex items-baseline gap-2 rounded-xl bg-cream-100 px-3.5 py-2.5">
            <span className="text-xs text-ink-400">🏋️ Last workout</span>
            <span className="text-sm font-semibold text-ink-800">
              {formatDistanceToNow(new Date(lastAt), { addSuffix: true })}
            </span>
            <span className="text-xs text-ink-400 ml-auto">{format(new Date(lastAt), 'EEE d MMM, HH:mm')}</span>
          </div>
        )}

        {/* Period selector */}
        <div className="flex gap-0.5 p-0.5 bg-cream-100 rounded-lg w-fit">
          {PERIODS.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => { setPeriod(p.id); setSelected(null) }}
              className={`px-4 min-h-[36px] rounded-md text-sm font-semibold transition-colors ${
                period === p.id ? 'bg-cream-50 text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Summary line */}
        <p className="text-sm text-ink-500">
          {workoutCount > 0
            ? <><strong className="text-ink-800">{workoutCount}</strong> workout{workoutCount !== 1 ? 's' : ''} · <strong className="text-ink-800">{total}</strong> exercises this {period} · tap a muscle</>
            : EMPTY_HINT[period]}
        </p>

        {/* Top-worked chips */}
        {topSlugs.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {topSlugs.map(m => (
              <button
                key={m.slug}
                onClick={() => setSelected(m.slug)}
                className={`px-3 min-h-[32px] rounded-full text-xs font-medium transition-colors border ${
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
        <div className="min-h-[64px]">
          {selectedEntry ? (
            <div className="rounded-xl border border-ink-200 bg-cream-50 p-4">
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-base font-semibold text-ink-800">{labelForSlug(selected!)}</p>
                <p className="text-xs text-ink-400">
                  {selectedExercises.length} exercise{selectedExercises.length !== 1 ? 's' : ''} · {selectedEntry.count} time{selectedEntry.count !== 1 ? 's' : ''}
                </p>
              </div>
              <ul className="flex flex-col gap-1.5">
                {selectedExercises.map(([name, c]) => (
                  <li key={name} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-ink-700 truncate">{name}</span>
                    <span className="text-ink-400 shrink-0">×{c}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-ink-400 py-4">
              {total > 0
                ? 'Tap a highlighted muscle (or a chip) to see which exercises hit it.'
                : 'Log a workout and sync — your worked muscles light up here.'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
