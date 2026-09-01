// Pure logic for the Progress tab's "Training Analysis" panel — a written,
// deterministic answer to "what am I doing well/poorly, what could I do
// better", added from a sports-scientist agent review (2026-09-01).
//
// DELIBERATELY RULE-BASED, NOT AN LLM CALL — the agent's explicit call: this
// is a standing analytical view the user re-opens repeatedly and reads as the
// app's canonical verdict on their own log, unlike PT Coach (a dated,
// one-shot, snapshot-archived opinion). Two loads of the same data must never
// produce two different verdicts, an LLM will occasionally launder a
// heuristic threshold into a "scientific minimum," and a second AI narrator
// risks contradicting PT Coach's own. Every `Finding` below carries an exact
// number traceable to the user's own log — never a generic "athletes should"
// answer — and a `tier` so the UI never lets a heuristic read as a
// measurement. Kept import-free of runtime deps (only type-only imports),
// same convention as progressAggregate.ts, so it's testable via sucrase.
import { mondayOf } from './progressAggregate'
import type {
  ConsistencyWeek, WeeklyVolumePoint, RepBucketCount, ExerciseSessionPoint, RelativeStrengthPoint,
} from './progressAggregate'
import type { Landmarks } from './muscleMap'

export type FindingTier = 'measured' | 'evidence' | 'heuristic'
export interface Finding {
  id: string
  tier: FindingTier
  /** true = good news, false = a gap/regression, null = purely informational. */
  positive: boolean | null
  text: string
}

const TIER_ORDER: Record<FindingTier, number> = { measured: 0, evidence: 1, heuristic: 2 }

/** Stable render order: measured facts first, then evidence-backed
 *  interpretation, then heuristic-threshold findings last — so the reader
 *  sees "what happened" before "what a convention says about it". */
export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier])
}

function shiftWeek(weekStart: string, weeks: number): string {
  const d = new Date(weekStart + 'T00:00:00')
  d.setDate(d.getDate() + weeks * 7)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The last calendar week that's actually finished — a partial current week
 *  always looks like a collapse, so every trend rule below excludes it. */
export function lastCompleteWeek(anchorDate: string): string {
  return shiftWeek(mondayOf(anchorDate), -1)
}

function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${Math.round(n * 100)}%`
}

// ── A. Consistency / adherence ──────────────────────────────────────────────
const CONSISTENCY_CLAUSE = 'This counts logged workouts only — a session you did and did not log is indistinguishable from one you skipped.'

export function computeConsistencyFindings(weeksAll: ConsistencyWeek[], anchorDate: string): Finding[] {
  const last = lastCompleteWeek(anchorDate)
  const complete = weeksAll.filter(w => w.weekStart <= last)
  const out: Finding[] = []
  if (complete.length === 0) return out

  const last8 = complete.slice(-8)
  const trainedWeeks8 = last8.filter(w => w.sessionCount >= 1).length
  const median8 = median(last8.map(w => w.sessionCount))
  if (last8.length >= 6 && trainedWeeks8 >= last8.length - 1 && median8 >= 2) {
    out.push({
      id: 'consistency-strong', tier: 'measured', positive: true,
      text: `You trained in ${trainedWeeks8} of the last ${last8.length} weeks, median ${median8} session${median8 === 1 ? '' : 's'} per week. This is the most reliable number on this page — a straight count of logged workouts, with no interpretation on top. ${CONSISTENCY_CLAUSE}`,
    })
  }

  const gapWeeks = complete.slice(-12).filter(w => w.sessionCount === 0)
  if (gapWeeks.length >= 3) {
    out.push({
      id: 'consistency-gaps', tier: 'measured', positive: false,
      text: `${gapWeeks.length} of your last ${Math.min(12, complete.length)} complete weeks had no logged session (week${gapWeeks.length === 1 ? '' : 's'} of ${gapWeeks.map(w => fmtWeekLabel(w.weekStart)).join(', ')}). Every trend on this page is computed across those gaps, so lines will look flatter than your actual training did. ${CONSISTENCY_CLAUSE}`,
    })
  }

  const prev8 = complete.slice(-12, -4)
  const recent4 = complete.slice(-4)
  if (recent4.length === 4 && prev8.length >= 6) {
    const prevMean = mean(prev8.map(w => w.sessionCount))
    const recentMean = mean(recent4.map(w => w.sessionCount))
    if (prevMean >= 1.5 && recentMean < prevMean * 0.6) {
      out.push({
        id: 'consistency-dropped', tier: 'measured', positive: false,
        text: `Your session frequency fell from ${round1(prevMean)}/week (the ${prev8.length} weeks before that) to ${round1(recentMean)}/week over the last 4 weeks — about a ${Math.round((1 - recentMean / prevMean) * 100)}% drop. Frequency itself changes little at matched weekly volume, so this only matters if your total weekly sets fell with it — see the muscle findings below.`,
      })
    }
  }

  return out
}

// ── B. Volume trend (tonnage) ───────────────────────────────────────────────
const VOLUME_CLAUSE = 'Tonnage is a training input, not a stimulus and not an outcome — 100kg×5 and 50kg×10 tally identically, and it moves whenever your exercise selection changes.'

function rollingAvgEndingAt(tonnageByWeek: Map<string, number>, endWeek: string, windowWeeks: number): number {
  let sum = 0
  for (let i = 0; i < windowWeeks; i++) sum += tonnageByWeek.get(shiftWeek(endWeek, -i)) ?? 0
  return sum / windowWeeks
}

export function computeVolumeFindings(weekly: WeeklyVolumePoint[], anchorDate: string): Finding[] {
  const last = lastCompleteWeek(anchorDate)
  const byWeek = new Map(weekly.map(w => [w.weekStart, w.tonnageKg]))
  const earliest = weekly[0]?.weekStart
  if (!earliest || earliest > shiftWeek(last, -11)) return [] // not enough history for an 8-week-back comparison

  const now = rollingAvgEndingAt(byWeek, last, 4)
  const then = rollingAvgEndingAt(byWeek, shiftWeek(last, -8), 4)
  if (now === 0 && then === 0) return []

  if (then > 0 && now >= then * 1.15) {
    return [{
      id: 'volume-up', tier: 'measured', positive: true,
      text: `Your 4-week rolling tonnage is up ${pct(now / then - 1)} versus 8 weeks ago (${fmtKg(then)} → ${fmtKg(now)} per week). ${VOLUME_CLAUSE} A rise this size is consistent with doing more work — it isn't by itself evidence you got stronger. Cross-check the per-exercise findings below.`,
    }]
  }
  if (then > 0 && now <= then * 0.85) {
    return [{
      id: 'volume-down', tier: 'measured', positive: null,
      text: `Your 4-week rolling tonnage is down ${pct(now / then - 1)} versus 8 weeks ago (${fmtKg(then)} → ${fmtKg(now)} per week). ${VOLUME_CLAUSE} A decline isn't automatically bad — a deload, a shift toward machines/isolation work, or a rep-range change all lower tonnage without lowering stimulus.`,
    }]
  }
  if (then > 0 && Math.abs(now / then - 1) < 0.1) {
    return [{
      id: 'volume-flat', tier: 'measured', positive: null,
      text: `Your 4-week rolling tonnage has stayed within ${pct(Math.abs(now / then - 1))} for 8 weeks (${fmtKg(then)} → ${fmtKg(now)} per week). ${VOLUME_CLAUSE} Flat isn't a failure state — progression can happen inside a flat tonnage number (closer to failure, better range of motion, slower tempo), none of which this data records.`,
    }]
  }
  return []
}

// ── C. Weekly sets per muscle vs landmarks ──────────────────────────────────
const MUSCLE_CLAUSE = 'MEV/MAV/MRV are a practitioner framework (Renaissance Periodization), not measured thresholds — what\'s well supported is the shape (more weekly sets → more growth, with diminishing returns; Schoenfeld 2017; Pelland 2025), not the specific numbers.'

export interface MuscleFindingInput { slug: string; label: string; weekly: { weekStart: string; sets: number }[]; landmarks: Landmarks | undefined }

export function computeMuscleFindings(inputs: MuscleFindingInput[], anchorDate: string): Finding[] {
  const last = lastCompleteWeek(anchorDate)
  const out: Finding[] = []
  for (const { label, weekly, landmarks } of inputs) {
    const byWeek = new Map(weekly.map(w => [w.weekStart, w.sets]))
    const last8 = Array.from({ length: 8 }, (_, i) => byWeek.get(shiftWeek(last, -i)) ?? 0)
    const meanSets = mean(last8)

    if (last8.every(v => v === 0)) {
      out.push({ id: `muscle-zero-${label}`, tier: 'measured', positive: false, text: `${label} received zero credited working sets in the last 8 weeks. No threshold is involved in that observation — you haven't trained it. If that's deliberate, ignore this.` })
      continue
    }
    if (!landmarks) continue

    const underCount = last8.filter(v => v < landmarks.mev).length
    if (underCount >= 6 && meanSets < landmarks.mev) {
      out.push({ id: `muscle-under-${label}`, tier: 'heuristic', positive: false, text: `${label} averaged ${round1(meanSets)} sets/week over the last 8 weeks and was below ${landmarks.mev} (this app's MEV convention) in ${underCount} of those weeks. At this dose you're most likely maintaining rather than building. ${MUSCLE_CLAUSE}` })
    }
    const overCount = last8.filter(v => v > landmarks.mrv).length
    if (overCount >= 4) {
      out.push({ id: `muscle-over-${label}`, tier: 'heuristic', positive: null, text: `${label} exceeded ${landmarks.mrv} sets/week (this app's MRV convention) in ${overCount} of the last 8 weeks (peak ${Math.max(...last8)}). Whether that's "too much" depends on effort per set, sleep and recovery — none of which this measures. If you're recovering and still progressing, there's nothing to fix here. ${MUSCLE_CLAUSE}` })
    }
  }
  return out
}

// ── D. Rep-range distribution ───────────────────────────────────────────────
const REP_RANGE_CLAUSE = 'Hypertrophy is roughly equivalent across about 5-30 reps when sets are taken close to failure (Schoenfeld 2017; Morton 2016) — there\'s no "the hypertrophy rep range", so no bucket here is wrong on its own. This app has no effort/RIR data, so it can\'t tell how close to failure your sets were.'

export function computeRepRangeFindings(buckets: RepBucketCount[]): Finding[] {
  const total = buckets.reduce((a, b) => a + b.count, 0)
  if (total < 50) return []
  const out: Finding[] = []

  const top = [...buckets].sort((a, b) => b.count - a.count)[0]
  if (top && top.count / total >= 0.7) {
    out.push({ id: 'rep-range-concentration', tier: 'evidence', positive: null, text: `${Math.round((top.count / total) * 100)}% of your ${total} working sets in the last 90 days sat in ${top.label} (${top.count} sets). ${REP_RANGE_CLAUSE} Strength gains do specifically favour heavier loads even where hypertrophy doesn't — a log with almost nothing under 6 reps is optimised for size over maximal strength.` })
  }

  const heavy = buckets.find(b => b.key === '1-5')
  if (heavy && heavy.count === 0 && total >= 100) {
    out.push({ id: 'rep-range-no-heavy', tier: 'evidence', positive: false, text: `You logged zero working sets in the 1-5 rep range across ${total} sets in 90 days. That's fine for hypertrophy — see above — but strength adaptations are load-specific and favour heavy work even when hypertrophy is equivalent. If maximal strength is a goal, this is the clearest actionable gap on this page. ${REP_RANGE_CLAUSE}` })
  }

  return out
}

// ── E. Relative strength (bodyweight-adjusted) ──────────────────────────────
export interface RelativeStrengthFindingInput { title: string; points: RelativeStrengthPoint[] }

function daysSpan(a: string, b: string): number {
  return Math.abs(new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86_400_000
}

export function computeRelativeStrengthFindings(inputs: RelativeStrengthFindingInput[], bodyweightAnchorCount: number): Finding[] {
  if (bodyweightAnchorCount < 3) {
    return [{ id: 'relative-strength-null', tier: 'measured', positive: null, text: `Bodyweight-adjusted strength can't be computed yet — only ${bodyweightAnchorCount} weigh-in${bodyweightAnchorCount === 1 ? '' : 's'} logged. This app deliberately won't carry a weight forward indefinitely to fill the gap, since that would flatten the denominator across a cut and make the ratio lie. Log bodyweight roughly weekly and this becomes readable.` }]
  }

  const out: Finding[] = []
  for (const { title, points } of inputs) {
    if (points.length < 6 || daysSpan(points[0].date, points[points.length - 1].date) < 56) continue
    const r0 = mean(points.slice(0, 3).map(p => p.ratio))
    const r1 = mean(points.slice(-3).map(p => p.ratio))
    const s0 = mean(points.slice(0, 3).map(p => p.est1rmValue))
    const s1 = mean(points.slice(-3).map(p => p.est1rmValue))
    const b0 = mean(points.slice(0, 3).map(p => p.bodyweightKg))
    const b1 = mean(points.slice(-3).map(p => p.bodyweightKg))

    if (r1 >= r0 * 1.05 && s1 >= s0 * 1.03) {
      out.push({ id: `rel-strength-gain-${title}`, tier: 'measured', positive: true, text: `${title}: strength-per-bodyweight rose ${pct(r1 / r0 - 1)} over ${points.length} sessions, and the absolute estimate rose too (${round1(s0)} kg → ${round1(s1)} kg) while bodyweight stayed near-flat (${round1(b0)} → ${round1(b1)} kg). Both the numerator and denominator agree, which is when this ratio is worth reading. Estimated 1RMs carry roughly ±10% error.` })
    } else if (r1 >= r0 * 1.05 && s1 <= s0 * 1.01 && b1 <= b0 * 0.98) {
      out.push({ id: `rel-strength-bw-${title}`, tier: 'measured', positive: null, text: `${title}: the bodyweight-adjusted number improved ${pct(r1 / r0 - 1)}, but the estimated 1RM barely moved (${round1(s0)} kg → ${round1(s1)} kg) — bodyweight fell from ${round1(b0)} to ${round1(b1)} kg. The ratio improved because the denominator shrank, not because you got stronger. Holding absolute strength through a bodyweight drop is a real result — it just isn't the same result as getting stronger.` })
    } else if (r1 <= r0 * 0.95 && s1 <= s0 * 0.97) {
      out.push({ id: `rel-strength-down-${title}`, tier: 'measured', positive: false, text: `${title}: strength-per-bodyweight fell ${pct(r1 / r0 - 1)} over ${points.length} sessions (estimated 1RM ${round1(s0)} kg → ${round1(s1)} kg). Estimated 1RM is derived, not tested — a move this size is close to the formula's own error band, so read it cautiously.` })
    }
  }
  return out
}

// ── F. Stalled vs progressing per exercise ──────────────────────────────────
export interface ExerciseTrendFindingInput { title: string; points: ExerciseSessionPoint[]; repRangeVaried: boolean; unit: string }

export function computeExerciseTrendFindings(inputs: ExerciseTrendFindingInput[]): Finding[] {
  const out: Finding[] = []
  for (const { title, points, repRangeVaried, unit } of inputs) {
    const eligible = points.filter(p => p.topValue != null)
    if (eligible.length < 6 || daysSpan(eligible[0].date, eligible[eligible.length - 1].date) < 56) continue

    if (repRangeVaried) {
      out.push({ id: `exercise-varied-${title}`, tier: 'measured', positive: null, text: `${title}'s rep range changed enough across this period that its trend can't be read reliably (see the Exercise Progress chart's own caveat) — skipped here rather than shown as a false stall or gain.` })
      continue
    }

    const v0 = mean(eligible.slice(0, 3).map(p => p.topValue!))
    const v1 = mean(eligible.slice(-3).map(p => p.topValue!))
    if (v1 >= v0 * 1.03) {
      out.push({ id: `exercise-progressing-${title}`, tier: 'measured', positive: true, text: `${title} is progressing: top-set ${round1(v0)} → ${round1(v1)} ${unit} across ${eligible.length} sessions. Measured from your own top working set each session, warm-ups excluded.` })
    } else if (Math.abs(v1 / v0 - 1) < 0.02) {
      out.push({ id: `exercise-stalled-${title}`, tier: 'measured', positive: null, text: `${title} has been flat for ${eligible.length} sessions: top-set ${round1(v0)} → ${round1(v1)} ${unit}. Flat is normal and not a problem by itself — but effort per set, rest length, sleep and nutrition are all unrecorded here, so this data can't say why.` })
    } else if (v1 <= v0 * 0.95) {
      out.push({ id: `exercise-regressing-${title}`, tier: 'measured', positive: false, text: `${title}'s top-set estimate fell ${pct(v1 / v0 - 1)} (${round1(v0)} → ${round1(v1)} ${unit}) over ${eligible.length} sessions. Before reading this as lost strength, check whether you changed grip, tempo or equipment — none of which is recorded.` })
    }
  }
  return out
}

// ── helpers ──────────────────────────────────────────────────────────────────
function mean(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0
}
function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
function round1(n: number): number {
  return Math.round(n * 10) / 10
}
function fmtKg(n: number): string {
  return `${Math.round(n).toLocaleString('en-GB')} kg`
}
function fmtWeekLabel(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
