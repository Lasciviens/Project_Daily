import { daysBetweenIso } from '../../healthWindowStats'
import type { HealthInsightInput } from '../../benchmarks/healthGuidance'
import type { HealthHero } from './useHealthHero'

/** The hero's numbers in the shape buildHealthInsights reads. */
export function insightInput(h: HealthHero): HealthInsightInput {
  const vo2Fresh = h.vo2 && daysBetweenIso(h.vo2.date, h.anchor) <= 365 ? h.vo2.value : null
  return {
    age: h.ctx.age, sex: h.ctx.sex, heightCm: h.ctx.heightCm ?? null,
    vo2max: vo2Fresh,
    restingHr: h.rhr.median7,
    restingHrBaseline: h.rhr.baseline?.median ?? null,
    hrvSdnn: h.vitals.hrv7,
    hrvBaseline: h.vitals.hrvRange ? { mean: h.vitals.hrvRange.center, sd: (h.vitals.hrvRange.high - h.vitals.hrvRange.low) / 2 } : null,
    avgSteps7: h.steps.avg7,
    avgSleepH7: h.sleep.avg7,
    sleepRegularity: h.sleep.wake?.sd ?? null,
    bodyFatPct: h.weight.fatPct,
    weightKg: h.weight.ma7 ?? h.weight.lastKg,
    waistCm: h.weight.waistCm,
    // Apple doesn't split moderate from vigorous minutes, so all count once.
    weeklyModerateMin: h.exercise.minutes7,
    strengthDaysPerWeek: h.exercise.isLoading ? null : h.exercise.strengthDays7,
    strengthMinPerWeek: h.exercise.strengthMin7,
  }
}
