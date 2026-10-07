import type { AdvancedTab } from './testGameStore'

// The Advanced section's tabs — the tools from the previous Games page the
// new design has no place for yet, reused as-is. Order = how often each is
// likely to be reached for.
export const ADVANCED_TABS: { key: AdvancedTab; label: string }[] = [
  { key: 'review',      label: 'Needs review' },
  { key: 'duplicates',  label: 'Duplicates' },
  { key: 'steam',       label: 'Steam' },
  { key: 'playstation', label: 'PlayStation' },
]
