import { isToday } from 'date-fns'
import { TrainingBand } from './summary/TrainingBand'
import { FoodBand } from './summary/FoodBand'
import { WatchingCard } from './summary/WatchingCard'
import { FootballCard } from './summary/FootballCard'
import { HealthCard } from './summary/HealthCard'
import { ReadingCard } from './summary/ReadingCard'
import { GamesCard } from './summary/GamesCard'
import { ShopCard } from './summary/ShopCard'
import { SectionLabel } from '../../../shared/ui'
import { formatLocalDate } from '../../../shared/utils/dateUtils'

// ─────────────────────────────────────────────────────────────────────────────
//  The day at a glance (owner, 26.10.2026: "a daily summary for anything I
//  plan or do … only basic things … easy, understandable and clear design"),
//  for the day the page shows:
//    · (the day line — the day's facts in one line — sits under the date in
//      the page header, DailyPage, so it shows at every width);
//    · Training and Food, two bands the board's full width (boxes inside);
//    · six cards in FIXED slots, explicit column counts per step of the
//      board's OWN width (1 / 2 / 3 at 36 / 55rem — it sits full width below
//      the schedule, or beside it on a wide PageBoard), NEVER auto-fill: a
//      card always lives in the same slot whatever its content, and every
//      grid is full:
//        2 columns  W F / H R / G S
//        3 columns  W F H / R G S
//      No fourth column: six cards would leave two holes.
//  Every card is made of the same box (summary/cellKit — the Health card's,
//  which the owner approved). Food returned as a summary with a details
//  popup (owner, 26.10.2026), not the old Nutrition card (16.10.2026).
// ─────────────────────────────────────────────────────────────────────────────

export function TodaySummary({ date, hideLabel = false }: {
  date: Date
  /** Beside the schedule (a wide PageBoard) the heading is visually hidden so the cards line up with the hero's top. */
  hideLabel?: boolean
}) {
  const dateStr = formatLocalDate(date)

  return (
    <section className="@container min-w-0">
      <SectionLabel className={hideLabel ? 'sr-only' : 'mb-2'}>{isToday(date) ? 'Today at a glance' : 'At a glance'}</SectionLabel>
      <div className="flex flex-col gap-3 stagger-in sm:gap-4">
        <TrainingBand date={dateStr} />
        <FoodBand date={dateStr} />
        <div className="grid grid-cols-1 gap-3 sm:gap-4 @[36rem]:grid-cols-2 @[55rem]:grid-cols-3">
          <div className="min-w-0"><WatchingCard date={dateStr} /></div>
          <div className="min-w-0"><FootballCard date={dateStr} /></div>
          <div className="min-w-0"><HealthCard date={dateStr} /></div>
          <div className="min-w-0"><ReadingCard date={dateStr} /></div>
          <div className="min-w-0"><GamesCard date={dateStr} /></div>
          <div className="min-w-0"><ShopCard date={dateStr} /></div>
        </div>
      </div>
    </section>
  )
}
