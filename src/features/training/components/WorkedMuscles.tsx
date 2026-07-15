import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  subDays, formatDistanceToNow, format,
} from 'date-fns'
import Body, { type ExtendedBodyPart, type Slug } from 'react-muscle-highlighter'
import { useHevyExerciseTemplates } from '../hooks/useHevyExerciseTemplates'
import { useHevyWorkouts } from '../hooks/useHevyWorkouts'
import { fetchWorkoutExerciseTemplateIds, fetchWorkoutsWithTemplateIds } from '../api/hevyApi'
import { slugForHevyGroup, RAMP, BANDS, BASE_MUSCLE_COLOR, labelForSlug, SIDE_SLUGS } from '../muscleMap'

// ─────────────────────────────────────────────────────────────────────────────
//  "Worked muscles" — a stylised front/back body (react-muscle-highlighter).
//  • No selection → heat-map of everything worked in the period (intensity ramp).
//  • Tap muscle(s) / chip(s) → multi-select: ONLY the selected muscles stay
//    coloured, and the right panel shows, per muscle: exercises this period,
//    when it was last trained, and the history of days it was trained.
//  • Front/Back switches the body AND filters the stats to that side.
//  Every Hevy primary_muscle_group maps to a slug via muscleMap's HEVY_TO_SLUG.
// ─────────────────────────────────────────────────────────────────────────────

type Period = 'day' | 'week' | 'month'

const PERIODS: { id: Period; label: string }[] = [
  { id: 'day',   label: 'Day'   },
  { id: 'week',  label: 'Week'  },
  { id: 'month', label: 'Month' },
]

const HISTORY_DAYS = 180  // how far back "last trained" / history looks

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
  const [selected, setSelected] = useState<Set<Slug>>(new Set())

  const now = new Date()
  const { from, to } = rangeFor(period, now)
  const historyFrom = subDays(now, HISTORY_DAYS).toISOString()

  const { data: templates = [] } = useHevyExerciseTemplates()
  const { data: recentWorkouts = [] } = useHevyWorkouts({ limit: 1 })
  const lastAt = recentWorkouts[0]?.start_time ?? recentWorkouts[0]?.hevy_created_at ?? null

  const { data: worked, isLoading } = useQuery({
    queryKey: ['hevy', 'muscle-map', period, from, to],
    queryFn:  () => fetchWorkoutExerciseTemplateIds(from, to),
    staleTime: 5 * 60_000,
  })

  // Longer window, per-workout, for "last trained" + history.
  const { data: history = [] } = useQuery({
    queryKey: ['hevy', 'muscle-history', historyFrom],
    queryFn:  () => fetchWorkoutsWithTemplateIds(historyFrom, now.toISOString()),
    staleTime: 5 * 60_000,
  })

  const workoutCount = worked?.workoutCount ?? 0

  // template id → { slug, title }
  const metaById = useMemo(() => {
    const m = new Map<string, { slug: Slug; title: string }>()
    for (const t of templates) {
      const slug = slugForHevyGroup(t.primary_muscle_group)
      if (slug) m.set(t.id, { slug, title: t.title })
    }
    return m
  }, [templates])

  // Per slug (this period): total exercise-instances + distinct exercise names.
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

  const maxCount = useMemo(() => Math.max(1, ...Object.values(perSlug).map(e => e.count)), [perSlug])
  const bandOf = (count: number) => Math.max(1, Math.ceil((count / maxCount) * BANDS))

  // Per slug (history window): the days it was trained (newest-first).
  const historyBySlug = useMemo(() => {
    const m = new Map<Slug, string[]>()
    for (const w of history) {
      const slugs = new Set<Slug>()
      for (const id of w.templateIds) {
        const meta = metaById.get(id)
        if (meta) slugs.add(meta.slug)
      }
      for (const s of slugs) {
        const arr = m.get(s) ?? []
        arr.push(w.date)
        m.set(s, arr)
      }
    }
    return m
  }, [history, metaById])

  // Body colouring: heat-map when nothing selected; otherwise ONLY the selected.
  const bodyData = useMemo<ExtendedBodyPart[]>(() => {
    if (selected.size === 0) {
      return Object.entries(perSlug).map(([slug, e]) => ({ slug: slug as Slug, intensity: bandOf(e.count) }))
    }
    return [...selected].map(slug => {
      const e = perSlug[slug]
      return e ? { slug, intensity: bandOf(e.count) } : { slug, color: '#38bdf8' }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [perSlug, selected, maxCount])

  // Chips: worked muscles on the CURRENT side, most-worked first.
  const sideChips = useMemo(
    () => Object.entries(perSlug)
      .filter(([slug]) => SIDE_SLUGS[side].has(slug as Slug))
      .sort((a, b) => b[1].count - a[1].count)
      .map(([slug, e]) => ({ slug: slug as Slug, count: e.count })),
    [perSlug, side],
  )

  function toggle(slug: Slug | null | undefined) {
    if (!slug) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug); else next.add(slug)
      return next
    })
  }

  const selectedList = [...selected]

  return (
    <div className="flex flex-col lg:flex-row gap-5 lg:gap-8 w-full items-start">
      {/* ── LEFT: the body ─────────────────────────────────────────────── */}
      <div className="w-full lg:w-[400px] shrink-0 flex flex-col items-center gap-3">
        <div className="flex items-center gap-2">
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
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="min-h-[36px] px-3 text-xs font-medium text-ink-500 hover:text-ink-800 rounded-md hover:bg-cream-100 transition-colors"
            >
              Clear ({selected.size})
            </button>
          )}
        </div>

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
              onBodyPartPress={(part) => toggle(part.slug)}
            />
          </div>
        </div>

        {total > 0 && selected.size === 0 && (
          <div className="flex items-center gap-1.5 text-[10px] text-ink-400">
            <span>Less</span>
            {RAMP.map(c => <span key={c} className="w-4 h-2.5 rounded-sm" style={{ backgroundColor: c }} />)}
            <span>More</span>
          </div>
        )}
        <p className="text-[11px] text-ink-400 text-center">
          {selected.size > 0 ? 'Tap muscles to add/remove · tap Clear to reset' : 'Tap muscles to inspect (multi-select)'}
        </p>
      </div>

      {/* ── RIGHT: stats ───────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 w-full flex flex-col gap-4">
        {lastAt && (
          <div className="flex items-baseline gap-2 rounded-xl bg-cream-100 px-3.5 py-2.5">
            <span className="text-xs text-ink-400">🏋️ Last workout</span>
            <span className="text-sm font-semibold text-ink-800">
              {formatDistanceToNow(new Date(lastAt), { addSuffix: true })}
            </span>
            <span className="text-xs text-ink-400 ml-auto">{format(new Date(lastAt), 'EEE d MMM, HH:mm')}</span>
          </div>
        )}

        <div className="flex gap-0.5 p-0.5 bg-cream-100 rounded-lg w-fit">
          {PERIODS.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              className={`px-4 min-h-[36px] rounded-md text-sm font-semibold transition-colors ${
                period === p.id ? 'bg-cream-50 text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-800'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <p className="text-sm text-ink-500">
          {workoutCount > 0
            ? <><strong className="text-ink-800">{workoutCount}</strong> workout{workoutCount !== 1 ? 's' : ''} · <strong className="text-ink-800">{total}</strong> exercises this {period}</>
            : EMPTY_HINT[period]}
        </p>

        {/* Chips for the current side */}
        {sideChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {sideChips.map(m => (
              <button
                key={m.slug}
                onClick={() => toggle(m.slug)}
                className={`px-3 min-h-[32px] rounded-full text-xs font-medium transition-colors border ${
                  selected.has(m.slug)
                    ? 'bg-accent-500 text-white border-accent-500'
                    : 'bg-cream-50 text-ink-600 border-ink-200 hover:border-accent-300'
                }`}
              >
                {labelForSlug(m.slug)} · {m.count}
              </button>
            ))}
          </div>
        )}

        {/* Selected muscle detail cards (multi) */}
        {selectedList.length > 0 ? (
          <div className="flex flex-col gap-3">
            {selectedList.map(slug => {
              const e = perSlug[slug]
              const exercises = e ? [...e.exercises.entries()].sort((a, b) => b[1] - a[1]) : []
              const days = historyBySlug.get(slug) ?? []
              const last = days[0]
              return (
                <div key={slug} className="rounded-xl border border-ink-200 bg-cream-50 p-4">
                  <div className="flex items-baseline justify-between mb-2 gap-2">
                    <p className="text-base font-semibold text-ink-800">{labelForSlug(slug)}</p>
                    <p className="text-xs text-ink-400 shrink-0">
                      {last ? <>last trained <strong className="text-ink-700">{formatDistanceToNow(new Date(last), { addSuffix: true })}</strong></> : 'not trained in 6 months'}
                    </p>
                  </div>

                  {exercises.length > 0 && (
                    <>
                      <p className="text-[11px] uppercase tracking-wide text-ink-400 mb-1">Exercises this {period}</p>
                      <ul className="flex flex-col gap-1 mb-3">
                        {exercises.map(([name, c]) => (
                          <li key={name} className="flex items-center justify-between gap-2 text-sm">
                            <span className="text-ink-700 truncate">{name}</span>
                            <span className="text-ink-400 shrink-0">×{c}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  <p className="text-[11px] uppercase tracking-wide text-ink-400 mb-1">
                    History <span className="normal-case">(last 6 months · {days.length}×)</span>
                  </p>
                  {days.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {days.slice(0, 12).map((d, i) => (
                        <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-cream-100 text-ink-600">
                          {format(new Date(d), 'd MMM')}
                        </span>
                      ))}
                      {days.length > 12 && <span className="text-[11px] text-ink-400 px-1 py-0.5">+{days.length - 12}</span>}
                    </div>
                  ) : (
                    <p className="text-xs text-ink-400">No sessions in the last 6 months.</p>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-ink-400 py-2">
            {total > 0
              ? 'Tap a muscle on the body (or a chip) to see its exercises, when you last trained it, and its history.'
              : 'Log a workout and sync — your worked muscles light up here.'}
          </p>
        )}
      </div>
    </div>
  )
}
