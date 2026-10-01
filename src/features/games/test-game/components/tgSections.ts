import {
  ChartColumn, CircleCheckBig, Heart, SlidersHorizontal, SquarePlay, Timer, Wand2,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { TgSection } from '../testGameModel'
import { GameLibraryMark } from './platformArt'

/** The badge counts the page's navigation prints. */
export interface TgNavCounts { queue: number; wishlist: number; completed: number; review: number; hidden?: number }

export interface TgSectionEntry {
  key: TgSection
  /** The navigation panel's label ("Play Queue"). */
  label: string
  /** The phone's section row, where every pill costs width ("Queue"). */
  short: string
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
  count?: keyof TgNavCounts
  /** Listed in the panel's footer (tools) instead of with the sections. */
  tool?: boolean
}

/** Every section, in the order the panel and the phone's section row list them.
 *  Library uses the logo's solid pad, as the design draws it; the rest are lucide. */
export const TG_SECTION_ENTRIES: readonly TgSectionEntry[] = [
  { key: 'library', label: 'Library', short: 'Library', icon: GameLibraryMark },
  { key: 'queue', label: 'Play Queue', short: 'Queue', icon: SquarePlay, count: 'queue' },
  { key: 'wishlist', label: 'Wishlist', short: 'Wishlist', icon: Heart, count: 'wishlist' },
  { key: 'completed', label: 'Completed', short: 'Completed', icon: CircleCheckBig, count: 'completed' },
  { key: 'analytics', label: 'Analytics', short: 'Analytics', icon: ChartColumn },
  { key: 'scrape', label: 'Scrape', short: 'Scrape', icon: Wand2, tool: true },
  { key: 'igdb', label: 'IGDB', short: 'IGDB', icon: Timer, tool: true },
  { key: 'advanced', label: 'Advanced', short: 'Advanced', icon: SlidersHorizontal, count: 'review', tool: true },
]

/** A section's badge: none while empty (the design draws an empty Wishlist bare). */
export function sectionCount(entry: TgSectionEntry, counts: TgNavCounts): number | undefined {
  const n = entry.count ? counts[entry.count] : undefined
  return n ? n : undefined
}
