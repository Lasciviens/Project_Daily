import type { ReactNode } from 'react'
import { PageBoard, PageContainer, cx, useBoardStep } from '../../../shared/ui'
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
import { BooksHomeWidget, BooksTile } from '../components/BooksHomeWidget'
import { RecentMediaWidget, RecentMediaTile } from '../components/RecentMediaWidget'
import { useElementWidthRem } from '../../../shared/hooks/useElementWidth'
import { GLANCE_GROUP_GRID, homeBoardFor, newsIsBand, newsRows, type GlanceGroup, type HomeSection } from './homeBoard'

/**
 * Glance tiles with swipeable screens that open their detail. `all` = the six;
 * the split laptop layout shows `outside` (weather, money — under transit) and
 * `activity` (training, watched, books, games — under the week and the
 * tasks). Each group's grid is GLANCE_GROUP_GRID in homeBoard.ts.
 */
function GlanceTiles({ group }: { group: GlanceGroup }) {
  const outside = group !== 'activity'
  const activity = group !== 'outside'
  return (
    <section aria-label={group === 'outside' ? 'Weather and money' : group === 'activity' ? 'Training, watching, reading and games' : 'At a glance'} className="@container">
      <div className={cx('grid gap-3', GLANCE_GROUP_GRID[group])}>
        {outside && <WeatherTile />}
        {outside && <CurrencyTile />}
        {activity && <TrainingTile />}
        {activity && <RecentMediaTile />}
        {activity && <BooksTile />}
        {activity && <GamesTile />}
      </div>
    </section>
  )
}

/**
 * The week and today's tasks side by side under the brief (laptop and up),
 * equal height, stacking again when the main track is narrow. The 44rem here
 * is homeBoard.ts' PAIR_SIDE_BY_SIDE_REM (the split layout starts there too).
 */
function HeroAndTasks() {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 items-stretch gap-4 @[44rem]:grid-cols-2 [&>*]:h-full">
        <HomeHero />
        <TodayTasksCard />
      </div>
    </div>
  )
}

/** A list on a phone; from the laptop up a band of cards across the bottom of the page. */
function HomeNews() {
  const step = useBoardStep()
  return <NewsWidget visible={newsRows(step)} layout={newsIsBand(step) ? 'band' : 'list'} />
}

/**
 * Home, laid out by PageBoard (see homeBoard.ts for which card goes where at
 * each width). Only the sections a step places are mounted, so a widget and
 * its tile never both fetch.
 */
export function HomePage() {
  // Asked for up front so the location prompt fires on load and every
  // location-aware card shares the one cached answer.
  useGeolocation()
  // The same content width PageBoard measures: it picks the split laptop
  // layout once the week and the tasks sit side by side (homeBoardFor).
  const { ref, width } = useElementWidthRem()

  const sections: Record<HomeSection, ReactNode> = {
    brief: <DailyBrief />,
    hero: <HomeHero />,
    tasks: <TodayTasksCard />,
    pair: <HeroAndTasks />,
    transit: <TransitCard />,
    tiles: <GlanceTiles group="all" />,
    outsideTiles: <GlanceTiles group="outside" />,
    activityTiles: <GlanceTiles group="activity" />,
    news: <HomeNews />,
    weather: <WeatherWidget />,
    currency: <CurrencyWidget />,
    training: <TrainingHomeWidget />,
    media: <RecentMediaWidget />,
    books: <BooksHomeWidget />,
    games: <GamesHomeWidget />,
  }

  return (
    <PageContainer>
      <div ref={ref}>
        <PageBoard sections={sections} layout={homeBoardFor(width)} stackClassName="max-w-[48rem] stagger-in" />
      </div>
    </PageContainer>
  )
}
