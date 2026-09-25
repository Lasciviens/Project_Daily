import type { AdvancedTab } from './testGameStore'

// The Advanced section's tabs — every feature of the current Games page that
// the new design has no place for yet, reused as-is. Order = how often each is
// likely to be reached for.
export const ADVANCED_TABS: { key: AdvancedTab; label: string }[] = [
  { key: 'classic',     label: 'Classic library' },
  { key: 'tiers',       label: 'Tiers' },
  { key: 'queue',       label: 'Queue editor' },
  { key: 'review',      label: 'Needs review' },
  { key: 'scraper',     label: 'ScreenScraper' },
  { key: 'steam',       label: 'Steam' },
  { key: 'playstation', label: 'PlayStation' },
  { key: 'tools',       label: 'Add & random' },
]
