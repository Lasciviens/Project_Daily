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
import { GLANCE_GROUP_GRID, GLANCE_ROW_TEMPLATE, homeBoardFor, newsIsBand, newsRows, type HomeSection } from './homeBoard'

/**
 * The six glance tiles, with swipeable screens that open their detail: on a
 * phone and in the 1280 side column (GLANCE_GROUP_GRID.all).
 */
function GlanceTiles() {
  return (
    <section aria-label="At a glance" className="@container">
      <div className={cx('grid', GLANCE_GROUP_GRID.all)}>
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
 * The split laptop board's glance row, on the board's own tracks
 * (GLANCE_ROW_TEMPLATE): money · watched · books · games under the week and
 * the tasks (GLANCE_GROUP_GRID.row), a large training tile under transit and
 * the weather. One grid row, so every tile has the same top and height.
 */
function GlanceRow() {
  return (
    <section aria-label="At a glance" className="grid gap-4" style={{ gridTemplateColumns: GLANCE_ROW_TEMPLATE }}>
      <div className="@container">
        <div className={cx('grid h-full', GLANCE_GROUP_GRID.row)}>
          <CurrencyTile />
          <RecentMediaTile />
          <BooksTile />
          <GamesTile />
        </div>
      </div>
      <TrainingTile large />
    </section>
  )
}

/**
 * The week and today's tasks side by side under the brief (laptop and up),
 * equal height, stacking again when the main track is narrow. The 44rem here
 * is homeBoard.ts' PAIR_SIDE_BY_SIDE_REM (the split layout starts there too).
 * `h-full`: on the split board the pair stretches to its row (the weather
 * tile beside it), and so do the week and the tasks.
 */
function HeroAndTasks() {
  return (
    <div className="@container">
      <div className="grid h-full grid-cols-1 items-stretch gap-4 @[44rem]:grid-cols-2 [&>*]:h-full">
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
    tiles: <GlanceTiles />,
    weatherTile: <WeatherTile large />,
    glanceRow: <GlanceRow />,
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
