import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PageContainer, PageHeader, useBoardStep, type BoardLayouts } from '../../../shared/ui'
import { keysAt } from '../../../shared/ui/pageBoardRules'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { useHealthProfile } from '../../training/hooks/useAthleteProfile'
import { GoalReportCard } from '../goal/GoalReportCard'
import { HealthRangeBar } from '../components/HealthRangeBar'
import { useRangeWindow } from '../components/dateNav'
import { ActivityRings } from '../components/ActivityRings'
import { SleepSection } from '../components/SleepSection'
import { StepsSection } from '../components/StepsSection'
import { EnergySection } from '../components/EnergySection'
import { HeartSection } from '../components/HeartSection'
import { VitalsReadingCard } from '../components/VitalsReadingCard'
import { BodyScaleCard, BodyWeightTrendCard } from '../components/BodySection'
import { HevyMeasurementsCard } from '../components/body/HevyMeasurementsCard'
import { CardioFitnessSection } from '../components/CardioFitnessSection'
import { HealthWorkoutsList } from '../components/HealthWorkoutsList'
import { MetricMiniGrid } from '../components/MetricMiniGrid'
import { ACTIVITY_EXTRA_METRICS, CARDIO_EXTRA_METRICS, HABIT_METRICS, MOBILITY_METRICS, SLEEP_EXTRA_METRICS } from '../components/miniMetrics'
import { HEALTH_SECTIONS, type HealthRange } from '../components/sectionTypes'
import {
  ACTIVITY_BOARD, BODY_BOARD, CARDIO_BOARD, HEART_BOARD, OVERVIEW_BOARD, SLEEP_BOARD,
} from '../healthBoards'
import { HealthProfileCard } from '../components/profile/HealthProfileCard'
import { useHealthPageRange } from '../components/overview/useHealthPageRange'
import { useHealthSection } from '../components/overview/useHealthSection'
import { useHealthHero } from '../components/overview/useHealthHero'
import { HealthHero } from '../components/overview/HealthHero'
import { HealthInsightsCard } from '../components/overview/HealthInsightsCard'
import { ProfileChip } from '../components/overview/ProfileChip'
import { HealthSectionTabs, SectionPanel } from '../components/overview/SectionPanel'
import { SleepTimingCard } from '../components/overview/SleepTimingCard'
import { ExerciseWeekCard } from '../components/overview/ExerciseWeekCard'
import { TrendCard } from '../components/overview/TrendCard'
import { buildTrendStats } from '../healthTrendStats'
import { hm, num, signed, signedHm } from '../components/overview/heroFormat'

// Health's own page, in windows (tabs) laid out by the metric ranking
// (docs/training-health/research/research-rank.json): Overview holds the six
// tier-1 tiles and the insights; every group then has its own window, and
// tier-3 metrics appear as compact cards only when they have data (tier 4
// left out). No composite health score (house rule). ONE day + period bar
// directly under the tabs, kept in the URL (?date=&period=), drives every
// window except Goal progress (its own window); the open window is ?section=. Only the open window mounts, so a window's
// queries run when you open it. (The alerts strip from the plan needs Health
// Auto Export's notification arrays ingested first — not built.)

function Guard({ name, children }: { name: string; children: ReactNode }) {
  return <ErrorBoundary label={name} action={`health_${name.toLowerCase().replace(/\W+/g, '_')}`}>{children}</ErrorBoundary>
}

export function HealthPage() {
  const range = useHealthPageRange()
  const { anchor, setAnchor, period, setPeriod, today } = range
  const [section, setSection] = useHealthSection()
  const win = useRangeWindow(range)
  const hero = useHealthHero(win)
  const { data: profile } = useHealthProfile()
  const profileIncomplete = profile != null && (profile.birthYear == null || profile.sex == null || profile.heightCm == null)
  const viewDay = (date: string) => { setPeriod('day'); setAnchor(date) }
  const miniWindow = { from: win.from, to: win.to, period }
  const exclude = hero.isToday ? anchor : null
  const label = HEALTH_SECTIONS.find(s => s.id === section)?.label ?? 'Health'

  return (
    <PageContainer>
      {/* The section tabs, then the ONE period + date bar directly under them
          (hidden on Goal progress, which reads its own 14/28/56-day window and
          shows those dates itself). Each window below is a PageBoard
          (healthBoards.ts), so a wide screen adds columns instead of length. */}
      <PageHeader title="Health" actions={<ProfileChip today={today} />} className="!mb-3">
        <HealthSectionTabs value={section} onChange={setSection} />
      </PageHeader>

      <div className="flex flex-col gap-4">
        {section !== 'goal' && (
          <HealthRangeBar period={period} setPeriod={setPeriod} anchor={anchor} setAnchor={setAnchor} today={today} />
        )}

        {/* Keyed by window so switching away resets one that crashed. */}
        <Guard key={section} name={label}>
          {section === 'overview' && (
            <SectionPanel id="overview" layout={OVERVIEW_BOARD} stackGap="gap-4" sections={{
              hero: <Guard name="Hero"><HealthHero hero={hero} onViewDay={viewDay} onOpenSection={setSection} /></Guard>,
              profile: profileIncomplete && <HealthProfileCard />,
              insights: <Guard name="Insights"><HealthInsightsCard hero={hero} /></Guard>,
            }} />
          )}

          {section === 'sleep' && (
            <SectionPanel id="sleep" note="Nights are filed under the morning you woke up." layout={SLEEP_BOARD} sections={{
              sleep: <Guard name="Sleep"><SleepCard range={range} /></Guard>,
              timing: <Guard name="Sleep timing"><SleepTimingCard sleep={hero.sleep} /></Guard>,
              trend: <TrendCard title="Sleep trend" stats={buildTrendStats(hero.sleep.nights, { to: anchor, direction: 'up' })}
                format={hm} formatDelta={signedHm} per="per night" direction="up" />,
              breathing: <MetricMiniGrid title="Breathing during sleep" metrics={SLEEP_EXTRA_METRICS} window={miniWindow} onViewDay={viewDay} hideWhenEmpty standalone="h3" />,
            }} />
          )}

          {section === 'activity' && (
            <SectionPanel id="activity" layout={ACTIVITY_BOARD} sections={{
              rings: <Guard name="Activity rings"><ActivityRings win={win} date={anchor} /></Guard>,
              steps: <Guard name="Steps"><StepsSection range={range} /></Guard>,
              stepsTrend: <TrendCard title="Steps trend" stats={buildTrendStats(hero.steps.series, { to: anchor, exclude, direction: 'up' })}
                format={v => num(v)} formatDelta={v => signed(v)} direction="up" rateUnit="steps/day per week" />,
              exercise: <Guard name="Weekly exercise"><ExerciseWeekCard exercise={hero.exercise} anchor={anchor} /></Guard>,
              energy: <Guard name="Energy"><EnergySection range={range} /></Guard>,
              note: (
                <p className="text-meta text-fg-muted">
                  What you eat lives in <Link to="/recipes" className="font-medium text-accent-600 underline underline-offset-2">Food</Link>;{' '}
                  <button type="button" className="font-medium text-accent-600 underline underline-offset-2" onClick={() => setSection('goal')}>Goal progress</button> compares it with this burn.
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
              rhrTrend: <TrendCard title="Resting heart rate trend" stats={buildTrendStats(hero.rhr.series, { to: anchor, direction: 'down' })}
                format={v => num(v)} formatDelta={v => `${signed(v)} bpm`} direction="down" rateUnit="bpm/week" />,
              hrvTrend: <TrendCard title="HRV trend" stats={buildTrendStats(hero.vitals.hrvSeries, { to: anchor, direction: 'up' })}
                format={v => num(v)} formatDelta={v => `${signed(v)} ms`} direction="up" />,
            }} />
          )}

          {section === 'body' && (
            // Scale readings only in the charts and the trend; the Hevy log keeps its own card.
            <SectionPanel id="body" layout={BODY_BOARD} sections={{
              scale: <Guard name="Body"><BodyScaleCard range={range} /></Guard>,
              trend: <Guard name="Weight trend"><BodyWeightTrendCard range={range} /></Guard>,
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
        </Guard>
      </div>
    </PageContainer>
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
