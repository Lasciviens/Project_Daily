import { isToday } from 'date-fns'
import { NutritionCard } from './summary/NutritionCard'
import { TrainingCard } from './summary/TrainingCard'
import { WatchNextCard } from './summary/WatchNextCard'
import { GamesCard } from './summary/GamesCard'
import { ShopCard } from './summary/ShopCard'
import { HealthCard } from './summary/HealthCard'
import { SectionLabel } from '../../../shared/ui'
import { formatLocalDate } from '../../../shared/utils/dateUtils'

// ─────────────────────────────────────────────────────────────────────────────
//  "At a glance" — six modules in FIXED slots. Explicit column counts per
//  step of the board's OWN width (1 / 2 / 3 / 4 at 36 / 55 / 90rem — it sits
//  full width below the schedule, or beside it on a wide PageBoard), NEVER
//  auto-fill: the width never depends on content, so a module always lives in
//  the same slot, and an empty module collapses to a compact row IN PLACE
//  instead of reshuffling its neighbours (E2E-verified requirement).
//
//  Nutrition is the tall module (its meal list), so from three columns it
//  takes a double slot two rows tall (three rows at four columns) and the
//  small modules stack beside it instead of stretching to its height:
//    3 columns  N N T / N N W / H G S
//    4 columns  N N T W / N N H G / N N S ·
//  Placement comes from these classes alone, never from content. Cards live
//  in ./summary/ (cellKit anatomy).
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
      <div className="grid grid-cols-1 gap-3 stagger-in sm:gap-4 @[36rem]:grid-cols-2 @[55rem]:grid-cols-3 @[90rem]:grid-cols-4">
        <div className="min-w-0 @[36rem]:col-span-2 @[55rem]:row-span-2 @[90rem]:row-span-3"><NutritionCard date={dateStr} /></div>
        <div className="min-w-0"><TrainingCard date={dateStr} /></div>
        <div className="min-w-0"><WatchNextCard date={dateStr} /></div>
        <div className="min-w-0"><HealthCard date={dateStr} /></div>
        <div className="min-w-0"><GamesCard date={dateStr} /></div>
        <div className="min-w-0"><ShopCard date={dateStr} /></div>
      </div>
    </section>
  )
}
