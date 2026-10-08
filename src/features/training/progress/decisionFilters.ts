// The decision table's filters — pure (sucrase-verified in
// scripts/verify-progress-filters.cjs), so the component only renders.
//
// Every filter narrows the open tab's list, and they combine with AND:
// search · evidence · date window · muscle · routine. Muscle and routine read
// per-exercise metadata the progress model carries next to its decisions
// (progressModel.ts: musclesByTemplateId, routineIdsByTemplateId) — neither
// changes a decision, they only choose which ones are listed.

import { labelForSlug, MAJOR_MUSCLES, type MuscleCredit, type TemplateMuscleCredit } from '../muscleMap'
import { daysAgo } from './decisionTabs'
import type { EvidenceLevel, ExerciseProgressResult } from '../progress-engine/types'

export type DateWindow = 'all' | '4w' | '8w' | '12w'
// 'all' is the whole loaded history — 6 months, never "all time".
export const DATE_WINDOWS: { id: DateWindow; label: string }[] = [
  { id: 'all', label: 'Last 6 months' },
  { id: '4w', label: 'Last 4 weeks' },
  { id: '8w', label: 'Last 8 weeks' },
  { id: '12w', label: 'Last 12 weeks' },
]
const WINDOW_WEEKS: Record<Exclude<DateWindow, 'all'>, number> = { '4w': 4, '8w': 8, '12w': 12 }

/** How an exercise trains a muscle: its primary, or one of its secondaries. */
export type MuscleRoleInExercise = MuscleCredit['role']

export interface DecisionFilters {
  query: string
  evidence: 'any' | EvidenceLevel
  window: DateWindow
  /** A body slug (muscleMap.ts), or 'any'. */
  muscle: string
  /** A current-program routine id, or 'any'. */
  routineId: string
}

export const NO_FILTERS: DecisionFilters = { query: '', evidence: 'any', window: 'all', muscle: 'any', routineId: 'any' }

/** The per-exercise metadata the filters read (ProgressData has all of it). */
export interface DecisionFilterData {
  titleById: ReadonlyMap<string, string>
  musclesByTemplateId: ReadonlyMap<string, TemplateMuscleCredit>
  routineIdsByTemplateId: ReadonlyMap<string, readonly string[]>
  today: string
}

export function filtersActive(f: DecisionFilters): boolean {
  return f.query.trim() !== '' || f.evidence !== 'any' || f.window !== 'all' || f.muscle !== 'any' || f.routineId !== 'any'
}

/** 'primary' when `slug` is the exercise's primary muscle, 'secondary' when
 *  it is one of its secondaries (templateMuscleCredit already dropped a
 *  secondary equal to the primary — lats + upper back are one Back), else null. */
export function muscleRoleFor(credit: TemplateMuscleCredit | undefined, slug: string): MuscleRoleInExercise | null {
  if (!credit) return null
  if (credit.primarySlug === slug) return 'primary'
  return (credit.secondarySlugs as readonly string[]).includes(slug) ? 'secondary' : null
}

export interface MuscleOption { slug: string; label: string; major: boolean }

/** Every muscle at least one listed exercise trains, as its primary or a
 *  secondary: the main muscles (MAJOR_MUSCLES) first, then the rest, each
 *  A–Z by label. Built from every decision, not the open tab's, so a picked
 *  muscle stays put when the tab changes. */
export function muscleOptions(
  decisions: readonly ExerciseProgressResult[],
  musclesByTemplateId: ReadonlyMap<string, TemplateMuscleCredit>,
): MuscleOption[] {
  const slugs = new Set<string>()
  for (const d of decisions) {
    const credit = musclesByTemplateId.get(d.exerciseTemplateId)
    if (!credit) continue
    if (credit.primarySlug) slugs.add(credit.primarySlug)
    for (const s of credit.secondarySlugs) slugs.add(s)
  }
  return [...slugs]
    .map(slug => ({ slug, label: labelForSlug(slug), major: (MAJOR_MUSCLES as ReadonlySet<string>).has(slug) }))
    .sort((a, b) => Number(b.major) - Number(a.major) || a.label.localeCompare(b.label))
}

export interface RoutineOption { id: string; label: string }

/** The current program's routines that hold at least one listed exercise, in
 *  the order given (the routine list's — the Program tab's order). Two
 *  routines with the same name stay apart: "Full body", "Full body (2)". */
export function routineOptions(
  decisions: readonly ExerciseProgressResult[],
  routines: readonly { id: string; title: string }[],
  routineIdsByTemplateId: ReadonlyMap<string, readonly string[]>,
): RoutineOption[] {
  const used = new Set<string>()
  for (const d of decisions) for (const id of routineIdsByTemplateId.get(d.exerciseTemplateId) ?? []) used.add(id)
  const seen = new Map<string, number>()
  return routines.filter(r => used.has(r.id)).map(r => {
    const name = r.title.trim() || 'Untitled routine'
    const n = (seen.get(name) ?? 0) + 1
    seen.set(name, n)
    return { id: r.id, label: n === 1 ? name : `${name} (${n})` }
  })
}

/** One routine leaves nothing to choose between (every listed exercise is
 *  in it), so the Routine filter only shows from two. */
export function showsRoutineFilter(routines: readonly RoutineOption[]): boolean {
  return routines.length > 1
}

/** The filters that actually apply: a picked muscle or routine that is no
 *  longer offered (the program or its exercises changed) filters nothing,
 *  and the select shows Any again instead of an invisible filter. */
export function effectiveFilters(f: DecisionFilters, muscles: readonly MuscleOption[], routines: readonly RoutineOption[]): DecisionFilters {
  const muscle = f.muscle !== 'any' && muscles.some(m => m.slug === f.muscle) ? f.muscle : 'any'
  const routineId = f.routineId !== 'any' && showsRoutineFilter(routines) && routines.some(r => r.id === f.routineId) ? f.routineId : 'any'
  return muscle === f.muscle && routineId === f.routineId ? f : { ...f, muscle, routineId }
}

/** The latest session falls inside the window ('all' = every loaded week).
 *  An exercise with no session date is never hidden by the window. */
export function withinDateWindow(result: ExerciseProgressResult, window: DateWindow, today: string): boolean {
  if (window === 'all') return true
  const latestDate = result.currentState.latest?.date
  if (!latestDate) return true
  return latestDate >= daysAgo(today, WINDOW_WEEKS[window] * 7)
}

/** The decisions every filter keeps (AND), in the order given. */
export function applyDecisionFilters(
  list: readonly ExerciseProgressResult[],
  f: DecisionFilters,
  data: DecisionFilterData,
): ExerciseProgressResult[] {
  const q = f.query.trim().toLowerCase()
  return list.filter(d => {
    const id = d.exerciseTemplateId
    if (q && !(data.titleById.get(id) ?? '').toLowerCase().includes(q)) return false
    if (f.evidence !== 'any' && d.evidence.progress !== f.evidence) return false
    if (f.muscle !== 'any' && !muscleRoleFor(data.musclesByTemplateId.get(id), f.muscle)) return false
    if (f.routineId !== 'any' && !(data.routineIdsByTemplateId.get(id) ?? []).includes(f.routineId)) return false
    return withinDateWindow(d, f.window, data.today)
  })
}
