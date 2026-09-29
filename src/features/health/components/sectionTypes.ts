import type { Dispatch, SetStateAction } from 'react'
import { Activity, Footprints, Gauge, HeartPulse, Moon, Scale, Target, type LucideIcon } from 'lucide-react'
import type { Period } from './PeriodToggle'

/** The Health page's windows (tabs), in the metric ranking's order with the
 *  overview first. Kept in `?section=` so a link or a reload opens the same
 *  window. The page was one long scroll for a while; the owner preferred
 *  windows, so every group has its own tab again. */
export type HealthSectionId = 'overview' | 'sleep' | 'activity' | 'heart' | 'body' | 'goal' | 'cardio'

export const HEALTH_SECTIONS: { id: HealthSectionId; label: string; icon: LucideIcon }[] = [
  { id: 'overview', label: 'Overview',       icon: Activity },
  { id: 'sleep',    label: 'Sleep',          icon: Moon },
  { id: 'activity', label: 'Activity',       icon: Footprints },
  { id: 'heart',    label: 'Heart & vitals', icon: HeartPulse },
  { id: 'body',     label: 'Body',           icon: Scale },
  { id: 'goal',     label: 'Goal progress',  icon: Target },
  { id: 'cardio',   label: 'Cardio fitness', icon: Gauge },
]

export const DEFAULT_HEALTH_SECTION: HealthSectionId = 'overview'

export function parseHealthSection(raw: string | null): HealthSectionId {
  // The goal report was the "cut report" (?section=cut) until it followed the chosen phase.
  if (raw === 'cut') return 'goal'
  // Workouts had their own window until strength moved to Training; the rest sit under Activity.
  if (raw === 'workouts') return 'activity'
  return HEALTH_SECTIONS.some(s => s.id === raw) ? raw as HealthSectionId : DEFAULT_HEALTH_SECTION
}

/** ONE day+period selection shared by every Health section.
 *
 *  Was per-section: Steps/Energy/Heart/Sleep each called useAnchorDate() and
 *  useState<Period>('week') of their own and rendered their own DateNav +
 *  PeriodToggle *inside* the section body. So changing the day in Steps left
 *  Heart on a different day, each section's date lived at a different scroll
 *  depth, and Overview/Body had no day control at all. HealthPage owns this
 *  once, renders the control in the header, and every section and the hero
 *  read it — one day change moves them together.
 *
 *  `setAnchor`/`setPeriod` are passed down (not just the values) because the
 *  chart drill-down needs them: clicking a bar in a Week/Month chart jumps to
 *  Day mode on that date, which is a write from inside a section. */
export interface HealthRange {
  anchor:    string
  setAnchor: Dispatch<SetStateAction<string>>
  period:    Period
  setPeriod: Dispatch<SetStateAction<Period>>
}
