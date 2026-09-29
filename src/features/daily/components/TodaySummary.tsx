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
//  step of the board's OWN width (1 / 2 / 3 / 4 at 36 / 56 / 90rem — it sits
//  full width below the schedule, or beside it on a wide PageBoard), NEVER
//  auto-fill: the width never depends on content, so a module always lives in
//  the same slot, and an empty module collapses to a compact row IN PLACE
//  instead of reshuffling its neighbours (E2E-verified requirement). Nutrition
//  takes a double slot from two columns up. Cards live in ./summary/ (cellKit
//  anatomy).
// ─────────────────────────────────────────────────────────────────────────────

export function TodaySummary({ date }: { date: Date }) {
  const dateStr = formatLocalDate(date)

  return (
    <div className="@container min-w-0">
      <SectionLabel className="mb-2">{isToday(date) ? 'Today at a glance' : 'At a glance'}</SectionLabel>
      <div className="grid grid-cols-1 gap-3 stagger-in sm:gap-4 @[36rem]:grid-cols-2 @[56rem]:grid-cols-3 @[90rem]:grid-cols-4">
        <div className="min-w-0 @[36rem]:col-span-2"><NutritionCard date={dateStr} /></div>
        <div className="min-w-0"><TrainingCard date={dateStr} /></div>
        <div className="min-w-0"><WatchNextCard date={dateStr} /></div>
        <div className="min-w-0"><HealthCard date={dateStr} /></div>
        <div className="min-w-0"><GamesCard date={dateStr} /></div>
        <div className="min-w-0"><ShopCard date={dateStr} /></div>
      </div>
    </div>
  )
}
