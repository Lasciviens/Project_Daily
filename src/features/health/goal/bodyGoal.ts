// Goal progress — is the pace right for the phase, is the change fat or
// muscle, and how far is each goal? Pure (scripts/verify-body-goal.cjs); the
// only import is the energy-balance math it builds on.
//
// PHASE — the person's own pick in their nutrition goals (day_targets.goal):
// cut, maintain or gain. Every verdict below reads through it.
//
// PACE, as % of bodyweight per week from the fitted weight trend (signed here:
// + = gaining, − = losing):
//   cut      −0.5 to −1.0 %/wk. Helms ER, Aragon AA, Fitschen PJ. J Int Soc
//            Sports Nutr 2014;11:20 (PMC4033492): lose ~0.5–1 %/wk to keep
//            muscle. Garthe I et al. Int J Sport Nutr Exerc Metab 2011
//            (PMID 21558571): at ~0.7 %/wk lean mass ROSE 2.1 %, at ~1.4 %/wk
//            it held but didn't grow — so past 1.0 is "fast", past 1.4 is
//            outside the studied range. The leaner you are, the closer to
//            0.5 %/wk you should stay (Helms 2014).
//   gain     +0.25 to +0.5 %/wk. Iraki J, Fitschen P, Espinar S, Helms E.
//            Sports 2019;7:154 (PMID 31247944): a ~10–20 % surplus aiming at
//            ~0.25–0.5 %/wk for novice/intermediate lifters; advanced lifters
//            more conservative. Past 0.75 %/wk (a heuristic: 1.5× the top of
//            the range) most of the extra is fat.
//   maintain within ±0.25 %/wk — a heuristic band about as wide as the
//            trend's own noise over a few weeks; not a published cut-off.
// The kcal advice gives the smallest change that reaches the phase's range (and
// the one that aims at its middle), with the same 7,700 kcal/kg as
// energyBalance.ts (±15 %).
//
// FAT vs MUSCLE — from the smart scale's body fat % and lean mass. Consumer
// bioimpedance swings with hydration, glycogen and food: under lab control
// day-to-day it moved ±0.5 kg fat mass, ±0.6 kg fat-free mass and ±0.6 %
// body fat (Looney DP et al. Front Nutr 2024, PMC11649400) — at home it is
// worse. So a change only counts as real when a least-squares line through
// 4+ readings over 14+ days moves by at least 0.5 kg AND by twice its own
// standard error, and readings from different scales/apps are never mixed
// (live data showed two apps reading the same weigh-in ~2 % body fat apart).
// Lean mass is everything that isn't fat — mostly muscle and water — so a
// lean drop in the first weeks of a cut is partly glycogen water.

import { addDays, daysBetween, linearFit, type EnergyReport, type Phase } from './energyBalance'

export type { Phase }
export type Tone = 'success' | 'warn' | 'danger' | 'info' | 'neutral'

export const ENERGY_DENSITY = 7700

// ── pace ───────────────────────────────────────────────────────────────────
export const PHASE_TARGET: Record<Phase, { lo: number; hi: number; mid: number }> = {
  cut: { lo: -1.0, hi: -0.5, mid: -0.75 },
  maintain: { lo: -0.25, hi: 0.25, mid: 0 },
  gain: { lo: 0.25, hi: 0.5, mid: 0.375 },
}
/** Garthe 2011's faster group: lean mass held, didn't grow. Beyond = outside the studied range. */
export const CUT_LIMIT = -1.4
/** Heuristic: 1.5× the top of the gain range. */
export const GAIN_LIMIT = 0.75
/** Movement smaller than this (%/wk) is "not moving" in either direction. */
export const STILL_BAND = 0.1

export type RateStatus =
  | 'wrong_way' | 'too_slow' | 'on_track' | 'too_fast' | 'way_too_fast'
  | 'stable' | 'drifting_down' | 'drifting_up'

/** `pct` is signed: + = gaining, − = losing, as % of bodyweight per week. */
export function classifyRate(phase: Phase, pct: number): RateStatus {
  const t = PHASE_TARGET[phase]
  if (phase === 'maintain') return pct < t.lo ? 'drifting_down' : pct > t.hi ? 'drifting_up' : 'stable'
  if (phase === 'cut') {
    if (pct > STILL_BAND) return 'wrong_way'
    if (pct > t.hi) return 'too_slow'
    if (pct >= t.lo) return 'on_track'
    return pct >= CUT_LIMIT ? 'too_fast' : 'way_too_fast'
  }
  if (pct < -STILL_BAND) return 'wrong_way'
  if (pct < t.lo) return 'too_slow'
  if (pct <= t.hi) return 'on_track'
  return pct <= GAIN_LIMIT ? 'too_fast' : 'way_too_fast'
}

export interface RateAdjust {
  /** kcal/day to change intake by (+ = eat more), rounded to 50 (at least 50). */
  kcal: number
  /** The signed %BW/week it aims at. */
  pct: number
  /** …as kg/week at this weight. */
  kgPerWeek: number
}

export interface RateVerdict {
  status: RateStatus
  /** Signed %BW/week (+ = gaining). */
  pctPerWeek: number
  /** Signed kg/week. */
  kgPerWeek: number
  /** The smallest change that reaches the range — its nearest edge (maintain:
   *  back to a steady weight). null when already in range. */
  adjust: RateAdjust | null
  /** The change that aims at the middle of the range (cut and gain only). */
  adjustMid: RateAdjust | null
  /** Logged intake + adjust.kcal — only when the diary covers enough days. */
  suggestedIntake: number | null
}

/** kcal/day between two paces (signed %BW/week) at a weight, rounded to 50, at least 50. */
export function kcalForPace(fromPct: number, toPct: number, kg: number, density = ENERGY_DENSITY): number {
  const raw = ((toPct - fromPct) / 100) * kg * density / 7
  return Math.sign(raw) * Math.max(50, Math.round(Math.abs(raw) / 50) * 50)
}

export function buildRateVerdict(phase: Phase, energy: EnergyReport, opts: { intakeReliable: boolean }): RateVerdict | null {
  const w = energy.weight
  if (!energy.hasTrend || w.kgPerWeek == null || w.pctPerWeek == null || !w.meanKg) return null
  const kg = w.meanKg
  const pct = -w.pctPerWeek
  const status = classifyRate(phase, pct)
  const t = PHASE_TARGET[phase]
  const at = (target: number): RateAdjust => ({ kcal: kcalForPace(pct, target, kg), pct: target, kgPerWeek: Math.round((target / 100) * kg * 100) / 100 })
  const inRange = status === 'on_track' || status === 'stable'
  const edge = phase === 'maintain' ? t.mid : pct < t.lo ? t.lo : t.hi
  const adjust = inRange ? null : at(edge)
  const adjustMid = inRange || phase === 'maintain' ? null : at(t.mid)
  const intake = energy.intake.meanKcal
  return {
    status,
    pctPerWeek: Math.round(pct * 100) / 100,
    kgPerWeek: w.kgPerWeek,
    adjust,
    adjustMid,
    suggestedIntake: adjust && opts.intakeReliable && intake != null ? Math.round((intake + adjust.kcal) / 50) * 50 : null,
  }
}

// ── scale readings ─────────────────────────────────────────────────────────
export interface CompositionReading {
  date: string
  /** The app/device that wrote it; trends never mix sources. */
  source: string
  weightKg: number
  fatPct: number | null
  fatMassKg: number | null
  leanMassKg: number | null
  /** Only the photo-imported scale report carries a muscle %. */
  muscleMassKg: number | null
}

export const REPORT_SOURCE = 'report'

export interface AppleScalePoint { metric: string; date: string; recordedAt: string; source: string; value: number }
export interface ScaleReport { date: string; weightKg: number; fatPct: number; fatMassKg: number; leanMassKg: number; musclePct: number | null }

/** Health Auto Export joins the contributing apps/devices with '|' in no fixed
 *  order; the same set is the same source. */
export function canonicalSource(s: string): string {
  return [...new Set(s.split('|').map(p => p.trim()).filter(Boolean))].sort().join('|') || s
}

const inRangeNum = (v: number | null | undefined, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null

/** One reading per (source, day) from Apple Health's weight / body fat % /
 *  lean mass points (the day's last value of each), plus the photo reports.
 *  A reading needs a weight and a body fat % from the SAME source that day. */
export function compositionReadings(apple: AppleScalePoint[], reports: ScaleReport[]): CompositionReading[] {
  const byKey = new Map<string, { date: string; source: string; kg?: number; fat?: number; lean?: number }>()
  for (const p of [...apple].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))) {
    const source = canonicalSource(p.source)
    const key = `${source}\u0000${p.date}`
    const cur = byKey.get(key) ?? { date: p.date, source }
    if (p.metric === 'weight_body_mass') cur.kg = inRangeNum(p.value, 25, 300) ?? cur.kg
    // Apple stores body fat either as a fraction (0.18) or a percentage (18).
    else if (p.metric === 'body_fat_percentage') cur.fat = inRangeNum(p.value <= 1 ? p.value * 100 : p.value, 2, 75) ?? cur.fat
    else if (p.metric === 'lean_body_mass') cur.lean = inRangeNum(p.value, 15, 200) ?? cur.lean
    byKey.set(key, cur)
  }
  const out: CompositionReading[] = []
  for (const r of byKey.values()) {
    if (r.kg == null) continue
    const fatMass = r.fat != null ? (r.kg * r.fat) / 100 : null
    out.push({
      date: r.date, source: r.source, weightKg: r.kg, fatPct: r.fat ?? null, fatMassKg: fatMass,
      leanMassKg: r.lean ?? (fatMass != null ? r.kg - fatMass : null), muscleMassKg: null,
    })
  }
  const lastReport = new Map<string, ScaleReport>()
  for (const r of reports) lastReport.set(r.date, r)
  for (const r of lastReport.values()) {
    const kg = inRangeNum(r.weightKg, 25, 300)
    if (kg == null) continue
    out.push({
      date: r.date, source: REPORT_SOURCE, weightKg: kg, fatPct: inRangeNum(r.fatPct, 2, 75),
      fatMassKg: inRangeNum(r.fatMassKg, 0, 200), leanMassKg: inRangeNum(r.leanMassKg, 15, 200),
      muscleMassKg: r.musclePct != null && inRangeNum(r.musclePct, 10, 95) != null ? (kg * r.musclePct) / 100 : null,
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source))
}

// ── trends ─────────────────────────────────────────────────────────────────
export const MIN_READINGS = 4
export const MIN_SPAN_DAYS = 14
/** A fitted change smaller than this is inside bioimpedance noise (Looney 2024). */
export const MIN_MASS_CHANGE_KG = 0.5
export const MIN_FAT_PCT_CHANGE = 0.6

export interface SeriesTrend {
  n: number
  spanDays: number
  firstDate: string
  lastDate: string
  slopePerDay: number
  perWeek: number
  /** Fitted change between the first and the last reading. */
  change: number
  /** Fitted value at the last reading. */
  current: number
  /** Larger than both the noise floor and twice its own standard error. */
  significant: boolean
}

export function fitSeries(points: { date: string; value: number }[], minChange: number): SeriesTrend | null {
  const pts = [...points].sort((a, b) => a.date.localeCompare(b.date))
  if (pts.length < MIN_READINGS) return null
  const first = pts[0].date, last = pts[pts.length - 1].date
  const span = daysBetween(first, last)
  if (span < MIN_SPAN_DAYS) return null
  const fit = linearFit(pts.map(p => daysBetween(first, p.date)), pts.map(p => p.value))
  if (!fit) return null
  const change = fit.slope * span
  const seChange = (fit.se ?? 0) * span
  return {
    n: pts.length, spanDays: span, firstDate: first, lastDate: last,
    slopePerDay: fit.slope, perWeek: fit.slope * 7, change,
    current: fit.intercept + fit.slope * span,
    significant: Math.abs(change) >= Math.max(minChange, 2 * seChange),
  }
}

// ── fat vs muscle ──────────────────────────────────────────────────────────
export type CompositionVerdict =
  | 'recomp' | 'fat_loss_lean_kept' | 'fat_loss_some_lean' | 'losing_lean'
  | 'lean_gain' | 'lean_gain_some_fat' | 'mostly_fat_gain' | 'fat_gain_lean_loss'
  | 'stable' | 'not_enough_data'

export interface CompositionResult {
  verdict: CompositionVerdict
  source: string | null
  /** Sources left out of the trend because another one had more readings. */
  otherSources: string[]
  readings: number
  spanDays: number
  fat: SeriesTrend | null
  lean: SeriesTrend | null
  fatPct: SeriesTrend | null
  /** Photo reports only (muscle % × weight). */
  muscle: SeriesTrend | null
  /** Lean's share of the weight change when fat and lean move the same way. */
  leanShare: number | null
  confidence: 'low' | 'medium' | 'high' | null
  /** Why there is no verdict, when there isn't. */
  missing: string | null
}

/** The source with the most body-fat readings in [from, to] (ties → newest). */
export function pickSource(readings: CompositionReading[], from: string, to: string): { source: string | null; others: string[] } {
  const counts = new Map<string, { n: number; last: string }>()
  for (const r of readings) {
    if (r.date < from || r.date > to || r.fatMassKg == null) continue
    const c = counts.get(r.source) ?? { n: 0, last: r.date }
    c.n++; if (r.date > c.last) c.last = r.date
    counts.set(r.source, c)
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1].n - a[1].n || b[1].last.localeCompare(a[1].last))
  return { source: ranked[0]?.[0] ?? null, others: ranked.slice(1).map(([s]) => s) }
}

const dir = (t: SeriesTrend | null) => (!t || !t.significant ? 0 : t.change > 0 ? 1 : -1)

export function analyseComposition(readings: CompositionReading[], from: string, to: string): CompositionResult {
  const { source, others } = pickSource(readings, from, to)
  const own = readings.filter(r => r.source === source && r.date >= from && r.date <= to)
  const series = (pick: (r: CompositionReading) => number | null, list = own) =>
    list.flatMap(r => { const v = pick(r); return v == null ? [] : [{ date: r.date, value: v }] })
  const fat = fitSeries(series(r => r.fatMassKg), MIN_MASS_CHANGE_KG)
  const lean = fitSeries(series(r => r.leanMassKg), MIN_MASS_CHANGE_KG)
  const fatPct = fitSeries(series(r => r.fatPct), MIN_FAT_PCT_CHANGE)
  const reportsIn = readings.filter(r => r.source === REPORT_SOURCE && r.date >= from && r.date <= to)
  const muscle = fitSeries(series(r => r.muscleMassKg, reportsIn), MIN_MASS_CHANGE_KG)
  const spanDays = own.length ? daysBetween(own[0].date, own[own.length - 1].date) : 0
  const base = { source, otherSources: others, readings: own.length, spanDays, fat, lean, fatPct, muscle }

  if (!fat || !lean) {
    const missing = !source ? 'No smart-scale readings with body fat in this window.'
      : own.length < MIN_READINGS ? `${own.length} scale reading${own.length === 1 ? '' : 's'} in this window — needs ${MIN_READINGS}.`
      : `Scale readings span ${spanDays} days — needs ${MIN_SPAN_DAYS} to tell fat from water swings.`
    return { ...base, verdict: 'not_enough_data', leanShare: null, confidence: null, missing }
  }

  const f = dir(fat), l = dir(lean)
  const absF = Math.abs(fat.change), absL = Math.abs(lean.change)
  const sameWay = f !== 0 && f === l
  const leanShare = sameWay ? Math.round((absL / (absF + absL)) * 100) / 100 : null
  let verdict: CompositionVerdict
  if (f < 0 && l > 0) verdict = 'recomp'
  else if (f < 0 && l === 0) verdict = 'fat_loss_lean_kept'
  else if (f < 0 && l < 0) verdict = (leanShare ?? 0) > 0.5 ? 'losing_lean' : 'fat_loss_some_lean'
  else if (f === 0 && l < 0) verdict = 'losing_lean'
  else if (f > 0 && l < 0) verdict = 'fat_gain_lean_loss'
  else if (f > 0 && l === 0) verdict = 'mostly_fat_gain'
  else if (f > 0 && l > 0) verdict = 1 - (leanShare ?? 0) > 0.5 ? 'mostly_fat_gain' : 'lean_gain_some_fat'
  else if (f === 0 && l > 0) verdict = 'lean_gain'
  else verdict = 'stable'

  const n = Math.min(fat.n, lean.n)
  const confidence = n >= 12 && fat.spanDays >= 28 ? 'high' : n >= 6 && fat.spanDays >= 21 ? 'medium' : 'low'
  return { ...base, verdict, leanShare, confidence, missing: null }
}

// ── goals ──────────────────────────────────────────────────────────────────
export type GoalKind = 'weight' | 'bodyFat' | 'muscle'
export type GoalStatus = 'reached' | 'moving_toward' | 'moving_away' | 'flat' | 'no_trend' | 'no_data'

export interface GoalProgress {
  kind: GoalKind
  goal: number
  current: number | null
  currentDate: string | null
  start: number | null
  startDate: string | null
  /** goal − current (signed). */
  remaining: number | null
  /** Share of start → goal covered, 0..1; null without a start. */
  progress: number | null
  /** Signed trend per week. */
  perWeek: number | null
  status: GoalStatus
  eta: { days: number; date: string } | 'too_far' | null
}

/** How close counts as "there" — about the measurement's own resolution. */
export const GOAL_TOLERANCE: Record<GoalKind, number> = { weight: 0.3, bodyFat: 0.5, muscle: 0.3 }
export const MAX_ETA_DAYS = 730

export interface GoalSeries {
  /** Every reading of the series (any date), oldest first. */
  points: { date: string; value: number }[]
  /** The window's trend, if there is one. */
  trend: { slopePerDay: number; current: number; lastDate: string; significant: boolean } | null
}

/** Mean of the first week of readings on/after `phaseStart` — the baseline. */
export function startValue(points: { date: string; value: number }[], phaseStart: string | null): { value: number; date: string } | null {
  if (!phaseStart) return null
  const after = points.filter(p => p.date >= phaseStart).sort((a, b) => a.date.localeCompare(b.date))
  if (!after.length) return null
  const firstDate = after[0].date
  const week = after.filter(p => daysBetween(firstDate, p.date) < 7)
  return { value: week.reduce((a, p) => a + p.value, 0) / week.length, date: firstDate }
}

export function goalProgress(kind: GoalKind, goal: number | null, s: GoalSeries, phaseStart: string | null): GoalProgress | null {
  if (goal == null || !Number.isFinite(goal)) return null
  const pts = [...s.points].sort((a, b) => a.date.localeCompare(b.date))
  const latest = pts[pts.length - 1] ?? null
  const current = s.trend?.current ?? latest?.value ?? null
  const currentDate = s.trend?.lastDate ?? latest?.date ?? null
  const start = startValue(pts, phaseStart)
  const base = { kind, goal, currentDate, start: start?.value ?? null, startDate: start?.date ?? null, perWeek: s.trend ? s.trend.slopePerDay * 7 : null }
  if (current == null) return { ...base, current: null, remaining: null, progress: null, status: 'no_data', eta: null }

  const tol = GOAL_TOLERANCE[kind]
  const remaining = goal - current
  const way = start && Math.abs(goal - start.value) > tol ? Math.sign(goal - start.value) : Math.sign(remaining)
  const progress = start && Math.abs(goal - start.value) > tol
    ? Math.min(1, Math.max(0, (current - start.value) / (goal - start.value))) : null
  const reached = Math.abs(remaining) <= tol || (way !== 0 && Math.sign(remaining) === -way)
  const out = { ...base, current, remaining, progress }
  if (reached) return { ...out, progress: progress != null ? 1 : null, status: 'reached', eta: null }
  if (!s.trend) return { ...out, status: 'no_trend', eta: null }
  if (!s.trend.significant || s.trend.slopePerDay === 0) return { ...out, status: 'flat', eta: null }
  if (Math.sign(s.trend.slopePerDay) !== Math.sign(remaining)) return { ...out, status: 'moving_away', eta: null }
  const days = Math.ceil(Math.round((Math.abs(remaining) / Math.abs(s.trend.slopePerDay)) * 1e6) / 1e6)
  return { ...out, status: 'moving_toward', eta: days > MAX_ETA_DAYS ? 'too_far' : { days, date: addDays(s.trend.lastDate, days) } }
}
