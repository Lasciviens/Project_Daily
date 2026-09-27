// Heart and lung metrics: VO2 max, resting heart rate, HRV, cardio recovery,
// respiratory rate, blood oxygen. Pure, import-free apart from sibling data.
import { SRC } from './sources'
import {
  HRV_VOSS_2015, RHR_NHANES, VO2_FRIEND_2015, VO2_KODAMA_METS,
  percentileFromTable, rowForAge, valueAtPercentile,
} from './referenceTables'
import { adultAge, ageBandName, build, fmt, nextStep, sexWord, type BandSpec } from './classifyKit'
import type { BenchmarkContext, Classification } from './types'

// ─── VO2 max ────────────────────────────────────────────────────────────────

const KODAMA_PER_MET =
  'Each 1 MET (3.5 ml/kg/min) of extra fitness is linked to about 13% lower all-cause mortality (Kodama 2009, RR 0.87 per MET).'

/** Mandsager 2018, Figure 2C, inverted to "vs the bottom quarter" (fact-checked). */
const MANDSAGER_BY_BAND: Record<string, string> = {
  very_low:
    'In 122,007 treadmill tests (Mandsager 2018), people in the bottom quarter for their age had about twice the mortality of the next quarter up (HR 1.95) and five times that of the fittest 2.3% (HR 5.04).',
  low:
    'In 122,007 treadmill tests (Mandsager 2018), people in the bottom quarter for their age had about twice the mortality of the next quarter up (HR 1.95) and five times that of the fittest 2.3% (HR 5.04).',
  below_average:
    'In Mandsager 2018 this quarter had about half the mortality of the bottom quarter (HR ≈0.51).',
  above_average:
    'In Mandsager 2018 this range had about 64% lower mortality than the bottom quarter (HR ≈0.36).',
  high:
    'In Mandsager 2018 the 75th–97th percentile group had about 74% lower mortality than the bottom quarter (HR ≈0.26).',
  very_high:
    'You are at or near Mandsager 2018’s elite group (top 2.3%), which had 80% lower mortality than the bottom quarter (HR 0.20) — and no upper limit of benefit was seen.',
}

interface Vo2Band extends BandSpec {
  /** The band applies while value < the table value at this percentile (null = top band). */
  belowPct: number | null
  /** Percentile range the band covers, used to keep the displayed percentile inside it. */
  lo: number
  hi: number
  next: { pct: number; label: string } | null
}

const VO2_BANDS: Vo2Band[] = [
  { band: 'very_low', label: 'Very low for your age', tone: 'warn', belowPct: 10, lo: 1, hi: 10,
    next: { pct: 25, label: 'Below average for your age (25th percentile)' } },
  { band: 'low', label: 'Low for your age', tone: 'warn', belowPct: 25, lo: 10, hi: 25,
    next: { pct: 25, label: 'Below average for your age (25th percentile)' } },
  { band: 'below_average', label: 'Below average for your age', tone: 'neutral', belowPct: 50, lo: 25, hi: 50,
    next: { pct: 50, label: 'Average for your age (50th percentile)' } },
  { band: 'above_average', label: 'Above average for your age', tone: 'success', belowPct: 75, lo: 50, hi: 75,
    next: { pct: 75, label: 'High for your age (75th percentile)' } },
  { band: 'high', label: 'High for your age', tone: 'success', belowPct: 95, lo: 75, hi: 95,
    next: { pct: 95, label: 'Very high for your age (95th percentile)' } },
  { band: 'very_high', label: 'Very high for your age', tone: 'success', belowPct: null, lo: 95, hi: 100, next: null },
]

export function classifyVo2(v: number, ctx: BenchmarkContext): Classification {
  const age = adultAge(ctx.age)
  if (age == null || !ctx.sex) return classifyVo2Generic(v)
  const pick = rowForAge(VO2_FRIEND_2015[ctx.sex], age)!
  const table = pick.row.data
  const at = (p: number) => valueAtPercentile(table, p)!
  const spec = VO2_BANDS.find(b => b.belowPct == null || v < at(b.belowPct))!
  const raw = percentileFromTable(table, v)
  const percentile = raw == null ? null : Math.min(spec.hi - 1, Math.max(spec.lo, raw))
  return build('vo2_max', spec, {
    percentile,
    referenceText:
      `${sexWord(ctx.sex)} ${ageBandName(pick.row.min, pick.row.max, pick.clamped)}: average ${fmt(at(50), 1)}, ` +
      `middle half ${fmt(at(25), 1)}–${fmt(at(75), 1)} ml/kg/min (FRIEND 2015 treadmill tests).`,
    nextStep: spec.next ? nextStep('vo2_max', spec.next.label, at(spec.next.pct), v) : null,
    meaning: `${MANDSAGER_BY_BAND[spec.band]} ${KODAMA_PER_MET}`,
    sources: [SRC.friend2015, SRC.mandsager2018, SRC.kodama2009],
  })
}

/** No age or sex: Kodama 2009's absolute categories, which apply to any adult. */
function classifyVo2Generic(v: number): Classification {
  const mets = v / 3.5
  const lowLine = VO2_KODAMA_METS.lowBelow * 3.5
  const highLine = VO2_KODAMA_METS.highFrom * 3.5
  const ref =
    `Any adult: low fitness under ${VO2_KODAMA_METS.lowBelow} METs (${fmt(lowLine, 1)} ml/kg/min), high from ` +
    `${VO2_KODAMA_METS.highFrom} METs (${fmt(highLine, 1)}) — Kodama 2009. Add your birth year and sex for an age-matched percentile.`
  const sources = [SRC.kodama2009]
  if (mets < VO2_KODAMA_METS.lowBelow) {
    return build('vo2_max', { band: 'low', label: 'Low fitness', tone: 'warn' }, {
      referenceText: ref,
      nextStep: nextStep('vo2_max', `Intermediate fitness (${VO2_KODAMA_METS.lowBelow} METs)`, lowLine, v),
      meaning: `Across 33 studies, low fitness carried 1.4× the mortality of intermediate fitness and 1.7× that of high fitness (Kodama 2009). ${KODAMA_PER_MET}`,
      sources,
    })
  }
  if (mets < VO2_KODAMA_METS.highFrom) {
    return build('vo2_max', { band: 'intermediate', label: 'Intermediate fitness', tone: 'neutral' }, {
      referenceText: ref,
      nextStep: nextStep('vo2_max', `High fitness (${VO2_KODAMA_METS.highFrom} METs)`, highLine, v),
      meaning: `Intermediate fitness sits between the low group (1.4× the mortality) and the high group in Kodama 2009. ${KODAMA_PER_MET}`,
      sources,
    })
  }
  return build('vo2_max', { band: 'high', label: 'High fitness', tone: 'success' }, {
    referenceText: ref,
    meaning: `In Kodama 2009, low fitness carried 1.7× the mortality of this high-fitness group. ${KODAMA_PER_MET}`,
    sources,
  })
}

// ─── Resting heart rate ─────────────────────────────────────────────────────

const RHR_EVIDENCE =
  'Each 10 bpm higher is linked to about 9% higher all-cause mortality (Zhang 2016: RR 1.09 per 10 bpm; 1.12 for 60–80 and 1.45 for over 80 compared with the lowest category). Endurance training lowered it by about 6 bpm in men (Reimers 2018).'

export function classifyRestingHr(v: number, ctx: BenchmarkContext): Classification {
  const age = adultAge(ctx.age)
  let percentile: number | null = null
  let reference =
    'Adults: the lowest-risk category in pooled studies was typically under 60 bpm; 60–80 and over 80 carried higher risk (Zhang 2016).'
  if (age != null && ctx.sex) {
    const pick = rowForAge(RHR_NHANES[ctx.sex], age)!
    const t = pick.row.data
    percentile = percentileFromTable(t, v)
    reference =
      `${sexWord(ctx.sex)} ${ageBandName(pick.row.min, pick.row.max, pick.clamped)}: median ${valueAtPercentile(t, 50)} bpm, ` +
      `middle half ${valueAtPercentile(t, 25)}–${valueAtPercentile(t, 75)} (US NHANES, seated clinic pulse). ` +
      'Lowest-risk category in pooled studies: typically under 60.'
  }
  const sources = [SRC.nhanesPulse, SRC.zhang2016, SRC.reimers2018]
  if (v < 60) {
    return build('resting_heart_rate', { band: 'low', label: 'Lowest-risk range (under 60)', tone: 'success' }, {
      percentile, referenceText: reference, sources,
      meaning: `You're in the range the pooled studies used as their lowest-risk reference. ${RHR_EVIDENCE}`,
    })
  }
  if (v <= 80) {
    return build('resting_heart_rate', { band: 'typical', label: 'Typical (60–80)', tone: 'neutral' }, {
      percentile, referenceText: reference, sources,
      nextStep: nextStep('resting_heart_rate', 'Under 60 bpm (lowest-risk range)', 59, v),
      meaning: `Common and not a warning sign on its own. ${RHR_EVIDENCE}`,
    })
  }
  return build('resting_heart_rate', { band: 'high', label: 'High (over 80)', tone: 'warn' }, {
    percentile, referenceText: reference, sources,
    nextStep: nextStep('resting_heart_rate', '80 bpm or lower', 80, v),
    meaning: `Over 80 carried about 45% higher all-cause mortality than the lowest category in large studies. ${RHR_EVIDENCE} If it stays high at rest, mention it to a doctor.`,
  })
}

// ─── HRV (SDNN) ─────────────────────────────────────────────────────────────

const HRV_EVIDENCE =
  'In people without heart disease, the lowest SDNN group had about 35% more first cardiovascular events than the highest (Hillebrand 2013, RR 1.35), and regular exercise raises SDNN moderately (16 trials, SMD 0.58).'

/** Personal baseline first (Plews 2013); population norms only as rough context. */
export function classifyHrv(v: number, ctx: BenchmarkContext): Classification | null {
  const b = ctx.baseline
  if (b && b.sd != null && b.sd > 0) {
    const lo = b.mean - b.sd
    const hi = b.mean + b.sd
    const reference = `Your normal range: ${fmt(lo)}–${fmt(hi)} ms (your baseline mean ± 1 SD).`
    const sources = [SRC.plews2013, SRC.shaffer2017, SRC.hillebrand2013]
    if (v < lo) {
      return build('heart_rate_variability', { band: 'below_baseline', label: 'Below your normal range', tone: 'warn' }, {
        referenceText: reference, sources,
        meaning: `A dip below your own range is a common fatigue signal after hard training, short sleep or illness (a monitoring convention, not a diagnosis). One low reading means little; several in a row are worth an easier day. ${HRV_EVIDENCE}`,
      })
    }
    if (v > hi) {
      return build('heart_rate_variability', { band: 'above_baseline', label: 'Above your normal range', tone: 'info' }, {
        referenceText: reference, sources,
        meaning: `Usually a sign of good recovery. ${HRV_EVIDENCE}`,
      })
    }
    return build('heart_rate_variability', { band: 'within_baseline', label: 'Within your normal range', tone: 'success' }, {
      referenceText: reference, sources,
      meaning: `Nothing unusual against your own baseline. ${HRV_EVIDENCE}`,
    })
  }

  const age = adultAge(ctx.age)
  if (age == null) return null
  const rows = ctx.sex ? [rowForAge(HRV_VOSS_2015[ctx.sex], age)!] : [rowForAge(HRV_VOSS_2015.male, age)!, rowForAge(HRV_VOSS_2015.female, age)!]
  const mean = rows.reduce((s, r) => s + r.row.data.mean, 0) / rows.length
  const sd = rows.reduce((s, r) => s + r.row.data.sd, 0) / rows.length
  const who = ctx.sex ? sexWord(ctx.sex) : 'Adults'
  const pick = rows[0]
  const reference =
    `${who} ${ageBandName(pick.row.min, pick.row.max, pick.clamped)}: ${fmt(mean, 1)} ± ${fmt(sd, 1)} ms on a 5-minute ECG (Voss 2015) — ` +
    'a different method from Apple’s short readings, which run about 8 ms lower than a chest strap.'
  const sources = [SRC.voss2015, SRC.appleWatchHrv2024, SRC.hillebrand2013]
  const meaning = `Only rough context: compare your 7-day average with your own 60-day range instead. ${HRV_EVIDENCE}`
  if (v < mean - sd) {
    return build('heart_rate_variability', { band: 'low_for_age', label: 'Lower than typical for your age (different method)', tone: 'neutral' },
      { referenceText: reference, sources, meaning })
  }
  if (v > mean + sd) {
    return build('heart_rate_variability', { band: 'high_for_age', label: 'Higher than typical for your age (different method)', tone: 'neutral' },
      { referenceText: reference, sources, meaning })
  }
  return build('heart_rate_variability', { band: 'typical_for_age', label: 'Typical for your age (different method)', tone: 'neutral' },
    { referenceText: reference, sources, meaning })
}

// ─── Cardio recovery ────────────────────────────────────────────────────────

export function classifyHeartRateRecovery(v: number): Classification {
  const reference =
    'Normal: a drop of more than 12 bpm in the first minute after hard exercise (Cole 1999). Apple measures after ordinary workouts, so compare similar sessions.'
  const evidence =
    'In clinical treadmill tests, a drop of 12 bpm or less carried about twice the mortality after adjustment (Cole 1999, adjusted RR 2.0); each 10 bpm slower recovery was linked to about 9% higher mortality (Qiu 2017).'
  const sources = [SRC.cole1999, SRC.qiu2017]
  if (v <= 12) {
    return build('heart_rate_recovery', { band: 'low', label: 'Slower than typical', tone: 'warn' }, {
      referenceText: reference, sources,
      nextStep: nextStep('heart_rate_recovery', 'More than 12 bpm', 13, v),
      meaning: `${evidence} After an easy workout a small drop is expected, so only a pattern over several hard sessions means much; aerobic training improves it.`,
    })
  }
  return build('heart_rate_recovery', { band: 'normal', label: 'Normal', tone: 'success' }, {
    referenceText: reference, sources, meaning: evidence,
  })
}

// ─── Respiratory rate ───────────────────────────────────────────────────────

export function classifyRespiratoryRate(v: number, ctx: BenchmarkContext): Classification {
  const reference =
    'Healthy adults 20–69 wearing a tracker: 11.8–19.2 breaths/min during sleep, average 15.4 (Natarajan 2021).'
  const sources = [SRC.natarajan2021]
  const b = ctx.baseline
  if (b && v - b.mean >= 3) {
    return build('respiratory_rate', { band: 'above_baseline', label: '3+ breaths/min above your baseline', tone: 'warn' }, {
      referenceText: `${reference} Your baseline: ${fmt(b.mean, 1)}.`, sources,
      meaning: 'In a large tracker study, a night 3 or more above a person’s own rate appeared around symptom onset in about a third of COVID-19 cases (Natarajan 2021) — a useful illness or overreaching flag. Worth an easier day if you also feel off.',
    })
  }
  const meaning = 'Night-time breathing rate is very stable within a person, so a clear rise above your own baseline means more than the number itself. It has no proven link to long-term health.'
  if (v < 11.8) {
    return build('respiratory_rate', { band: 'below_typical', label: 'Below the typical range', tone: 'neutral' },
      { referenceText: reference, sources, meaning: `Usually nothing to worry about if it's stable. ${meaning}` })
  }
  if (v <= 19.2) {
    return build('respiratory_rate', { band: 'typical', label: 'Typical', tone: 'success' }, { referenceText: reference, sources, meaning })
  }
  return build('respiratory_rate', { band: 'above_typical', label: 'Above the typical range', tone: 'warn' }, {
    referenceText: reference, sources,
    nextStep: nextStep('respiratory_rate', 'Within the typical range (19.2 or lower)', 19.2, v),
    meaning: `Outside the range 90% of healthy adults fall in. If it stays there, mention it to a doctor. ${meaning}`,
  })
}

// ─── Blood oxygen ───────────────────────────────────────────────────────────

/** Accepts a percentage (97) or a fraction (0.97); anything else is not a reading. */
export function normalizeSpo2(v: number): number | null {
  if (!Number.isFinite(v) || v <= 0) return null
  const pct = v <= 1 ? v * 100 : v
  return pct > 100 ? null : pct
}

export function classifyBloodOxygen(raw: number): Classification | null {
  const v = normalizeSpo2(raw)
  if (v == null) return null
  const reference =
    'Normal awake at sea level: 95–100% (WHO). During sleep healthy adults average about 95%, with brief dips into the high 80s (Boulos 2019).'
  const sources = [SRC.whoOximetry, SRC.boulos2019, SRC.appleSpo2Review]
  const meaning = 'In healthy people a reading in the normal range has no proven link to long-term health; the value is in catching unusual lows.'
  if (v >= 95) return build('blood_oxygen', { band: 'normal', label: 'Normal', tone: 'success' }, { referenceText: reference, sources, meaning })
  if (v >= 90) {
    return build('blood_oxygen', { band: 'slightly_low', label: 'Slightly below 95%', tone: 'neutral' }, {
      referenceText: reference, sources,
      meaning: `Common for night-time readings. Re-check awake and at rest with the watch snug. ${meaning}`,
    })
  }
  return build('blood_oxygen', { band: 'low', label: 'Low', tone: 'warn' }, {
    referenceText: reference, sources,
    nextStep: nextStep('blood_oxygen', 'Normal range (95%+)', 95, v),
    meaning: 'Below what healthy adults average even during sleep. Re-measure with the watch snug and still; repeated low readings are worth medical advice.',
  })
}
