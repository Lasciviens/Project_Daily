// Heart & overnight vitals, read out in plain words: for the day or period on
// screen, each signal's value against YOUR usual range, how it moved against
// the period before, and one overall sentence that combines them.
//
// House rules this follows:
//   - No composite score. The overall read is a COUNT and a list of the
//     signals that are off (the way Apple's Vitals app works — it only speaks
//     up when two or more overnight metrics leave your typical range).
//   - No diagnosis. Wording is "often means", "can do this", never "you have".
//   - Your own baseline, not population norms: Apple's short overnight readings
//     fit population tables poorly. The one exception is heart-rate recovery,
//     which has a clinical cut-off (Cole 1999) and too few readings for a
//     personal range.
//   - Uncertainty is said out loud: too few readings, too little history or a
//     thin baseline are reported, never papered over.
//
// "Your usual" is built from the 60 days BEFORE the day or period being judged
// (a week of elevated readings must not pull its own baseline towards itself):
//   resting HR     median ± 5 bpm — a sustained rise of 5+ bpm over your
//                  60-day baseline is the recognised signal (research-rank;
//                  Quer 2021 used resting-HR rises in illness detection)
//   HRV            mean ± 1 SD of daily values, judged on the 7-day average
//                  (Plews 2013 — single days swing too much)
//   breathing rate median ± 1.5 breaths/min (the app's existing band; a rise
//                  of 3+ is the level Natarajan 2021 linked with infection)
//   blood oxygen   mean ± 2 SD, at least ± 1 point (Watch error is ± 3–4 points)
//   wrist temp     mean ± 2 SD, at least ± 0.3 °C, shown as a deviation
//   walking HR     median ± 4 bpm, judged on the 7-day average (± 4 ≈ the
//                  Watch's resting-HR error — a heuristic)
//   HR recovery    more than 12 bpm in the first minute is typical (Cole 1999)
//
// PURE — only sibling pure modules are imported, so
// scripts/verify-vitals-reading.cjs can load it through sucrase.
import { SRC, type Source } from './benchmarks/sources'
import { normalizeSpo2 } from './benchmarks/classifyCardio'
import { addDaysIso, daysBetweenIso, mean, type DayValue } from './healthWindowStats'
import { usualRange, type UsualRange } from './healthTrendStats'

export type VitalKey = 'rhr' | 'hrv' | 'resp' | 'spo2' | 'temp' | 'walking' | 'hrr'
export type VitalStatus = 'inside' | 'above' | 'below' | 'unknown'
/** What a status means for this signal: in your range, the direction worth
 *  attention, the direction that is a good sign, or a harmless deviation. */
export type VitalSignal = 'in-range' | 'concern' | 'good' | 'neutral' | 'unknown'
export type VitalReason = 'no-reading' | 'few-readings' | 'no-history'
export type VitalRangeSpec =
  | { mode: 'sd'; k: number; minHalfWidth?: number }
  | { mode: 'median'; halfWidth: number }

/** Days before the judged day/period that make up "your usual". */
export const BASELINE_DAYS = 60
/** A usual range built from fewer readings than this is labelled rough. */
export const THIN_HISTORY = 28
/** Days a Day view looks back when the day itself has no reading yet. */
const DAY_FALLBACK_DAYS = 3
/** A smoothed (7-day) value needs this many readings in its week. */
const MIN_SMOOTH_READINGS = 3
/** A run of out-of-range days ends at a gap longer than this. */
const RUN_MAX_GAP_DAYS = 2
/** How far back a run is looked for. */
const RUN_LOOKBACK_DAYS = 14
/** Days in a row that make a deviation "persistent" rather than a one-off. */
export const PERSISTENT_DAYS = 3

const VITALS_SRC = {
  appleVitals: {
    citation: 'Apple Support — Track your overnight vitals with Apple Watch (Vitals app: a typical range after 7 nights; a notification only when two or more metrics are out of range)',
    url: 'https://support.apple.com/en-us/120142',
  },
  appleWristTemp: {
    citation: 'Apple Support — About wrist temperature on Apple Watch (baseline after about 5 nights)',
    url: 'https://support.apple.com/en-us/102674',
  },
  quer2021: {
    citation: 'Quer G et al. Wearable sensor data and self-reported symptoms for COVID-19 detection. Nat Med 2021',
    url: 'https://pubmed.ncbi.nlm.nih.gov/33122860/',
  },
  smarr2020: {
    citation: 'Smarr BL et al. Feasibility of continuous fever monitoring using wearable devices. Sci Rep 2020',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC7736301/',
  },
} as const satisfies Record<string, Source>

export interface VitalSpec {
  key: VitalKey
  /** health_metrics.metric_name. */
  metric: string
  label: string
  /** Lower-case name used inside the overall sentence. */
  phraseLabel: string
  unit: string
  decimals: number
  /** 'recovery' signals feed the overall verdict; 'fitness' ones are context. */
  group: 'recovery' | 'fitness'
  concern: 'above' | 'below'
  good: 'above' | 'below' | null
  /** Personal usual range; null = the population cut-off below. */
  range: VitalRangeSpec | null
  /** Population floor (heart-rate recovery): more than this is typical. */
  floor?: number
  /** Readings needed in the 60 days before for a usual range. */
  minHistory: number
  /** 1 = the day's own reading; 7 = the 7-day average ending on the day. */
  smoothDays: number
  /** Show the value as a difference from your usual centre (wrist temperature). */
  deviation: boolean
  /** A reading this many days old still counts when the period has none (HR recovery). */
  lookbackDays?: number
  /** Readings a period needs before it is judged (default: one per five days, at least 2). */
  minPeriodReadings?: number
  /** What the signal is, in one or two plain sentences. */
  about: string
  /** How "your usual" is defined, in plain words. */
  rangeRule: string
  transform?: (v: number) => number | null
  sources: readonly Source[]
}

export const VITAL_SPECS: Record<VitalKey, VitalSpec> = {
  rhr: {
    key: 'rhr', metric: 'resting_heart_rate', label: 'Resting heart rate', phraseLabel: 'resting heart rate',
    unit: 'bpm', decimals: 0, group: 'recovery', concern: 'above', good: 'below',
    range: { mode: 'median', halfWidth: 5 }, minHistory: 14, smoothDays: 1, deviation: false,
    about: 'Your lowest steady heart rate while awake and still, worked out by the Watch each day. Fatigue, stress, heat, alcohol and illness push it up.',
    rangeRule: 'your median over the 60 days before this day or period, ± 5 bpm — a sustained rise of more than 5 bpm is the recognised signal',
    sources: [VITALS_SRC.quer2021, SRC.appleWatchHrv2024, SRC.reimers2018],
  },
  hrv: {
    key: 'hrv', metric: 'heart_rate_variability', label: 'HRV (SDNN)', phraseLabel: 'HRV',
    unit: 'ms', decimals: 0, group: 'recovery', concern: 'below', good: 'above',
    range: { mode: 'sd', k: 1 }, minHistory: 14, smoothDays: 7, deviation: false,
    about: 'Heart rate variability: how much the time between heartbeats varies (Apple measures SDNN). Higher usually means more rested; strain, poor sleep, alcohol and illness lower it.',
    rangeRule: 'your average over the 60 days before this day or period, ± 1 standard deviation, judged on the 7-day average (Plews 2013)',
    sources: [SRC.plews2013, SRC.appleWatchHrv2024, SRC.shaffer2017],
  },
  resp: {
    key: 'resp', metric: 'respiratory_rate', label: 'Breathing rate (sleep)', phraseLabel: 'breathing rate in sleep',
    unit: 'br/min', decimals: 1, group: 'recovery', concern: 'above', good: null,
    range: { mode: 'median', halfWidth: 1.5 }, minHistory: 10, smoothDays: 1, deviation: false,
    about: 'Breaths per minute while you sleep. It is very steady from night to night, so a rise is one of the first things to change when you get ill.',
    rangeRule: 'your median over the 60 days before this day or period, ± 1.5 breaths a minute; a rise of 3 or more is the level linked with infection',
    sources: [SRC.natarajan2021, VITALS_SRC.appleVitals],
  },
  spo2: {
    key: 'spo2', metric: 'blood_oxygen_saturation', label: 'Blood oxygen (sleep)', phraseLabel: 'blood oxygen in sleep',
    unit: '%', decimals: 0, group: 'recovery', concern: 'below', good: null,
    range: { mode: 'sd', k: 2, minHalfWidth: 1 }, minHistory: 10, smoothDays: 1, deviation: false,
    about: 'How much oxygen your blood carries, from spot readings while you sleep.',
    rangeRule: 'your average over the 60 days before this day or period, ± 2 standard deviations (at least ± 1 point)',
    transform: normalizeSpo2,
    sources: [SRC.appleSpo2Review, SRC.boulos2019, SRC.whoOximetry, VITALS_SRC.appleVitals],
  },
  temp: {
    key: 'temp', metric: 'apple_sleeping_wrist_temperature', label: 'Wrist temperature (sleep)', phraseLabel: 'wrist temperature',
    unit: '°C', decimals: 1, group: 'recovery', concern: 'above', good: null,
    range: { mode: 'sd', k: 2, minHalfWidth: 0.3 }, minHistory: 10, smoothDays: 1, deviation: true,
    about: 'Your overnight wrist-skin temperature compared with your usual night — Apple shows it the same way, as a difference.',
    rangeRule: 'your average night over the 60 days before this day or period, ± 2 standard deviations (at least ± 0.3 °C), shown as the difference from it',
    sources: [VITALS_SRC.appleWristTemp, VITALS_SRC.smarr2020, VITALS_SRC.appleVitals],
  },
  walking: {
    key: 'walking', metric: 'walking_heart_rate_average', label: 'Walking heart rate', phraseLabel: 'walking heart rate',
    unit: 'bpm', decimals: 0, group: 'fitness', concern: 'above', good: 'below',
    range: { mode: 'median', halfWidth: 4 }, minHistory: 10, smoothDays: 7, deviation: false,
    about: 'Your average heart rate during ordinary walking through the day. It is a light, repeatable effort, so it drifts down as fitness improves.',
    rangeRule: 'your median over the 60 days before this day or period, ± 4 bpm (about the Watch’s heart-rate error — a rule of thumb), judged on the 7-day average',
    sources: [SRC.appleWatchHrv2024],
  },
  hrr: {
    key: 'hrr', metric: 'cardio_recovery', label: 'Heart-rate recovery', phraseLabel: 'heart-rate recovery',
    unit: 'bpm', decimals: 0, group: 'fitness', concern: 'below', good: null,
    range: null, floor: 12, minHistory: 0, smoothDays: 1, deviation: false, lookbackDays: 30, minPeriodReadings: 1,
    about: 'How far your heart rate falls in the first minute after a workout ends. A faster drop goes with better fitness.',
    rangeRule: 'typical is a drop of more than 12 bpm in the first minute after exercise (Cole 1999) — too few readings for a personal range',
    sources: [SRC.cole1999, SRC.qiu2017],
  },
}

/** Display order: the recovery signals first, then the fitness context. */
export const VITAL_ORDER: readonly VitalKey[] = ['rhr', 'hrv', 'resp', 'spo2', 'temp', 'walking', 'hrr']

/** Every health_metrics name the reading needs. */
export const VITAL_METRICS: readonly string[] = VITAL_ORDER.map(k => VITAL_SPECS[k].metric)

export interface VitalRun { direction: 'above' | 'below'; days: number; last: string }

export interface VitalRow {
  key: VitalKey
  spec: VitalSpec
  /** The judged value (raw unit — a deviation metric subtracts `usual.center` for display). */
  value: number | null
  /** Where the value comes from: 'day' = that day's reading, 'smoothed' = the
   *  7-day average ending on it, 'period' = the period's average,
   *  'latest' = the newest reading (HR recovery, when the period has none). */
  basis: 'day' | 'smoothed' | 'period' | 'latest'
  /** The day of the reading behind the value (the newest one in a period). */
  valueDate: string | null
  /** Readings behind the value. */
  readings: number
  usual: UsualRange | null
  referenceKind: 'personal' | 'population'
  deltaVsUsual: number | null
  previous: number | null
  deltaVsPrevious: number | null
  previousLabel: string
  status: VitalStatus
  signal: VitalSignal
  reason: VitalReason | null
  /** Why a status is unknown, in words ("only 1 reading in these 7 days"). */
  reasonText: string | null
  /** Period views: days whose reading sat outside your usual range. */
  daysAbove: number | null
  daysBelow: number | null
  daysChecked: number | null
  /** Out-of-range readings in a row at the end of the judged span. */
  run: VitalRun | null
  /** The usual range rests on fewer than THIN_HISTORY readings. */
  thinHistory: boolean
  /** One plain sentence: what this reading means for you. */
  meaning: string
}

export type VerdictTone = 'success' | 'neutral' | 'warn'

export interface VitalsVerdict {
  tone: VerdictTone
  /** A short label for the status pill ("All normal for you", "2 signals off"). */
  label: string
  headline: string
  /** Follow-up sentences: persistence, context, what was not judged, caveats. */
  notes: string[]
  concerns: VitalKey[]
  goods: VitalKey[]
  /** Recovery signals that could be judged. */
  judged: number
}

export interface VitalsReading {
  from: string
  to: string
  isDay: boolean
  totalDays: number
  rows: VitalRow[]
  verdict: VitalsVerdict
  /** Every source behind the rows, de-duplicated. */
  sources: Source[]
}

export interface VitalsReadingInput {
  from: string
  to: string
  /** Daily series per health_metrics name (the useHealthDaily output). A
   *  metric absent here is simply not shown. */
  series: Readonly<Record<string, readonly DayValue[] | undefined>>
}

// ── Formatting (en-GB, a real minus sign) ────────────────────────────────────

export function fmtVital(v: number, decimals: number): string {
  const r = Math.abs(v) < 0.5 * 10 ** -decimals ? 0 : v
  const s = Math.abs(r).toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return r < 0 ? `−${s}` : s
}

export function fmtSignedVital(v: number, decimals: number): string {
  const s = fmtVital(Math.abs(v), decimals)
  if (s === fmtVital(0, decimals)) return `±${s}`
  return `${v > 0 ? '+' : '−'}${s}`
}

/** The unit after a difference: a change in SpO₂ is in percentage points. */
const unitGap = (unit: string) => (unit === '%' ? ' points' : ` ${unit}`)
/** "97%", "58 bpm". */
const withUnit = (v: string, unit: string) => (unit === '%' ? `${v}%` : `${v} ${unit}`)

/** The value as shown: a deviation metric reads "+0.4 °C" against your usual night. */
export function displayValue(row: Pick<VitalRow, 'value' | 'usual' | 'spec'>): string {
  if (row.value == null) return '—'
  const { spec } = row
  if (spec.deviation && row.usual) return withUnit(fmtSignedVital(row.value - row.usual.center, spec.decimals), spec.unit)
  return withUnit(fmtVital(row.value, spec.decimals), spec.unit)
}

/** "your usual 52–62 bpm", "± 0.3 °C", "> 12 bpm". */
export function displayUsual(row: Pick<VitalRow, 'usual' | 'spec'>): string {
  const { spec, usual } = row
  if (spec.floor != null) return `more than ${withUnit(String(spec.floor), spec.unit)}`
  if (!usual) return '—'
  if (spec.deviation) return `± ${withUnit(fmtVital((usual.high - usual.low) / 2, spec.decimals), spec.unit)}`
  return withUnit(`${fmtVital(usual.low, spec.decimals)}–${fmtVital(usual.high, spec.decimals)}`, spec.unit)
}

// ── Series helpers ───────────────────────────────────────────────────────────

function prepare(spec: VitalSpec, raw: readonly DayValue[] | undefined): DayValue[] {
  const out: DayValue[] = []
  for (const d of raw ?? []) {
    const v = spec.transform ? spec.transform(d.value) : d.value
    if (v != null && Number.isFinite(v)) out.push({ date: d.date, value: v })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

function inSpan(s: readonly DayValue[], from: string, to: string): DayValue[] {
  return s.filter(d => d.date >= from && d.date <= to)
}

/** The value a single day carries: its own reading, or the 7-day average
 *  ending on it (needs MIN_SMOOTH_READINGS). null when neither exists. */
function perDay(spec: VitalSpec, s: readonly DayValue[], date: string): number | null {
  if (spec.smoothDays <= 1) return s.find(d => d.date === date)?.value ?? null
  const vals = inSpan(s, addDaysIso(date, -(spec.smoothDays - 1)), date).map(d => d.value)
  return vals.length >= MIN_SMOOTH_READINGS ? mean(vals) : null
}

function stateOf(value: number, spec: VitalSpec, usual: UsualRange | null): VitalStatus {
  if (spec.floor != null) return value > spec.floor ? 'inside' : 'below'
  if (!usual) return 'unknown'
  return value > usual.high ? 'above' : value < usual.low ? 'below' : 'inside'
}

function signalOf(status: VitalStatus, spec: VitalSpec): VitalSignal {
  if (status === 'unknown') return 'unknown'
  if (status === 'inside') return 'in-range'
  if (status === spec.concern) return 'concern'
  if (status === spec.good) return 'good'
  return 'neutral'
}

/** Out-of-range readings in a row, newest first, ending at `end`. */
function runAt(spec: VitalSpec, s: readonly DayValue[], end: string, usual: UsualRange | null): VitalRun | null {
  if (!usual && spec.floor == null) return null
  const dates = inSpan(s, addDaysIso(end, -(RUN_LOOKBACK_DAYS - 1)), end).map(d => d.date).reverse()
  let direction: 'above' | 'below' | null = null
  let days = 0
  let prev: string | null = null
  let last: string | null = null
  for (const date of dates) {
    if (prev && daysBetweenIso(date, prev) > RUN_MAX_GAP_DAYS) break
    const v = perDay(spec, s, date)
    if (v == null) break
    const st = stateOf(v, spec, usual)
    if (st !== 'above' && st !== 'below') break
    if (direction && st !== direction) break
    direction = st
    days++
    last ??= date
    prev = date
  }
  return direction && last ? { direction, days, last } : null
}

// ── One row ──────────────────────────────────────────────────────────────────

function readRow(spec: VitalSpec, s: readonly DayValue[], from: string, to: string): VitalRow | null {
  const totalDays = daysBetweenIso(from, to) + 1
  const isDay = totalDays === 1

  let value: number | null = null
  let basis: VitalRow['basis'] = isDay ? (spec.smoothDays > 1 ? 'smoothed' : 'day') : 'period'
  let valueDate: string | null = null
  let readings = 0
  let valueFrom = from
  let few = false

  if (isDay && spec.smoothDays > 1) {
    valueFrom = addDaysIso(to, -(spec.smoothDays - 1))
    const win = inSpan(s, valueFrom, to)
    readings = win.length
    value = win.length ? mean(win.map(d => d.value)) : null
    valueDate = win.length ? win[win.length - 1].date : null
    few = win.length > 0 && win.length < MIN_SMOOTH_READINGS
  } else if (isDay) {
    const lookback = spec.lookbackDays ?? DAY_FALLBACK_DAYS
    const hits = inSpan(s, addDaysIso(to, -(lookback - 1)), to)
    const hit = hits[hits.length - 1]
    if (hit) {
      value = hit.value
      valueDate = hit.date
      readings = 1
      valueFrom = hit.date
      if (hit.date !== to) basis = spec.lookbackDays ? 'latest' : 'day'
    }
  } else {
    let win = inSpan(s, from, to)
    if (!win.length && spec.lookbackDays) {
      const hits = inSpan(s, addDaysIso(to, -(spec.lookbackDays - 1)), to)
      if (hits.length) {
        win = [hits[hits.length - 1]]
        basis = 'latest'
        valueFrom = win[0].date
      }
    }
    readings = win.length
    value = win.length ? mean(win.map(d => d.value)) : null
    valueDate = win.length ? win[win.length - 1].date : null
    const minReadings = basis === 'latest' ? 1 : spec.minPeriodReadings ?? Math.max(2, Math.ceil(totalDays / 5))
    few = win.length > 0 && win.length < minReadings
  }

  // Nothing in the period and nothing to compare it with → not shown at all.
  const baseFrom = addDaysIso(valueFrom, -BASELINE_DAYS)
  const baseTo = addDaysIso(valueFrom, -1)
  const history = inSpan(s, baseFrom, baseTo).map(d => d.value)
  if (value == null && (!history.length || spec.floor != null)) return null

  const usual = spec.range ? usualRange(history, spec.range, spec.minHistory) : null

  // The period before: the same length (a Day view compares with the 7 days before).
  const prevLen = isDay ? 7 : totalDays
  const prevWin = basis === 'latest' ? [] : inSpan(s, addDaysIso(valueFrom, -prevLen), addDaysIso(valueFrom, -1))
  const prevMin = isDay ? 3 : Math.max(2, Math.ceil(prevLen / 5))
  const previous = prevWin.length >= prevMin ? mean(prevWin.map(d => d.value)) : null
  const previousLabel = isDay ? 'vs the 7 days before' : `vs the ${totalDays} days before`

  let status: VitalStatus = 'unknown'
  let reason: VitalReason | null = null
  let reasonText: string | null = null
  if (value == null) {
    reason = 'no-reading'
    reasonText = isDay ? 'No reading for this day.' : `No reading in these ${totalDays} days.`
  } else if (few) {
    reason = 'few-readings'
    reasonText = isDay
      ? `Only ${readings} reading${readings === 1 ? '' : 's'} in the 7 days to this day — too few for a 7-day average.`
      : `Only ${readings} reading${readings === 1 ? '' : 's'} in these ${totalDays} days — too few to judge the period.`
  } else {
    status = stateOf(value, spec, usual)
    if (status === 'unknown') {
      reason = 'no-history'
      reasonText = `Not enough history to know your usual yet: ${history.length} of the ${spec.minHistory} readings needed in the 60 days before.`
    }
  }
  const signal = signalOf(status, spec)

  // Day by day inside a period (and the run at its end).
  let daysAbove: number | null = null, daysBelow: number | null = null, daysChecked: number | null = null
  if (!isDay && basis === 'period' && (usual || spec.floor != null)) {
    daysAbove = 0; daysBelow = 0; daysChecked = 0
    for (const d of inSpan(s, from, to)) {
      const v = perDay(spec, s, d.date)
      if (v == null) continue
      daysChecked++
      const st = stateOf(v, spec, usual)
      if (st === 'above') daysAbove++
      else if (st === 'below') daysBelow++
    }
  }
  const run = value != null && !few ? runAt(spec, s, valueDate ?? to, usual) : null

  const row: VitalRow = {
    key: spec.key, spec, value, basis, valueDate, readings, usual,
    referenceKind: spec.floor != null ? 'population' : 'personal',
    deltaVsUsual: value != null && usual ? value - usual.center : null,
    previous, deltaVsPrevious: value != null && previous != null ? value - previous : null, previousLabel,
    status, signal, reason, reasonText,
    daysAbove, daysBelow, daysChecked, run,
    thinHistory: !!usual && usual.n < THIN_HISTORY,
    meaning: '',
  }
  row.meaning = meaningOf(row, isDay)
  return row
}

// ── Words ────────────────────────────────────────────────────────────────────

function absDelta(row: VitalRow): string {
  return `${fmtVital(Math.abs(row.deltaVsUsual ?? 0), row.spec.decimals)}${unitGap(row.spec.unit)}`
}

function meaningOf(row: VitalRow, isDay: boolean): string {
  const { spec, status } = row
  if (status === 'unknown') {
    if (row.reason === 'no-history') return `${row.reasonText} Until then this reading can’t be compared with your normal.`
    if (row.reason === 'no-reading' && spec.group === 'recovery' && spec.key !== 'rhr' && spec.key !== 'hrv') {
      return `${row.reasonText} Wear the Watch to sleep to get this.`
    }
    return row.reasonText ?? 'Not enough data.'
  }
  const span = isDay ? '' : ' on average'
  switch (spec.key) {
    case 'rhr':
      if (status === 'inside') return `Within 5 bpm of your usual${span} — normal day-to-day variation.`
      if (status === 'above') return `${absDelta(row)} above your usual${span} — hard training, short sleep, alcohol, stress, heat or a cold coming on can all raise it.`
      return `${absDelta(row)} below your usual${span} — usually a sign of good recovery or better fitness.`
    case 'hrv':
      if (status === 'inside') return `Within your normal range${isDay ? ' (7-day average — single days swing too much to judge)' : ''}.`
      if (status === 'below') return 'Lower than your normal — your body may be under more strain than usual: hard training, poor sleep, alcohol, stress or illness can all lower it.'
      return 'Higher than your normal — usually a sign of good recovery.'
    case 'resp':
      if (status === 'inside') return 'Normal for you. Breathing rate in sleep is very steady, so it only matters when it rises.'
      if (status === 'above') {
        const big = (row.deltaVsUsual ?? 0) >= 3
        return `${absDelta(row)} faster than usual in sleep — often one of the first signs of a cold or other infection; alcohol and altitude raise it too.${big ? ' A rise of 3 or more is the level wearable studies linked with infection.' : ''}`
      }
      return 'A little slower than usual — not a concern.'
    case 'spo2': {
      const mid = row.value != null && row.value < 95 ? ' Mid-90s in sleep is normal — healthy adults average about 95% asleep.' : ''
      if (status === 'inside') return `Normal for you.${mid}`
      if (status === 'below') return 'Lower than usual. A dip on one night is within the Watch’s error (± 3–4 points); repeated low nights, or low together with other signals, are worth noting. Altitude and a loose band lower it too.'
      return 'A little higher than usual — nothing to act on.'
    }
    case 'temp':
      if (status === 'inside') return 'Normal for you.'
      if (status === 'above') return 'Warmer than your usual night — common after alcohol, a late workout, a warm room or when getting ill. A rise over several nights matters more than one.'
      return 'Cooler than your usual night — usually a cold room or a loose band.'
    case 'walking':
      if (status === 'inside') return `Normal for you${isDay ? ' (7-day average)' : ''}.`
      if (status === 'above') return `${absDelta(row)} higher than usual on ordinary walks — heat, poor sleep, illness, dehydration or a break from training can do this.`
      return `${absDelta(row)} lower than usual on ordinary walks — consistent with better fitness.`
    case 'hrr':
      if (status === 'inside') return 'Normal: your heart rate dropped more than 12 bpm in the first minute after a workout.'
      return 'Slower than typical. After an easy session a small drop is expected, so compare similar hard sessions before reading much into it.'
  }
}

/** "resting heart rate is 6 bpm above your usual". */
function phraseOf(row: VitalRow, isDay: boolean): string {
  const { spec, status } = row
  const verb = isDay ? 'is' : 'averaged'
  const dir = status === 'above' ? 'above' : 'below'
  switch (spec.key) {
    case 'hrv': return `HRV ${verb} ${dir} your usual range`
    case 'temp': return `wrist temperature ${verb} ${absDelta(row)} ${dir} your usual night`
    case 'spo2': return `blood oxygen in sleep ${verb} ${absDelta(row)} ${dir} your usual`
    case 'hrr': return `heart-rate recovery after your latest workout was ${fmtVital(row.value ?? 0, 0)} bpm`
    default: return `${spec.phraseLabel} ${verb} ${absDelta(row)} ${dir} your usual`
  }
}

function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five']
const countWord = (n: number) => COUNT_WORDS[n] ?? String(n)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function persistentDays(row: VitalRow): number {
  if (!row.run || row.run.direction !== row.status) return 0
  return row.run.days
}

function daysOffText(row: VitalRow): string | null {
  if (row.daysChecked == null || !row.daysChecked) return null
  const n = row.status === 'above' ? row.daysAbove : row.status === 'below' ? row.daysBelow : null
  if (n == null) return null
  const word = row.status === 'above' ? (row.spec.key === 'temp' ? 'warm' : 'high') : 'low'
  return `${word} on ${n} of ${row.daysChecked} days`
}

function buildVerdict(rows: VitalRow[], isDay: boolean, totalDays: number): VitalsVerdict {
  const recovery = rows.filter(r => r.spec.group === 'recovery')
  const judged = recovery.filter(r => r.status !== 'unknown')
  const concerns = judged.filter(r => r.signal === 'concern')
  const goods = judged.filter(r => r.signal === 'good')
  const neutrals = judged.filter(r => r.signal === 'neutral')
  const notes: string[] = []
  const span = isDay ? 'this day' : `these ${totalDays} days`

  let tone: VerdictTone
  let label: string
  let headline: string

  if (!rows.length) {
    return {
      tone: 'neutral', label: 'No readings', headline: `No heart or overnight readings for ${span} yet.`,
      notes: ['Resting heart rate and HRV come from wearing the Watch; the overnight vitals need it worn to sleep.'],
      concerns: [], goods: [], judged: 0,
    }
  }

  if (!judged.length) {
    tone = 'neutral'
    label = 'Not enough data'
    headline = `Not enough readings to judge ${span} yet.`
  } else if (!concerns.length) {
    tone = 'success'
    label = 'All normal for you'
    if (goods.length) {
      const g = goods.map(r => r.key === 'rhr' ? 'resting heart rate is lower than usual' : r.key === 'hrv' ? 'HRV is higher than usual' : phraseOf(r, isDay))
      headline = `Everything is in your usual range or better: ${listJoin(g)} — usually a sign you’re well recovered.`
    } else {
      headline = judged.length === 1 ? `${judged[0].spec.label} is in your usual range.` : 'Everything is in your usual range.'
    }
    // A signal that averages fine but has been off for the last few days.
    for (const r of judged) {
      if (!r.run || r.run.days < 2 || r.run.direction !== r.spec.concern || r.status === r.spec.concern) continue
      notes.push(`${r.spec.label} has been ${r.run.direction} your usual for the last ${r.run.days} readings, though ${isDay ? 'today' : 'the period'} as a whole is normal — worth keeping an eye on.`)
      if (r.run.days >= PERSISTENT_DAYS) tone = 'neutral'
    }
  } else {
    const persistent = concerns.filter(r => persistentDays(r) >= PERSISTENT_DAYS || (!isDay && r.daysChecked != null && r.daysChecked >= PERSISTENT_DAYS
      && ((r.status === 'above' ? r.daysAbove : r.daysBelow) ?? 0) * 2 >= r.daysChecked))
    const phrases = concerns.map(r => {
      const off = !isDay ? daysOffText(r) : null
      return `${phraseOf(r, isDay)}${off ? ` (${off})` : ''}`
    })
    label = `${concerns.length} signal${concerns.length === 1 ? '' : 's'} off`
    if (concerns.length === 1) {
      const r = concerns[0]
      headline = `One signal is off: ${phrases[0]}.`
      if (persistent.length) {
        tone = 'warn'
        const n = persistentDays(r)
        notes.push(n >= PERSISTENT_DAYS
          ? `It has been off for ${n} readings in a row — worth easing off hard training and putting sleep first. If it carries on or you feel unwell, rest.`
          : 'It was off on most days of this period — worth easing off hard training and putting sleep first. If it carries on or you feel unwell, rest.')
      } else {
        tone = 'neutral'
        notes.push(isDay
          ? 'On its own that’s common — a hard session, alcohol, a late meal or a short night can do it. One day is noise; if it’s still off in two or three days, take it easier.'
          : 'On its own that’s common and often passes. If it is still off next week, look at sleep, alcohol, stress and how hard you’ve been training.')
      }
    } else {
      tone = 'warn'
      headline = `${countWord(concerns.length)} recovery signals are off: ${listJoin(phrases)} — together these often mean fatigue, illness coming on, alcohol or short sleep.`
      if (persistent.length) {
        const r = persistent[0]
        const n = persistentDays(r)
        notes.push(n >= PERSISTENT_DAYS
          ? `${r.spec.label} has been off for ${n} readings in a row — ease off hard training and put sleep first; if you feel unwell, rest.`
          : 'They were off on most days of this period — ease off hard training and put sleep first; if you feel unwell, rest.')
      } else {
        notes.push('One bad day is noise; three in a row is worth easing off.')
      }
    }
  }

  // Harmless deviations, said so they don't look like a missed warning.
  for (const r of neutrals) notes.push(`${r.spec.label}: ${r.meaning}`)

  // Fitness context.
  const walking = rows.find(r => r.key === 'walking' && r.status !== 'unknown')
  if (walking?.signal === 'concern') {
    notes.push(concerns.length
      ? `Walking heart rate is also ${absDelta(walking)} above your usual.`
      : `Walking heart rate is ${absDelta(walking)} above your usual — heat, poor sleep, illness or a break from training can do this.`)
  } else if (walking?.signal === 'good') {
    notes.push('Walking heart rate is lower than usual — consistent with better fitness.')
  }
  const hrr = rows.find(r => r.key === 'hrr' && r.status === 'below')
  if (hrr) notes.push(`${cap(phraseOf(hrr, isDay))} — slower than typical; compare similar hard sessions before reading much into it.`)

  // What could not be judged, and how firm the rest is.
  const notJudged = rows.filter(r => r.status === 'unknown')
  if (notJudged.length) {
    const bits = notJudged.map(r => {
      const why = r.reason === 'no-reading' ? 'no reading' : r.reason === 'few-readings' ? 'too few readings' : 'not enough history yet'
      return `${r.spec.label.replace(/ \(.*\)$/, '')} (${why})`
    })
    notes.push(`Not judged: ${listJoin(bits)}.`)
  }
  const thin = rows.filter(r => r.status !== 'unknown' && r.thinHistory)
  if (thin.length) {
    const names = thin.map(r => r.spec.label.replace(/ \(.*\)$/, ''))
    notes.push(`${listJoin(names)} ${thin.length === 1 ? 'has' : 'have'} a usual range from under four weeks of readings, so read ${thin.length === 1 ? 'it' : 'them'} as rough.`)
  }
  if (judged.length && judged.length < 2 && recovery.length > judged.length) {
    notes.push('Based on a single signal — one reading on its own says little.')
  }
  if (totalDays > 30 && notJudged.some(r => r.reason === 'no-history')) {
    notes.push('A long period often has no earlier history to compare with — pick a day or 7 days to check how you’re doing now, or see the trend cards below.')
  }

  return { tone, label, headline, notes, concerns: concerns.map(r => r.key), goods: goods.map(r => r.key), judged: judged.length }
}

// ── The reading ──────────────────────────────────────────────────────────────

/** Heart & vitals for the day or period [from, to], each against your own
 *  usual range, plus the overall sentence. */
export function readVitals(input: VitalsReadingInput): VitalsReading {
  const { from, to } = input
  const totalDays = daysBetweenIso(from, to) + 1
  const isDay = totalDays === 1
  const rows: VitalRow[] = []
  for (const key of VITAL_ORDER) {
    const spec = VITAL_SPECS[key]
    const raw = input.series[spec.metric]
    if (!raw) continue
    const row = readRow(spec, prepare(spec, raw), from, to)
    if (row) rows.push(row)
  }
  const seen = new Set<string>()
  const sources: Source[] = []
  for (const r of rows) for (const s of r.spec.sources) if (!seen.has(s.url)) { seen.add(s.url); sources.push(s) }
  return { from, to, isDay, totalDays, rows, verdict: buildVerdict(rows, isDay, totalDays), sources }
}
