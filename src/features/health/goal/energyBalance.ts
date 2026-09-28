// Goal progress — does the scale agree with the calorie numbers? Pure and
// import-free (scripts/verify-energy-balance.cjs). The phase-aware verdicts
// (pace, fat vs muscle, goals) live in bodyGoal.ts on top of this.
//
// Three independent measurements meet here:
//   intake       — the food diary (eaten food_log_entries), LOGGED days only
//   expenditure  — Apple Health active + basal energy per day
//   weight       — the merged bodyweight series (bodyweight.ts)
// If all three were perfect, (Apple burn − intake) × days ÷ energy density
// would equal the weight the trend line lost (or gained). They never are, so
// the report works backwards too: the OBSERVED burn ("observed TDEE") is the
// intake plus the energy the weight change stands for, and the gap between
// that and Apple's figure says which way the numbers disagree. The same math
// runs for a deficit (cut), a surplus (gain) or neither (maintain).
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
// below as ±15 %, not exact. The same figure is used for weight GAINED: a
// surplus stores a similar fat/lean mix, and the first weeks of a gain refill
// glycogen and water, so weight rises faster than the surplus predicts.
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
// RATE — the phase-aware pace bands (Garthe 2011, Helms 2014, Iraki 2019)
//   live in bodyGoal.ts.
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
// the average so it can't fake a huge deficit. With a calorie target the bar
// is relative instead (halfLoggedCutoff): a day logged at 1,400 against a
// 2,500 target is a forgotten dinner, not a real 1,400 kcal day.
export const MIN_LOGGED_DAY_KCAL = 800
/** A logged day under this share of the day's calorie target is half-logged. */
export const HALF_LOGGED_SHARE = 0.6
// Weight trend differences smaller than this (kcal/day) are inside what the
// method can resolve over a few weeks of daily weigh-ins.
export const MATCH_TOLERANCE_KCAL = 200
// The first week or two of a cut lose glycogen and water (Thomas 2013); the
// first weeks of a gain put them back. That shift inflates a window which
// contains the phase start or begins less than this many days after it; a
// window that starts later already has it behind it.
export const EARLY_PHASE_DAYS = 7

export type Phase = 'cut' | 'maintain' | 'gain'

export interface IntakeDay { date: string; kcal: number; proteinG: number }
export interface EnergyDay { date: string; activeKcal: number | null; basalKcal: number | null }
export interface WeighIn { date: string; kg: number }

export interface EnergyInputs {
  /** Inclusive days. `to` should be the last COMPLETE day (yesterday). */
  from: string
  to: string
  intake: IntakeDay[]
  energy: EnergyDay[]
  /** Merged weigh-ins; readings up to the day after `to` are used (a morning
   *  weigh-in reflects the day before), earlier ones feed the moving average. */
  weights: WeighIn[]
  goal?: Phase | null
  targetKcal?: number | null
  /** The day the current cut/gain started, if known — flags the water-heavy
   *  early weeks. */
  phaseStartDate?: string | null
  /** Latest lean mass from the scale, for protein per kg of fat-free mass. */
  leanMassKg?: number | null
  energyDensity?: number
}

export type Verdict = 'on_track' | 'slower' | 'faster'
export type Confidence = 'low' | 'medium' | 'high'
export type ProteinBand = 'below_floor' | 'in_range' | 'high'
export type Reason =
  | 'intake_underlogged' | 'partial_logging' | 'apple_overestimates'
  | 'early_water' | 'short_window' | 'apple_underestimates' | 'intake_overlogged'

export interface TrendPoint { date: string; kg: number; avg7: number }

/** Why a day of the window was left out of the calorie comparison — food
 *  reasons first, so a day with neither counts once, as "no food". */
export type DayUse = 'used' | 'no_food' | 'half_logged' | 'apple_gap'

export interface BalanceDay {
  date: string
  /** Logged kcal (0 = nothing logged). */
  intakeKcal: number
  /** Apple active + basal, or null with no Apple energy at all. */
  burnKcal: number | null
  use: DayUse
}

/** The days that have BOTH a full diary and a complete Apple day — the only
 *  days where "burned − eaten" means anything. */
export interface PairedBalance {
  days: number
  meanBurn: number | null
  meanActive: number | null
  meanBasal: number | null
  meanIntake: number | null
  /** mean(burn − intake) over those days. Positive = a deficit. */
  deficit: number | null
  /** The day's logged kcal under this = half-logged. */
  halfLoggedBelow: number
  excluded: { noFood: number; halfLogged: number; appleGap: number }
}

export interface RecentBalance { days: number; meanBurn: number | null; meanIntake: number | null; deficit: number | null }

export interface EnergyReport {
  days: number
  intake: { loggedDays: number; partialDays: number; completeness: number; meanKcal: number | null; meanProteinG: number | null }
  apple: { days: number; meanActive: number | null; meanBasal: number | null; meanTdee: number | null }
  /** Day by day, and the days both sources cover. */
  daysDetail: BalanceDay[]
  paired: PairedBalance
  /** The same comparison over the window's last 7 days — the span Activity's
   *  and Food's 7-day views cover — or null when the window is 7 days or less. */
  recent7: RecentBalance | null
  /** Apple burn − logged intake per day, over the paired days only (a day
   *  with Apple energy but no diary would add burn and no food). Positive =
   *  a deficit. */
  loggedDeficit: number | null
  /** The deficit the weight trend stands for: −trend kg/day × energy density.
   *  Positive = a deficit. Independent of the diary and of Apple. */
  scaleDeficit: number | null
  weight: {
    weighIns: number
    spanDays: number
    series: TrendPoint[]
    slopeKgPerDay: number | null
    /** Standard error of the slope (kg/day) — the trend's own noise. */
    slopeSe: number | null
    kgPerWeek: number | null
    /** Positive = losing (a share of the mean weight). */
    pctPerWeek: number | null
    meanKg: number | null
    currentTrendKg: number | null
    changeKg: number | null
  }
  /** Weight change the logged deficit predicts over the window (negative = loss). */
  expectedChangeKg: number | null
  /** Intake + energy the weight change stands for, per day (paired days). */
  observedTdee: number | null
  /** observedTdee − Apple TDEE on the same days. Negative = you burn less than Apple says (or eat more than logged). */
  tdeeGap: number | null
  verdict: Verdict | null
  reasons: Reason[]
  confidence: Confidence | null
  confidenceNotes: string[]
  /** What stops a verdict, in plain words. Empty when there is one. */
  missing: string[]
  earlyPhase: boolean
  /** Enough weigh-ins for a pace: 4+ spanning a week. */
  hasTrend: boolean
  protein: { gPerKg: number | null; band: ProteinBand | null; gPerKgFfm: number | null }
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

/** burn − intake over the used days among `days` (BalanceDay rows). */
export function balanceOver(days: readonly BalanceDay[]): RecentBalance {
  const used = days.filter(d => d.use === 'used' && d.burnKcal != null)
  return {
    days: used.length,
    meanBurn: round(mean(used.map(d => d.burnKcal as number))),
    meanIntake: round(mean(used.map(d => d.intakeKcal))),
    deficit: round(mean(used.map(d => (d.burnKcal as number) - d.intakeKcal))),
  }
}

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

export function proteinBand(gPerKg: number): ProteinBand {
  if (gPerKg < 1.6) return 'below_floor'
  if (gPerKg <= 2.2) return 'in_range'
  return 'high'
}

/** Days of food / Apple energy a window needs before a verdict. */
export function neededDays(days: number): number { return Math.max(7, Math.ceil(days * 0.6)) }

/** The logged-kcal bar under which a day counts as half-logged: 60 % of the
 *  calorie target (to the nearest 50), never under 800. Without a target, 800. */
export function halfLoggedCutoff(targetKcal?: number | null): number {
  if (!targetKcal || !Number.isFinite(targetKcal) || targetKcal <= 0) return MIN_LOGGED_DAY_KCAL
  return Math.max(MIN_LOGGED_DAY_KCAL, Math.round((targetKcal * HALF_LOGGED_SHARE) / 50) * 50)
}

/** A finished day with enough Apple energy to be a whole day (basal present). */
export function isCompleteAppleDay(e: Pick<EnergyDay, 'activeKcal' | 'basalKcal'>): boolean {
  return e.basalKcal != null && (e.activeKcal ?? 0) + (e.basalKcal ?? 0) > MIN_APPLE_DAY_KCAL
}

export function buildEnergyReport(inp: EnergyInputs): EnergyReport {
  const density = inp.energyDensity ?? ENERGY_DENSITY_KCAL_PER_KG
  const days = daysBetween(inp.from, inp.to) + 1
  const inWin = (d: string) => d >= inp.from && d <= inp.to

  // ── intake (logged days only) ─────────────────────────────────────────────
  const cutoff = halfLoggedCutoff(inp.targetKcal)
  const intakeByDate = new Map<string, { kcal: number; p: number }>()
  for (const r of inp.intake) {
    if (!inWin(r.date)) continue
    const cur = intakeByDate.get(r.date) ?? { kcal: 0, p: 0 }
    cur.kcal += r.kcal || 0; cur.p += r.proteinG || 0
    intakeByDate.set(r.date, cur)
  }
  const fullDays = [...intakeByDate.values()].filter(v => v.kcal >= cutoff)
  const partialDays = [...intakeByDate.values()].filter(v => v.kcal > 0 && v.kcal < cutoff).length
  const meanKcal = mean(fullDays.map(v => v.kcal))
  const meanProteinG = mean(fullDays.map(v => v.p))
  const completeness = days > 0 ? fullDays.length / days : 0

  // ── Apple expenditure (complete days only) ────────────────────────────────
  const energyByDate = new Map<string, EnergyDay>()
  for (const e of inp.energy) if (inWin(e.date)) energyByDate.set(e.date, e)
  const appleDays = [...energyByDate.values()].filter(isCompleteAppleDay)
  const meanActive = mean(appleDays.map(e => e.activeKcal ?? 0))
  const meanBasal = mean(appleDays.map(e => e.basalKcal ?? 0))
  const meanTdee = mean(appleDays.map(e => (e.activeKcal ?? 0) + (e.basalKcal ?? 0)))

  // ── paired days: a full diary AND a complete Apple day ────────────────────
  // Averaging each source over its own days let a day with Apple energy but
  // no diary add burn with no food against it, which inflates the deficit.
  const daysDetail: BalanceDay[] = []
  const excluded = { noFood: 0, halfLogged: 0, appleGap: 0 }
  const paired: { burn: number; active: number; basal: number; intake: number }[] = []
  for (let i = 0; i < days; i++) {
    const date = addDays(inp.from, i)
    const intakeKcal = Math.round(intakeByDate.get(date)?.kcal ?? 0)
    const e = energyByDate.get(date)
    const burnKcal = e && (e.activeKcal != null || e.basalKcal != null) ? Math.round((e.activeKcal ?? 0) + (e.basalKcal ?? 0)) : null
    const use: DayUse = intakeKcal <= 0 ? 'no_food'
      : intakeKcal < cutoff ? 'half_logged'
        : !e || !isCompleteAppleDay(e) ? 'apple_gap' : 'used'
    if (use === 'no_food') excluded.noFood++
    else if (use === 'half_logged') excluded.halfLogged++
    else if (use === 'apple_gap') excluded.appleGap++
    else paired.push({ burn: (e!.activeKcal ?? 0) + (e!.basalKcal ?? 0), active: e!.activeKcal ?? 0, basal: e!.basalKcal ?? 0, intake: intakeByDate.get(date)!.kcal })
    daysDetail.push({ date, intakeKcal, burnKcal, use })
  }
  const pairedBurn = mean(paired.map(d => d.burn))
  const pairedIntake = mean(paired.map(d => d.intake))
  const loggedDeficit = mean(paired.map(d => d.burn - d.intake))

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
  // Everything below reads the paired days, so the logged deficit, the
  // expected change and the gap add up: gap × days ÷ density = expected − actual.
  const expectedChangeKg = loggedDeficit != null ? (-loggedDeficit * days) / density : null
  const observedTdee = pairedIntake != null && slope != null ? pairedIntake - slope * density : null
  const tdeeGap = observedTdee != null && pairedBurn != null ? observedTdee - pairedBurn : null
  const scaleDeficit = slope != null ? -slope * density : null

  // ── enough data for a verdict? ────────────────────────────────────────────
  const needDays = neededDays(days)
  const needSpan = Math.max(10, Math.ceil(days * 0.5))
  const missing: string[] = []
  if (fullDays.length < needDays) missing.push(`Food logged on ${fullDays.length} of ${days} days — needs ${needDays}.`)
  if (appleDays.length < needDays) missing.push(`Complete Apple energy on ${appleDays.length} of ${days} days — needs ${needDays}.`)
  if (fullDays.length >= needDays && appleDays.length >= needDays && paired.length < needDays) {
    missing.push(`A full diary and a complete Apple day on only ${paired.length} of ${days} days — needs ${needDays}.`)
  }
  if (trendWeights.length < 4) missing.push(`${trendWeights.length} weigh-in${trendWeights.length === 1 ? '' : 's'} in the window — needs 4.`)
  else if (spanDays < needSpan) missing.push(`Weigh-ins span ${spanDays} days — needs ${needSpan}.`)

  const earlyPhase = !!inp.phaseStartDate && (inp.goal === 'cut' || inp.goal === 'gain')
    && daysBetween(inp.phaseStartDate, inp.from) < EARLY_PHASE_DAYS && daysBetween(inp.phaseStartDate, inp.to) >= 0

  let verdict: Verdict | null = null
  const reasons: Reason[] = []
  let confidence: Confidence | null = null
  const confidenceNotes: string[] = []

  if (!missing.length && tdeeGap != null) {
    const seKcal = fit?.se != null ? fit.se * density : 0
    const tol = Math.max(MATCH_TOLERANCE_KCAL, 1.5 * seKcal)
    if (Math.abs(tdeeGap) <= tol) verdict = 'on_track'
    else if (tdeeGap < 0) {
      // The scale sits higher than the numbers predict: less lost / more gained.
      verdict = 'slower'
      if (earlyPhase && inp.goal === 'gain') reasons.push('early_water')
      if (completeness < 0.85 || partialDays > 0) reasons.push('partial_logging')
      reasons.push('intake_underlogged', 'apple_overestimates')
    } else {
      // The scale sits lower than the numbers predict: more lost / less gained.
      verdict = 'faster'
      if (earlyPhase && inp.goal === 'cut') reasons.push('early_water')
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
      confidenceNotes.push(inp.goal === 'gain'
        ? 'This window includes the start of your gain — part of the gain is glycogen and water.'
        : 'This window includes the start of your cut — part of the loss is glycogen and water.')
      if (confidence === 'high') confidence = 'medium'
    }
  }

  // ── protein ───────────────────────────────────────────────────────────────
  const hasTrend = trendWeights.length >= 4 && spanDays >= 7
  const kgForProtein = currentTrendKg ?? meanKg
  const gPerKg = meanProteinG != null && kgForProtein ? meanProteinG / kgForProtein : null
  const ffm = inp.leanMassKg ?? null
  const protein = {
    gPerKg: round(gPerKg, 2),
    band: gPerKg != null ? proteinBand(gPerKg) : null,
    gPerKgFfm: meanProteinG != null && ffm ? round(meanProteinG / ffm, 2) : null,
  }

  return {
    days,
    intake: { loggedDays: fullDays.length, partialDays, completeness: round(completeness, 2) as number, meanKcal: round(meanKcal), meanProteinG: round(meanProteinG) },
    apple: { days: appleDays.length, meanActive: round(meanActive), meanBasal: round(meanBasal), meanTdee: round(meanTdee) },
    daysDetail,
    paired: {
      days: paired.length,
      meanBurn: round(pairedBurn),
      meanActive: round(mean(paired.map(d => d.active))),
      meanBasal: round(mean(paired.map(d => d.basal))),
      meanIntake: round(pairedIntake),
      deficit: round(loggedDeficit),
      halfLoggedBelow: cutoff,
      excluded,
    },
    recent7: days > 7 ? balanceOver(daysDetail.slice(-7)) : null,
    loggedDeficit: round(loggedDeficit),
    scaleDeficit: round(scaleDeficit),
    weight: {
      weighIns: trendWeights.length, spanDays, series,
      slopeKgPerDay: round(slope, 4), slopeSe: round(fit?.se ?? null, 4),
      kgPerWeek: round(kgPerWeek, 2), pctPerWeek: round(pctPerWeek, 2),
      meanKg: round(meanKg, 1), currentTrendKg: round(currentTrendKg, 1), changeKg: round(changeKg, 2),
    },
    expectedChangeKg: round(expectedChangeKg, 2),
    observedTdee: round(observedTdee),
    tdeeGap: round(tdeeGap),
    verdict, reasons, confidence, confidenceNotes, missing, earlyPhase, hasTrend, protein,
    plannedDeficit: (pairedBurn ?? meanTdee) != null && inp.targetKcal ? round((pairedBurn ?? meanTdee)! - inp.targetKcal) : null,
  }
}
