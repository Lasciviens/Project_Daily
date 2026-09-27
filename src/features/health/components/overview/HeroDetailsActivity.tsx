import type { ReactNode } from 'react'
import { useChartColors } from '../../../../shared/ui'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { addDaysIso } from '../../healthWindowStats'
import { buildTrendStats, fmtClock, weeklyBuckets } from '../../healthTrendStats'
import { SRC } from '../../benchmarks/sources'
import { HealthTrendChart } from '../HealthTrendChart'
import { SLEEP_COLOR } from '../sleepStages'
import { nightMissingText, weekRangeLabel } from '../../healthDateLabels'
import type { HealthHero } from './useHealthHero'
import { DailyTrend } from './DailyTrend'
import { MetricExplainer } from './MetricExplainer'
import { SleepTimeline } from './SleepTimeline'
import { TrendStatsBlock } from './TrendStatsBlock'
import { hm, num, signed, signedHm } from './heroFormat'

// Detail sheets for the Sleep, Steps and Exercise hero tiles.

interface Props { hero: HealthHero; onViewDay: (date: string) => void }

export function Summary({ children }: { children: ReactNode }) {
  return <p className="text-body text-fg-2">{children}</p>
}

export function SleepDetail({ hero, onViewDay }: Props) {
  const { sleep, anchor: A, ctx } = hero
  const stats = buildTrendStats(sleep.nights, { to: A, direction: 'up' })
  return (
    <div className="flex flex-col gap-5">
      <Summary>
        {sleep.lastNight != null
          ? <>{hero.isToday ? 'Last night' : 'That night'} you slept <b className="text-fg">{hm(sleep.lastNight)}</b>. </>
          : <>{nightMissingText(A, hero.today)}. </>}
        {sleep.avg7 != null && <>Your 7-night average is <b className="text-fg">{hm(sleep.avg7)}</b> ({sleep.nights7} nights) against the 7 h guideline.</>}
      </Summary>
      <DailyTrend series={sleep.nights} from={addDaysIso(A, -29)} to={A} kind="bar" rolling label="asleep" unit=""
        ariaLabel="Hours asleep per night, last 30 nights" color={SLEEP_COLOR} formatValue={hm}
        refLines={[{ y: 7, label: '7 h' }]} onViewDay={onViewDay} />
      <TrendStatsBlock stats={stats} format={hm} formatDelta={signedHm} per="per night" direction="up" />

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <p className="section-label">Regularity — last 14 nights</p>
        <p className="text-meta text-fg-2">
          {sleep.wake
            ? <>You wake around <b className="text-fg">{fmtClock(sleep.wake.center)}</b>, give or take {Math.round(sleep.wake.sd)} min
              {sleep.onset && <>; you fall asleep around {fmtClock(sleep.onset.center)} ± {Math.round(sleep.onset.sd)} min</>}.</>
            : 'At least 5 nights with a recorded session are needed for a spread.'}
        </p>
        <SleepTimeline timeline={sleep.timeline} wakeCenter={sleep.wake?.center} onsetCenter={sleep.onset?.center} />
        {sleep.wake && <MetricExplainer metric="sleep_regularity" ctx={ctx} value={sleep.wake.sd} cls={sleep.regularityCls} />}
      </div>

      <div className="border-t border-line pt-4">
        <MetricExplainer metric="sleep_duration" ctx={ctx} value={sleep.avg7} cls={sleep.cls} />
      </div>
    </div>
  )
}

export function StepsDetail({ hero, onViewDay }: Props) {
  const { steps, anchor: A, ctx } = hero
  const exclude = hero.isToday ? A : null
  const stats = buildTrendStats(steps.series, { to: A, exclude, direction: 'up' })
  return (
    <div className="flex flex-col gap-5">
      <Summary>
        Over the last 7 finished days you averaged <b className="text-fg">{num(steps.avg7)}</b> steps a day
        {steps.todaySoFar != null && <>; today so far {num(steps.todaySoFar)}</>}.
      </Summary>
      <DailyTrend series={steps.series} from={addDaysIso(A, -89)} to={A} kind="bar" rolling label="steps" unit=""
        ariaLabel="Steps per day, last 90 days" band={{ y1: 7000, y2: 8000, label: '7,000–8,000', labelSide: 'right' }} onViewDay={onViewDay} />
      <TrendStatsBlock stats={stats} format={v => num(v)} formatDelta={v => signed(v)} direction="up" rateUnit="steps/day per week" />
      <div className="border-t border-line pt-4">
        <MetricExplainer metric="step_count" ctx={ctx} value={steps.avg7} cls={steps.cls} />
      </div>
    </div>
  )
}

// Each bar is a Monday–Sunday week, labelled as its range ("7–13 Jul") on
// the axis and in the tooltip — a single date read like one day.
export function WeeklyBars({ data, refY, refLabel, label, unit, ariaLabel, color }: {
  data: { weekStart: string; value: number }[]; refY: number; refLabel: string; label: string; unit: string; ariaLabel: string; color: string
}) {
  if (!data.length) return null
  return (
    <HealthTrendChart
      data={data.map(w => ({ label: weekRangeLabel(w.weekStart), title: weekRangeLabel(w.weekStart, todayStr()), value: w.value }))}
      series={[{ key: 'value', label, color, kind: 'bar' }]}
      unit={unit}
      ariaLabel={ariaLabel}
      height={140}
      refLines={[{ y: refY, label: refLabel }]}
    />
  )
}

export function ExerciseDetail({ hero }: Props) {
  const { exercise, anchor: A, ctx } = hero
  const c = useChartColors()
  const from = addDaysIso(A, -83)
  const minutesWeeks = weeklyBuckets(exercise.series, { from, to: A, agg: 'total', minDays: 1 })
  const strengthWeeks = weeklyBuckets(exercise.strengthDays.map(d => ({ date: d.date, value: 1 })), { from, to: A, agg: 'total', minDays: 0 })
  const stats = buildTrendStats(exercise.series, { to: A, direction: 'up', weekAgg: 'total' })
  return (
    <div className="flex flex-col gap-5">
      <Summary>
        In the last 7 days: <b className="text-fg">{num(exercise.minutes7 ?? 0)} exercise minutes</b> (Apple) and
        {' '}<b className="text-fg">{exercise.strengthDays7} strength day{exercise.strengthDays7 === 1 ? '' : 's'}</b> in Hevy
        {exercise.strengthMin7 ? <> ({num(exercise.strengthMin7)} min of lifting)</> : null}.
      </Summary>
      <div>
        <p className="section-label mb-1">Exercise minutes per week (complete weeks)</p>
        <WeeklyBars data={minutesWeeks} refY={150} refLabel="150 min" label="of exercise" unit="min" color={c.series[2]}
          ariaLabel="Apple exercise minutes per complete week" />
      </div>
      <div>
        <p className="section-label mb-1">Strength days per week (Hevy)</p>
        <WeeklyBars data={strengthWeeks} refY={2} refLabel="2 days" label="strength days" unit="" color={c.series[1]}
          ariaLabel="Days with a Hevy workout per complete week" />
      </div>
      <TrendStatsBlock stats={stats} format={v => num(v)} formatDelta={v => signed(v)} direction="up" />
      <p className="text-meta text-fg-muted">
        Apple’s Exercise minutes count every minute at brisk-walk intensity or above, including recorded strength workouts. Apple
        doesn’t split moderate from vigorous, so each minute counts once here — WHO counts a vigorous minute twice, so this can
        understate how close you are.
      </p>
      <div className="border-t border-line pt-4">
        <MetricExplainer metric="weekly_exercise_minutes" ctx={ctx} value={exercise.minutes7} cls={exercise.cls} />
      </div>
      {exercise.strengthCls && (
        <div className="border-t border-line pt-4">
          <MetricExplainer metric="strength_days" ctx={ctx} value={exercise.strengthDays7} cls={exercise.strengthCls} extraSources={[SRC.momma2022]} />
        </div>
      )}
    </div>
  )
}
