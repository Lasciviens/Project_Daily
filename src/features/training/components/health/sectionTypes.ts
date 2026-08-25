import type { Dispatch, SetStateAction } from 'react'
import type { Period } from './PeriodToggle'

export type SectionId = 'overview' | 'steps' | 'energy' | 'heart' | 'sleep' | 'body'

/** ONE day+period selection shared by every Health section.
 *
 *  Was per-section: Steps/Energy/Heart/Sleep each called useAnchorDate() and
 *  useState<Period>('week') of their own and rendered their own DateNav +
 *  PeriodToggle *inside* the section body. So changing the day in Steps left
 *  Heart on a different day, each section's date lived at a different scroll
 *  depth, and Overview/Body had no day control at all. HealthTab now owns
 *  this once, renders it above the section pills, and hands it down — so one
 *  day change moves every section together.
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

export const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '⭕' },
  { id: 'steps',    label: 'Steps',    icon: '🚶' },
  { id: 'energy',   label: 'Energy',   icon: '🔥' },
  { id: 'heart',    label: 'Heart',    icon: '❤️' },
  { id: 'sleep',    label: 'Sleep',    icon: '😴' },
  { id: 'body',     label: 'Body',     icon: '⚖️' },
]
