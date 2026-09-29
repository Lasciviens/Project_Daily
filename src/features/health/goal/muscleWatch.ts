// Muscle watch — "am I losing muscle?", said plainly. It combines numbers the
// app already has into ONE deterministic reading. Pure and import-free except
// types (scripts/verify-muscle-watch.cjs); useMuscleWatch.ts feeds it.
//
// No single signal can answer the question — consumer bioimpedance swings
// ±0.6 kg of fat-free mass from day to day (Looney 2024), and a strength dip
// can be fatigue. So the reading weighs five signals, each with its own tier:
//
//   1. SCALE (measured). From the phase start (or the last 28 days without
//      one), per the goal report's scale rules — one scale only, never two
//      mixed (analyseComposition picks it): muscle mass (photo reports: muscle
//      % × weight) and lean mass, first-week mean at the start vs the fitted
//      value now. A drop of MIN_MASS_CHANGE_KG (0.5 kg) or more is "past the
//      noise floor"; 0.2–0.5 kg is a small drop inside it. Also the LEAN SHARE
//      of the weight lost since the start (lean drop ÷ weight drop, same scale,
//      weight down ≥ 1 kg): above 40 % is high — on a cut run inside the
//      published pace most of the loss is fat (Garthe 2011: lean mass even
//      rose at ~0.7 %/week). 40 % is a heuristic cut-off.
//   2. RATE (evidence). The fitted weight trend as %BW/week. Losing faster
//      than 1 %/week raises the risk (Helms 2014; Garthe 2011), faster than
//      1.4 %/week is outside what was studied.
//   3. PROTEIN (evidence). The logged average over the report's window, per kg
//      of bodyweight, only when enough days were logged (neededDays). Low =
//      under 1.6 g/kg (Morton 2018) OR under 90 % of the saved daily target
//      (heuristic).
//   4. STRENGTH (measured). Current-program lifts with an est. 1RM (Epley,
//      ≤ 12 reps), each needing 3+ sessions over 14+ days in the window: the
//      mean of the best e1RM of its last 2 sessions vs its first 2. Beyond
//      ±2.5 % counts as up/down (heuristic — about one small plate on a
//      100 kg lift). Needs 2+ such lifts. DECLINING = 40 %+ of them down and
//      more down than up; HOLDING = at most 20 % down. Holding strength is
//      evidence AGAINST real muscle loss, since the scale is noisy.
//   5. TRAINING (measured). Sessions and working sets per week over the last
//      28 days vs the 28 before, and vs the profile's days-per-week. A drop of
//      30 %+ (from at least 1.5 sessions/week) or under 75 % of the target
//      raises the risk (heuristic: less stimulus to keep muscle).
//
// LEVEL, in order:
//   likely_loss — the scale is past the floor (drop ≥ 0.5 kg or lean share
//                 > 40 %) AND strength is declining, or the scale is past the
//                 floor AND at least one of (protein low, rate too fast,
//                 training dropped) AND strength is NOT holding.
//   watch       — the scale is past the floor but nothing corroborates it or
//                 strength holds; or a small scale drop (0.2–0.5 kg); or two
//                 or more risk factors (protein low, rate too fast, strength
//                 declining, training dropped) whatever the scale says.
//   not_enough_data — no scale muscle/lean change can be read and fewer than
//                 two risk factors.
//   ok          — otherwise.
// CONFIDENCE: high when the scale drop is also a significant fitted trend,
//   strength data exists and 2+ other signals agree; medium with the scale
//   plus one corroborating signal (or any strength data); low otherwise.
//
// Separately, an UNREALISTIC MUSCLE GOAL is named in plain words: on a cut
// the best case is holding muscle; in a gain phase a trained lifter adds
// roughly 0.25–0.5 kg of muscle a month (practitioner heuristic, e.g. the
// Aragon model), so a goal more than 24 months away at 0.5 kg/month — or any
// gap over 1 kg on a cut — is called out. It never changes the level.

import type { CompositionReading, CompositionResult, Phase, Tone } from './bodyGoal'

export type MuscleWatchLevel = 'ok' | 'watch' | 'likely_loss' | 'not_enough_data'
export type MuscleWatchSignal = 'scale' | 'share' | 'rate' | 'protein' | 'strength' | 'training' | 'goal'
export type EvidenceTier = 'measured' | 'evidence' | 'heuristic'

export interface MuscleWatchReason { signal: MuscleWatchSignal; tone: Tone; text: string; evidenceTier: EvidenceTier }

export interface MuscleWatch {
  level: MuscleWatchLevel
  headline: string
  reasons: MuscleWatchReason[]
  actions: string[]
  confidence: 'low' | 'medium' | 'high'
  /** The window's first day (phase start, else 28 days back). */
  from: string
}

export interface LiftHistory { id: string; name: string; sessions: { date: string; e1rm: number }[] }
export interface TrainingSession { date: string; workingSets: number }

export interface MuscleWatchInput {
  today: string
  phase: Phase
  /** The window's first day — the phase start, else the report's composition window start. */
  from: string
  /** Every scale reading (all sources); comp decides the one scale. */
  readings: CompositionReading[]
  /** analyseComposition over [from, today]. */
  comp: CompositionResult
  /** Signed %BW/week, + = gaining; null without a weight trend. */
  ratePctPerWeek: number | null
  /** Current (trend) bodyweight. */
  weightKg: number | null
  protein: { meanG: number | null; loggedDays: number; neededDays: number; targetG: number | null }
  /** Current-program est-1RM lifts, sessions oldest first (any date — the window is applied here). */
  lifts: LiftHistory[]
  /** One per workout, any date. */
  sessions: TrainingSession[]
  targetSessionsPerWeek: number | null
  muscleGoalKg: number | null
}

// ── thresholds ─────────────────────────────────────────────────────────────
export const NOISE_FLOOR_KG = 0.5 // = bodyGoal.MIN_MASS_CHANGE_KG
export const SMALL_DROP_KG = 0.2
export const MIN_WEIGHT_LOSS_FOR_SHARE_KG = 1
export const HIGH_LEAN_SHARE = 0.4
export const FAST_RATE_PCT = -1.0
export const WAY_FAST_RATE_PCT = -1.4
export const PROTEIN_FLOOR_G_PER_KG = 1.6
export const CUT_PROTEIN_G_PER_KG = 2.2
export const PROTEIN_TARGET_SHARE = 0.9
export const LIFT_CHANGE = 0.025
export const MIN_LIFT_SESSIONS = 3
export const MIN_LIFT_SPAN_DAYS = 14
export const MIN_LIFTS = 2
export const DECLINING_SHARE = 0.4
export const HOLDING_SHARE = 0.2
export const TRAINING_DROP = 0.3
export const TRAINING_TARGET_SHARE = 0.75
export const MUSCLE_GAIN_KG_PER_MONTH = 0.5
export const KCAL_PER_KG = 7700 // = energyBalance.ENERGY_DENSITY_KCAL_PER_KG

// ── small helpers (dates are 'yyyy-MM-dd', UTC math, no time zone) ────────
function dayNum(d: string): number {
  const [y, m, dd] = d.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, dd) / 86_400_000)
}
export function daysBetween(a: string, b: string): number { return dayNum(b) - dayNum(a) }
export function addDays(d: string, n: number): string { return new Date((dayNum(d) + n) * 86_400_000).toISOString().slice(0, 10) }

/** "13.08.2026" — the app's one date format (shared/utils/dateFormat.formatDate). */
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

type Pt = { date: string; value: number }

/** Mean of the first week of points on/after `from` (the goal report's baseline rule). */
export function firstWeekMean(points: Pt[], from: string): { value: number; date: string } | null {
  const after = points.filter(p => p.date >= from).sort((a, b) => a.date.localeCompare(b.date))
  if (!after.length) return null
  const week = after.filter(p => daysBetween(after[0].date, p.date) < 7)
  return { value: mean(week.map(p => p.value)), date: after[0].date }
}
/** Mean of the last week of points (up to `to`). */
export function lastWeekMean(points: Pt[], to: string): { value: number; date: string } | null {
  const upTo = points.filter(p => p.date <= to).sort((a, b) => a.date.localeCompare(b.date))
  if (!upTo.length) return null
  const last = upTo[upTo.length - 1].date
  return { value: mean(upTo.filter(p => daysBetween(p.date, last) < 7).map(p => p.value)), date: last }
}

export interface MassChange { start: number; current: number; change: number; startDate: string; significant: boolean }

/** Start (first-week mean) → now (the fitted value when the window has a trend, else the last-week mean). */
export function massChange(points: Pt[], from: string, to: string, trend: { current: number; significant: boolean } | null): MassChange | null {
  const s = firstWeekMean(points, from)
  const e = lastWeekMean(points.filter(p => p.date >= from), to)
  if (!s || !e || daysBetween(s.date, e.date) < 7) return null
  const current = trend ? trend.current : e.value
  return { start: s.value, current, change: current - s.value, startDate: s.date, significant: !!trend?.significant }
}

// ── strength ───────────────────────────────────────────────────────────────
export interface StrengthSummary { analysed: number; up: number; down: number; held: number; declining: boolean; holding: boolean }

export function summarizeStrength(lifts: LiftHistory[], from: string, to: string): StrengthSummary {
  let up = 0, down = 0, held = 0
  for (const l of lifts) {
    const s = l.sessions.filter(x => x.date >= from && x.date <= to && Number.isFinite(x.e1rm) && x.e1rm > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
    if (s.length < MIN_LIFT_SESSIONS || daysBetween(s[0].date, s[s.length - 1].date) < MIN_LIFT_SPAN_DAYS) continue
    const first = mean(s.slice(0, 2).map(x => x.e1rm))
    const last = mean(s.slice(-2).map(x => x.e1rm))
    const ch = last / first - 1
    if (ch > LIFT_CHANGE) up++
    else if (ch < -LIFT_CHANGE) down++
    else held++
  }
  const analysed = up + down + held
  const enough = analysed >= MIN_LIFTS
  return {
    analysed, up, down, held,
    declining: enough && down / analysed >= DECLINING_SHARE && down > up,
    holding: enough && down / analysed <= HOLDING_SHARE,
  }
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

// ── the reading ────────────────────────────────────────────────────────────
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function buildMuscleWatch(inp: MuscleWatchInput): MuscleWatch {
  const { today, phase, from, comp } = inp
  const reasons: MuscleWatchReason[] = []
  const actions: string[] = []
  const since = ddmmyyyy(from)

  // 1. Scale — the one scale analyseComposition picked, plus the photo reports for muscle.
  const own = inp.readings.filter(r => r.source === comp.source)
  const pts = (list: CompositionReading[], pick: (r: CompositionReading) => number | null): Pt[] =>
    list.flatMap(r => { const v = pick(r); return v == null ? [] : [{ date: r.date, value: v }] })
  const reportRows = inp.readings.filter(r => r.muscleMassKg != null)
  const muscle = massChange(pts(reportRows, r => r.muscleMassKg), from, today, comp.muscle)
  const lean = massChange(pts(own, r => r.leanMassKg), from, today, comp.lean)
  const fat = massChange(pts(own, r => r.fatMassKg), from, today, comp.fat)
  const weight = massChange(pts(own, r => r.weightKg), from, today, null)

  const main = muscle ?? lean
  const mainName = muscle ? 'scale muscle' : 'scale lean mass'
  const mainDrop = main ? -main.change : 0
  const pastFloor = main != null && mainDrop >= NOISE_FLOOR_KG
  const smallDrop = main != null && mainDrop >= SMALL_DROP_KG && !pastFloor
  const scaleSignificant = pastFloor && main.significant
  if (main) {
    const nums = `${main.start.toFixed(1)} → ${main.current.toFixed(1)} kg`
    reasons.push({
      signal: 'scale', evidenceTier: 'measured',
      tone: pastFloor ? (scaleSignificant ? 'danger' : 'warn') : smallDrop ? 'warn' : 'success',
      text: pastFloor
        ? `${mainName[0].toUpperCase()}${mainName.slice(1)} ${signed(main.change)} kg since ${ddmmyyyy(main.startDate)} (${nums}) — more than the scale's ±${NOISE_FLOOR_KG} kg noise${scaleSignificant ? ', and a steady trend' : ''}.`
        : smallDrop
          ? `${mainName[0].toUpperCase()}${mainName.slice(1)} ${signed(main.change)} kg since ${ddmmyyyy(main.startDate)} (${nums}) — small, inside the scale's ±${NOISE_FLOOR_KG} kg noise.`
          : `${mainName[0].toUpperCase()}${mainName.slice(1)} ${signed(main.change)} kg since ${ddmmyyyy(main.startDate)} (${nums}) — holding.`,
    })
  }

  let leanShare: number | null = null
  if (weight && lean && -weight.change >= MIN_WEIGHT_LOSS_FOR_SHARE_KG && lean.change < 0) {
    leanShare = Math.min(1, -lean.change / -weight.change)
    const high = leanShare > HIGH_LEAN_SHARE
    const fatPart = fat ? `fat ${signed(fat.change)} kg, ` : ''
    reasons.push({
      signal: 'share', evidenceTier: 'heuristic', tone: high ? 'danger' : 'success',
      text: `About ${Math.round(leanShare * 100)} % of the ${Math.abs(weight.change).toFixed(1)} kg you lost on the scale was lean mass (${fatPart}lean ${signed(lean.change)} kg). ${high ? 'On a well-paced cut most of the loss should be fat.' : 'Most of it was fat — that is the goal.'}`,
    })
  }
  const shareHigh = leanShare != null && leanShare > HIGH_LEAN_SHARE
  const scalePast = pastFloor || shareHigh

  // 2. Rate.
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

  // 3. Protein.
  const kg = inp.weightKg
  const p = inp.protein
  const proteinReadable = p.meanG != null && kg != null && kg > 0 && p.loggedDays >= p.neededDays
  const gPerKg = proteinReadable ? (p.meanG as number) / (kg as number) : null
  const targetGPerKg = p.targetG != null && kg ? p.targetG / kg : null
  const proteinLow = gPerKg != null && (gPerKg < PROTEIN_FLOOR_G_PER_KG || (targetGPerKg != null && gPerKg < targetGPerKg * PROTEIN_TARGET_SHARE))
  if (gPerKg != null) {
    const tgt = targetGPerKg != null ? ` (target ${targetGPerKg.toFixed(1)})` : ''
    reasons.push({
      signal: 'protein', evidenceTier: gPerKg < PROTEIN_FLOOR_G_PER_KG ? 'evidence' : 'heuristic',
      tone: gPerKg < PROTEIN_FLOOR_G_PER_KG ? 'danger' : proteinLow ? 'warn' : 'success',
      text: gPerKg < PROTEIN_FLOOR_G_PER_KG
        ? `Protein ${gPerKg.toFixed(1)} g/kg a day${tgt} — under the 1.6 g/kg floor for keeping muscle (Morton 2018).`
        : proteinLow
          ? `Protein ${gPerKg.toFixed(1)} g/kg a day${tgt} — below your own target.`
          : `Protein ${gPerKg.toFixed(1)} g/kg a day${tgt} — enough.`,
    })
  } else if (p.meanG != null && p.loggedDays < p.neededDays) {
    reasons.push({ signal: 'protein', evidenceTier: 'measured', tone: 'neutral', text: `Protein can't be judged: ${plural(p.loggedDays, 'day')} fully logged, needs ${p.neededDays}.` })
  }

  // 4. Strength.
  const strength = summarizeStrength(inp.lifts, from < addDays(today, -27) ? from : addDays(today, -27), today)
  if (strength.analysed >= MIN_LIFTS) {
    reasons.push({
      signal: 'strength', evidenceTier: 'measured',
      tone: strength.declining ? 'danger' : strength.holding ? 'success' : 'warn',
      text: `${strength.down} of ${strength.analysed} lifts down, ${strength.up} up (est. 1RM, first vs last sessions). ${strength.declining ? 'Falling strength with a falling scale is the clearest sign of real muscle loss.' : strength.holding ? 'Strength holding is a good sign the scale drop is mostly water, not muscle.' : 'Mixed — not a clear sign either way.'}`,
    })
  } else if (strength.analysed > 0 || inp.lifts.length > 0) {
    reasons.push({ signal: 'strength', evidenceTier: 'measured', tone: 'neutral', text: 'Strength can\'t be judged yet: needs 2+ current-program lifts with 3 sessions over 14 days.' })
  }

  // 5. Training.
  const training = summarizeTraining(inp.sessions, today, inp.targetSessionsPerWeek)
  const trainingDrop = training.dropped || training.belowTarget
  if (inp.sessions.length > 0) {
    const tgt = inp.targetSessionsPerWeek ? ` (plan ${inp.targetSessionsPerWeek})` : ''
    reasons.push({
      signal: 'training', evidenceTier: 'heuristic', tone: trainingDrop ? 'warn' : 'success',
      text: `${training.perWeek} sessions and ${Math.round(training.setsPerWeek)} working sets a week over the last 4 weeks${tgt}, vs ${training.prevPerWeek} and ${Math.round(training.prevSetsPerWeek)} the 4 weeks before.${trainingDrop ? ' Less training means less signal to keep muscle.' : ''}`,
    })
  }

  // Muscle goal realism (never changes the level).
  const muscleNow = muscle?.current ?? null
  if (inp.muscleGoalKg != null && muscleNow != null) {
    const gap = inp.muscleGoalKg - muscleNow
    const months = gap / MUSCLE_GAIN_KG_PER_MONTH
    if (gap > 0 && ((phase === 'cut' && gap > 1) || months > 24)) {
      const years = `${r1(gap / (MUSCLE_GAIN_KG_PER_MONTH * 12))}–${r1(gap / (0.25 * 12))}`
      reasons.push({
        signal: 'goal', evidenceTier: 'heuristic', tone: 'info',
        text: `Your muscle goal is ${inp.muscleGoalKg.toFixed(1)} kg — ${gap.toFixed(1)} kg more than now. ${phase === 'cut' ? 'On a cut the best realistic result is keeping the muscle you have. ' : ''}A trained lifter adds roughly 0.25–0.5 kg of muscle a month in a gain phase, so this is about ${years} years of gaining away.`,
      })
    }
  }

  // ── level ────────────────────────────────────────────────────────────────
  const corroborators = [proteinLow, rateFast, trainingDrop].filter(Boolean).length
  const risks = corroborators + (strength.declining ? 1 : 0)
  let level: MuscleWatchLevel
  if (scalePast && (strength.declining || (corroborators >= 1 && !strength.holding))) level = 'likely_loss'
  else if (scalePast || smallDrop || risks >= 2) level = 'watch'
  else if (!main && !lean) level = 'not_enough_data'
  else level = 'ok'

  const confidence: MuscleWatch['confidence'] =
    scaleSignificant && strength.analysed >= MIN_LIFTS && risks >= 2 ? 'high'
      : (scalePast && risks >= 1) || strength.analysed >= MIN_LIFTS ? 'medium' : 'low'

  // ── headline ─────────────────────────────────────────────────────────────
  const parts: string[] = []
  if (main && (pastFloor || smallDrop)) parts.push(`${mainName} ${signed(main.change)} kg since ${ddmmyyyy(main.startDate)}`)
  if (shareHigh && leanShare != null) parts.push(`${Math.round(leanShare * 100)} % of the weight lost was lean mass`)
  if (proteinLow && gPerKg != null) parts.push(`protein ${gPerKg.toFixed(1)} g/kg${targetGPerKg != null ? ` (target ${targetGPerKg.toFixed(1)})` : ''}`)
  if (rateFast && rate != null) parts.push(`losing ${Math.abs(rate).toFixed(1)} %/week`)
  if (strength.declining) parts.push(`${strength.down} of ${strength.analysed} lifts down`)
  if (trainingDrop) parts.push(`training down to ${training.perWeek} sessions/week`)
  const list = parts.join(', ')
  let headline: string
  if (level === 'likely_loss') headline = `You may be losing muscle: ${list}.`
  else if (level === 'watch') {
    headline = strength.holding && scalePast
      ? `Worth watching: ${list}, but your lifts are holding — more likely water or scale noise so far.`
      : `Worth watching: ${list || 'several small signs point the wrong way'}.`
  } else if (level === 'not_enough_data') headline = 'Not enough scale data to judge muscle yet — weigh in on the smart scale a few times a week.'
  else headline = strength.holding ? `Muscle looks protected: ${mainName} holding and your lifts are holding since ${since}.` : `Muscle looks protected: ${mainName} holding since ${since}.`

  // ── actions ──────────────────────────────────────────────────────────────
  const concern = level === 'likely_loss' || level === 'watch'
  if (kg && (proteinLow || (concern && gPerKg == null))) {
    const perKg = phase === 'cut' ? CUT_PROTEIN_G_PER_KG : PROTEIN_FLOOR_G_PER_KG + 0.2
    const g = Math.max(round5(kg * perKg), p.targetG ?? 0)
    actions.push(`Raise protein to about ${g} g a day (${(g / kg).toFixed(1)} g/kg), spread over 3–5 meals.`)
  }
  if (concern && phase === 'cut' && rate != null && kg) {
    const aim = level === 'likely_loss' ? -0.5 : FAST_RATE_PCT
    if (rate < aim) {
      const kcal = Math.max(50, Math.round((((aim - rate) / 100) * kg * KCAL_PER_KG / 7) / 50) * 50)
      actions.push(`Slow the cut: eat about ${kcal} kcal a day more, aiming at ${Math.abs(aim)} % of bodyweight a week.`)
    }
  }
  if (concern) actions.push('Keep the heavy compound sets (squat, press, row, deadlift variations) at 5–8 reps close to failure; trim accessory volume before you cut heavy sets.')
  if (trainingDrop) actions.push(`Get back to ${inp.targetSessionsPerWeek ?? Math.max(2, Math.round(training.prevPerWeek))} strength sessions a week.`)
  if (concern && !main) actions.push('Weigh in on the smart scale 3+ times a week, same time of day, so the trend can be read.')

  return { level, headline, reasons, actions, confidence, from }
}
