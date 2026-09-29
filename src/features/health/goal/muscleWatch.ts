// Muscle watch — "am I losing muscle?", said plainly. It combines numbers the
// app already has into ONE deterministic reading. Pure and import-free except
// types (scripts/verify-muscle-watch.cjs); useMuscleWatch.ts feeds it.
// Rules agreed with the strength-coach consult (2026-09-29).
//
// No single signal answers the question: consumer bioimpedance swings about
// ±1 kg of fat-free mass (Looney 2024 measured ±0.6 kg under lab control;
// at home it is worse), and the first weeks of a cut drop glycogen and water.
// So the reading weighs these signals:
//
//   STRENGTH (measured) — the current program's main lifts (est. 1RM, the
//     same per-lift change as Training → Progress's Improvement card:
//     plan/improvement.ts, better of the first two vs the last two sessions,
//     3+ sessions over 14+ days in the last 4 weeks, up to 5 lifts).
//     DOWN = est. 1RM down more than 5 % on 2+ main lifts. HOLDING = 2+ lifts
//     judged and none down more than 2.5 %. Strength is the signal that tells
//     real muscle loss from scale noise.
//   SCALE (measured) — per the goal report's rules (analyseComposition picks
//     ONE scale; two are never mixed): lean mass (and, from the photo
//     reports, muscle mass = muscle % × weight), first-week mean at the start
//     vs the fitted value now. DOWN = more than 1.0 kg over 4+ weeks — beyond
//     the ~1 kg noise. A smaller drop is reported but triggers nothing. The
//     lean share of the weight lost (same scale) is shown for context only.
//   RATE (evidence) — losing more than 1 % of bodyweight a week (Helms 2014;
//     Garthe 2011: past ~1 %/week lean mass stops rising and starts to go).
//   PROTEIN (evidence) — the logged average over the goal report's window
//     (only with enough fully logged days) under 1.6 g/kg bodyweight
//     (Morton 2018). The aim quoted is ~2.2 g/kg bodyweight, or 2.3–3.1 g per
//     kg of lean mass on a cut (Helms 2014) — for 83 kg about 180 g a day.
//   TRAINING (measured, context only) — sessions and working sets a week over
//     the last 4 weeks vs the 4 before; never changes the level.
//
// LEVEL:
//   likely_loss — STRENGTH DOWN and at least one of: scale down, rate too
//                 fast, protein low. A scale drop alone is NEVER "losing
//                 muscle" (early-cut water and glycogen).
//   watch       — any one of: strength down, scale down, rate too fast,
//                 protein low.
//   not_enough_data — neither strength nor a scale change can be read (pace
//                 and protein alone can't clear muscle), and nothing warns.
//   ok          — otherwise.
// CONFIDENCE: high = strength down + 2 other signals; medium = strength down +
//   1 other, or 2+ watch signals; low otherwise.
//
// A MUSCLE GOAL is called a long-term target, not this phase's, when it asks
// for any gain during a cut, or (other phases) more than 0.5 kg of muscle a
// month to reach within a year — about the ceiling for an intermediate lifter
// (practitioner heuristic). It never changes the level.

import type { CompositionReading, CompositionResult, Phase, Tone } from './bodyGoal'

export type MuscleWatchLevel = 'ok' | 'watch' | 'likely_loss' | 'not_enough_data'
export type MuscleWatchSignal = 'strength' | 'scale' | 'muscle' | 'share' | 'rate' | 'protein' | 'training' | 'goal'
export type EvidenceTier = 'measured' | 'evidence' | 'heuristic'

export interface MuscleWatchReason { signal: MuscleWatchSignal; tone: Tone; text: string; evidenceTier: EvidenceTier }

export interface MuscleWatch {
  level: MuscleWatchLevel
  headline: string
  reasons: MuscleWatchReason[]
  actions: string[]
  confidence: 'low' | 'medium' | 'high'
  /** The scale window's first day (phase start, else the report's composition window). */
  from: string
}

/** One judged main lift over the last 4 weeks (plan/improvement.ts LiftChange). */
export interface LiftTrend { name: string; changePct: number }
export interface TrainingSession { date: string; workingSets: number }

export interface MuscleWatchInput {
  today: string
  phase: Phase
  /** The scale window's first day — the phase start, else the report's composition window start. */
  from: string
  /** Every scale reading (all sources); comp decides the one scale. */
  readings: CompositionReading[]
  /** analyseComposition over [from, today]. */
  comp: CompositionResult
  /** Signed %BW/week, + = gaining; null without a weight trend. */
  ratePctPerWeek: number | null
  /** Current (trend) bodyweight. */
  weightKg: number | null
  protein: { meanG: number | null; loggedDays: number; neededDays: number }
  /** Current-program main lifts judged over the last 4 weeks. */
  lifts: LiftTrend[]
  /** One per workout, any date. */
  sessions: TrainingSession[]
  targetSessionsPerWeek: number | null
  muscleGoalKg: number | null
}

// ── thresholds ─────────────────────────────────────────────────────────────
export const LIFT_DOWN_PCT = 5
export const LIFT_FLAT_PCT = 2.5 // = plan/improvement.FLAT_BAND_PCT
export const MIN_LIFTS_DOWN = 2
export const SCALE_DROP_KG = 1.0
export const SCALE_MIN_DAYS = 28
export const SMALL_DROP_KG = 0.2
export const MIN_WEIGHT_LOSS_FOR_SHARE_KG = 1
export const FAST_RATE_PCT = -1.0
export const WAY_FAST_RATE_PCT = -1.4
export const PROTEIN_FLOOR_G_PER_KG = 1.6
export const PROTEIN_AIM_G_PER_KG = 2.2
export const MAINTAIN_PROTEIN_AIM_G_PER_KG = 1.8
export const TRAINING_DROP = 0.3
export const TRAINING_TARGET_SHARE = 0.75
export const MUSCLE_GAIN_KG_PER_MONTH = 0.5
export const GOAL_TOLERANCE_KG = 0.3 // = bodyGoal.GOAL_TOLERANCE.muscle
export const KCAL_PER_KG = 7700 // = energyBalance.ENERGY_DENSITY_KCAL_PER_KG

// ── small helpers (dates are 'yyyy-MM-dd', UTC math, no time zone) ────────
function dayNum(d: string): number {
  const [y, m, dd] = d.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, dd) / 86_400_000)
}
export function daysBetween(a: string, b: string): number { return dayNum(b) - dayNum(a) }
export function addDays(d: string, n: number): string { return new Date((dayNum(d) + n) * 86_400_000).toISOString().slice(0, 10) }

/** "13.08.2026" — the app's one date format (the same output as shared/utils/dateFormat.formatDate). */
export function ddmmyyyy(d: string): string {
  const [y, m, dd] = d.split('-')
  return `${dd}.${m}.${y}`
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
const r1 = (v: number) => Math.round(v * 10) / 10
const round5 = (v: number) => Math.round(v / 5) * 5
function signed(v: number, dp = 1, unit = ''): string {
  const s = Math.abs(v).toFixed(dp)
  return `${Number(s) === 0 ? '±' : v > 0 ? '+' : '−'}${s}${unit}`
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

type Pt = { date: string; value: number }

/** Mean of the first week of points on/after `from` (the goal report's baseline rule). */
export function firstWeekMean(points: Pt[], from: string): { value: number; date: string } | null {
  const after = points.filter(p => p.date >= from).sort((a, b) => a.date.localeCompare(b.date))
  if (!after.length) return null
  const week = after.filter(p => daysBetween(after[0].date, p.date) < 7)
  return { value: mean(week.map(p => p.value)), date: after[0].date }
}
/** Mean of the last week of points up to `to`. */
export function lastWeekMean(points: Pt[], to: string): { value: number; date: string } | null {
  const upTo = points.filter(p => p.date <= to).sort((a, b) => a.date.localeCompare(b.date))
  if (!upTo.length) return null
  const last = upTo[upTo.length - 1].date
  return { value: mean(upTo.filter(p => daysBetween(p.date, last) < 7).map(p => p.value)), date: last }
}

export interface MassChange { start: number; current: number; change: number; startDate: string; spanDays: number }

/** Start (first-week mean) → now (the fitted value when the window has a
 *  trend, else the last-week mean). Null under a week apart. */
export function massChange(points: Pt[], from: string, to: string, trend: { current: number } | null): MassChange | null {
  const s = firstWeekMean(points, from)
  const e = lastWeekMean(points.filter(p => p.date >= from), to)
  if (!s || !e || daysBetween(s.date, e.date) < 7) return null
  const current = trend ? trend.current : e.value
  return { start: s.value, current, change: current - s.value, startDate: s.date, spanDays: daysBetween(s.date, e.date) }
}

/** Dropped by more than SCALE_DROP_KG over at least SCALE_MIN_DAYS. */
export const scaleDropped = (m: MassChange | null): boolean => m != null && -m.change > SCALE_DROP_KG && m.spanDays >= SCALE_MIN_DAYS

// ── strength ───────────────────────────────────────────────────────────────
export interface StrengthSummary { judged: number; downBig: number; down: number; up: number; strengthDown: boolean; holding: boolean }

export function summarizeStrength(lifts: LiftTrend[]): StrengthSummary {
  const ok = lifts.filter(l => Number.isFinite(l.changePct))
  const downBig = ok.filter(l => l.changePct < -LIFT_DOWN_PCT).length
  const down = ok.filter(l => l.changePct <= -LIFT_FLAT_PCT).length
  const up = ok.filter(l => l.changePct >= LIFT_FLAT_PCT).length
  return { judged: ok.length, downBig, down, up, strengthDown: downBig >= MIN_LIFTS_DOWN, holding: ok.length >= 2 && down === 0 }
}

// ── training ───────────────────────────────────────────────────────────────
export interface TrainingSummary { perWeek: number; prevPerWeek: number; setsPerWeek: number; prevSetsPerWeek: number; dropped: boolean; belowTarget: boolean }

export function summarizeTraining(sessions: TrainingSession[], today: string, target: number | null): TrainingSummary {
  const lastFrom = addDays(today, -27), prevFrom = addDays(today, -55)
  const inLast = sessions.filter(s => s.date >= lastFrom && s.date <= today)
  const inPrev = sessions.filter(s => s.date >= prevFrom && s.date < lastFrom)
  const perWeek = r1(inLast.length / 4), prevPerWeek = r1(inPrev.length / 4)
  const setsPerWeek = r1(inLast.reduce((a, s) => a + s.workingSets, 0) / 4)
  const prevSetsPerWeek = r1(inPrev.reduce((a, s) => a + s.workingSets, 0) / 4)
  const dropped = (prevPerWeek >= 1.5 && perWeek <= prevPerWeek * (1 - TRAINING_DROP))
    || (prevSetsPerWeek >= 20 && setsPerWeek <= prevSetsPerWeek * (1 - TRAINING_DROP))
  const belowTarget = target != null && target > 0 && perWeek < target * TRAINING_TARGET_SHARE
  return { perWeek, prevPerWeek, setsPerWeek, prevSetsPerWeek, dropped, belowTarget }
}

/** The protein aim in g/day: ~2.2 g/kg on a cut (1.8 otherwise), to the nearest 5 g. */
export function proteinAimG(phase: Phase, kg: number): number {
  return round5(kg * (phase === 'cut' ? PROTEIN_AIM_G_PER_KG : MAINTAIN_PROTEIN_AIM_G_PER_KG))
}

// ── the reading ────────────────────────────────────────────────────────────
export function buildMuscleWatch(inp: MuscleWatchInput): MuscleWatch {
  const { today, phase, from, comp } = inp
  const reasons: MuscleWatchReason[] = []
  const actions: string[] = []

  // Strength.
  const st = summarizeStrength(inp.lifts)
  if (st.judged > 0) {
    reasons.push({
      signal: 'strength', evidenceTier: 'measured',
      tone: st.strengthDown ? 'danger' : st.holding ? 'success' : st.down > 0 ? 'warn' : 'neutral',
      text: `${st.downBig} of ${plural(st.judged, 'main lift')} down more than 5 % (est. 1RM, last 4 weeks), ${st.up} up. ${
        st.strengthDown ? 'Falling strength is the clearest sign the scale drop is real muscle.'
          : st.holding ? 'Strength holding is a good sign that any scale drop is water, not muscle.'
            : 'Not a clear sign either way.'}`,
    })
  } else {
    reasons.push({ signal: 'strength', evidenceTier: 'measured', tone: 'neutral', text: 'Strength can\'t be judged yet: needs current-program lifts with 3+ sessions over 2+ weeks in the last 4 weeks.' })
  }

  // Scale — one scale (comp.source) for lean/fat/weight, the photo reports for muscle.
  const pts = (list: CompositionReading[], pick: (r: CompositionReading) => number | null): Pt[] =>
    list.flatMap(r => { const v = pick(r); return v == null ? [] : [{ date: r.date, value: v }] })
  const own = inp.readings.filter(r => r.source === comp.source)
  const muscle = massChange(pts(inp.readings.filter(r => r.muscleMassKg != null), r => r.muscleMassKg), from, today, comp.muscle)
  const lean = massChange(pts(own, r => r.leanMassKg), from, today, comp.lean)
  const fat = massChange(pts(own, r => r.fatMassKg), from, today, comp.fat)
  const weight = massChange(pts(own, r => r.weightKg), from, today, null)
  const scaleDown = scaleDropped(lean) || scaleDropped(muscle)

  const massLine = (label: string, m: MassChange) => {
    const nums = `${m.start.toFixed(1)} → ${m.current.toFixed(1)} kg`
    const past = scaleDropped(m)
    const note = past ? `more than the scale's ~${SCALE_DROP_KG} kg noise over ${m.spanDays} days`
      : -m.change > SCALE_DROP_KG ? `beyond the noise, but over only ${m.spanDays} days — needs 4 weeks`
        : -m.change >= SMALL_DROP_KG ? `inside the scale's ~${SCALE_DROP_KG} kg noise`
          : 'holding'
    return { past, text: `${cap(label)} ${signed(m.change)} kg since ${ddmmyyyy(m.startDate)} (${nums}) — ${note}.` }
  }
  if (lean) {
    const l = massLine('scale lean mass', lean)
    reasons.push({ signal: 'scale', evidenceTier: 'measured', tone: l.past ? 'warn' : -lean.change >= SMALL_DROP_KG ? 'neutral' : 'success', text: l.text })
  }
  if (muscle) {
    const l = massLine('scale muscle', muscle)
    reasons.push({ signal: 'muscle', evidenceTier: 'measured', tone: l.past ? 'warn' : -muscle.change >= SMALL_DROP_KG ? 'neutral' : 'success', text: l.text })
  }
  if (weight && lean && -weight.change >= MIN_WEIGHT_LOSS_FOR_SHARE_KG && lean.change < 0) {
    const share = Math.min(1, -lean.change / -weight.change)
    reasons.push({
      signal: 'share', evidenceTier: 'heuristic', tone: 'neutral',
      text: `On the scale, about ${Math.round(share * 100)} % of the ${Math.abs(weight.change).toFixed(1)} kg lost was lean mass (${fat ? `fat ${signed(fat.change)} kg, ` : ''}lean ${signed(lean.change)} kg). Early in a cut much of that is water and glycogen; only falling strength makes it muscle.`,
    })
  }

  // Rate.
  const rate = inp.ratePctPerWeek
  const rateFast = rate != null && rate < FAST_RATE_PCT
  if (rate != null && rate < 0) {
    reasons.push({
      signal: 'rate', evidenceTier: 'evidence', tone: rate < WAY_FAST_RATE_PCT ? 'danger' : rateFast ? 'warn' : 'success',
      text: rateFast
        ? `Losing ${Math.abs(rate).toFixed(2)} % of bodyweight a week — faster than the 0.5–1 % that keeps muscle (Helms 2014, Garthe 2011).`
        : `Losing ${Math.abs(rate).toFixed(2)} % of bodyweight a week — inside the 1 %/week limit that keeps muscle.`,
    })
  }

  // Protein.
  const kg = inp.weightKg
  const p = inp.protein
  const gPerKg = p.meanG != null && kg != null && kg > 0 && p.loggedDays >= p.neededDays ? p.meanG / kg : null
  const proteinLow = gPerKg != null && gPerKg < PROTEIN_FLOOR_G_PER_KG
  const aimPerKg = phase === 'cut' ? PROTEIN_AIM_G_PER_KG : MAINTAIN_PROTEIN_AIM_G_PER_KG
  if (gPerKg != null && kg) {
    const aim = `aim for ~${aimPerKg.toFixed(1)} g/kg (≈${proteinAimG(phase, kg)} g a day)${phase === 'cut' ? ', or 2.3–3.1 g per kg of lean mass' : ''}`
    reasons.push({
      signal: 'protein', evidenceTier: 'evidence',
      tone: proteinLow ? 'danger' : gPerKg < aimPerKg - 0.1 ? 'warn' : 'success',
      text: proteinLow
        ? `Protein ${gPerKg.toFixed(1)} g/kg a day — under the 1.6 g/kg floor for keeping muscle; ${aim} (Morton 2018, Helms 2014).`
        : gPerKg < aimPerKg - 0.1
          ? `Protein ${gPerKg.toFixed(1)} g/kg a day — above the 1.6 floor, below the ~${aimPerKg.toFixed(1)} g/kg aim.`
          : `Protein ${gPerKg.toFixed(1)} g/kg a day — enough.`,
    })
  } else if (p.meanG != null && p.loggedDays < p.neededDays) {
    reasons.push({ signal: 'protein', evidenceTier: 'measured', tone: 'neutral', text: `Protein can't be judged: ${plural(p.loggedDays, 'day')} fully logged, needs ${p.neededDays}.` })
  }

  // Training (context only).
  const training = summarizeTraining(inp.sessions, today, inp.targetSessionsPerWeek)
  const trainingDrop = training.dropped || training.belowTarget
  if (inp.sessions.length > 0) {
    const plan = inp.targetSessionsPerWeek ? ` (plan ${inp.targetSessionsPerWeek})` : ''
    reasons.push({
      signal: 'training', evidenceTier: 'heuristic', tone: trainingDrop ? 'warn' : 'neutral',
      text: `${training.perWeek} sessions and ${Math.round(training.setsPerWeek)} working sets a week over the last 4 weeks${plan}, vs ${training.prevPerWeek} and ${Math.round(training.prevSetsPerWeek)} the 4 weeks before.${trainingDrop ? ' Less training is less signal to keep muscle.' : ''}`,
    })
  }

  // Muscle goal realism (never changes the level).
  const muscleNow = muscle?.current ?? null
  if (inp.muscleGoalKg != null && muscleNow != null) {
    const gap = inp.muscleGoalKg - muscleNow
    if (gap > GOAL_TOLERANCE_KG && (phase === 'cut' || gap / MUSCLE_GAIN_KG_PER_MONTH > 12)) {
      const months = Math.ceil(gap / MUSCLE_GAIN_KG_PER_MONTH)
      reasons.push({
        signal: 'goal', evidenceTier: 'heuristic', tone: 'info',
        text: `Your muscle goal of ${inp.muscleGoalKg.toFixed(1)} kg is a long-term target, not this phase's: it is ${gap.toFixed(1)} kg above now. ${
          phase === 'cut' ? 'On a cut the realistic aim is keeping the muscle you have. ' : ''}At the ~0.5 kg a month an intermediate lifter can add in a gain phase, it is at least ${months} months of gaining away.`,
      })
    }
  }

  // ── level ────────────────────────────────────────────────────────────────
  const others = [scaleDown, rateFast, proteinLow].filter(Boolean).length
  const signals = others + (st.strengthDown ? 1 : 0)
  // Only strength and the scale can show muscle loss; pace and protein alone can't clear it.
  const readable = st.judged > 0 || lean != null || muscle != null
  const level: MuscleWatchLevel =
    st.strengthDown && others >= 1 ? 'likely_loss'
      : signals >= 1 ? 'watch'
        : !readable ? 'not_enough_data'
          : 'ok'
  const confidence: MuscleWatch['confidence'] =
    st.strengthDown && others >= 2 ? 'high'
      : (st.strengthDown && others >= 1) || signals >= 2 ? 'medium' : 'low'

  // ── headline ─────────────────────────────────────────────────────────────
  const parts: string[] = []
  if (st.strengthDown) parts.push(`${st.downBig} of ${st.judged} main lifts down more than 5 %`)
  if (muscle && -muscle.change >= SMALL_DROP_KG && (scaleDown || level !== 'ok')) parts.push(`scale muscle ${signed(muscle.change)} kg since ${ddmmyyyy(muscle.startDate)}`)
  if (scaleDropped(lean) && lean) parts.push(`lean mass ${signed(lean.change)} kg since ${ddmmyyyy(lean.startDate)}`)
  if (proteinLow && gPerKg != null) parts.push(`protein ${gPerKg.toFixed(1)} g/kg (aim ${aimPerKg.toFixed(1)})`)
  if (rateFast && rate != null) parts.push(`losing ${Math.abs(rate).toFixed(1)} % a week`)
  const list = parts.join(', ')
  let headline: string
  if (level === 'likely_loss') headline = `You may be losing muscle: ${list}.`
  else if (level === 'watch') {
    headline = st.holding
      ? `Worth watching: ${list} — but your lifts are holding, so this is more likely water than muscle so far.`
      : st.judged === 0
        ? `Worth watching: ${list}. Your lifts can't be judged yet — they are what would tell muscle from water.`
        : `Worth watching: ${list}.`
  } else if (level === 'not_enough_data') headline = 'Not enough data to judge muscle yet — log your lifts and weigh in on the smart scale a few times a week.'
  else headline = st.holding ? 'Muscle looks protected: your lifts are holding and nothing points the other way.' : 'No sign of muscle loss right now.'

  // ── actions ──────────────────────────────────────────────────────────────
  const concern = level === 'likely_loss' || level === 'watch'
  if (kg && (proteinLow || (concern && gPerKg != null && gPerKg < aimPerKg - 0.1))) {
    actions.push(`Raise protein to about ${proteinAimG(phase, kg)} g a day (~${aimPerKg.toFixed(1)} g/kg), spread over 3–5 meals.`)
  }
  if (concern && phase === 'cut' && rate != null && kg) {
    const aim = level === 'likely_loss' ? -0.5 : FAST_RATE_PCT
    if (rate < aim) {
      const kcal = Math.max(50, Math.round((((aim - rate) / 100) * kg * KCAL_PER_KG / 7) / 50) * 50)
      actions.push(`Slow the cut: eat about ${kcal} kcal a day more, aiming at ${Math.abs(aim)} % of bodyweight a week.`)
    }
  }
  if (concern) actions.push('Keep the heavy compound sets (squat, press, row, hinge) at 5–8 reps close to failure; trim accessory volume before you cut heavy sets.')
  if (concern && trainingDrop) actions.push(`Get back to ${inp.targetSessionsPerWeek ?? Math.max(2, Math.round(training.prevPerWeek))} strength sessions a week.`)
  if (concern && st.judged === 0) actions.push('Log your main lifts in Hevy for a few weeks — strength is what tells real muscle loss from scale noise.')

  return { level, headline, reasons, actions, confidence, from }
}
