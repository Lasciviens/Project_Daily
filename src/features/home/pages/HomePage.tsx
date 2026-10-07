import type { ReactNode } from 'react'
import { PageBoard, PageContainer, useBoardStep } from '../../../shared/ui'
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
import { HOME_BOARD, newsIsBand, newsRows, type HomeSection } from './homeBoard'

/** Glance tiles with swipeable screens that open their detail: 2 across in a side column or on a phone, 3 on a wider stack. */
function GlanceTiles() {
  return (
    <section aria-label="At a glance" className="@container">
      <div className="grid grid-cols-2 gap-3 @[36rem]:grid-cols-3">
        <WeatherTile />
        <CurrencyTile />
        <TrainingTile />
        <RecentMediaTile />
        <BooksTile />
        <GamesTile />
      </div>
    </section>
  )
}

/**
 * The week and today's tasks side by side under the brief (laptop and up),
 * equal height, stacking again when the main track is narrow.
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

  const sections: Record<HomeSection, ReactNode> = {
    brief: <DailyBrief />,
    hero: <HomeHero />,
    tasks: <TodayTasksCard />,
    pair: <HeroAndTasks />,
    transit: <TransitCard />,
    tiles: <GlanceTiles />,
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
      <PageBoard sections={sections} layout={HOME_BOARD} stackClassName="max-w-[48rem] stagger-in" />
    </PageContainer>
  )
}
