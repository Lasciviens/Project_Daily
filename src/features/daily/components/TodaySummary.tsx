import { isToday } from 'date-fns'
import { NutritionCard } from './summary/NutritionCard'
import { TrainingCard } from './summary/TrainingCard'
import { WatchNextCard } from './summary/WatchNextCard'
import { formatLocalDate } from '../../../shared/utils/dateUtils'

// ─────────────────────────────────────────────────────────────────────────────
//  "At a glance" — Daily's operational dashboard strip. v2: no longer a
//  read-only overview that links out — every card carries its own actions
//  (quick-add meals, plan a routine inline, plan/mark-watched the next
//  episode) so the day is manageable without leaving Daily. Cards live in
//  ./summary/ (one file each, per the ~150-line component rule).
// ─────────────────────────────────────────────────────────────────────────────

export function TodaySummary({ date }: { date: Date }) {
  const dateStr = formatLocalDate(date)

  return (
    <div className="mb-5">
      <p className="text-[11px] uppercase tracking-wider font-semibold text-ink-400 mb-2">
        {isToday(date) ? 'Today at a glance' : 'At a glance'}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 max-w-5xl">
        <NutritionCard date={dateStr} />
        <TrainingCard date={dateStr} />
        <WatchNextCard date={dateStr} />
      </div>
    </div>
  )
}
