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
import { homeBoardFor, newsIsBand, newsRows, type HomeSection } from './homeBoard'

/**
 * Glance tiles with swipeable screens that open their detail. `all` = the six,
 * 2 across in a side column or on a phone, 3 on a wider stack; the split
 * laptop layout shows `outside` (weather, money — 2 across under transit) and
 * `activity` (training, watched, books, games — one row of 4 under the week
 * and the tasks).
 */
function GlanceTiles({ group }: { group: 'all' | 'outside' | 'activity' }) {
  const outside = group !== 'activity'
  const activity = group !== 'outside'
  return (
    <section aria-label={group === 'outside' ? 'Weather and money' : group === 'activity' ? 'Training, watching, reading and games' : 'At a glance'} className="@container">
      <div className={cx('grid grid-cols-2 gap-3', group === 'all' && '@[36rem]:grid-cols-3', group === 'activity' && '@[40rem]:grid-cols-4')}>
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
