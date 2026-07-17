import { isToday } from 'date-fns'
import { NutritionCard } from './summary/NutritionCard'
import { TrainingCard } from './summary/TrainingCard'
import { WatchNextCard } from './summary/WatchNextCard'
import { WorkCard } from './summary/WorkCard'
import { ProjectsCard } from './summary/ProjectsCard'
import { GamesCard } from './summary/GamesCard'
import { ShopCard } from './summary/ShopCard'
import { SleepCard } from './summary/SleepCard'
import { formatLocalDate } from '../../../shared/utils/dateUtils'

// ─────────────────────────────────────────────────────────────────────────────
//  "At a glance" — Daily's operational dashboard: ONE room to run the whole
//  day. Every plannable area of the app has a card here with its own inline
//  actions (nothing is a bare link-out): meals quick-add, training routine
//  planning, next episode plan/watch, work tasks check/add, project items
//  plan/complete, play-queue session planning, planned purchases. Cards live
//  in ./summary/ (one file each, per the ~150-line component rule).
// ─────────────────────────────────────────────────────────────────────────────

export function TodaySummary({ date }: { date: Date }) {
  const dateStr = formatLocalDate(date)

  return (
    <div className="mb-5">
      <p className="text-[11px] uppercase tracking-wider font-semibold text-ink-400 mb-2">
        {isToday(date) ? 'Today at a glance' : 'At a glance'}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
        <NutritionCard date={dateStr} />
        <TrainingCard date={dateStr} />
        <WatchNextCard date={dateStr} />
        <WorkCard date={dateStr} />
        <ProjectsCard date={dateStr} />
        <GamesCard date={dateStr} />
        <ShopCard date={dateStr} />
        <SleepCard date={dateStr} />
      </div>
    </div>
  )
}
