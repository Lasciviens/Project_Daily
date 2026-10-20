import { isToday } from 'date-fns'
import { TrainingCard } from './summary/TrainingCard'
import { WatchNextCard } from './summary/WatchNextCard'
import { GamesCard } from './summary/GamesCard'
import { ShopCard } from './summary/ShopCard'
import { HealthCard } from './summary/HealthCard'
import { ReadingCard } from './summary/ReadingCard'
import { SectionLabel } from '../../../shared/ui'
import { formatLocalDate } from '../../../shared/utils/dateUtils'

// ─────────────────────────────────────────────────────────────────────────────
//  "At a glance" — six modules in FIXED slots. Explicit column counts per
//  step of the board's OWN width (1 / 2 / 3 at 36 / 55rem — it sits full
//  width below the schedule, or beside it on a wide PageBoard), NEVER
//  auto-fill: the width never depends on content, so a module always lives in
//  the same slot, and an empty module collapses to a compact row IN PLACE
//  instead of reshuffling its neighbours (E2E-verified requirement). Every
//  grid is full (B = Books' reading cell — docs/kobo/REFERENCE.md §4.4):
//    2 columns  T W / H G / S B
//    3 columns  T W H / G S B
//  No fourth column: six cards would leave two holes. Nutrition left the
//  Personal page (owner, 16.10.2026: "Remove nutrition from personal page") —
//  food and water live on the Food page. Cards live in ./summary/ (cellKit).
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
      <div className="grid grid-cols-1 gap-3 stagger-in sm:gap-4 @[36rem]:grid-cols-2 @[55rem]:grid-cols-3">
        <div className="min-w-0"><TrainingCard date={dateStr} /></div>
        <div className="min-w-0"><WatchNextCard date={dateStr} /></div>
        <div className="min-w-0"><HealthCard date={dateStr} /></div>
        <div className="min-w-0"><GamesCard date={dateStr} /></div>
        <div className="min-w-0"><ShopCard date={dateStr} /></div>
        <div className="min-w-0"><ReadingCard date={dateStr} /></div>
      </div>
    </section>
  )
}
