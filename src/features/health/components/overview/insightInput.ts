import { daysBetweenIso } from '../../healthWindowStats'
import type { HealthInsightInput } from '../../benchmarks/healthGuidance'
import type { HealthHero } from './useHealthHero'

/** The hero's numbers for the picked period, in the shape buildHealthInsights
 *  reads. The guidelines on exercise are weekly, so a single day leaves them
 *  out; a day still in progress isn't judged on steps. */
export function insightInput(h: HealthHero): HealthInsightInput {
  const vo2Fresh = h.vo2 && daysBetweenIso(h.vo2.date, h.anchor) <= 365 ? h.vo2.value : null
  return {
    age: h.ctx.age, sex: h.ctx.sex, heightCm: h.ctx.heightCm ?? null,
    vo2max: vo2Fresh,
    restingHr: h.rhr.median,
    restingHrBaseline: h.rhr.baseline?.median ?? null,
    hrvSdnn: h.vitals.hrv,
    hrvBaseline: h.vitals.hrvRange ? { mean: h.vitals.hrvRange.center, sd: (h.vitals.hrvRange.high - h.vitals.hrvRange.low) / 2 } : null,
    avgSteps7: h.steps.partial ? null : h.steps.value,
    avgSleepH7: h.sleep.value,
    sleepRegularity: h.sleep.wake?.sd ?? null,
    bodyFatPct: h.weight.fatPct,
    weightKg: h.weight.value ?? h.weight.lastKg,
    waistCm: h.weight.waistCm,
    // Apple doesn't split moderate from vigorous minutes, so all count once.
    weeklyModerateMin: h.isDay ? null : h.exercise.minutes,
    strengthDaysPerWeek: h.isDay || h.exercise.isLoading ? null : h.exercise.strengthDays,
    strengthMinPerWeek: h.isDay ? null : h.exercise.strengthMin,
  }
}
