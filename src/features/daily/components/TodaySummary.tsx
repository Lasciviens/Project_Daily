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
      {/* Spaced cards instead of the old hairline-separated slab ("dip dibe"
          feedback): same FIXED slots and explicit column counts (never
          auto-fill), but each module is its own bordered card with real
          gaps, so the board reads as distinct modules at a glance. */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 stagger-in">
        <div className="sm:col-span-2 h-full rounded-2xl border border-ink-200 bg-cream-50 shadow-card overflow-hidden"><NutritionCard date={dateStr} /></div>
        <div className="h-full rounded-2xl border border-ink-200 bg-cream-50 shadow-card overflow-hidden"><MealsCard date={dateStr} /></div>
        <div className="h-full rounded-2xl border border-ink-200 bg-cream-50 shadow-card overflow-hidden"><TrainingCard date={dateStr} /></div>
        <div className="h-full rounded-2xl border border-ink-200 bg-cream-50 shadow-card overflow-hidden"><WatchNextCard date={dateStr} /></div>
        <div className="h-full rounded-2xl border border-ink-200 bg-cream-50 shadow-card overflow-hidden"><HealthCard date={dateStr} /></div>
        <div className="h-full rounded-2xl border border-ink-200 bg-cream-50 shadow-card overflow-hidden"><GamesCard date={dateStr} /></div>
        <div className="h-full rounded-2xl border border-ink-200 bg-cream-50 shadow-card overflow-hidden"><ShopCard date={dateStr} /></div>
      </section>
    </div>
  )
}
