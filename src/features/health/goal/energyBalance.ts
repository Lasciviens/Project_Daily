// Cut report — does the scale agree with the calorie numbers? Pure and
// import-free (scripts/verify-energy-balance.cjs).
//
// Three independent measurements meet here:
//   intake       — the food diary (eaten food_log_entries), LOGGED days only
//   expenditure  — Apple Health active + basal energy per day
//   weight       — the merged bodyweight series (Hevy > smart scale > Apple)
// If all three were perfect, (Apple burn − intake) × days ÷ energy density
// would equal the weight the trend line lost. They never are, so the report
// works backwards too: the OBSERVED burn ("observed TDEE") is the intake plus
// the energy the weight change stands for, and the gap between that and
// Apple's figure says which way the numbers disagree.
//
// ENERGY DENSITY — 7,700 kcal per kg of weight lost (3,500 kcal/lb, 32.2 MJ/kg).
//   Hall KD. What is the required energy deficit per unit weight loss?
//   Int J Obes 2008;32:573-576 (PMID 17848938): the classic rule; the real
//   figure depends on body fat and on how far into the diet you are.
//   Pure fat is ~9,400 kcal/kg (39.5 MJ/kg) and fat-free tissue ~1,100-1,800
//   kcal/kg, so 7,700 is a mixed-tissue average (Hall 2008, PLoS Comput Biol
//   "The dynamics of human body weight change").
//   Thomas DM et al. Energy content of weight loss: kinetic features during
//   voluntary caloric restriction. Metabolism 2013 (PMC3810417): early loss is
//   glycogen, protein and water, so the first weeks carry LESS energy per kg —
//   weight drops faster than the deficit predicts at the start of a cut.
// A lean person loses more lean tissue per kg than an obese one, so for a lean
// lifter 7,700 is if anything a slight overestimate — treat every kcal figure
// below as ±15 %, not exact.
//
// WHY THE NUMBERS USUALLY DISAGREE (the "likely reason" copy):
//   • Food records under-report intake by roughly 19-41 % against doubly
//     labelled water (reviews of DLW validation studies; lean non-athletic
//     groups 0 to −20 %, obese groups larger). Missed snacks, oils and
//     portions are the usual cause.
//   • Wrist wearables overestimate energy expenditure; the Apple Watch's mean
//     error was ~28 % across activities in a 2025 living systematic review
//     (npj Digit Med 2025, s41746-025-02238-1), mostly in the overestimating
//     direction for active energy.
// Both push the same way: the logged deficit looks bigger than the real one,
// so "slower than your numbers say" is the common result, not a failure.
//
// RATE — Garthe I et al. Effect of two different weight-loss rates on body
//   composition and strength and power-related performance in elite athletes.
//   Int J Sport Nutr Exerc Metab 2011;21:97-104 (PMID 21558571): at ~0.7 % of
//   bodyweight a week lean mass ROSE 2.1 %; at ~1.4 % it was unchanged. The
//   authors: 0.7 %/wk to gain lean mass, up to 1.0-1.4 %/wk to keep it.
//
// PROTEIN — Morton RW et al. Br J Sports Med 2018 (PMID 28698222): no further
//   fat-free-mass gain above 1.62 g/kg/day (95 % CI 1.03-2.20; the breakpoint
//   was not statistically significant, so 1.6 is a floor, not a ceiling; the
//   authors suggest ~2.2 to maximise). Helms ER et al. Int J Sport Nutr Exerc
//   Metab 2014 (PMID 24092765): lean, trained people in a deficit likely need
//   2.3-3.1 g per kg of FAT-FREE mass.

export const ENERGY_DENSITY_KCAL_PER_KG = 7700

// A finished day under this many kcal of Apple energy is a coverage gap
// (watch off, sync missing) — basal alone is ~1,600-2,400. Same bar the Health
// page's Energy section uses (MIN_COMPLETE_DAY_KCAL).
export const MIN_APPLE_DAY_KCAL = 1550
// A diary day under this is almost certainly half-logged (a coffee and a
// snack), not a real 600 kcal day; it's counted as partial and left out of
// the average so it can't fake a huge deficit.
export const MIN_LOGGED_DAY_KCAL = 800
// Weight trend differences smaller than this (kcal/day) are inside what the
// method can resolve over a few weeks of daily weigh-ins.
export const MATCH_TOLERANCE_KCAL = 200
// The first weeks of a cut lose glycogen and water (Thomas 2013).
export const EARLY_PHASE_DAYS = 21

export interface IntakeDay { date: string; kcal: number; proteinG: number }
export interface EnergyDay { date: string; activeKcal: number | null; basalKcal: number | null }
export interface WeighIn { date: string; kg: number }
export interface ScaleReading { date: string; weightKg: number; fatMassKg: number | null; leanMassKg: number | null }

export interface CutInputs {
  /** Inclusive days. `to` should be the last COMPLETE day (yesterday). */
  from: string
  to: string
  intake: IntakeDay[]
  energy: EnergyDay[]
  /** Merged weigh-ins; readings up to the day after `to` are used (a morning
   *  weigh-in reflects the day before), earlier ones feed the moving average. */
  weights: WeighIn[]
  scale?: ScaleReading[]
  goal?: 'cut' | 'maintain' | 'gain' | null
  targetKcal?: number | null
  goalWeightKg?: number | null
  /** The day the cut started, if known — flags the water-heavy early weeks. */
  cutStartDate?: string | null
  energyDensity?: number
}

export type Verdict = 'on_track' | 'slower' | 'faster'
export type Confidence = 'low' | 'medium' | 'high'
export type RateBand = 'gaining' | 'stalled' | 'slow' | 'target' | 'fast' | 'very_fast'
export type ProteinBand = 'below_floor' | 'in_range' | 'high'
export type Reason =
  | 'intake_underlogged' | 'partial_logging' | 'apple_overestimates'
  | 'early_water' | 'short_window' | 'apple_underestimates' | 'intake_overlogged'

export interface TrendPoint { date: string; kg: number; avg7: number }

export interface CutReport {
  days: number
  intake: { loggedDays: number; partialDays: number; completeness: number; meanKcal: number | null; meanProteinG: number | null }
  apple: { days: number; meanActive: number | null; meanBasal: number | null; meanTdee: number | null }
  /** Apple burn − logged intake, per day. Positive = a deficit. */
  loggedDeficit: number | null
  weight: {
    weighIns: number
    spanDays: number
    series: TrendPoint[]
    slopeKgPerDay: number | null
    /** Standard error of the slope (kg/day) — the trend's own noise. */
    slopeSe: number | null
    kgPerWeek: number | null
    /** Positive = losing. */
    pctPerWeek: number | null
    meanKg: number | null
    currentTrendKg: number | null
    changeKg: number | null
  }
  /** Weight change the logged deficit predicts over the window (negative = loss). */
  expectedChangeKg: number | null
  /** Intake + energy the weight change stands for, per day. */
  observedTdee: number | null
  /** observedTdee − Apple TDEE. Negative = you burn less than Apple says (or eat more than logged). */
  tdeeGap: number | null
  verdict: Verdict | null
  reasons: Reason[]
  confidence: Confidence | null
  confidenceNotes: string[]
  /** What stops a verdict, in plain words. Empty when there is one. */
  missing: string[]
  earlyPhase: boolean
  rate: RateBand | null
  protein: { gPerKg: number | null; band: ProteinBand | null; gPerKgFfm: number | null }
  composition: { from: string; to: string; fatChangeKg: number | null; leanChangeKg: number | null; leanShareOfLoss: number | null } | null
  projection: { goalKg: number; days: number; date: string } | 'not_losing' | 'reached' | 'too_far' | null
  plannedDeficit: number | null
}

// ── date helpers (UTC-safe, no timezone) ───────────────────────────────────
function dayNum(d: string): number {
  const [y, m, dd] = d.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, dd) / 86_400_000)
}
function fromDayNum(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10)
}
export function daysBetween(a: string, b: string): number { return dayNum(b) - dayNum(a) }
export function addDays(d: string, n: number): string { return fromDayNum(dayNum(d) + n) }

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const round = (v: number | null, dp = 0) => (v == null ? null : Math.round(v * 10 ** dp) / 10 ** dp)

/** Ordinary least squares of y on x; slope, intercept and the slope's SE. */
export function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number; se: number | null } | null {
  const n = xs.length
  if (n < 2) return null
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxx = 0, sxy = 0
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my) }
  if (sxx === 0) return null
  const slope = sxy / sxx
  const intercept = my - slope * mx
  let sse = 0
  for (let i = 0; i < n; i++) sse += (ys[i] - (intercept + slope * xs[i])) ** 2
  const se = n > 2 ? Math.sqrt(sse / (n - 2) / sxx) : null
  return { slope, intercept, se }
}

/** Trailing 7-day mean of the weigh-ins (not of calendar days — a missing
 *  weigh-in isn't a zero). */
export function movingAverage7(weights: WeighIn[]): TrendPoint[] {
  const sorted = [...weights].sort((a, b) => a.date.localeCompare(b.date))
  return sorted.map(w => {
    const win = sorted.filter(o => daysBetween(o.date, w.date) >= 0 && daysBetween(o.date, w.date) < 7)
    return { date: w.date, kg: w.kg, avg7: round(mean(win.map(o => o.kg)) as number, 2) as number }
  })
}

export function rateBand(pctLossPerWeek: number): RateBand {
  if (pctLossPerWeek < -0.1) return 'gaining'
  if (pctLossPerWeek < 0.25) return 'stalled'
  if (pctLossPerWeek < 0.5) return 'slow'
  if (pctLossPerWeek <= 1.0) return 'target'
  if (pctLossPerWeek <= 1.4) return 'fast'
  return 'very_fast'
}

export function proteinBand(gPerKg: number): ProteinBand {
  if (gPerKg < 1.6) return 'below_floor'
  if (gPerKg <= 2.2) return 'in_range'
  return 'high'
}

export function buildCutReport(inp: CutInputs): CutReport {
  const density = inp.energyDensity ?? ENERGY_DENSITY_KCAL_PER_KG
  const days = daysBetween(inp.from, inp.to) + 1
  const inWin = (d: string) => d >= inp.from && d <= inp.to

  // ── intake (logged days only) ─────────────────────────────────────────────
  const intakeByDate = new Map<string, { kcal: number; p: number }>()
  for (const r of inp.intake) {
    if (!inWin(r.date)) continue
    const cur = intakeByDate.get(r.date) ?? { kcal: 0, p: 0 }
    cur.kcal += r.kcal || 0; cur.p += r.proteinG || 0
    intakeByDate.set(r.date, cur)
  }
  const fullDays = [...intakeByDate.values()].filter(v => v.kcal >= MIN_LOGGED_DAY_KCAL)
  const partialDays = [...intakeByDate.values()].filter(v => v.kcal > 0 && v.kcal < MIN_LOGGED_DAY_KCAL).length
  const meanKcal = mean(fullDays.map(v => v.kcal))
  const meanProteinG = mean(fullDays.map(v => v.p))
  const completeness = days > 0 ? fullDays.length / days : 0

  // ── Apple expenditure (complete days only) ────────────────────────────────
  const appleDays = inp.energy.filter(e => inWin(e.date)
    && (e.activeKcal ?? 0) + (e.basalKcal ?? 0) > MIN_APPLE_DAY_KCAL && e.basalKcal != null)
  const meanActive = mean(appleDays.map(e => e.activeKcal ?? 0))
  const meanBasal = mean(appleDays.map(e => e.basalKcal ?? 0))
  const meanTdee = mean(appleDays.map(e => (e.activeKcal ?? 0) + (e.basalKcal ?? 0)))
  const loggedDeficit = meanTdee != null && meanKcal != null ? meanTdee - meanKcal : null

  // ── weight trend ──────────────────────────────────────────────────────────
  const weightEnd = addDays(inp.to, 1)
  const valid = inp.weights.filter(w => Number.isFinite(w.kg) && w.kg > 0)
  const trendWeights = valid.filter(w => w.date >= inp.from && w.date <= weightEnd)
    .sort((a, b) => a.date.localeCompare(b.date))
  const ma = movingAverage7(valid.filter(w => w.date >= addDays(inp.from, -6) && w.date <= weightEnd))
  const series = ma.filter(p => p.date >= inp.from)
  const spanDays = trendWeights.length ? daysBetween(trendWeights[0].date, trendWeights[trendWeights.length - 1].date) : 0
  const fit = linearFit(trendWeights.map(w => daysBetween(inp.from, w.date)), trendWeights.map(w => w.kg))
  const slope = trendWeights.length >= 2 ? fit?.slope ?? null : null
  const meanKg = mean(trendWeights.map(w => w.kg))
  const currentTrendKg = fit && trendWeights.length >= 2
    ? fit.intercept + fit.slope * daysBetween(inp.from, trendWeights[trendWeights.length - 1].date) : null
  const kgPerWeek = slope != null ? slope * 7 : null
  const pctPerWeek = kgPerWeek != null && meanKg ? (-kgPerWeek / meanKg) * 100 : null
  const changeKg = slope != null ? slope * days : null

  // ── energy balance ────────────────────────────────────────────────────────
  const expectedChangeKg = loggedDeficit != null ? (-loggedDeficit * days) / density : null
  const observedTdee = meanKcal != null && slope != null ? meanKcal - slope * density : null
  const tdeeGap = observedTdee != null && meanTdee != null ? observedTdee - meanTdee : null

  // ── enough data for a verdict? ────────────────────────────────────────────
  const needDays = Math.max(7, Math.ceil(days * 0.6))
  const needSpan = Math.max(10, Math.ceil(days * 0.5))
  const missing: string[] = []
  if (fullDays.length < needDays) missing.push(`Food logged on ${fullDays.length} of ${days} days — needs ${needDays}.`)
  if (appleDays.length < needDays) missing.push(`Complete Apple energy on ${appleDays.length} of ${days} days — needs ${needDays}.`)
  if (trendWeights.length < 4) missing.push(`${trendWeights.length} weigh-in${trendWeights.length === 1 ? '' : 's'} in the window — needs 4.`)
  else if (spanDays < needSpan) missing.push(`Weigh-ins span ${spanDays} days — needs ${needSpan}.`)

  const earlyPhase = !!inp.cutStartDate && daysBetween(inp.cutStartDate, inp.from) < EARLY_PHASE_DAYS
    && daysBetween(inp.cutStartDate, inp.to) >= 0

  let verdict: Verdict | null = null
  const reasons: Reason[] = []
  let confidence: Confidence | null = null
  const confidenceNotes: string[] = []

  if (!missing.length && tdeeGap != null) {
    const seKcal = fit?.se != null ? fit.se * density : 0
    const tol = Math.max(MATCH_TOLERANCE_KCAL, 1.5 * seKcal)
    if (Math.abs(tdeeGap) <= tol) verdict = 'on_track'
    else if (tdeeGap < 0) {
      verdict = 'slower'
      if (completeness < 0.85 || partialDays > 0) reasons.push('partial_logging')
      reasons.push('intake_underlogged', 'apple_overestimates')
    } else {
      verdict = 'faster'
      if (earlyPhase) reasons.push('early_water')
      if (days <= 14) reasons.push('short_window')
      reasons.push('apple_underestimates', 'intake_overlogged')
    }

    // Confidence: how much the window can support, not how sure the model is.
    let score = 0
    if (days >= 28) score++; else confidenceNotes.push(`${days}-day window — daily water swings weigh more in a short one.`)
    if (completeness >= 0.85) score++; else confidenceNotes.push(`Food logged on ${Math.round(completeness * 100)} % of days.`)
    if (trendWeights.length >= Math.min(12, Math.ceil(days * 0.5))) score++
    else confidenceNotes.push(`${trendWeights.length} weigh-ins — daily weighing tightens the trend.`)
    if (seKcal <= 150) score++; else confidenceNotes.push(`The weight trend is noisy (±${Math.round(seKcal)} kcal/day).`)
    confidence = score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low'
    if (earlyPhase) {
      confidenceNotes.push('Early weeks of a cut — part of the loss is glycogen and water.')
      if (confidence === 'high') confidence = 'medium'
    }
  }

  // ── rate, protein, composition, projection ────────────────────────────────
  const rate = pctPerWeek != null && trendWeights.length >= 4 && spanDays >= 7 ? rateBand(pctPerWeek) : null

  const scaleIn = (inp.scale ?? []).filter(s => inWin(s.date) || s.date === weightEnd)
    .sort((a, b) => a.date.localeCompare(b.date))
  const latestScale = [...(inp.scale ?? [])].sort((a, b) => a.date.localeCompare(b.date)).pop() ?? null
  const kgForProtein = currentTrendKg ?? meanKg
  const gPerKg = meanProteinG != null && kgForProtein ? meanProteinG / kgForProtein : null
  const ffm = latestScale?.leanMassKg ?? null
  const protein = {
    gPerKg: round(gPerKg, 2),
    band: gPerKg != null ? proteinBand(gPerKg) : null,
    gPerKgFfm: meanProteinG != null && ffm ? round(meanProteinG / ffm, 2) : null,
  }

  let composition: CutReport['composition'] = null
  if (scaleIn.length >= 2) {
    const a = scaleIn[0], b = scaleIn[scaleIn.length - 1]
    if (daysBetween(a.date, b.date) >= 7) {
      const fat = a.fatMassKg != null && b.fatMassKg != null ? b.fatMassKg - a.fatMassKg : null
      const lean = a.leanMassKg != null && b.leanMassKg != null ? b.leanMassKg - a.leanMassKg : null
      const lost = a.weightKg - b.weightKg
      composition = {
        from: a.date, to: b.date,
        fatChangeKg: round(fat, 2), leanChangeKg: round(lean, 2),
        leanShareOfLoss: lean != null && lost > 0.3 ? round(Math.max(0, -lean) / lost, 2) : null,
      }
    }
  }

  let projection: CutReport['projection'] = null
  if (inp.goalWeightKg && currentTrendKg != null && slope != null && trendWeights.length >= 4) {
    const gap = currentTrendKg - inp.goalWeightKg
    if (gap <= 0) projection = 'reached'
    else if (slope >= -0.005) projection = 'not_losing'
    else {
      const d = Math.ceil(Math.round((gap / -slope) * 1e6) / 1e6)
      projection = d > 730 ? 'too_far' : { goalKg: inp.goalWeightKg, days: d, date: addDays(trendWeights[trendWeights.length - 1].date, d) }
    }
  }

  return {
    days,
    intake: { loggedDays: fullDays.length, partialDays, completeness: round(completeness, 2) as number, meanKcal: round(meanKcal), meanProteinG: round(meanProteinG) },
    apple: { days: appleDays.length, meanActive: round(meanActive), meanBasal: round(meanBasal), meanTdee: round(meanTdee) },
    loggedDeficit: round(loggedDeficit),
    weight: {
      weighIns: trendWeights.length, spanDays, series,
      slopeKgPerDay: round(slope, 4), slopeSe: round(fit?.se ?? null, 4),
      kgPerWeek: round(kgPerWeek, 2), pctPerWeek: round(pctPerWeek, 2),
      meanKg: round(meanKg, 1), currentTrendKg: round(currentTrendKg, 1), changeKg: round(changeKg, 2),
    },
    expectedChangeKg: round(expectedChangeKg, 2),
    observedTdee: round(observedTdee),
    tdeeGap: round(tdeeGap),
    verdict, reasons, confidence, confidenceNotes, missing, earlyPhase, rate, protein, composition, projection,
    plannedDeficit: meanTdee != null && inp.targetKcal ? round(meanTdee - inp.targetKcal) : null,
  }
}
