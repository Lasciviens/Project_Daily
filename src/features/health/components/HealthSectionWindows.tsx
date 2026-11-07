import { Link } from 'react-router-dom'
import { useBoardStep, type BoardLayouts } from '../../../shared/ui'
import { keysAt } from '../../../shared/ui/pageBoardRules'
import { GoalReportCard } from '../goal/GoalReportCard'
import { ActivityRings } from './ActivityRings'
import { SleepSection } from './SleepSection'
import { StepsSection } from './StepsSection'
import { EnergySection } from './EnergySection'
import { HeartSection } from './HeartSection'
import { VitalsReadingCard } from './VitalsReadingCard'
import { BodyScaleCard } from './BodySection'
import { WeeklyChangesCard } from './body/WeeklyChangesCard'
import { HevyMeasurementsCard } from './body/HevyMeasurementsCard'
import { CardioFitnessSection } from './CardioFitnessSection'
import { HealthWorkoutsList } from './HealthWorkoutsList'
import { MetricMiniGrid } from './MetricMiniGrid'
import { ACTIVITY_EXTRA_METRICS, CARDIO_EXTRA_METRICS, HABIT_METRICS, MOBILITY_METRICS, SLEEP_EXTRA_METRICS } from './miniMetrics'
import type { HealthRange, HealthSectionId } from './sectionTypes'
import { ACTIVITY_BOARD, BODY_BOARD, CARDIO_BOARD, HEART_BOARD, SLEEP_BOARD } from '../healthBoards'
import { SectionPanel } from './overview/SectionPanel'
import { SleepTimingCard } from './overview/SleepTimingCard'
import { ExerciseWeekCard } from './overview/ExerciseWeekCard'
import { TrendCard } from './overview/TrendCard'
import type { HealthHero } from './overview/useHealthHero'
import { buildTrendStats } from '../healthTrendStats'
import type { HealthWindow } from '../healthWindowStats'
import { hm, num, signed, signedHm } from './overview/heroFormat'
import { HealthGuard as Guard } from './HealthGuard'

// Health's windows after Overview, in a module of their own: HealthPage loads it
// when one opens (and in idle time once the page shows), so the first download
// of the page carries Overview without these windows' charts.

/** One of the windows after Overview, over the page's one period (HealthPage). */
export function HealthSectionWindow({ section, range, win, hero, onViewDay, onOpenSection }: {
  section: Exclude<HealthSectionId, 'overview'>
  range: HealthRange
  win: HealthWindow
  hero: HealthHero
  onViewDay: (date: string) => void
  onOpenSection: (id: HealthSectionId) => void
}) {
  const { anchor, period } = range
  const miniWindow = { from: win.from, to: win.to, period }
  const exclude = hero.isToday ? anchor : null
  // Every trend card reads the period picked in the range bar.
  const picked = { from: win.from, to: anchor }
  const viewDay = onViewDay

  return (
    <>
      {section === 'sleep' && (
        <SectionPanel id="sleep" note="Nights are filed under the morning you woke up." layout={SLEEP_BOARD} sections={{
          sleep: <Guard name="Sleep"><SleepCard range={range} /></Guard>,
          timing: <Guard name="Sleep timing"><SleepTimingCard sleep={hero.sleep} from={win.from} to={anchor} /></Guard>,
          trend: <TrendCard title="Sleep trend" stats={buildTrendStats(hero.sleep.nights, { ...picked, direction: 'up' })}
            format={hm} formatDelta={signedHm} per="per night" direction="up" />,
          breathing: <MetricMiniGrid title="Breathing during sleep" metrics={SLEEP_EXTRA_METRICS} window={miniWindow} onViewDay={viewDay} hideWhenEmpty standalone="h3" />,
        }} />
      )}

      {section === 'activity' && (
        <SectionPanel id="activity" layout={ACTIVITY_BOARD} sections={{
          rings: <Guard name="Activity rings"><ActivityRings win={win} /></Guard>,
          steps: <Guard name="Steps"><StepsSection range={range} /></Guard>,
          stepsTrend: <TrendCard title="Steps trend" stats={buildTrendStats(hero.steps.series, { ...picked, exclude, direction: 'up' })}
            format={v => num(v)} formatDelta={v => signed(v)} direction="up" rateUnit="steps/day per week" />,
          exercise: <Guard name="Weekly exercise"><ExerciseWeekCard hero={hero} /></Guard>,
          energy: <Guard name="Energy"><EnergySection range={range} /></Guard>,
          note: (
            <p className="text-meta text-fg-muted">
              What you eat lives in <Link to="/recipes" className="font-medium text-accent-600 underline underline-offset-2">Food</Link>;{' '}
              <button type="button" className="font-medium text-accent-600 underline underline-offset-2" onClick={() => onOpenSection('goal')}>Goal progress</button> compares it with this burn.
            </p>
          ),
          // Non-strength Apple workouts; strength sessions live under Training.
          workouts: <Guard name="Other workouts"><HealthWorkoutsList win={win} /></Guard>,
          more: <MetricMiniGrid title="More activity" metrics={ACTIVITY_EXTRA_METRICS} window={miniWindow} onViewDay={viewDay} hideWhenEmpty standalone="h3" />,
          mobility: <MetricMiniGrid title="Mobility" metrics={MOBILITY_METRICS} window={miniWindow} onViewDay={viewDay} hideWhenEmpty standalone="h3" />,
          // Moved from Body, which shows the smart scale only (owner).
          habits: <MetricMiniGrid title="Daily habits & environment" metrics={HABIT_METRICS} window={miniWindow} onViewDay={viewDay} hideWhenEmpty standalone="h3" />,
        }} />
      )}

      {section === 'heart' && (
        <SectionPanel id="heart" note="Each against your own usual range." layout={HEART_BOARD} sections={{
          vitals: <Guard name="Vitals reading"><VitalsReadingCard range={range} /></Guard>,
          heart: <Guard name="Heart"><HeartSection range={range} /></Guard>,
          rhrTrend: <TrendCard title="Resting heart rate trend" stats={buildTrendStats(hero.rhr.series, { ...picked, direction: 'down' })}
            format={v => num(v)} formatDelta={v => `${signed(v)} bpm`} direction="down" rateUnit="bpm/week" />,
          hrvTrend: <TrendCard title="HRV trend" stats={buildTrendStats(hero.vitals.hrvSeries, { ...picked, direction: 'up' })}
            format={v => num(v)} formatDelta={v => `${signed(v)} ms`} direction="up" />,
        }} />
      )}

      {section === 'body' && (
        // Scale readings only in the charts and the weekly changes; the Hevy log keeps its own card.
        <SectionPanel id="body" layout={BODY_BOARD} sections={{
          scale: <Guard name="Body"><BodyScaleCard range={range} /></Guard>,
          weekly: <Guard name="Weekly changes"><WeeklyChangesCard range={range} /></Guard>,
          hevy: <Guard name="Logged in Hevy"><HevyMeasurementsCard anchor={anchor} /></Guard>,
        }} />
      )}

      {section === 'goal' && (
        <section id="health-panel-goal" role="tabpanel" aria-labelledby="health-tab-goal" className="flex min-w-0 flex-col gap-3">
          <p className="text-meta text-fg-muted">Your weight, fat and muscle against the phase you picked — cut, maintain or gain — and your own goals.</p>
          {/* Lays its own cards out (healthBoards.ts → GOAL_BOARD). */}
          <Guard name="Goal progress"><GoalReportCard /></Guard>
        </section>
      )}

      {section === 'cardio' && (
        <SectionPanel id="cardio" layout={CARDIO_BOARD} sections={{
          vo2: <Guard name="Cardio fitness"><CardioCard range={range} /></Guard>,
          recovery: <MetricMiniGrid title="Recovery and effort" metrics={CARDIO_EXTRA_METRICS} window={miniWindow} onViewDay={viewDay} hideWhenEmpty standalone="h3" />,
        }} />
      )}
    </>
  )
}

/** True when the board gives `key` a card of its own at the current width. */
function usePlacedApart(layout: BoardLayouts<string>, key: string): boolean {
  return keysAt(layout, useBoardStep()).includes(key)
}

/** The sleep card; its breathing grid moves into its own card once there is a track for it. */
function SleepCard({ range }: { range: HealthRange }) {
  return <SleepSection range={range} extras={!usePlacedApart(SLEEP_BOARD, 'breathing')} />
}

/** VO₂ max; its recovery grid moves into its own card once there is a track for it. */
function CardioCard({ range }: { range: HealthRange }) {
  return <CardioFitnessSection range={range} extras={!usePlacedApart(CARDIO_BOARD, 'recovery')} />
}
