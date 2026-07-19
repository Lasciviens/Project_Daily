import { isToday } from 'date-fns'
import { NutritionCard } from './summary/NutritionCard'
import { MealsCard } from './summary/MealsCard'
import { TrainingCard } from './summary/TrainingCard'
import { WatchNextCard } from './summary/WatchNextCard'
import { GamesCard } from './summary/GamesCard'
import { ShopCard } from './summary/ShopCard'
import { HealthCard } from './summary/HealthCard'
import { formatLocalDate } from '../../../shared/utils/dateUtils'

// ─────────────────────────────────────────────────────────────────────────────
//  "At a glance" — ONE board surface, not six separate boxes. The six modules
//  are FIXED cells of a single bordered panel, separated by hairlines (gap-px
//  over an ink-100 backdrop) instead of per-card borders. Positions are
//  stable by construction (explicit column counts per breakpoint — 1 / 2 / 3,
//  NO auto-fill): a module always lives in the same slot; an empty module
//  collapses to a compact row IN PLACE (see NutritionCard) and never
//  reshuffles its neighbours. Cards live in ./summary/ using the shared
//  Cell/CellHeader anatomy (cellKit.tsx).
// ─────────────────────────────────────────────────────────────────────────────

export function TodaySummary({ date }: { date: Date }) {
  const dateStr = formatLocalDate(date)

  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wider font-semibold text-ink-400 mb-2">
        {isToday(date) ? 'Today at a glance' : 'At a glance'}
      </p>
      {/* Full-width board now (schedule moved to its own row). Explicit column
          counts per breakpoint — NO auto-fill; Nutrition gets a DOUBLE slot
          (wider, as requested) from sm up so its position stays deterministic. */}
      <section className="rounded-2xl border border-ink-200 bg-ink-100 overflow-hidden shadow-card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-px stagger-in">
          <div className="sm:col-span-2"><NutritionCard date={dateStr} /></div>
          <MealsCard date={dateStr} />
          <TrainingCard date={dateStr} />
          <WatchNextCard date={dateStr} />
          <HealthCard date={dateStr} />
          <GamesCard date={dateStr} />
          <ShopCard date={dateStr} />
          {/* lg (3-col) flow leaves one trailing slot; a cream filler keeps the
              panel visually complete there (sm/2xl already tile evenly). */}
          <div className="hidden lg:block 2xl:hidden bg-cream-50" />
        </div>
      </section>
    </div>
  )
}
