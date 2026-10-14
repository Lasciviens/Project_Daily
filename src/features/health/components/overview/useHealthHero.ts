import { useMemo } from 'react'
import { localDayOf } from '../../../../shared/utils/dateUtils'
import { useHealthProfile } from '../../../training/hooks/useAthleteProfile'
import { useHevyWorkoutsRange } from '../../../training/hooks/useHevyWorkouts'
import { useHevyBodyMeasurements } from '../../../training/hooks/useHevyBodyMeasurements'
import { extractSleepSessions, sleepNightKey } from '../../healthAggregate'
import type { HealthMetric } from '../../api/healthApi'
import {
  addDaysIso, mean, median, personalBaseline, summarizeWindow, type Baseline, type DayValue, type HealthWindow,
} from '../../healthWindowStats'
import {
  nightBounds, summarizeVitals, timeOfDaySpread, usualRange, vitalState, weekStartsFor, weekTotals, weeklyTotal,
  type ClockNight, type UsualRange, type VitalState, type VitalsSummary, type WeekBucket,
} from '../../healthTrendStats'
import {
  classify, computeBmi, computeWaistToHeight, contextFor, exerciseAim, hrvAim, normalizeSpo2, restingHrAim, sleepAim, stepsAim,
  vitalsAim, weightAim,
  type Aim, type BenchmarkContext, type Classification, type HealthProfile,
} from '../../benchmarks/healthBenchmarks'
import { useDayTargets } from '../../../daily/hooks/useDayTargets'
import { useBodyGoals } from '../../goal/useBodyGoals'
import type { BodyweightSource } from '../../bodyweight'
import { useMetricWindow, useSleepWindow } from '../../hooks/useHealthWindow'
import { useBodyweightSeries } from '../../hooks/useBodyweight'
import { useLatestHealthValue } from '../../hooks/useHealthExport'
import { nightEndingOn } from '../../healthDateLabels'

// Everything the six hero tiles, their detail sheets, the insights list and
// the windows' trend cards need, computed ONCE for the period picked in the
// range bar (owner: "the widgets should not be hardcoded by 7 day average but
// should be based on my selection"). A day shows that day's value; 7, 30 and
// 90 days and a year show the period's average — or, for exercise, its
// weekly total — against the same number of days just before. Personal usual
// ranges are the 60 days BEFORE the period, as on Heart & vitals
// (vitalsReading.ts), so a bad week can't hide inside its own average. Every
// Apple Health read shares the page window's download (dateNav.healthWindowFor).

/** Personal usual ranges read the days just before the period. */
export const BASELINE_DAYS = 60

/** A chart's dashed 7-day average only helps when the chart is longer than two weeks. */
export const rollingFor = (days: number) => days > 14

export interface VitalItem {
  key: string
  label: string
  unit: string
  decimals: number
  value: number | null
  date: string | null
  range: UsualRange | null
  state: VitalState
  /** The direction that is a good sign (HRV above your usual), never a warning. */
  good?: 'above' | 'below' | null
  /** How the usual range is defined, for the detail sheet. */
  rangeRule: string
}

export type SleepTimelineNight = ClockNight

export interface HealthHero {
  /** The period's last day (the day picked in the range bar). */
  anchor: string
  /** The period's first day. */
  from: string
  /** Days in the period (1 = a single day). */
  days: number
  isDay: boolean
  /** Today's date (the clock), for "last night" vs "that night". */
  today: string
  isToday: boolean
  ctx: BenchmarkContext
  profile: HealthProfile | undefined
  sleep: {
    nights: DayValue[]
    /** The night that ended on the anchor day — never an older one (null = none recorded). */
    lastNight: number | null
    /** That night (a day), or the average per night over the period. */
    value: number | null
    /** The same over the period before. */
    previous: number | null
    /** Nights behind `value`. */
    count: number
    /** Wake / onset spread over the period's nights (5 or more). */
    wake: { center: number; sd: number; n: number } | null
    onset: { center: number; sd: number; n: number } | null
    /** Onset and wake of every night in the period, oldest first. */
    timeline: SleepTimelineNight[]
    cls: Classification | null
    regularityCls: Classification | null
    isLoading: boolean
  }
  steps: {
    series: DayValue[]
    /** That day's steps, or the average per finished day over the period. */
    value: number | null
    previous: number | null
    /** A day still in progress: `value` is "so far" and isn't judged. */
    partial: boolean
    /** Today's count so far, when a multi-day period ends today. */
    todaySoFar: number | null
    cls: Classification | null
    isLoading: boolean
  }
  exercise: {
    series: DayValue[]
    /** That day's minutes, or minutes a week over the period (a 7-day total, or the average week). */
    minutes: number | null
    previous: number | null
    /** Days with a Hevy workout: that day (0/1), or a week over the period. */
    strengthDays: number
    /** Minutes of lifting on the same basis. */
    strengthMin: number | null
    /** Hevy sessions per local day over the period's weeks. */
    strengthSeries: DayValue[]
    /** The Mondays of the weeks the period touches, newest first (at least two). */
    weekStarts: string[]
    cls: Classification | null
    strengthCls: Classification | null
    isLoading: boolean
  }
  rhr: {
    series: DayValue[]
    /** That day's reading, or the period's average. */
    value: number | null
    /** Median of the period's readings (the insights read it). */
    median: number | null
    baseline: Baseline | null
    delta: number | null
    cls: Classification | null
    isLoading: boolean
  }
  weight: {
    series: DayValue[]
    sources: Map<string, BodyweightSource>
    /** That day's weigh-in, or the average of the period's weigh-ins. */
    value: number | null
    previous: number | null
    /** The newest weigh-in on or before the anchor. */
    lastKg: number | null
    lastDate: string | null
    fatPct: number | null
    bmi: number | null
    whtr: number | null
    waistCm: number | null
    waistDate: string | null
    bmiCls: Classification | null
    whtrCls: Classification | null
    isLoading: boolean
  }
  vitals: {
    hrvSeries: DayValue[]
    /** That night's HRV, or the period's average. */
    hrv: number | null
    hrvRange: UsualRange | null
    hrvCls: Classification | null
    items: VitalItem[]
    summary: VitalsSummary
    isLoading: boolean
  }
  vo2: { value: number; date: string } | null
  /** What to aim for on each tile (benchmarks/aimGuidance.ts), shared with its detail sheet. */
  aims: Record<'sleep' | 'steps' | 'exercise' | 'rhr' | 'weight' | 'vitals', Aim>
  /** The goal weight from Goal progress, when one is set. */
  goalWeightKg: number | null
  /** False while the goal row is still loading (the defaults are showing). */
  goalLoaded: boolean
}

/** Exercise minutes and strength days per week, for the weeks the period
 *  touches; the newest week counts up to the viewed day. */
export function exerciseWeeks(exercise: HealthHero['exercise'], anchor: string): { minutes: WeekBucket[]; strength: WeekBucket[] } {
  const opts = { weekStarts: exercise.weekStarts, to: anchor }
  return {
    minutes: weekTotals(exercise.series, opts),
    strength: weekTotals(exercise.strengthSeries.map(d => ({ date: d.date, value: 1 })), { ...opts, minDays: 0 }),
  }
}

const inSpan = (s: readonly DayValue[], from: string, to: string) => s.filter(d => d.date >= from && d.date <= to)
const valuesIn = (s: readonly DayValue[], from: string, to: string) => inSpan(s, from, to).map(d => d.value)

function minutesOfDay(ms: number): number {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

/** Onset and wake of each night in [from, to] from the raw sleep rows. */
function clockNights(points: readonly HealthMetric[], nights: readonly DayValue[], from: string, to: string): ClockNight[] {
  const byNight = new Map<string, HealthMetric[]>()
  for (const p of points) {
    const key = sleepNightKey(p)
    if (key >= from && key <= to) byNight.set(key, [...(byNight.get(key) ?? []), p])
  }
  const out: ClockNight[] = []
  for (const [date, rows] of [...byNight.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const b = nightBounds(extractSleepSessions(rows, date))
    if (b) out.push({ date, onset: minutesOfDay(b.onsetMs), wake: minutesOfDay(b.wakeMs), asleep: nightEndingOn(nights, date)?.value ?? null })
  }
  return out
}

export function useHealthHero(win: HealthWindow): HealthHero {
  const A = win.to
  const F = win.from
  const { today, isDay, totalDays: days, prevFrom, prevTo } = win
  const isToday = A === today
  // The usual range ends the day before the period starts.
  const baseFrom = addDaysIso(F, -BASELINE_DAYS)
  const baseTo = addDaysIso(F, -1)
  const profileQ = useHealthProfile()
  const profile = profileQ.data
  const ctx = useMemo(() => contextFor(profile, today), [profile, today])

  const weekStarts = useMemo(() => weekStartsFor(A, days), [A, days])
  const sleepQ = useSleepWindow(win)
  const stepsQ = useMetricWindow('step_count', win)
  const exQ = useMetricWindow('apple_exercise_time', win)
  const rhrQ = useMetricWindow('resting_heart_rate', win, { kind: 'average', todayComplete: true })
  const hrvQ = useMetricWindow('heart_rate_variability', win, { todayComplete: true })
  const respQ = useMetricWindow('respiratory_rate', win, { todayComplete: true })
  const spo2Q = useMetricWindow('blood_oxygen_saturation', win, { todayComplete: true })
  const tempQ = useMetricWindow('apple_sleeping_wrist_temperature', win)
  const weightQ = useBodyweightSeries(win.fetchFrom, A)
  const hevyQ = useHevyWorkoutsRange(weekStarts[weekStarts.length - 1], A)
  const measQ = useHevyBodyMeasurements()
  const vo2Q = useLatestHealthValue('vo2_max', A)
  const { settings: goals } = useBodyGoals()
  const { targets, isLoaded: goalLoaded } = useDayTargets()
  // Until the goal row has loaded, the placeholder says "no goal" — never show that as fact.
  const goalWeightKg = goalLoaded ? goals.goalWeightKg ?? null : null
  const phase = targets.goal

  const sleep = useMemo<HealthHero['sleep']>(() => {
    const nights = sleepQ.nights.map(n => ({ date: n.date, value: n.total }))
    // Last night = the night filed under the anchor day, never the newest one on record.
    const last = nightEndingOn(nights, A)?.value ?? null
    const s = sleepQ.summary
    const timeline = clockNights(sleepQ.points, nights, F, A)
    const wake = timeOfDaySpread(timeline.map(t => t.wake))
    const onset = timeOfDaySpread(timeline.map(t => t.onset))
    return {
      nights, lastNight: last, value: s.value, previous: s.previous, count: s.daysCounted,
      wake, onset, timeline,
      cls: s.value != null ? classify('sleep_duration', s.value, ctx) : null,
      regularityCls: wake ? classify('sleep_regularity', wake.sd, ctx) : null,
      isLoading: sleepQ.isLoading,
    }
  }, [sleepQ.nights, sleepQ.points, sleepQ.summary, sleepQ.isLoading, F, A, ctx])

  const steps = useMemo<HealthHero['steps']>(() => {
    const s = stepsQ.summary
    const partial = isDay && s.partialToday
    return {
      series: stepsQ.daily,
      // Multi-day: the mean of the finished days (today's count is still growing).
      value: s.value, previous: partial ? null : s.previous, partial,
      todaySoFar: !isDay && F <= today && today <= A ? stepsQ.daily.find(d => d.date === today)?.value ?? null : null,
      cls: s.value != null && !partial ? classify('step_count', s.value, ctx) : null,
      isLoading: stepsQ.isLoading,
    }
  }, [stepsQ.daily, stepsQ.summary, stepsQ.isLoading, isDay, F, A, today, ctx])

  const exercise = useMemo<HealthHero['exercise']>(() => {
    const series = exQ.daily
    // A running total towards 150 a week, so today's minutes so far count.
    const minutes = weeklyTotal(series, F, A)
    const previous = weeklyTotal(series, prevFrom, prevTo)
    const perDay = new Map<string, number>()
    let strengthMs = 0
    for (const w of hevyQ.data ?? []) {
      const day = localDayOf(w.start_time ?? w.hevy_created_at)
      if (!day) continue
      perDay.set(day, (perDay.get(day) ?? 0) + 1)
      if (day >= F && day <= A && w.start_time && w.end_time) {
        const ms = Date.parse(w.end_time) - Date.parse(w.start_time)
        if (ms > 0 && ms < 6 * 3_600_000) strengthMs += ms
      }
    }
    const strengthSeries = [...perDay.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date))
    const daysWithLift = inSpan(strengthSeries, F, A).length
    // Per week, like the guideline (WHO: 2 days a week); a day is that day's 0 or 1.
    const perWeek = (v: number) => (isDay ? v : (v * 7) / days)
    const strengthDays = perWeek(daysWithLift)
    return {
      series, minutes, previous, strengthDays,
      strengthMin: hevyQ.data ? Math.round(perWeek(strengthMs / 60_000)) : null,
      strengthSeries, weekStarts,
      // The guideline is per week, so a single day isn't judged against it.
      cls: !isDay && minutes != null ? classify('weekly_exercise_minutes', minutes, ctx) : null,
      strengthCls: !isDay && hevyQ.data ? classify('strength_days', strengthDays, ctx) : null,
      isLoading: exQ.isLoading || hevyQ.isLoading,
    }
  }, [exQ.daily, exQ.isLoading, hevyQ.data, hevyQ.isLoading, F, A, prevFrom, prevTo, isDay, days, weekStarts, ctx])

  const rhr = useMemo<HealthHero['rhr']>(() => {
    const series = rhrQ.daily
    const value = rhrQ.summary.value
    const baseline = personalBaseline(series, { from: baseFrom, to: baseTo, minPoints: 14 })
    return {
      series, value, median: median(valuesIn(series, F, A)), baseline,
      delta: value != null && baseline ? value - baseline.median : null,
      cls: value != null ? classify('resting_heart_rate', value, ctx) : null,
      isLoading: rhrQ.isLoading,
    }
  }, [rhrQ.daily, rhrQ.summary.value, rhrQ.isLoading, F, A, baseFrom, baseTo, ctx])

  const weight = useMemo<HealthHero['weight']>(() => {
    const pts = (weightQ.data ?? []).filter(p => p.date <= A)
    const series = pts.map(p => ({ date: p.date, value: p.kg }))
    const sources = new Map(pts.map(p => [p.date, p.source]))
    const last = pts[pts.length - 1] ?? null
    // A weigh-in is complete the moment it is taken, so today counts.
    const s = summarizeWindow('average', series, { from: F, to: A, today, todayComplete: true })
    const fat = [...pts].reverse().find(p => p.fatPct != null)
    const waistRow = (measQ.data ?? [])
      .filter(m => m.waist_cm != null && m.date <= A)
      .sort((a, b) => b.date.localeCompare(a.date))[0]
    const kg = s.value ?? last?.kg ?? null
    const bmi = computeBmi(kg, ctx.heightCm)
    const whtr = computeWaistToHeight(waistRow?.waist_cm ?? null, ctx.heightCm)
    return {
      series, sources, value: s.value, previous: s.previous,
      lastKg: last?.kg ?? null, lastDate: last?.date ?? null,
      fatPct: fat?.fatPct ?? null,
      bmi, whtr,
      waistCm: waistRow?.waist_cm ?? null, waistDate: waistRow?.date ?? null,
      bmiCls: bmi != null ? classify('bmi', bmi, ctx) : null,
      whtrCls: whtr != null ? classify('waist_to_height', whtr, ctx) : null,
      isLoading: weightQ.isLoading,
    }
  }, [weightQ.data, weightQ.isLoading, measQ.data, F, A, today, ctx])

  const vitals = useMemo<HealthHero['vitals']>(() => {
    const hrvSeries = hrvQ.daily
    const hrv = hrvQ.summary.value
    const hrvRange = usualRange(valuesIn(hrvSeries, baseFrom, baseTo), { mode: 'sd', k: 1 }, 14)
    const hrvCls = hrv != null
      ? classify('heart_rate_variability', hrv, { ...ctx, baseline: hrvRange ? { mean: hrvRange.center, sd: (hrvRange.high - hrvRange.low) / 2 } : null })
      : null

    const spo2Series = spo2Q.daily
      .map(d => ({ date: d.date, value: normalizeSpo2(d.value) }))
      .filter((d): d is DayValue => d.value != null)

    // That night's reading, or the period's average, against the 60 days before.
    function item(key: string, label: string, unit: string, decimals: number, s: readonly DayValue[],
      spec: Parameters<typeof usualRange>[1], rangeRule: string): VitalItem {
      const inPeriod = inSpan(s, F, A)
      const value = mean(inPeriod.map(d => d.value))
      const range = usualRange(valuesIn(s, baseFrom, baseTo), spec, 10)
      return { key, label, unit, decimals, value, date: inPeriod[inPeriod.length - 1]?.date ?? null, range, state: vitalState(value, range), rangeRule }
    }

    const items: VitalItem[] = [
      {
        key: 'hrv', label: 'HRV', unit: 'ms', decimals: 0, value: hrv, date: hrv != null ? A : null, range: hrvRange,
        state: vitalState(hrv, hrvRange), good: 'above', rangeRule: 'Against your mean over the 60 days before ± 1 SD (Plews 2013)',
      },
      item('resp', 'Respiratory rate', 'br/min', 1, respQ.daily, { mode: 'median', halfWidth: 1.5 },
        'Against your median over the 60 nights before ± 1.5 breaths/min'),
      item('spo2', 'Blood oxygen', '%', 0, spo2Series, { mode: 'sd', k: 2, minHalfWidth: 1 },
        'Against your mean over the 60 nights before ± 2 SD (at least ± 1 point)'),
      item('temp', 'Wrist temperature', '°C', 1, tempQ.daily, { mode: 'sd', k: 2, minHalfWidth: 0.3 },
        'Against your mean over the 60 nights before ± 2 SD (at least ± 0.3 °C)'),
    ]
    return {
      hrvSeries, hrv, hrvRange, hrvCls, items,
      summary: summarizeVitals(items),
      isLoading: hrvQ.isLoading || respQ.isLoading || spo2Q.isLoading || tempQ.isLoading,
    }
  }, [hrvQ.daily, hrvQ.summary.value, respQ.daily, spo2Q.daily, tempQ.daily, hrvQ.isLoading, respQ.isLoading, spo2Q.isLoading, tempQ.isLoading,
    F, A, baseFrom, baseTo, ctx])

  const aims = useMemo<HealthHero['aims']>(() => ({
    sleep: sleepAim({ avg7: sleep.value, wakeSd: sleep.wake?.sd ?? null }),
    steps: stepsAim({ avg7: steps.partial ? null : steps.value, age: ctx.age }),
    // The guideline is weekly: a single day gets the plain aim.
    exercise: exerciseAim(isDay ? { minutes7: null, strengthDays7: null } : { minutes7: exercise.minutes, strengthDays7: exercise.strengthDays }),
    rhr: restingHrAim({ value: rhr.value, baselineMedian: rhr.baseline?.median ?? null, delta: rhr.delta }),
    weight: weightAim({ kg: weight.value ?? weight.lastKg, heightCm: ctx.heightCm, goalWeightKg, phase, whtr: weight.whtr, goalLoaded }),
    vitals: vitalsAim({ ...vitals.summary, hrv: hrvAim({ value: vitals.hrv, range: vitals.hrvRange }) }),
  }), [sleep.value, sleep.wake, steps.partial, steps.value, isDay, exercise.minutes, exercise.strengthDays, rhr.value, rhr.baseline, rhr.delta,
    weight.value, weight.lastKg, weight.whtr, vitals.summary, vitals.hrv, vitals.hrvRange, ctx.age, ctx.heightCm, goalWeightKg, phase, goalLoaded])

  return {
    anchor: A, from: F, days, isDay, today, isToday, ctx, profile, sleep, steps, exercise, rhr, weight, vitals,
    vo2: vo2Q.data ?? null, aims, goalWeightKg, goalLoaded,
  }
}
