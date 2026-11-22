import { actionLabel, workloadLabel } from '../progress-engine'
import { labelForSlug } from '../muscleMap'
import { leanLabel, PAIR_META, ratioText, type BalancePair } from '../plan/muscleBalance'
import { nextTargetText, type CoachData } from './coachFormat'

// ─────────────────────────────────────────────────────────────────────────────
//  The PT assessment's decisions, made by code (AI last, docs/features/ai.md).
//
//  What the daily assessment used to leave to the model, "is today a rest day?", "is a muscle past its ceiling?",
//  "which one lift comes first?", is an if-then on the numbers the app already has. So code decides it here, and the
//  `coach_assessment` job gets the verdicts as figures to explain, next to the snapshot (formatPtSnapshot) they
//  came from. The model's part is what code cannot do: read the owner's own words (pain, motivation), pick what to
//  say first, and write a few calm sentences that follow the verdicts (never against them).
//
//  The thresholds are the PT rules' own (sleep under 6 h trims a session, under 5 h twice running is a rest day, a
//  muscle at its recoverable ceiling is a deload cue); each is one constant below. Pure: no React, no I/O
//  (scripts/verify-coach-context.cjs).
// ─────────────────────────────────────────────────────────────────────────────

/** The four feelings the screen offers. The Turkish words are the stored values of `pt_assessments.feeling`. */
export const PT_FEELINGS = ['az çalıştım', 'normal', 'yorgunum', 'çok yorgunum'] as const
export type PtFeeling = typeof PT_FEELINGS[number]

export const SHORT_NIGHT_HOURS = 6
export const VERY_SHORT_NIGHT_HOURS = 5
/** Decisions that mean a lift went backwards (or its load was cut): two of them with a very tired owner is a deload cue. */
const REGRESSION_ACTIONS: readonly string[] = ['WATCH_FOR_REGRESSION', 'REVIEW_LOAD_REDUCTION']
const WATCH_ACTIONS: readonly string[] = ['WATCH_FOR_PLATEAU', 'WATCH_FOR_REGRESSION', 'REVIEW_LOAD_REDUCTION']

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
  /** Muscles at or over the recoverable ceiling (MRV), by name and with their sets. */
  overreach: { muscle: string; sets: number; mrv: number }[]
  workloadReview: boolean
  regressionLifts: string[]
  /** True when the overreach rule says to halve the sets: a muscle at its ceiling, a workload review, or two lifts down with a very tired owner. */
  deloadCue: boolean
  /** Muscles under their minimum effective volume that no limitation restricts, worst first. */
  belowMinimum: { muscle: string; sets: number; mev: number }[]
  /** The one lift for the next session: the first ready to increase, else the first with a watch flag. */
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
  if (feeling === 'çok yorgunum' && last.total < average) return { gate: 'technique_day', ...base, reason: 'very tired, and last night was below the seven-night average' }
  return { gate: 'normal', ...base, reason: '' }
}

/** Every verdict the assessment rules decide from the numbers. */
export function ptVerdicts(d: CoachData, feeling: PtFeeling): PtVerdicts {
  const recovery = recoveryOf(d, feeling)
  const overreach = d.weeklyMuscleSets
    .filter(m => m.landmarks && m.sets >= m.landmarks.mrv)
    .map(m => ({ muscle: labelForSlug(m.slug), sets: round1(m.sets), mrv: m.landmarks!.mrv }))
  const workloadReview = d.progress.program?.workload === 'review_workload'
  const regressionLifts = d.progress.decisions
    .filter(r => REGRESSION_ACTIONS.includes(r.currentAction))
    .map(r => d.progress.titleById.get(r.exerciseTemplateId) ?? r.exerciseTemplateId)
  const belowMinimum = d.weeklyMuscleSets
    .filter(m => m.landmarks && !m.restriction && m.sets < m.landmarks.mev)
    .map(m => ({ muscle: labelForSlug(m.slug), sets: round1(m.sets), mev: m.landmarks!.mev }))
    .sort((a, b) => (b.mev - b.sets) - (a.mev - a.sets))

  const pick = d.progress.decisions.find(r => r.currentAction === 'READY_TO_INCREASE') ?? d.progress.decisions.find(r => WATCH_ACTIONS.includes(r.currentAction))
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
    recovery, overreach, workloadReview, regressionLifts,
    deloadCue: overreach.length > 0 || workloadReview || (regressionLifts.length >= 2 && feeling === 'çok yorgunum'),
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
  lines.push(`OVERREACH: ${v.deloadCue ? 'deload cue' : 'none'}${v.overreach.length ? ` · at the ceiling: ${v.overreach.map(o => `${o.muscle} ${o.sets}/${o.mrv}`).join(', ')}` : ''}${v.workloadReview ? ` · program workload: ${workloadLabel('review_workload')}` : ''}${v.regressionLifts.length ? ` · down: ${v.regressionLifts.join(', ')}` : ''}`)
  lines.push(`PRIORITY: ${v.priority ? `${v.priority.exercise} — ${v.priority.action} "${v.priority.actionTitle}"${v.priority.next ? ` · next: ${v.priority.next}` : ''}` : 'none (no decision to act on)'}`)
  lines.push(`BELOW MINIMUM VOLUME: ${v.belowMinimum.length ? v.belowMinimum.slice(0, 4).map(b => `${b.muscle} ${b.sets}/${b.mev}`).join(', ') : 'none'}`)
  lines.push(`IMBALANCE: ${v.balanceFlags.length ? v.balanceFlags.join('; ') : 'none'}`)
  lines.push(`MISSED: ${v.missed.length ? v.missed.join(', ') : 'none'}`)
  return lines.join('\n')
}
