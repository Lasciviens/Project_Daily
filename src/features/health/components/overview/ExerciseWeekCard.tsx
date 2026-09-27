import { Card, TonePill, useChartColors } from '../../../../shared/ui'
import { addDaysIso } from '../../healthWindowStats'
import { weeklyBuckets } from '../../healthTrendStats'
import type { HealthHero } from './useHealthHero'
import { WeeklyBars } from './HeroDetailsActivity'
import { num } from './heroFormat'

// Weekly exercise against WHO 2020: Apple exercise minutes vs 150 a week and
// days with a Hevy workout vs 2, over the last 12 complete weeks.
export function ExerciseWeekCard({ exercise, anchor }: { exercise: HealthHero['exercise']; anchor: string }) {
  const c = useChartColors()
  const from = addDaysIso(anchor, -83)
  const minutes = weeklyBuckets(exercise.series, { from, to: anchor, agg: 'total', minDays: 1 })
  const strength = weeklyBuckets(exercise.strengthDays.map(d => ({ date: d.date, value: 1 })), { from, to: anchor, agg: 'total', minDays: 0 })
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body font-semibold text-fg">Weekly exercise</p>
        {exercise.cls && <TonePill tone={exercise.cls.tone}>{exercise.cls.label}</TonePill>}
      </div>
      <p className="text-meta text-fg-2">
        Last 7 days: {num(exercise.minutes7 ?? 0)} of 150 exercise minutes · {exercise.strengthDays7} of 2 strength days (Hevy)
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="section-label mb-1">Minutes per week</p>
          <WeeklyBars data={minutes} refY={150} refLabel="150" label="minutes" unit="min" color={c.series[2]} ariaLabel="Exercise minutes per complete week" />
        </div>
        <div className="min-w-0">
          <p className="section-label mb-1">Strength days per week</p>
          <WeeklyBars data={strength} refY={2} refLabel="2" label="strength days" unit="" color={c.series[1]} ariaLabel="Days with a Hevy workout per complete week" />
        </div>
      </div>
    </Card>
  )
}
