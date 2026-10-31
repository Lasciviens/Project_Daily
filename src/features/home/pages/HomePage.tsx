import { useState, type ReactNode } from 'react'
import { PageBoard, PageContainer, cx, useBoardStep } from '../../../shared/ui'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useGeolocation } from '../hooks/useGeolocation'
import { DailyBrief } from '../components/DailyBrief'
import { HomeDayCard } from '../components/HomeDayCard'
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
 * The day card under the brief (laptop and up). `h-full`: on the split board
 * it stretches to its row (the weather tile beside it), content top-aligned.
 */
function DayCardCell({ day, onDay }: { day: string; onDay: (day: string) => void }) {
  return (
    <div className="h-full">
      <HomeDayCard day={day} onDay={onDay} />
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
  // Read up front so every location-aware card shares the one answer; it never
  // prompts on load (the phone is asked only when it already allows it, or
  // after "Use my location").
  useGeolocation()
  // The same content width PageBoard measures: it picks the split laptop
  // layout once the main track is 44rem wide (homeBoardFor).
  const { ref, width } = useElementWidthRem()
  // The day the week strip picked; none picked is today — worked out on every render, so an app left open past
  // midnight shows (and quick-adds to) the new day, never yesterday.
  const [picked, setPicked] = useState<string | null>(null)
  const today = todayStr()
  const day = picked ?? today
  const setDay = (d: string) => setPicked(d === today ? null : d)

  const sections: Record<HomeSection, ReactNode> = {
    brief: <DailyBrief />,
    tasks: <HomeDayCard day={day} onDay={setDay} />,
    pair: <DayCardCell day={day} onDay={setDay} />,
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
