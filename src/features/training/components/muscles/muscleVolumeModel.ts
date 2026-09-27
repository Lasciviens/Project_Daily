import type { Slug } from 'react-muscle-highlighter'
import { subDays } from 'date-fns'
import { localDayOf } from '../../../../shared/utils/dateUtils'
import {
  bandForWeeklySets, creditedMuscles, labelForSlug, templateMuscleCredit, weeklySetGap,
  type Landmarks, type MuscleRole, type SlugRestriction, type WeeklySetGap,
} from '../../muscleMap'
import { balanceTotals, ratioText, readMuscleBalance, type MuscleBalance } from '../../plan/muscleBalance'
import type { AthleteLimitation } from '../../types.athlete'
import type { Tone } from '../../../../shared/ui'

// The Muscles tab's aggregation and plain-language copy — no React. Band,
// landmark scaling, set gaps and restrictions all come from muscleMap.ts, the
// same helpers Training Analysis and the AI coach read, so a muscle can't be
// "optimal" on one screen and "under-dosed" on another.

export type Period = '7d' | '30d' | '90d' | 'custom'
export const PRESETS: { id: Exclude<Period, 'custom'>; label: string; days: number }[] = [
  { id: '7d',  label: '7 days',  days: 7 },
  { id: '30d', label: '30 days', days: 30 },
  { id: '90d', label: '90 days', days: 90 },
]

/** The last `days` days ending tonight — the Muscles tab's preset window.
 *  Anything else reading "done in the last 30 days" (the Program tab's
 *  balance card) uses this too, so both share one query and one number. */
export function presetWindowIso(anchorDay: string, days: number): { fromIso: string; toIso: string } {
  const end = new Date(`${anchorDay}T23:59:59`)
  return { fromIso: subDays(end, days).toISOString(), toIso: end.toISOString() }
}

export const ROLE_LABEL: Record<MuscleRole, string> = { primary: 'Primary', secondary: 'Secondary', tertiary: 'Tertiary' }
export const ROLE_BADGE: Record<MuscleRole, string> = {
  primary:   'bg-surface-hover text-fg',
  secondary: 'bg-surface-2 text-fg-muted',
  tertiary:  'bg-surface-2 text-fg-faint',
}

// A muscle flagged by an active athlete limitation is a THIRD state, deliberately
// not one of BANDS_META's six colours. Violet reads as "train carefully", never
// as green (optimal) or red (over-MRV) — most flagged muscles are still safely
// trainable through a non-conflicting exercise, so a danger-coded colour would
// overstate the restriction. Colours come from useBandColors().flag.
export const FLAG_META: Record<'avoid' | 'limit', { label: string; desc: string }> = {
  avoid: {
    label: 'Training conservatively',
    desc: 'An active limitation restricts the movement pattern that usually loads this muscle hardest, with no easy substitute at heavy load. Still trainable — just favour exercises that respect the limitation.',
  },
  limit: {
    label: 'Flagged — see limitation',
    desc: 'An active limitation touches a movement pattern that helps train this muscle, but other patterns or isolation work can still load it safely.',
  },
}

export type Trend = 'up' | 'down' | 'flat'
export const TREND_TONE: Record<Trend, Tone> = { up: 'success', down: 'warn', flat: 'neutral' }
export const trendIcon = (t: Trend | null) => t === 'up' ? '↑' : t === 'down' ? '↓' : t === 'flat' ? '→' : ''

// One-word band status for the naked-number chips.
export const BAND_WORD = ['—', 'low', 'maintain', 'good', 'high', 'over'] as const

/** Plain-language "what to do", no MEV/MAV jargon in the main text. */
export function bandGuidance(band: number, L?: Landmarks): string {
  if (!L) return ''
  switch (band) {
    case 1: return `Likely too little to build this muscle — and maybe to hold it long-term. Aim for at least ${L.mev} sets a week to grow it.`
    case 2: return `Enough to maintain, but not to grow. Aim for ${L.mev}–${L.mav} sets a week to build it.`
    case 3: return `In the growth sweet spot (${L.mev}–${L.mav} sets a week). Keep it here.`
    case 4: return `High volume — near the most people recover from (~${L.mrv}/week). Fine short-term; watch fatigue.`
    case 5: return `More than the usual recoverable amount (~${L.mrv}/week). Only cut if you're sore, stalling, or sleeping badly.`
    default: return 'Not trained in this period.'
  }
}

export interface ExerciseHit { sets: number; credited: number; role: MuscleRole; lastDate: string; templateId: string }
export interface SlugAgg { credited: number; dates: Set<string>; directDates: Set<string>; exercises: Map<string, ExerciseHit> }
export interface VolumeRow { templateId: string; workoutId: string; workoutDate: string; workingSets: number; routineId?: string | null }
export interface Tpl { primary: Slug | null; secondaries: Slug[]; title: string }

/** Template id → the body slugs it credits (each once — templateMuscleCredit). */
export function buildTplById(
  templates: readonly { id: string; title: string; primary_muscle_group: string | null; secondary_muscle_groups?: string[] | null }[],
): Map<string, Tpl> {
  const m = new Map<string, Tpl>()
  for (const t of templates) {
    const c = templateMuscleCredit(t.primary_muscle_group, t.secondary_muscle_groups)
    m.set(t.id, { primary: c.primarySlug, secondaries: c.secondarySlugs, title: t.title })
  }
  return m
}

export interface VolumeAggregate {
  perSlug: Record<string, SlugAgg>
  unattributed: { sets: number; exercises: number }
  totalWorkingSets: number
  workoutCount: number
}

/** Volume rows from per-set history rows (warm-ups out), for a caller that
 *  holds the training history rather than the volume query — the AI coach.
 *  Days are inclusive local 'yyyy-MM-dd'. */
export function volumeRowsFromSets(
  sets: readonly { workout_id: string; date: string; exercise_template_id: string; set_type: string; routine_id?: string | null }[],
  fromDay: string,
  toDay: string,
): VolumeRow[] {
  const by = new Map<string, VolumeRow>()
  for (const s of sets) {
    if (s.set_type === 'warmup' || s.date < fromDay || s.date > toDay) continue
    const key = `${s.workout_id}|${s.exercise_template_id}`
    const row = by.get(key) ?? { templateId: s.exercise_template_id, workoutId: s.workout_id, workoutDate: `${s.date}T12:00:00`, workingSets: 0, routineId: s.routine_id ?? null }
    row.workingSets += 1
    by.set(key, row)
  }
  return [...by.values()]
}

/** Credited working sets per slug from one window's volume rows (primary 1.0,
 *  each distinct secondary 0.5 — creditedMuscles, the rule every volume
 *  screen shares). Days are LOCAL days — workoutDate is an instant, and its
 *  UTC date put a 00:30 session on the previous day. */
export function aggregateVolume(volume: readonly VolumeRow[], tplById: Map<string, Tpl>): VolumeAggregate {
  const acc: Record<string, SlugAgg> = {}
  const add = (slug: string, credit: number, day: string, title: string, ws: number, role: MuscleRole, direct: boolean, templateId: string) => {
    const e = acc[slug] ?? (acc[slug] = { credited: 0, dates: new Set(), directDates: new Set(), exercises: new Map() })
    e.credited += credit
    if (day) { e.dates.add(day); if (direct) e.directDates.add(day) }
    const prev = e.exercises.get(title)
    e.exercises.set(title, prev
      ? { sets: prev.sets + ws, credited: prev.credited + credit, role: prev.role === 'primary' ? 'primary' : role, lastDate: day > prev.lastDate ? day : prev.lastDate, templateId }
      : { sets: ws, credited: credit, role, lastDate: day, templateId })
  }
  let unattributedSets = 0
  const unattributedTitles = new Set<string>()
  const workouts = new Set<string>()
  let totalWorkingSets = 0
  for (const row of volume) {
    const t = tplById.get(row.templateId)
    if (!t) continue
    const day = localDayOf(row.workoutDate) ?? ''
    workouts.add(row.workoutId)
    totalWorkingSets += row.workingSets
    if (!t.primary) {
      unattributedSets += row.workingSets
      if (row.workingSets > 0) unattributedTitles.add(t.title)
    }
    for (const c of creditedMuscles(row.templateId, t.primary, t.secondaries)) {
      add(c.slug, row.workingSets * c.weight, day, t.title, row.workingSets, c.role, c.role === 'primary', row.templateId)
    }
  }
  return { perSlug: acc, unattributed: { sets: unattributedSets, exercises: unattributedTitles.size }, totalWorkingSets, workoutCount: workouts.size }
}

/** Everything the per-muscle card shows, computed once. */
export interface MuscleRead {
  slug: Slug
  weekly: number
  band: number
  landmarks: Landmarks | undefined
  gap: WeeklySetGap | null
  restriction: SlugRestriction<AthleteLimitation> | null
  exercises: [string, ExerciseHit][]
  dates: string[]
  sessions: number
  freqPerWeek: number
  daysSince: number | null
  trend: Trend | null
}

export interface MuscleReadContext {
  perSlug: Record<string, SlugAgg>
  priorPerSlug: Record<string, SlugAgg>
  weeks: number
  today: string
  landmarksFor: (slug: string) => Landmarks | undefined
  restrictions: Map<Slug, SlugRestriction<AthleteLimitation>>
}

const dayMs = 86_400_000
const daysBetween = (from: string, to: string) =>
  Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / dayMs)

export function weeklyOf(ctx: Pick<MuscleReadContext, 'perSlug' | 'weeks'>, slug: string): number {
  return (ctx.perSlug[slug]?.credited ?? 0) / ctx.weeks
}

export function bandOf(ctx: Pick<MuscleReadContext, 'perSlug' | 'weeks' | 'landmarksFor'>, slug: string): number {
  return bandForWeeklySets(slug, weeklyOf(ctx, slug), ctx.landmarksFor(slug))
}

/** Current weekly vs the prior equal window's weekly. Directional only. */
export function trendOf(ctx: MuscleReadContext, slug: string): Trend | null {
  const cur = weeklyOf(ctx, slug)
  const prior = (ctx.priorPerSlug[slug]?.credited ?? 0) / ctx.weeks
  if (cur === 0 && prior === 0) return null
  if (prior === 0) return cur > 0 ? 'up' : null
  const r = cur / prior
  return r > 1.25 ? 'up' : r < 0.75 ? 'down' : 'flat'
}

export function readMuscle(ctx: MuscleReadContext, slug: Slug): MuscleRead {
  const agg = ctx.perSlug[slug]
  const weekly = weeklyOf(ctx, slug)
  const landmarks = ctx.landmarksFor(slug)
  const direct = agg ? [...agg.directDates].sort() : []
  return {
    slug,
    weekly,
    band: bandForWeeklySets(slug, weekly, landmarks),
    landmarks,
    gap: weeklySetGap(weekly, landmarks),
    restriction: ctx.restrictions.get(slug) ?? null,
    exercises: agg ? [...agg.exercises.entries()].sort((a, b) => b[1].credited - a[1].credited) : [],
    dates: agg ? [...agg.dates].sort((a, b) => (a < b ? 1 : -1)) : [],
    sessions: direct.length,
    freqPerWeek: direct.length / ctx.weeks,
    daysSince: direct.length ? daysBetween(direct[direct.length - 1], ctx.today) : null,
    trend: trendOf(ctx, slug),
  }
}

export type VerdictIcon = 'down' | 'add' | 'up' | 'balance'
export interface Verdict { headline: string; bullets: { icon: VerdictIcon; text: string }[]; extra: number }

export type Balance = MuscleBalance

/** Done push:pull and quad:hamstring over the window — muscleBalance.ts's
 *  shared ratio + verdict over the same weekly numbers the body map shows. */
export function computeBalance(ctx: Pick<MuscleReadContext, 'perSlug' | 'weeks'>): Balance {
  return readMuscleBalance(balanceTotals(slug => weeklyOf(ctx, slug)))
}

export interface MajorBuckets { inGrowth: number; close: number; needWork: number }

/** The verdict banner: headline + up to 3 prioritised fixes. A restricted
 *  muscle is never told to "add sets" — its fix line names the limitation
 *  instead (same rule as Training Analysis). */
export function buildVerdict(args: {
  ctx: MuscleReadContext
  majors: Iterable<Slug>
  priorHasData: boolean
  windowDays: number
  smallSample: boolean
  balance: Balance
}): { verdict: Verdict; buckets: MajorBuckets; optimalCount: number } {
  const { ctx, priorHasData, windowDays, smallSample, balance } = args
  const under: { slug: Slug; wk: number }[] = []
  const untrained: Slug[] = []
  const buckets: MajorBuckets = { inGrowth: 0, close: 0, needWork: 0 }
  for (const slug of args.majors) {
    const b = bandOf(ctx, slug)
    if (b >= 3) buckets.inGrowth++
    else if (b === 2) buckets.close++
    else buckets.needWork++
    if (b === 0) untrained.push(slug)
    else if (b === 1 || b === 2) under.push({ slug, wk: weeklyOf(ctx, slug) })
  }
  let optimalCount = 0
  const over: { slug: string; wk: number }[] = []
  for (const slug of Object.keys(ctx.perSlug)) {
    const b = bandOf(ctx, slug)
    if (b === 3) optimalCount++
    if (b === 5) over.push({ slug, wk: weeklyOf(ctx, slug) })
  }
  under.sort((a, b) => a.wk - b.wk)
  over.sort((a, b) => b.wk - a.wk)

  // Over-MRV is a multi-week concept — don't alarm on a muscle already
  // trending DOWN (a deliberate deload). Only persistent highs make the banner.
  const persistentOver = over.filter(o => {
    if (!priorHasData) return true
    const priorWk = (ctx.priorPerSlug[o.slug]?.credited ?? 0) / ctx.weeks
    return !(priorWk > 0 && o.wk / priorWk < 0.75)
  })
  const restrictedNote = (slug: Slug) => {
    const r = ctx.restrictions.get(slug)
    return r ? `${labelForSlug(slug)} is low — your active ${r.weight} limitation reaches it, so that may be deliberate.` : null
  }
  const bullets: Verdict['bullets'] = []
  for (const o of persistentOver.slice(0, 2)) {
    const d = weeklySetGap(o.wk, ctx.landmarksFor(o.slug))
    bullets.push({ icon: 'down', text: `Ease off ${labelForSlug(o.slug)} — ${o.wk.toFixed(0)}/wk is more than most recover from${d?.kind === 'cut' ? `; if recovery's suffering, drop ~${d.sets} sets` : ''}.` })
  }
  for (const slug of untrained.slice(0, 2)) {
    bullets.push({ icon: 'add', text: restrictedNote(slug) ?? `Start training ${labelForSlug(slug)} — nothing logged this ${windowDays === 7 ? 'week' : 'period'}. Even one session helps.` })
  }
  for (const u of under.slice(0, 3)) {
    const d = weeklySetGap(u.wk, ctx.landmarksFor(u.slug))
    bullets.push({ icon: 'up', text: restrictedNote(u.slug) ?? (d?.kind === 'add'
      ? `Add ~${d.sets} sets/wk to ${labelForSlug(u.slug)} (≈ ${d.sessions === 1 ? 'one more session' : `${d.sessions} more sessions`}) to reach the growth range.`
      : `Train ${labelForSlug(u.slug)} more — ${u.wk.toFixed(1)}/wk.`) })
  }
  // Only the side worth fixing becomes a bullet — pull-heavy is rarely a
  // problem (muscleBalance.leanTone), so it stays on the balance card.
  if (balance.pushPull.lean === 'a') {
    bullets.push({ icon: 'balance', text: `You're push-heavy (${ratioText(balance.pushPull)}) — add back & biceps (pull) work.` })
  }
  const top = bullets.slice(0, 3)
  const needCount = untrained.length + under.length
  const needNames = [...untrained, ...under.map(u => u.slug)].map(labelForSlug)
  let headline: string
  if (smallSample) headline = `Light snapshot — here's your last ${windowDays} days per muscle.`
  else if (persistentOver.length) headline = `Solid work — but you're overcooking ${persistentOver.slice(0, 2).map(o => labelForSlug(o.slug)).join(' & ')}.`
  else if (buckets.inGrowth <= 1 && needCount >= 3) headline = `Just getting started — ${buckets.inGrowth} muscle${buckets.inGrowth !== 1 ? 's' : ''} in the growth range so far. Build from here.`
  else if (needCount >= 3) headline = `Decent base, but ${needCount} muscles need more for growth.`
  else if (needCount) headline = `Mostly on track — just ${needNames.join(' & ')} needs more.`
  else if (optimalCount >= 4) headline = `Dialled in — most muscles are in the growth sweet spot. Keep it up.`
  else headline = `Here's how your last ${windowDays} days stack up per muscle.`
  return { verdict: { headline, bullets: top, extra: bullets.length - top.length }, buckets, optimalCount }
}
