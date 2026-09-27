import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PageContainer, PageHeader } from '../../../shared/ui'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { useHealthProfile } from '../../training/hooks/useAthleteProfile'
import { CutReportCard } from '../cut/CutReportCard'
import { DateNav } from '../components/DateNav'
import { PeriodToggle } from '../components/PeriodToggle'
import { labelForAnchor, stepAnchor, useRangeWindow } from '../components/dateNav'
import { ActivityRings } from '../components/ActivityRings'
import { SleepSection } from '../components/SleepSection'
import { StepsSection } from '../components/StepsSection'
import { EnergySection } from '../components/EnergySection'
import { HeartSection } from '../components/HeartSection'
import { BodySection } from '../components/BodySection'
import { CardioFitnessSection } from '../components/CardioFitnessSection'
import { HealthWorkoutsList } from '../components/HealthWorkoutsList'
import { MetricMiniGrid } from '../components/MetricMiniGrid'
import { ACTIVITY_EXTRA_METRICS, HABIT_METRICS, MOBILITY_METRICS } from '../components/miniMetrics'
import { HealthProfileCard } from '../components/profile/HealthProfileCard'
import { useHealthPageRange } from '../components/overview/useHealthPageRange'
import { useHealthHero } from '../components/overview/useHealthHero'
import { HealthHero } from '../components/overview/HealthHero'
import { HealthInsightsCard } from '../components/overview/HealthInsightsCard'
import { ProfileChip } from '../components/overview/ProfileChip'
import { PageSection } from '../components/overview/PageSection'
import { SleepTimingCard } from '../components/overview/SleepTimingCard'
import { ExerciseWeekCard } from '../components/overview/ExerciseWeekCard'
import { TrendCard } from '../components/overview/TrendCard'
import { buildTrendStats } from '../healthTrendStats'
import { hm, num, signed, signedHm } from '../components/overview/heroFormat'

// Health's own page, laid out by the metric ranking
// (docs/training-health/research/research-rank.json): the six tier-1 tiles as
// the hero, then one section per group in the ranking's order, tier-3 metrics
// as compact cards only when they have data, tier 4 left out. No composite
// health score (house rule). ONE day + period control in the header, kept in
// the URL (?date=&period=), drives every section; the hero always reads "as
// of" the selected day. (The alerts strip from the plan needs Health Auto
// Export's notification arrays ingested first — not built.)

const JUMPS = [
  { id: 'sleep', label: 'Sleep' },
  { id: 'activity', label: 'Activity' },
  { id: 'heart', label: 'Heart & vitals' },
  { id: 'body', label: 'Body' },
  { id: 'cardio', label: 'Cardio fitness' },
  { id: 'workouts', label: 'Workouts' },
]

function Guard({ name, children }: { name: string; children: ReactNode }) {
  return <ErrorBoundary label={name} action={`health_${name.toLowerCase().replace(/\W+/g, '_')}`}>{children}</ErrorBoundary>
}

export function HealthPage() {
  const range = useHealthPageRange()
  const { anchor, setAnchor, period, setPeriod, today } = range
  const win = useRangeWindow(range)
  const hero = useHealthHero(win)
  const { data: profile } = useHealthProfile()
  const profileIncomplete = profile != null && (profile.birthYear == null || profile.sex == null || profile.heightCm == null)
  const viewDay = (date: string) => { setPeriod('day'); setAnchor(date) }
  const miniWindow = { from: win.from, to: win.to, period }
  const exclude = hero.isToday ? anchor : null

  return (
    <PageContainer width="full">
      <PageHeader title="Health" actions={<ProfileChip today={today} />} className="max-w-[76rem]">
        <div className="flex flex-wrap items-center gap-2">
          <DateNav
            label={labelForAnchor(period, anchor)}
            onPrev={() => setAnchor(a => stepAnchor(period, a, -1))}
            onNext={() => setAnchor(a => stepAnchor(period, a, 1))}
            canGoNext={anchor < today}
            value={anchor}
            onPick={d => setAnchor(d > today ? today : d)}
          />
          <div className="scroll-x max-w-full">
            <PeriodToggle value={period} onChange={setPeriod} dayLabel={anchor === today ? 'Today' : 'Day'} />
          </div>
        </div>
      </PageHeader>

      <div className="flex flex-col gap-8">
        <div className="flex max-w-[76rem] flex-col gap-4">
          <Guard name="Hero"><HealthHero hero={hero} onViewDay={viewDay} /></Guard>
          {profileIncomplete && <HealthProfileCard className="max-w-4xl" />}
          <Guard name="Insights"><HealthInsightsCard hero={hero} /></Guard>
          <nav aria-label="Health sections" className="scroll-x -mx-1 flex gap-1 px-1">
            {JUMPS.map(j => (
              <button key={j.id} type="button" className="pill-tab shrink-0 px-3"
                onClick={() => document.getElementById(j.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                {j.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="grid grid-cols-1 items-start gap-8 min-[1800px]:max-w-[118rem] min-[1800px]:grid-cols-2">
          <PageSection id="sleep" title="Sleep" subtitle="Nights are filed under the morning you woke up.">
            <Guard name="Sleep"><SleepSection range={range} /></Guard>
            <Guard name="Sleep timing"><SleepTimingCard sleep={hero.sleep} /></Guard>
            <TrendCard title="Sleep trend" stats={buildTrendStats(hero.sleep.nights, { to: anchor, direction: 'up' })}
              format={hm} formatDelta={signedHm} per="per night" direction="up" />
          </PageSection>

          <PageSection id="activity" title="Activity">
            <Guard name="Activity rings"><ActivityRings win={win} date={anchor} /></Guard>
            <Guard name="Steps"><StepsSection range={range} /></Guard>
            <TrendCard title="Steps trend" stats={buildTrendStats(hero.steps.series, { to: anchor, exclude, direction: 'up' })}
              format={v => num(v)} formatDelta={v => signed(v)} direction="up" rateUnit="steps/day per week" />
            <Guard name="Weekly exercise"><ExerciseWeekCard exercise={hero.exercise} anchor={anchor} /></Guard>
            <Guard name="Energy"><EnergySection range={range} /></Guard>
            <p className="text-meta text-fg-muted">
              What you eat lives in <Link to="/recipes" className="font-medium text-accent-600 underline underline-offset-2">Food</Link>; the cut report under Body compares it with this burn.
            </p>
            <MetricMiniGrid title="More activity" metrics={ACTIVITY_EXTRA_METRICS} window={miniWindow} onViewDay={viewDay} hideWhenEmpty standalone="h3" />
          </PageSection>

          <PageSection id="heart" title="Heart & overnight vitals" subtitle="Each against your own usual range.">
            <Guard name="Heart"><HeartSection range={range} /></Guard>
            <TrendCard title="Resting heart rate trend" stats={buildTrendStats(hero.rhr.series, { to: anchor, direction: 'down' })}
              format={v => num(v)} formatDelta={v => `${signed(v)} bpm`} direction="down" rateUnit="bpm/week" />
            <TrendCard title="HRV trend" stats={buildTrendStats(hero.vitals.hrvSeries, { to: anchor, direction: 'up' })}
              format={v => num(v)} formatDelta={v => `${signed(v)} ms`} direction="up" />
          </PageSection>

          <PageSection id="body" title="Body">
            <Guard name="Body"><BodySection range={range} /></Guard>
            <TrendCard title="Weight trend" stats={buildTrendStats(hero.weight.series, { to: anchor, direction: null, sparse: true })}
              format={v => `${num(v, 1)} kg`} formatDelta={v => `${signed(v, 1)} kg`} direction={null} rateUnit="kg/week" />
            <Guard name="Cut report"><CutReportCard /></Guard>
          </PageSection>

          <PageSection id="cardio" title="Cardio fitness">
            <Guard name="Cardio fitness"><CardioFitnessSection range={range} /></Guard>
          </PageSection>

          <div className="flex w-full max-w-4xl flex-col gap-8">
            <MetricMiniGrid id="mobility" title="Mobility" metrics={MOBILITY_METRICS} window={miniWindow} onViewDay={viewDay} hideWhenEmpty standalone="h2" />
            <MetricMiniGrid id="habits" title="Daily habits & environment" metrics={HABIT_METRICS} window={miniWindow} onViewDay={viewDay} hideWhenEmpty standalone="h2" />
          </div>

          <PageSection id="workouts" title="Workouts" subtitle="Apple Watch workouts; tap one for its heart-rate curve, route and splits.">
            <Guard name="Workouts"><HealthWorkoutsList win={win} /></Guard>
          </PageSection>
        </div>
      </div>
    </PageContainer>
  )
}
