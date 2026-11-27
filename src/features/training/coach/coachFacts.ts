import { actionLabel, workloadLabel } from '../progress-engine'
import { labelForSlug } from '../muscleMap'
import { leanLabel, PAIR_META, ratioText, type BalancePair } from '../plan/muscleBalance'
import { nextTargetText, type CoachData } from './coachFormat'
import { mondayOfStr, shiftDateStr } from '../../../shared/utils/dateUtils'

// ─────────────────────────────────────────────────────────────────────────────
//  The PT assessment's decisions, made by code (AI last, docs/features/ai.md).
//
//  What the daily assessment used to leave to the model, "is today a rest day?", "is a muscle past its ceiling?",
//  "which one lift comes first?", is an if-then on the numbers the app already has. So code decides it here, and the
//  `coach_assessment` job gets the verdicts as figures to explain, next to the snapshot (formatPtSnapshot) they
//  came from. The model's part is what code cannot do: read the owner's own words (pain, motivation), pick what to
//  say first, and write a few calm sentences that follow the verdicts (never against them).
//
//  The thresholds are the PT rules' own (sleep under 6 h trims a session, under 5 h twice running is a rest day); the
//  deload cue follows S31 in docs/training/science.md — offered, never forced — and high weekly volume alone is never
//  one (S18: high volume is not an error). Each threshold is one constant below. Pure: no React, no I/O
//  (scripts/verify-coach-context.cjs).
// ─────────────────────────────────────────────────────────────────────────────

/** The four feelings the screen offers. These English words are the stored values of `pt_assessments.feeling`. */
export const PT_FEELINGS = ['undertrained', 'normal', 'tired', 'very tired'] as const
export type PtFeeling = typeof PT_FEELINGS[number]

/**
 * Rows saved before 22.11.2026 hold the Turkish words (everything saved is English since the owner's rule of that
 * day). Reads accept both; new writes are English. Remove once the owner has run the one-off conversion in
 * docs/deploy-checklist.md.
 */
const LEGACY_FEELINGS: Record<string, PtFeeling> = { 'az çalıştım': 'undertrained', yorgunum: 'tired', 'çok yorgunum': 'very tired' }

/** A stored feeling as one of the four English words; a word nobody knows stays as it is (null: not a feeling). */
export function feelingOf(stored: unknown): PtFeeling | null {
  if (typeof stored !== 'string') return null
  if ((PT_FEELINGS as readonly string[]).includes(stored)) return stored as PtFeeling
  return Object.prototype.hasOwnProperty.call(LEGACY_FEELINGS, stored) ? LEGACY_FEELINGS[stored] : null
}

export const SHORT_NIGHT_HOURS = 6
export const VERY_SHORT_NIGHT_HOURS = 5
/** Decisions that mean a lift went backwards (or its load was cut) — listed as "down". */
const REGRESSION_ACTIONS: readonly string[] = ['WATCH_FOR_REGRESSION', 'REVIEW_LOAD_REDUCTION']
/** S31(b): a lift whose numbers have not risen at its load (a plateau, or falling reps). */
const STALLED_ACTIONS: readonly string[] = ['WATCH_FOR_PLATEAU', 'WATCH_FOR_REGRESSION']
/** The one lift to name when nothing is ready: a step back first, then a watch flag. */
const WATCH_ACTIONS: readonly string[] = ['STEP_BACK', 'WATCH_FOR_PLATEAU', 'WATCH_FOR_REGRESSION', 'REVIEW_LOAD_REDUCTION']
/** The lifts to push: two sessions at the top of the range (Add weight), or Almost (reps first, or jump). */
const READY_ACTIONS: readonly string[] = ['READY_TO_INCREASE', 'ALMOST_READY']

/** S31(a): offer a deload after this many weeks without an easy week (S31 says 4–8; the middle is an app choice). */
export const DELOAD_AFTER_WEEKS = 6
/** S31(b): this many stalled lifts at once (the app doesn't know which lifts are "main", so one is not enough). */
export const DELOAD_STALLED_LIFTS = 2
/** How far back the easy-week count looks (the coach's training history is 6 months). */
const EASY_WEEK_LOOKBACK = 26

/**
 * S31(a) + S32: complete Monday–Sunday weeks in a row, newest first, each with more than half of the planned sessions.
 * A week with half or fewer counts as easy (S32) and ends the run. Null without a weekly target (nothing to compare).
 */
export function weeksSinceEasyWeek(sessionDates: readonly string[], today: string, targetPerWeek: number | null | undefined): number | null {
  if (!targetPerWeek || targetPerWeek <= 0) return null
  const perWeek = new Map<string, number>()
  for (const date of sessionDates) {
    const week = mondayOfStr(date)
    perWeek.set(week, (perWeek.get(week) ?? 0) + 1)
  }
  let weeks = 0
  for (let start = shiftDateStr(mondayOfStr(today), -7); weeks < EASY_WEEK_LOOKBACK; start = shiftDateStr(start, -7)) {
    if ((perWeek.get(start) ?? 0) * 2 <= targetPerWeek) break
    weeks++
  }
  return weeks
}

export type RecoveryGate = 'rest_day' | 'technique_day' | 'normal' | 'no_sleep_data'

export interface PtVerdicts {
  recovery: {
    gate: RecoveryGate
    lastNightHours: number | null
    /** The night's day, when it is not today's. */
    lastNightDate: string | null
    sevenNightAverage: number | null
    /** Why the gate is not "normal", in a clause. */
    reason: string
  }
  workloadReview: boolean
  regressionLifts: string[]
  /** S31(b): lifts not rising at their load (plateau or falling reps). */
  stalledLifts: string[]
  /** S31(a): complete weeks in a row without an easy week, or null without a weekly target. */
  weeksSinceEasy: number | null
  /** S31: offer an easy week (about half the sets, same sessions) — never forced. */
  deloadCue: boolean
  /** Why the cue is on, in short clauses; empty when it is off. */
  deloadReasons: string[]
  /** Muscles under their minimum effective volume that no limitation restricts, worst first. */
  belowMinimum: { muscle: string; sets: number; mev: number }[]
  /** The one lift for the next session: the first to add weight (or Almost), else a step back, else a watch flag. */
  priority: { exercise: string; action: string; actionTitle: string; next: string | null } | null
  /** Push:pull and quad:hamstring ratios where a side is heavy. */
  balanceFlags: string[]
  /** Routines of the program not done for 7+ days. */
  missed: string[]
}

const round1 = (n: number) => Math.round(n * 10) / 10

function recoveryOf(d: CoachData, feeling: PtFeeling): PtVerdicts['recovery'] {
  const nights = [...d.sleep].sort((a, b) => a.date.localeCompare(b.date))
  const last = nights[nights.length - 1]
  if (!last) return { gate: 'no_sleep_data', lastNightHours: null, lastNightDate: null, sevenNightAverage: null, reason: 'no sleep data' }
  const recent = nights.slice(-7)
  const average = recent.reduce((sum, n) => sum + n.total, 0) / recent.length
  const base = {
    lastNightHours: round1(last.total), lastNightDate: last.date === d.today ? null : last.date, sevenNightAverage: round1(average),
  }
  const before = nights[nights.length - 2]
  if (last.total < VERY_SHORT_NIGHT_HOURS && before && before.total < VERY_SHORT_NIGHT_HOURS) {
    return { gate: 'rest_day', ...base, reason: `under ${VERY_SHORT_NIGHT_HOURS} h two nights running` }
  }
  if (last.total < SHORT_NIGHT_HOURS) return { gate: 'technique_day', ...base, reason: `last night was under ${SHORT_NIGHT_HOURS} h` }
  if (feeling === 'very tired' && last.total < average) return { gate: 'technique_day', ...base, reason: 'very tired, and last night was below the seven-night average' }
  return { gate: 'normal', ...base, reason: '' }
}

/** Every verdict the assessment rules decide from the numbers. */
export function ptVerdicts(d: CoachData, feeling: PtFeeling): PtVerdicts {
  const recovery = recoveryOf(d, feeling)
  const workloadReview = d.progress.program?.workload === 'review_workload'
  const titleOf = (id: string) => d.progress.titleById.get(id) ?? id
  const regressionLifts = d.progress.decisions.filter(r => REGRESSION_ACTIONS.includes(r.currentAction)).map(r => titleOf(r.exerciseTemplateId))
  const stalledLifts = d.progress.decisions.filter(r => STALLED_ACTIONS.includes(r.currentAction)).map(r => titleOf(r.exerciseTemplateId))
  const weeksSinceEasy = weeksSinceEasyWeek(d.sessions.map(s => s.date), d.today, d.profile?.training_days_per_week)

  // S31 — any one of: a long run without an easy week, lifts stalled at their load, or the owner very tired while a
  // lift is stalled or down; plus the program-level workload review (several lifts declining). High volume alone is
  // never a cue (S18).
  const deloadReasons: string[] = []
  if (weeksSinceEasy != null && weeksSinceEasy >= DELOAD_AFTER_WEEKS) deloadReasons.push(`${weeksSinceEasy} weeks without an easy week`)
  if (stalledLifts.length >= DELOAD_STALLED_LIFTS) deloadReasons.push(`${stalledLifts.length} lifts not rising at their load`)
  if (feeling === 'very tired' && (stalledLifts.length > 0 || regressionLifts.length > 0)) deloadReasons.push('very tired, with a lift stalled or down')
  if (workloadReview) deloadReasons.push(`program workload: ${workloadLabel('review_workload')}`)
  const belowMinimum = d.weeklyMuscleSets
    .filter(m => m.landmarks && !m.restriction && m.sets < m.landmarks.mev)
    .map(m => ({ muscle: labelForSlug(m.slug), sets: round1(m.sets), mev: m.landmarks!.mev }))
    .sort((a, b) => (b.mev - b.sets) - (a.mev - a.sets))

  const pick = d.progress.decisions.find(r => READY_ACTIONS.includes(r.currentAction)) ?? d.progress.decisions.find(r => WATCH_ACTIONS.includes(r.currentAction))
  const priority = pick
    ? {
        exercise: d.progress.titleById.get(pick.exerciseTemplateId) ?? pick.exerciseTemplateId,
        action: pick.currentAction, actionTitle: actionLabel(pick.currentAction), next: nextTargetText(pick),
      }
    : null

  const balanceFlags: string[] = []
  const balance = d.balance
  if (balance) {
    for (const pair of ['pushPull', 'quadHam'] as BalancePair[]) {
      const done = balance.done[pair]
      // Push- and quad-heavy are worth fixing; the other way round rarely matters (the PT rules' own).
      if (done.lean === 'a') {
        const planned = balance.planned?.[pair]
        balanceFlags.push(`${PAIR_META[pair].label}: done ${ratioText(done)} (${leanLabel(done)})${planned ? `, planned ${ratioText(planned)} (${leanLabel(planned)})` : ''}`)
      }
    }
  }
  return {
    recovery, workloadReview, regressionLifts, stalledLifts, weeksSinceEasy,
    deloadCue: deloadReasons.length > 0, deloadReasons,
    belowMinimum, priority, balanceFlags,
    missed: (d.missedSessions ?? []).map(m => `${m.title} (due ${m.dueDate})`),
  }
}

/** The verdicts as the text the job reads: one labelled line each, a fixed vocabulary the job's instructions name. */
export function formatPtVerdicts(v: PtVerdicts): string {
  const lines: string[] = []
  const r = v.recovery
  const night = r.lastNightHours === null ? '' : ` · last night ${r.lastNightHours} h${r.lastNightDate ? ` (${r.lastNightDate})` : ''}, seven-night average ${r.sevenNightAverage} h`
  lines.push(`RECOVERY: ${r.gate}${r.reason ? ` (${r.reason})` : ''}${night}`)
  lines.push(`OVERREACH: ${v.deloadCue ? `deload cue (${v.deloadReasons.join('; ')})` : 'none'}${v.stalledLifts.length ? ` · stalled: ${v.stalledLifts.join(', ')}` : ''}${v.regressionLifts.length ? ` · down: ${v.regressionLifts.join(', ')}` : ''}`)
  lines.push(`PRIORITY: ${v.priority ? `${v.priority.exercise} — ${v.priority.action} "${v.priority.actionTitle}"${v.priority.next ? ` · next: ${v.priority.next}` : ''}` : 'none (no decision to act on)'}`)
  lines.push(`BELOW MINIMUM VOLUME: ${v.belowMinimum.length ? v.belowMinimum.slice(0, 4).map(b => `${b.muscle} ${b.sets}/${b.mev}`).join(', ') : 'none'}`)
  lines.push(`IMBALANCE: ${v.balanceFlags.length ? v.balanceFlags.join('; ') : 'none'}`)
  lines.push(`MISSED: ${v.missed.length ? v.missed.join(', ') : 'none'}`)
  return lines.join('\n')
}
