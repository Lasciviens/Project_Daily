import type { Dispatch, SetStateAction } from 'react'
import type { Period } from './PeriodToggle'

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
