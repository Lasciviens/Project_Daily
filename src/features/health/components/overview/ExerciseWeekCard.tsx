import { Card, TonePill, useChartColors } from '../../../../shared/ui'
import { exerciseWeeks, type HealthHero } from './useHealthHero'
import { MINUTES_EMPTY, STRENGTH_EMPTY, WeeklyBars } from './HeroDetailsActivity'
import { num } from './heroFormat'

// Weekly exercise against WHO 2020: Apple exercise minutes vs 150 a week and
// days with a Hevy workout vs 2, for the weeks the picked period touches (a
// day or 7 days still show this week and the one before; the newest week
// counts up to the viewed day).
export function ExerciseWeekCard({ hero }: { hero: HealthHero }) {
  const { exercise, isDay, days } = hero
  const c = useChartColors()
  const weeks = exerciseWeeks(exercise, hero.anchor)
  const strength = days === 7 ? String(Math.round(exercise.strengthDays)) : num(exercise.strengthDays, 1)
  return (
    <Card className="@container flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body font-semibold text-fg">Weekly exercise</p>
        {exercise.cls && <TonePill tone={exercise.cls.tone}>{exercise.cls.label}</TonePill>}
      </div>
      <p className="text-meta text-fg-2">
        {isDay
          ? <>That day: {num(exercise.minutes ?? 0)} exercise minutes · {exercise.strengthDays ? 'a strength workout' : 'no strength workout'} (Hevy)</>
          : <>{days === 7 ? 'Total' : 'Average week'}: {num(exercise.minutes ?? 0)} of 150 exercise minutes · {strength} of 2 strength days (Hevy)</>}
      </p>
      <div className="grid gap-3 @[34rem]:grid-cols-2">
        <div className="min-w-0">
          <p className="section-label mb-1">Minutes per week</p>
          <WeeklyBars data={weeks.minutes} refY={150} refLabel="150" label="of exercise" unit="min" color={c.series[2]}
            ariaLabel="Exercise minutes per week; the newest week counts up to the day you're viewing" empty={MINUTES_EMPTY} />
        </div>
        <div className="min-w-0">
          <p className="section-label mb-1">Strength days per week</p>
          <WeeklyBars data={weeks.strength} refY={2} refLabel="2" label="strength days" unit="" color={c.series[1]}
            ariaLabel="Days with a Hevy workout per week; the newest week counts up to the day you're viewing" empty={STRENGTH_EMPTY} />
        </div>
      </div>
    </Card>
  )
}
