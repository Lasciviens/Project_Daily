import { PageContainer } from '../../../shared/ui'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'
import { useGeolocation } from '../hooks/useGeolocation'
import { DailyBrief } from '../components/DailyBrief'
import { HomeHero } from '../components/HomeHero'
import { TodayTasksCard } from '../components/TodayTasksCard'
import { TransitCard } from '../components/TransitCard'
import { WeatherWidget, WeatherTile } from '../components/WeatherWidget'
import { CurrencyWidget, CurrencyTile } from '../components/CurrencyWidget'
import { NewsWidget } from '../components/NewsWidget'
import { TrainingHomeWidget, TrainingTile } from '../components/TrainingHomeWidget'
import { GamesHomeWidget, GamesTile } from '../components/GamesHomeWidget'
import { ProjectsHomeWidget, ProjectsTile } from '../components/ProjectsHomeWidget'
import { RecentMediaWidget, RecentMediaTile } from '../components/RecentMediaWidget'

/**
 * Home. Phones get one actionable column (brief → now/next → tasks → transit)
 * followed by 2-column glance tiles that open their detail, then news.
 * Wider screens get a content-sized, left-aligned grid: a 44rem main column
 * plus a 24rem rail (two rails from 1800px, when both fit), never stretched to the viewport.
 * The structures differ (tiles vs full widgets), so each widget renders once
 * — never a hidden duplicate that keeps fetching.
 */
export function HomePage() {
  // Asked for up front so the location prompt fires on load and every
  // location-aware card shares the one cached answer.
  useGeolocation()
  const isPhone = useBreakpoint() === 'phone'

  if (isPhone) {
    return (
      <PageContainer width="narrow" className="space-y-3 stagger-in">
        <DailyBrief />
        <HomeHero />
        <TodayTasksCard />
        <TransitCard />
        <section aria-label="At a glance" className="grid grid-cols-2 gap-3">
          <WeatherTile />
          <CurrencyTile />
          <TrainingTile />
          <RecentMediaTile />
          <ProjectsTile />
          <GamesTile />
        </section>
        <NewsWidget />
      </PageContainer>
    )
  }

  return (
    <PageContainer width="full">
      <div className="grid max-w-[44rem] grid-cols-1 items-start gap-4 lg:max-w-none lg:grid-cols-[minmax(0,44rem)_minmax(0,24rem)] min-[1800px]:grid-cols-[minmax(0,44rem)_minmax(0,49rem)] min-[1800px]:gap-5">
        <div className="flex min-w-0 flex-col gap-4 min-[1800px]:gap-5">
          <DailyBrief />
          <HomeHero />
          <TodayTasksCard />
        </div>
        {/* One rail at lg; from 1800px the same rail splits into two 24rem columns. */}
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 min-[1800px]:grid-cols-2 min-[1800px]:gap-5">
          <div className="flex min-w-0 flex-col gap-4 min-[1800px]:gap-5">
            <WeatherWidget />
            <TransitCard />
            <CurrencyWidget />
          </div>
          <div className="flex min-w-0 flex-col gap-4 min-[1800px]:gap-5">
            <TrainingHomeWidget />
            <RecentMediaWidget />
            <ProjectsHomeWidget />
            <GamesHomeWidget />
            <NewsWidget />
          </div>
        </div>
      </div>
    </PageContainer>
  )
}
