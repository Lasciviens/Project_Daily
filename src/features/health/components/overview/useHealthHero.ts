import { useMemo } from 'react'
import { localDayOf } from '../../../../shared/utils/dateUtils'
import { useHealthProfile } from '../../../training/hooks/useAthleteProfile'
import { useHevyWorkoutsRange } from '../../../training/hooks/useHevyWorkouts'
import { useHevyBodyMeasurements } from '../../../training/hooks/useHevyBodyMeasurements'
import { extractSleepSessions } from '../../healthAggregate'
import { addDaysIso, median, personalBaseline, type Baseline, type DayValue, type HealthWindow } from '../../healthWindowStats'
import {
  movingAverageAt, nightBounds, periodChange, summarizeVitals, timeOfDaySpread, usualRange, vitalState, weeklyRate,
  type UsualRange, type VitalState, type VitalsSummary,
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
import { LONG_BACK_DAYS } from '../dateNav'
import { nightEndingOn } from '../../healthDateLabels'

// Everything the six hero tiles, their detail sheets and the insights list
// need, computed ONCE for the viewed day. The hero ignores the period control
// on purpose: it always answers "how am I doing as of this day" over the
// windows the evidence uses (last night + 7 nights, 7-day averages, a rolling
// week, a 60-day personal baseline). Every read shares the page window's
// long download (dateNav.LONG_BACK_DAYS), so the hero costs no extra request
// for Apple Health data.

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

export interface SleepTimelineNight {
  date: string
  /** Sleep onset / wake, minutes after midnight. */
  onset: number
  wake: number
  /** Hours asleep that night (the measured total), null when unknown. */
  asleep: number | null
}

export interface HealthHero {
  anchor: string
  /** Today's date (the clock), for "last night" vs "that night". */
  today: string
  isToday: boolean
  ctx: BenchmarkContext
  profile: HealthProfile | undefined
  sleep: {
    nights: DayValue[]
    /** The night that ended on the anchor day — never an older one (null = none recorded). */
    lastNight: number | null
    avg7: number | null
    prevAvg7: number | null
    nights7: number
    wake: { center: number; sd: number; n: number } | null
    onset: { center: number; sd: number; n: number } | null
    /** Onset and wake per night (minutes after midnight) over the last 14
     *  nights, plus that night's hours asleep. */
    timeline: SleepTimelineNight[]
    cls: Classification | null
    regularityCls: Classification | null
    isLoading: boolean
  }
  steps: {
    series: DayValue[]
    avg7: number | null
    prevAvg7: number | null
    todaySoFar: number | null
    cls: Classification | null
    isLoading: boolean
  }
  exercise: {
    series: DayValue[]
    minutes7: number | null
    prevMinutes7: number | null
    strengthDays7: number
    strengthMin7: number | null
    /** Hevy sessions per local day over the last 90 days. */
    strengthDays: DayValue[]
    cls: Classification | null
    strengthCls: Classification | null
    isLoading: boolean
  }
  rhr: {
    series: DayValue[]
    avg7: number | null
    median7: number | null
    baseline: Baseline | null
    delta: number | null
    cls: Classification | null
    isLoading: boolean
  }
  weight: {
    series: DayValue[]
    sources: Map<string, BodyweightSource>
    ma7: number | null
    ma7Prev: number | null
    lastKg: number | null
    lastDate: string | null
    perWeek: number | null
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
    hrv7: number | null
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

const valuesIn = (s: readonly DayValue[], from: string, to: string) => s.filter(d => d.date >= from && d.date <= to).map(d => d.value)

/** The newest reading within `days` of the anchor. */
function recent(s: readonly DayValue[], anchor: string, days = 3): DayValue | null {
  const from = addDaysIso(anchor, -(days - 1))
  const hits = s.filter(d => d.date >= from && d.date <= anchor)
  return hits.length ? hits[hits.length - 1] : null
}

function minutesOfDay(ms: number): number {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

export function useHealthHero(win: HealthWindow): HealthHero {
  const A = win.to
  const today = win.today
  const isToday = A === today
  const profileQ = useHealthProfile()
  const profile = profileQ.data
  const ctx = useMemo(() => contextFor(profile, today), [profile, today])

  const sleepQ = useSleepWindow(win)
  const stepsQ = useMetricWindow('step_count', win)
  const exQ = useMetricWindow('apple_exercise_time', win)
  const rhrQ = useMetricWindow('resting_heart_rate', win, { kind: 'average', todayComplete: true })
  const hrvQ = useMetricWindow('heart_rate_variability', win, { todayComplete: true })
  const respQ = useMetricWindow('respiratory_rate', win, { todayComplete: true })
  const spo2Q = useMetricWindow('blood_oxygen_saturation', win, { todayComplete: true })
  const tempQ = useMetricWindow('apple_sleeping_wrist_temperature', win)
  const weightQ = useBodyweightSeries(addDaysIso(A, -LONG_BACK_DAYS), A)
  const hevyQ = useHevyWorkoutsRange(addDaysIso(A, -89), A)
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
    const cur = periodChange(nights, { to: A, days: 7, minPoints: 3 })
    const timeline: SleepTimelineNight[] = []
    for (let i = 13; i >= 0; i--) {
      const date = addDaysIso(A, -i)
      const b = nightBounds(extractSleepSessions(sleepQ.points, date))
      if (b) timeline.push({ date, onset: minutesOfDay(b.onsetMs), wake: minutesOfDay(b.wakeMs), asleep: nightEndingOn(nights, date)?.value ?? null })
    }
    const wake = timeOfDaySpread(timeline.map(t => t.wake))
    const onset = timeOfDaySpread(timeline.map(t => t.onset))
    return {
      nights, lastNight: last, avg7: cur.current, prevAvg7: cur.previous, nights7: cur.nCurrent,
      wake, onset, timeline,
      cls: cur.current != null ? classify('sleep_duration', cur.current, ctx) : null,
      regularityCls: wake ? classify('sleep_regularity', wake.sd, ctx) : null,
      isLoading: sleepQ.isLoading,
    }
  }, [sleepQ.nights, sleepQ.points, sleepQ.isLoading, A, ctx])

  const steps = useMemo<HealthHero['steps']>(() => {
    const series = stepsQ.daily
    // Today's count is still growing, so the average is the 7 finished days.
    const cur = periodChange(series, { to: A, days: 7, exclude: isToday ? A : null, minPoints: 3 })
    return {
      series,
      avg7: cur.current, prevAvg7: cur.previous,
      todaySoFar: isToday ? series.find(d => d.date === A)?.value ?? null : null,
      cls: cur.current != null ? classify('step_count', cur.current, ctx) : null,
      isLoading: stepsQ.isLoading,
    }
  }, [stepsQ.daily, stepsQ.isLoading, A, isToday, ctx])

  const exercise = useMemo<HealthHero['exercise']>(() => {
    const series = exQ.daily
    const sum = (from: string, to: string) => {
      const v = valuesIn(series, from, to)
      return v.length ? v.reduce((a, b) => a + b, 0) : null
    }
    // A ROLLING week (today's minutes so far included — it is a running
    // total towards 150, not an average).
    const minutes7 = sum(addDaysIso(A, -6), A)
    const prevMinutes7 = sum(addDaysIso(A, -13), addDaysIso(A, -7))
    const perDay = new Map<string, number>()
    let strengthMs = 0
    for (const w of hevyQ.data ?? []) {
      const day = localDayOf(w.start_time ?? w.hevy_created_at)
      if (!day) continue
      perDay.set(day, (perDay.get(day) ?? 0) + 1)
      if (day >= addDaysIso(A, -6) && day <= A && w.start_time && w.end_time) {
        const ms = Date.parse(w.end_time) - Date.parse(w.start_time)
        if (ms > 0 && ms < 6 * 3_600_000) strengthMs += ms
      }
    }
    const strengthDays = [...perDay.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date))
    const strengthDays7 = strengthDays.filter(d => d.date >= addDaysIso(A, -6) && d.date <= A).length
    return {
      series, minutes7, prevMinutes7, strengthDays7,
      strengthMin7: hevyQ.data ? Math.round(strengthMs / 60_000) : null,
      strengthDays,
      cls: minutes7 != null ? classify('weekly_exercise_minutes', minutes7, ctx) : null,
      strengthCls: hevyQ.data ? classify('strength_days', strengthDays7, ctx) : null,
      isLoading: exQ.isLoading || hevyQ.isLoading,
    }
  }, [exQ.daily, exQ.isLoading, hevyQ.data, hevyQ.isLoading, A, ctx])

  const rhr = useMemo<HealthHero['rhr']>(() => {
    const series = rhrQ.daily
    const last7 = valuesIn(series, addDaysIso(A, -6), A)
    const avg7 = last7.length >= 3 ? movingAverageAt(series, A, 7) : null
    const median7 = last7.length >= 3 ? median(last7) : null
    // The 60 days BEFORE this week, so the week being judged isn't part of its own baseline.
    const baseline = personalBaseline(series, { from: addDaysIso(A, -66), to: addDaysIso(A, -7), minPoints: 14 })
    return {
      series, avg7, median7, baseline,
      delta: avg7 != null && baseline ? avg7 - baseline.median : null,
      cls: avg7 != null ? classify('resting_heart_rate', avg7, ctx) : null,
      isLoading: rhrQ.isLoading,
    }
  }, [rhrQ.daily, rhrQ.isLoading, A, ctx])

  const weight = useMemo<HealthHero['weight']>(() => {
    const pts = weightQ.data ?? []
    const series = pts.map(p => ({ date: p.date, value: p.kg }))
    const sources = new Map(pts.map(p => [p.date, p.source]))
    const last = pts[pts.length - 1] ?? null
    const ma7 = movingAverageAt(series, A, 7)
    const ma7Prev = movingAverageAt(series, addDaysIso(A, -7), 7)
    const rate = weeklyRate(series, { to: A, days: 28, minPoints: 3, minSpanDays: 7 })
    const fat = [...pts].reverse().find(p => p.fatPct != null)
    const waistRow = (measQ.data ?? [])
      .filter(m => m.waist_cm != null && m.date <= A)
      .sort((a, b) => b.date.localeCompare(a.date))[0]
    const kg = ma7 ?? last?.kg ?? null
    const bmi = computeBmi(kg, ctx.heightCm)
    const whtr = computeWaistToHeight(waistRow?.waist_cm ?? null, ctx.heightCm)
    return {
      series, sources, ma7, ma7Prev,
      lastKg: last?.kg ?? null, lastDate: last?.date ?? null,
      perWeek: rate?.perWeek ?? null,
      fatPct: fat?.fatPct ?? null,
      bmi, whtr,
      waistCm: waistRow?.waist_cm ?? null, waistDate: waistRow?.date ?? null,
      bmiCls: bmi != null ? classify('bmi', bmi, ctx) : null,
      whtrCls: whtr != null ? classify('waist_to_height', whtr, ctx) : null,
      isLoading: weightQ.isLoading,
    }
  }, [weightQ.data, weightQ.isLoading, measQ.data, A, ctx])

  const vitals = useMemo<HealthHero['vitals']>(() => {
    const hrvSeries = hrvQ.daily
    const hrv7 = movingAverageAt(hrvSeries, A, 7, { minPoints: 3 })
    const hrvRange = usualRange(valuesIn(hrvSeries, addDaysIso(A, -66), addDaysIso(A, -7)), { mode: 'sd', k: 1 }, 14)
    const hrvCls = hrv7 != null
      ? classify('heart_rate_variability', hrv7, { ...ctx, baseline: hrvRange ? { mean: hrvRange.center, sd: (hrvRange.high - hrvRange.low) / 2 } : null })
      : null

    const spo2Series = spo2Q.daily
      .map(d => ({ date: d.date, value: normalizeSpo2(d.value) }))
      .filter((d): d is DayValue => d.value != null)

    function item(key: string, label: string, unit: string, decimals: number, s: readonly DayValue[],
      spec: Parameters<typeof usualRange>[1], priorDays: number, rangeRule: string): VitalItem {
      const r = recent(s, A)
      const range = r ? usualRange(valuesIn(s, addDaysIso(r.date, -priorDays), addDaysIso(r.date, -1)), spec, 10) : null
      return { key, label, unit, decimals, value: r?.value ?? null, date: r?.date ?? null, range, state: vitalState(r?.value, range), rangeRule }
    }

    const items: VitalItem[] = [
      {
        key: 'hrv', label: 'HRV', unit: 'ms', decimals: 0, value: hrv7, date: hrv7 != null ? A : null, range: hrvRange,
        state: vitalState(hrv7, hrvRange), good: 'above', rangeRule: '7-day average against your 60-day mean ± 1 SD (Plews 2013)',
      },
      // 60 prior nights, like the chart band and the Heart & vitals reading (vitalsReading.ts).
      item('resp', 'Respiratory rate', 'br/min', 1, respQ.daily, { mode: 'median', halfWidth: 1.5 }, 60,
        'Latest night against your 60-night median ± 1.5 breaths/min'),
      item('spo2', 'Blood oxygen', '%', 0, spo2Series, { mode: 'sd', k: 2, minHalfWidth: 1 }, 60,
        'Latest night against your 60-night mean ± 2 SD (at least ± 1 point)'),
      item('temp', 'Wrist temperature', '°C', 1, tempQ.daily, { mode: 'sd', k: 2, minHalfWidth: 0.3 }, 60,
        'Latest night against your 60-night mean ± 2 SD (at least ± 0.3 °C)'),
    ]
    return {
      hrvSeries, hrv7, hrvRange, hrvCls, items,
      summary: summarizeVitals(items),
      isLoading: hrvQ.isLoading || respQ.isLoading || spo2Q.isLoading || tempQ.isLoading,
    }
  }, [hrvQ.daily, respQ.daily, spo2Q.daily, tempQ.daily, hrvQ.isLoading, respQ.isLoading, spo2Q.isLoading, tempQ.isLoading, A, ctx])

  const aims = useMemo<HealthHero['aims']>(() => ({
    sleep: sleepAim({ avg7: sleep.avg7, wakeSd: sleep.wake?.sd ?? null }),
    steps: stepsAim({ avg7: steps.avg7, age: ctx.age }),
    exercise: exerciseAim({ minutes7: exercise.minutes7, strengthDays7: exercise.strengthDays7 }),
    rhr: restingHrAim({ value: rhr.avg7, baselineMedian: rhr.baseline?.median ?? null, delta: rhr.delta }),
    weight: weightAim({ kg: weight.ma7 ?? weight.lastKg, heightCm: ctx.heightCm, goalWeightKg, phase, whtr: weight.whtr, goalLoaded }),
    vitals: vitalsAim({ ...vitals.summary, hrv: hrvAim({ value: vitals.hrv7, range: vitals.hrvRange }) }),
  }), [sleep.avg7, sleep.wake, steps.avg7, exercise.minutes7, exercise.strengthDays7, rhr.avg7, rhr.baseline, rhr.delta,
    weight.ma7, weight.lastKg, weight.whtr, vitals.summary, vitals.hrv7, vitals.hrvRange, ctx.age, ctx.heightCm, goalWeightKg, phase, goalLoaded])

  return { anchor: A, today, isToday, ctx, profile, sleep, steps, exercise, rhr, weight, vitals, vo2: vo2Q.data ?? null, aims, goalWeightKg, goalLoaded }
}
