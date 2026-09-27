// Planned weekly volume per muscle for the CURRENT program, the push:pull and
// quad:hamstring balance, and a short plain-language read of each — pure
// (runtime imports only from muscleMap, itself pure), sucrase-tested by
// scripts/verify-training-plan.cjs.
//
// Science (docs/training-health/research/research-science.json, fact-checked
// in verify-science.json):
//  - Sets are counted "fractionally": 1.0 for the exercise's primary muscle,
//    0.5 for each secondary. That counting fitted best in the largest
//    dose-response meta-regression (Pelland 2025, Sports Med; 67 studies).
//  - Pelland's hypertrophy tiers: <4 sets/week is below the minimum effective
//    dose; 5–10, 11–18, 19–29, 30–42 are progressively LESS efficient per
//    extra set (diminishing returns, no clear plateau). ACSM 2026 (Currier):
//    ≥10 sets/week enhances hypertrophy. A 10–20 target suits most
//    recreational lifters (Baz-Valle 2022 for trained men: 12–20).
//  - MEV/MAV/MRV (Renaissance Periodization) are PRACTITIONER heuristics, not
//    trial-derived; they are shown next to the tiers and labelled as such.
//  - Push:pull ~1:1 and hamstring ≥0.5× quad are heuristics with no trial
//    support as thresholds (Kolber 2009 observed shoulder imbalances in
//    recreational lifters; van Dyk 2019: programmes with the Nordic hamstring
//    curl roughly halved hamstring injuries in athletes).

import {
  MUSCLE_LANDMARKS, BANDS_META, MAJOR_MUSCLES, bandForWeeklySets, contribution, labelForSlug,
  scaleLandmarksForExperience, slugForHevyGroup, type Landmarks,
} from '../muscleMap'
import type { ExperienceLevel, MusclePreference } from '../types.athlete'
import type { Tone } from '../../../shared/ui/Tone'

export interface ProgramRoutineInput {
  id: string
  title: string
  exercises: readonly {
    exercise_template_id: string
    title: string
    sets: readonly { type: string }[]
  }[]
}

export interface TemplateMuscles { primary: string | null; secondary: readonly string[] }

export interface MuscleSource { exerciseTitle: string; routineTitle: string; sets: number; role: 'primary' | 'secondary' }

export interface PlannedMuscle {
  slug: string
  label: string
  /** Fractional sets per week (primary 1.0 + secondary 0.5 each). */
  weeklySets: number
  /** Primary-muscle ("direct") sets per week. */
  directSets: number
  sources: MuscleSource[]
}

function round1(n: number): number { return Math.round(n * 10) / 10 }

/** Working sets a routine exercise prescribes (warm-ups excluded; dropsets
 *  count, as in Pelland's counting). */
export function workingSetCount(sets: readonly { type: string }[]): number {
  return sets.filter(s => s.type !== 'warmup').length
}

/** How many times a week each routine runs. With a weekly training-days
 *  target (or the number of weekdays your recurring training blocks cover)
 *  and N routines, each runs days ÷ N times; otherwise once. */
export function passesPerWeek(trainingDays: number | null | undefined, routineCount: number): number {
  if (!trainingDays || trainingDays <= 0 || routineCount <= 0) return 1
  return Math.round((trainingDays / routineCount) * 100) / 100
}

/** Planned fractional sets per muscle per week, from the routines' own
 *  prescriptions. Muscles are body slugs (muscleMap). */
export function plannedWeeklySets(
  routines: readonly ProgramRoutineInput[],
  templateMuscles: ReadonlyMap<string, TemplateMuscles>,
  passes = 1,
): PlannedMuscle[] {
  const by = new Map<string, PlannedMuscle>()
  const add = (slug: string, sets: number, src: MuscleSource) => {
    const cur = by.get(slug) ?? { slug, label: labelForSlug(slug), weeklySets: 0, directSets: 0, sources: [] }
    cur.weeklySets += sets
    if (src.role === 'primary') cur.directSets += sets
    cur.sources.push(src)
    by.set(slug, cur)
  }
  for (const r of routines) {
    for (const ex of r.exercises) {
      const n = workingSetCount(ex.sets) * passes
      if (n === 0) continue
      const m = templateMuscles.get(ex.exercise_template_id)
      if (!m) continue
      const primary = slugForHevyGroup(m.primary)
      if (primary) add(primary, n * contribution(ex.exercise_template_id, primary, 'primary'), { exerciseTitle: ex.title, routineTitle: r.title, sets: n, role: 'primary' })
      for (const sec of m.secondary) {
        const slug = slugForHevyGroup(sec)
        if (!slug || slug === primary) continue
        add(slug, n * contribution(ex.exercise_template_id, slug, 'secondary'), { exerciseTitle: ex.title, routineTitle: r.title, sets: n, role: 'secondary' })
      }
    }
  }
  return [...by.values()]
    .map(m => ({ ...m, weeklySets: round1(m.weeklySets), directSets: round1(m.directSets) }))
    .sort((a, b) => b.weeklySets - a.weeklySets || a.slug.localeCompare(b.slug))
}

// ── Pelland 2025 hypertrophy tiers (Table 3) ────────────────────────────────
export type VolumeTier = 'below_med' | 'med' | 'high_eff' | 'intermediate' | 'lower_eff' | 'lowest_eff' | 'no_data'

export const TIER_LABEL: Record<VolumeTier, string> = {
  below_med:    'Below minimum dose',
  med:          'Minimum effective dose',
  high_eff:     'Most efficient range',
  intermediate: 'Intermediate',
  lower_eff:    'Lower efficiency',
  lowest_eff:   'Lowest efficiency',
  no_data:      'Beyond studied range',
}

export function tierFor(weeklySets: number): VolumeTier {
  if (weeklySets < 4) return 'below_med'
  if (weeklySets < 5) return 'med'
  if (weeklySets < 11) return 'high_eff'
  if (weeklySets < 19) return 'intermediate'
  if (weeklySets < 30) return 'lower_eff'
  if (weeklySets < 43) return 'lowest_eff'
  return 'no_data'
}

export const RECOMMENDED_RANGE = { min: 10, max: 20 } as const

export type MuscleStatus = 'excluded' | 'restricted' | 'below_med' | 'under' | 'in_range' | 'high' | 'very_high' | 'untrained'

export interface MuscleRead {
  slug: string
  label: string
  weeklySets: number
  directSets: number
  tier: VolumeTier
  status: MuscleStatus
  /** RP band (heuristic), experience-scaled — idx into BANDS_META. */
  rpBand: number
  rpBandLabel: string
  landmarks: Landmarks | null
  priority: boolean
  excludeDirect: boolean
  restriction: 'avoid' | 'limit' | null
  advice: string
  /** Sets/week that would reach the next useful point (MED or 10), or null. */
  setsToAdd: number | null
}

/** One muscle's planned dose read against the science, respecting the
 *  athlete's preferences and restrictions: an excluded muscle never gets a
 *  "no direct work" nag, a restricted one is never told to add volume. */
export function readMuscle(
  m: Pick<PlannedMuscle, 'slug' | 'label' | 'weeklySets' | 'directSets'>,
  ctx: { preference: MusclePreference | null; restriction: 'avoid' | 'limit' | null; experience: ExperienceLevel | null },
): MuscleRead {
  const base = MUSCLE_LANDMARKS[m.slug]
  const landmarks = base ? scaleLandmarksForExperience(base, ctx.experience) : null
  const rpBand = bandForWeeklySets(m.slug, m.weeklySets, landmarks ?? undefined)
  const priority = ctx.preference === 'priority'
  const excludeDirect = ctx.preference === 'exclude_direct'
  const tier = tierFor(m.weeklySets)
  const s = m.weeklySets
  let status: MuscleStatus
  let advice: string
  let setsToAdd: number | null = null

  if (excludeDirect && m.directSets === 0) {
    status = 'excluded'
    advice = s > 0
      ? `Direct work excluded by your preference — ${s} sets/week still come from other exercises.`
      : 'Direct work excluded by your preference.'
  } else if (ctx.restriction && s < RECOMMENDED_RANGE.min) {
    status = 'restricted'
    advice = `Low, but an active “${ctx.restriction}” limitation reaches this muscle — likely deliberate, nothing to add.`
  } else if (s === 0) {
    status = 'untrained'
    setsToAdd = 4
    advice = priority
      ? 'Priority muscle with no planned sets — add at least 4 a week (the minimum effective dose).'
      : 'No planned sets.'
  } else if (s < 4) {
    status = 'below_med'
    setsToAdd = round1(4 - s)
    advice = `Below the minimum effective dose of 4 sets/week — about ${setsToAdd} more would reach it.`
  } else if (s < RECOMMENDED_RANGE.min) {
    status = 'under'
    if (priority) {
      setsToAdd = round1(RECOMMENDED_RANGE.min - s)
      advice = `Priority muscle: below the ~10 sets/week linked to more growth — about ${setsToAdd} more sets.`
    } else {
      advice = 'Enough to grow; more sets add a little more, with diminishing returns.'
    }
  } else if (s <= RECOMMENDED_RANGE.max) {
    status = 'in_range'
    advice = 'Inside the 10–20 sets/week most recreational lifters target.'
  } else if (s < 30) {
    status = 'high'
    advice = 'Above 20 — more can still help a little, at a rising cost in fatigue and time.'
  } else {
    status = 'very_high'
    advice = 'Very high — each extra set buys the least here; keep an eye on recovery.'
  }

  return {
    slug: m.slug, label: m.label, weeklySets: s, directSets: m.directSets, tier, status,
    rpBand, rpBandLabel: BANDS_META[rpBand]?.label ?? '', landmarks, priority, excludeDirect,
    restriction: ctx.restriction, advice, setsToAdd,
  }
}

/** Every muscle worth showing: the ten major muscles (even at 0 sets), any
 *  other muscle the program trains, and any priority muscle. */
export function readProgramMuscles(
  planned: readonly PlannedMuscle[],
  ctx: {
    preferences: ReadonlyMap<string, MusclePreference>
    restrictions: ReadonlyMap<string, 'avoid' | 'limit'>
    experience: ExperienceLevel | null
  },
): MuscleRead[] {
  const bySlug = new Map(planned.map(p => [p.slug, p]))
  const slugs = new Set<string>([...MAJOR_MUSCLES, ...planned.filter(p => p.weeklySets > 0).map(p => p.slug), ...[...ctx.preferences.entries()].filter(([, v]) => v === 'priority').map(([k]) => k)])
  return [...slugs].map(slug => {
    const p = bySlug.get(slug) ?? { slug, label: labelForSlug(slug), weeklySets: 0, directSets: 0 }
    return readMuscle(p, { preference: ctx.preferences.get(slug) ?? null, restriction: ctx.restrictions.get(slug) ?? null, experience: ctx.experience })
  }).sort((a, b) => Number(b.priority) - Number(a.priority) || b.weeklySets - a.weeklySets || a.label.localeCompare(b.label))
}

// ── Balance ────────────────────────────────────────────────────────────────
export const PUSH_SLUGS = ['chest', 'deltoids', 'triceps'] as const
export const PULL_SLUGS = ['upper-back', 'trapezius', 'biceps'] as const

export interface BalanceRead {
  push: number
  pull: number
  /** push ÷ pull, null when one side has no sets. */
  pushPullRatio: number | null
  pushPullFlag: 'push_heavy' | 'pull_heavy' | null
  quad: number
  ham: number
  /** hamstring ÷ quad, null without quad sets. */
  hamQuadRatio: number | null
  hamQuadFlag: boolean
  hasKneeFlexion: boolean
  notes: string[]
}

const KNEE_FLEXION_RE = /nordic|(leg|lying|seated|hamstring|standing|glute[- ]?ham)[\s-]*curl|\bghr\b/i

export function isKneeFlexionExercise(title: string): boolean {
  return KNEE_FLEXION_RE.test(title)
}

export function readBalance(
  planned: readonly PlannedMuscle[],
  exerciseTitles: readonly string[],
  restrictions: ReadonlyMap<string, 'avoid' | 'limit'> = new Map(),
): BalanceRead {
  const sets = (slug: string) => planned.find(p => p.slug === slug)?.weeklySets ?? 0
  const push = round1(PUSH_SLUGS.reduce((s, k) => s + sets(k), 0))
  const pull = round1(PULL_SLUGS.reduce((s, k) => s + sets(k), 0))
  const quad = sets('quadriceps')
  const ham = sets('hamstring')
  const pushPullRatio = push > 0 && pull > 0 ? Math.round((push / pull) * 100) / 100 : null
  let pushPullFlag: BalanceRead['pushPullFlag'] = null
  if (push > 0 && pull === 0) pushPullFlag = 'push_heavy'
  else if (pull > 0 && push === 0) pushPullFlag = 'pull_heavy'
  else if (pushPullRatio != null && pushPullRatio > 1.5) pushPullFlag = 'push_heavy'
  else if (pushPullRatio != null && pushPullRatio < 0.67) pushPullFlag = 'pull_heavy'
  const hamQuadRatio = quad > 0 ? Math.round((ham / quad) * 100) / 100 : null
  const hamQuadFlag = hamQuadRatio != null && hamQuadRatio < 0.5
  const hasKneeFlexion = exerciseTitles.some(isKneeFlexionExercise)

  const restricted = (slugs: readonly string[]) => slugs.some(s => restrictions.get(s) === 'avoid')
  const notes: string[] = []
  if (pushPullFlag === 'push_heavy') {
    notes.push(restricted(PULL_SLUGS)
      ? 'More pushing than pulling — an active limitation on pulling may explain it.'
      : 'More pushing than pulling planned. Adding a row or pulldown brings it closer to 1:1.')
  } else if (pushPullFlag === 'pull_heavy') {
    notes.push(restricted(PUSH_SLUGS)
      ? 'More pulling than pushing — an active limitation on pressing may explain it.'
      : 'More pulling than pushing planned. That is rarely a problem; add a press if you want it even.')
  }
  if (hamQuadFlag) {
    notes.push(restricted(['hamstring'])
      ? 'Hamstrings get under half the quad sets — an active limitation may explain it.'
      : 'Hamstrings get under half the quad sets. A hinge or a curl evens it out.')
  }
  if (!hasKneeFlexion && (quad > 0 || ham > 0)) {
    notes.push('No knee-flexion hamstring exercise (a leg curl or Nordic curl) in the program.')
  }
  return { push, pull, pushPullRatio, pushPullFlag, quad, ham, hamQuadRatio, hamQuadFlag, hasKneeFlexion, notes }
}

/** Status tone for a muscle read — never "harmful" for high volume. */
export const MUSCLE_STATUS_TONE: Record<MuscleStatus, Tone> = {
  excluded:   'neutral',
  restricted: 'highlight',
  untrained:  'neutral',
  below_med:  'warn',
  under:      'info',
  in_range:   'success',
  high:       'info',
  very_high:  'warn',
}
