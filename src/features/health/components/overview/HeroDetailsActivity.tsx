import type { ReactNode } from 'react'
import { useChartColors } from '../../../../shared/ui'
import { todayStr } from '../../../../shared/utils/dateUtils'
import { buildTrendStats, clockRows, fmtClock } from '../../healthTrendStats'
import { SRC } from '../../benchmarks/sources'
import { HealthTrendChart } from '../HealthTrendChart'
import { SLEEP_COLOR } from '../sleepStages'
import { nightMissingText, weekRangeLabel } from '../../healthDateLabels'
import { exerciseWeeks, rollingFor, type HealthHero } from './useHealthHero'
import { DailyTrend } from './DailyTrend'
import { MetricExplainer } from './MetricExplainer'
import { SleepTimeline } from './SleepTimeline'
import { TrendStatsBlock } from './TrendStatsBlock'
import { hm, num, signed, signedHm } from './heroFormat'

// Detail sheets for the Sleep, Steps and Exercise hero tiles. Like the tiles
// they follow the range bar: a day's own value, or the period's average with
// its chart, trend and weeks; a single day has no chart to draw.

interface Props { hero: HealthHero; onViewDay: (date: string) => void }

export function Summary({ children }: { children: ReactNode }) {
  return <p className="text-body text-fg-2">{children}</p>
}

export function SleepDetail({ hero, onViewDay }: Props) {
  const { sleep, anchor: A, from: F, ctx, isDay } = hero
  const stats = buildTrendStats(sleep.nights, { from: F, to: A, direction: 'up' })
  return (
    <div className="flex flex-col gap-5">
      <Summary>
        {isDay
          ? sleep.lastNight != null
            ? <>{hero.isToday ? 'Last night' : 'That night'} you slept <b className="text-fg">{hm(sleep.lastNight)}</b>, against the 7 h guideline.</>
            : <>{nightMissingText(A, hero.today)}.</>
          : sleep.value != null
            ? <>You averaged <b className="text-fg">{hm(sleep.value)}</b> a night ({sleep.count} nights), against the 7 h guideline.</>
            : <>No sleep recorded in this period.</>}
      </Summary>
      {!isDay && (
        <DailyTrend series={sleep.nights} from={F} to={A} kind="bar" rolling={rollingFor(hero.days)} label="asleep" unit=""
          ariaLabel="Hours asleep per night" color={SLEEP_COLOR} formatValue={hm}
          refLines={[{ y: 7, label: '7 h' }]} onViewDay={onViewDay} />
      )}
      <TrendStatsBlock stats={stats} format={hm} formatDelta={signedHm} per="per night" direction="up" />

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <p className="section-label">Regularity</p>
        <p className="text-meta text-fg-2">
          {isDay && sleep.timeline.length
            ? <>You fell asleep at <b className="text-fg">{fmtClock(sleep.timeline[0].onset)}</b> and woke at <b className="text-fg">{fmtClock(sleep.timeline[0].wake)}</b>. A spread needs a period of 5 nights or more.</>
            : sleep.wake
            ? <>You wake around <b className="text-fg">{fmtClock(sleep.wake.center)}</b>, give or take {Math.round(sleep.wake.sd)} min
              {sleep.onset && <>; you fall asleep around {fmtClock(sleep.onset.center)} ± {Math.round(sleep.onset.sd)} min</>}.</>
            : 'At least 5 nights with a recorded session are needed for a spread.'}
        </p>
        <SleepTimeline rows={clockRows(sleep.timeline, F, A)} wakeCenter={sleep.wake?.center} onsetCenter={sleep.onset?.center} />
        {sleep.wake && <MetricExplainer metric="sleep_regularity" ctx={ctx} value={sleep.wake.sd} cls={sleep.regularityCls} />}
      </div>

      <div className="border-t border-line pt-4">
        <MetricExplainer metric="sleep_duration" ctx={ctx} value={sleep.value} cls={sleep.cls} aim={hero.aims.sleep} />
      </div>
    </div>
  )
}

export function StepsDetail({ hero, onViewDay }: Props) {
  const { steps, anchor: A, from: F, ctx, isDay } = hero
  const exclude = hero.isToday ? A : null
  const stats = buildTrendStats(steps.series, { from: F, to: A, exclude, direction: 'up' })
  return (
    <div className="flex flex-col gap-5">
      <Summary>
        {isDay
          ? <>{steps.partial ? 'So far today' : 'That day'}: <b className="text-fg">{num(steps.value)}</b> steps.</>
          : <>You averaged <b className="text-fg">{num(steps.value)}</b> steps a day over the finished days
            {steps.todaySoFar != null && <>; today so far {num(steps.todaySoFar)}</>}.</>}
      </Summary>
      {!isDay && (
        <DailyTrend series={steps.series} from={F} to={A} kind="bar" rolling={rollingFor(hero.days)} label="steps" unit=""
          ariaLabel="Steps per day" band={{ y1: 7000, y2: 8000, label: '7,000–8,000', labelSide: 'right' }} onViewDay={onViewDay} />
      )}
      <TrendStatsBlock stats={stats} format={v => num(v)} formatDelta={v => signed(v)} direction="up" rateUnit="steps/day per week" />
      <div className="border-t border-line pt-4">
        <MetricExplainer metric="step_count" ctx={ctx} value={steps.partial ? null : steps.value} cls={steps.cls} aim={hero.aims.steps} />
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
  const { exercise, anchor: A, from: F, ctx, isDay } = hero
  const c = useChartColors()
  const weeks = exerciseWeeks(exercise, A)
  const stats = buildTrendStats(exercise.series, { from: F, to: A, exclude: hero.isToday ? A : null, direction: 'up', weekAgg: 'total' })
  const lifting = exercise.strengthMin ? <> ({num(exercise.strengthMin)} min of lifting)</> : null
  return (
    <div className="flex flex-col gap-5">
      <Summary>
        {isDay
          ? <>That day: <b className="text-fg">{num(exercise.minutes ?? 0)} exercise minutes</b> (Apple){exercise.strengthDays ? <> and a strength workout in Hevy{lifting}</> : ', no strength workout in Hevy'}.</>
          : <>{hero.days === 7 ? 'In this period' : 'An average week in this period'}: <b className="text-fg">{num(exercise.minutes ?? 0)} exercise minutes</b> (Apple) and
            {' '}<b className="text-fg">{hero.days === 7 ? Math.round(exercise.strengthDays) : num(exercise.strengthDays, 1)} strength days</b> in Hevy{lifting}.</>}
      </Summary>
      <div>
        <p className="section-label mb-1">Exercise minutes per week</p>
        <WeeklyBars data={weeks.minutes} refY={150} refLabel="150 min" label="of exercise" unit="min" color={c.series[2]}
          ariaLabel="Apple exercise minutes per week; the newest week counts up to the day you're viewing" />
      </div>
      <div>
        <p className="section-label mb-1">Strength days per week (Hevy)</p>
        <WeeklyBars data={weeks.strength} refY={2} refLabel="2 days" label="strength days" unit="" color={c.series[1]}
          ariaLabel="Days with a Hevy workout per week; the newest week counts up to the day you're viewing" />
      </div>
      <TrendStatsBlock stats={stats} format={v => num(v)} formatDelta={v => signed(v)} direction="up" />
      <p className="text-meta text-fg-muted">
        Apple’s Exercise minutes count every minute at brisk-walk intensity or above, including recorded strength workouts. Apple
        doesn’t split moderate from vigorous, so each minute counts once here — WHO counts a vigorous minute twice, so this can
        understate how close you are. The newest week counts up to the day you’re viewing.
      </p>
      <div className="border-t border-line pt-4">
        <MetricExplainer metric="weekly_exercise_minutes" ctx={ctx} value={isDay ? null : exercise.minutes} cls={exercise.cls} aim={hero.aims.exercise} />
      </div>
      {exercise.strengthCls && (
        <div className="border-t border-line pt-4">
          <MetricExplainer metric="strength_days" ctx={ctx} value={exercise.strengthDays} cls={exercise.strengthCls} extraSources={[SRC.momma2022]} />
        </div>
      )}
    </div>
  )
}
