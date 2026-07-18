import { isToday } from 'date-fns'
import { NutritionCard } from './summary/NutritionCard'
import { TrainingCard } from './summary/TrainingCard'
import { WatchNextCard } from './summary/WatchNextCard'
import { GamesCard } from './summary/GamesCard'
import { ShopCard } from './summary/ShopCard'
import { HealthCard } from './summary/HealthCard'
import { formatLocalDate } from '../../../shared/utils/dateUtils'

// ─────────────────────────────────────────────────────────────────────────────
//  "At a glance" — Daily's operational dashboard: ONE room to run the whole
//  day. Every plannable area of the app has a card here with its own inline
//  actions (nothing is a bare link-out): meals quick-add, training routine
//  planning, next episode plan/watch, play-queue session planning, planned
//  purchases, a swipeable health strip. Cards live in ./summary/ (one file
//  each, per the ~150-line component rule). Work + Projects cards were removed
//  per request (they have their own full pages); Sleep became the scrollable
//  HealthCard (browse sleep/steps/energy/heart/weight, not just sleep).
//
//  Width standard: content-width columns via auto-fill (≤ 22rem each) instead
//  of viewport-fraction columns — cards never stretch on a monitor, leftover
//  space stays right.
// ─────────────────────────────────────────────────────────────────────────────

export function TodaySummary({ date }: { date: Date }) {
  const dateStr = formatLocalDate(date)

  return (
    <div className="mb-5">
      <p className="text-[11px] uppercase tracking-wider font-semibold text-ink-400 mb-2">
        {isToday(date) ? 'Today at a glance' : 'At a glance'}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(17rem,22rem))] justify-start gap-4 stagger-in">
        <NutritionCard date={dateStr} />
        <TrainingCard date={dateStr} />
        <WatchNextCard date={dateStr} />
        <GamesCard date={dateStr} />
        <ShopCard date={dateStr} />
        <HealthCard date={dateStr} />
      </div>
    </div>
  )
}
