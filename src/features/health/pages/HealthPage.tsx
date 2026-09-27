import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PageContainer, PageHeader } from '../../../shared/ui'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { useHealthProfile } from '../../training/hooks/useAthleteProfile'
import { GoalReportCard } from '../goal/GoalReportCard'
import { DateNav } from '../components/DateNav'
import { PeriodToggle } from '../components/PeriodToggle'
import { labelForAnchor, stepAnchor, useRangeWindow } from '../components/dateNav'
import { ActivityRings } from '../components/ActivityRings'
import { SleepSection } from '../components/SleepSection'
import { StepsSection } from '../components/StepsSection'
import { EnergySection } from '../components/EnergySection'
import { HeartSection } from '../components/HeartSection'
import { VitalsReadingCard } from '../components/VitalsReadingCard'
import { BodySection } from '../components/BodySection'
import { CardioFitnessSection } from '../components/CardioFitnessSection'
import { HealthWorkoutsList } from '../components/HealthWorkoutsList'
import { MetricMiniGrid } from '../components/MetricMiniGrid'
import { ACTIVITY_EXTRA_METRICS, HABIT_METRICS, MOBILITY_METRICS } from '../components/miniMetrics'
import { HEALTH_SECTIONS } from '../components/sectionTypes'
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
// left out). No composite health score (house rule). ONE day + period control
// in the header, kept in the URL (?date=&period=), drives every window; the
// open window is ?section=. Only the open window mounts, so a window's
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
    <PageContainer width="full">
      <PageHeader title="Health" actions={<ProfileChip today={today} />} className="max-w-[76rem]">
        {/* Period first, then the dates: the toggle's segments are equal-width
            and the date label has a fixed width, so neither moves when the
            period or the date changes. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="scroll-x max-w-full">
            <PeriodToggle value={period} onChange={setPeriod} dayLabel={anchor === today ? 'Today' : 'Day'} />
          </div>
          <DateNav
            label={labelForAnchor(period, anchor, today)}
            onPrev={() => setAnchor(a => stepAnchor(period, a, -1))}
            onNext={() => setAnchor(a => stepAnchor(period, a, 1))}
            canGoNext={anchor < today}
            value={anchor}
            onPick={d => setAnchor(d > today ? today : d)}
          />
        </div>
      </PageHeader>

      <div className="flex flex-col gap-4">
        <div className="max-w-[76rem]"><HealthSectionTabs value={section} onChange={setSection} /></div>

        {/* Keyed by window so switching away resets one that crashed. */}
        <Guard key={section} name={label}>
          {section === 'overview' && (
            <section id="health-panel-overview" role="tabpanel" aria-labelledby="health-tab-overview" className="flex max-w-[76rem] flex-col gap-4">
              <Guard name="Hero"><HealthHero hero={hero} onViewDay={viewDay} onOpenSection={setSection} /></Guard>
              {profileIncomplete && <HealthProfileCard className="max-w-4xl" />}
              <Guard name="Insights"><HealthInsightsCard hero={hero} /></Guard>
            </section>
          )}

          {section === 'sleep' && (
            <SectionPanel id="sleep" note="Nights are filed under the morning you woke up.">
              <Guard name="Sleep"><SleepSection range={range} /></Guard>
              <Guard name="Sleep timing"><SleepTimingCard sleep={hero.sleep} /></Guard>
              <TrendCard title="Sleep trend" stats={buildTrendStats(hero.sleep.nights, { to: anchor, direction: 'up' })}
                format={hm} formatDelta={signedHm} per="per night" direction="up" />
            </SectionPanel>
          )}

          {section === 'activity' && (
            <SectionPanel id="activity">
              <Guard name="Activity rings"><ActivityRings win={win} date={anchor} /></Guard>
              <Guard name="Steps"><StepsSection range={range} /></Guard>
              <TrendCard title="Steps trend" stats={buildTrendStats(hero.steps.series, { to: anchor, exclude, direction: 'up' })}
                format={v => num(v)} formatDelta={v => signed(v)} direction="up" rateUnit="steps/day per week" />
              <Guard name="Weekly exercise"><ExerciseWeekCard exercise={hero.exercise} anchor={anchor} /></Guard>
              <Guard name="Energy"><EnergySection range={range} /></Guard>
              <p className="text-meta text-fg-muted">
                What you eat lives in <Link to="/recipes" className="font-medium text-accent-600 underline underline-offset-2">Food</Link>;{' '}
                <button type="button" className="font-medium text-accent-600 underline underline-offset-2" onClick={() => setSection('goal')}>Goal progress</button> compares it with this burn.
              </p>
              <MetricMiniGrid title="More activity" metrics={ACTIVITY_EXTRA_METRICS} window={miniWindow} onViewDay={viewDay} hideWhenEmpty standalone="h3" />
              <MetricMiniGrid title="Mobility" metrics={MOBILITY_METRICS} window={miniWindow} onViewDay={viewDay} hideWhenEmpty standalone="h3" />
              {/* Moved from Body, which shows the smart scale only (owner). */}
              <MetricMiniGrid title="Daily habits & environment" metrics={HABIT_METRICS} window={miniWindow} onViewDay={viewDay} hideWhenEmpty standalone="h3" />
            </SectionPanel>
          )}

          {section === 'heart' && (
            <SectionPanel id="heart" note="Each against your own usual range.">
              <Guard name="Vitals reading"><VitalsReadingCard range={range} /></Guard>
              <Guard name="Heart"><HeartSection range={range} /></Guard>
              <TrendCard title="Resting heart rate trend" stats={buildTrendStats(hero.rhr.series, { to: anchor, direction: 'down' })}
                format={v => num(v)} formatDelta={v => `${signed(v)} bpm`} direction="down" rateUnit="bpm/week" />
              <TrendCard title="HRV trend" stats={buildTrendStats(hero.vitals.hrvSeries, { to: anchor, direction: 'up' })}
                format={v => num(v)} formatDelta={v => `${signed(v)} ms`} direction="up" />
            </SectionPanel>
          )}

          {section === 'body' && (
            <SectionPanel id="body">
              {/* Its weight trend card sits inside: scale readings only, like the charts. */}
              <Guard name="Body"><BodySection range={range} /></Guard>
            </SectionPanel>
          )}

          {section === 'goal' && (
            <SectionPanel id="goal" note="Your weight, fat and muscle against the phase you picked — cut, maintain or gain — and your own goals.">
              <Guard name="Goal progress"><GoalReportCard /></Guard>
            </SectionPanel>
          )}

          {section === 'cardio' && (
            <SectionPanel id="cardio">
              <Guard name="Cardio fitness"><CardioFitnessSection range={range} /></Guard>
            </SectionPanel>
          )}

          {section === 'workouts' && (
            <SectionPanel id="workouts" note="Apple Watch workouts; tap one for its heart-rate curve, route and splits.">
              <Guard name="Workouts"><HealthWorkoutsList win={win} /></Guard>
            </SectionPanel>
          )}
        </Guard>
      </div>
    </PageContainer>
  )
}
