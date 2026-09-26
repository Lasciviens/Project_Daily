import type { Tone } from '../../../shared/ui'
import { NAV } from '../../../app/navigation'
import type { DevRequestCategory, DevRequestPriority } from '../types'

// Split out from DevRequestCard.tsx — a component file can only export
// components for Fast Refresh to work, not also share constants.
export const CATEGORY_TONE: Record<DevRequestCategory, Tone> = {
  bug:         'danger',
  feature:     'info',
  improvement: 'success',
  integration: 'highlight',
  longterm:    'star',
  question:    'neutral',
  other:       'neutral',
}

export const PRIORITY_TONE: Record<DevRequestPriority, Tone> = {
  low:    'neutral',
  medium: 'info',
  high:   'warn',
  urgent: 'danger',
}

// The app's own routes, straight from the nav registry, so a new page shows
// up here without a second list to maintain. A dropdown of these beats a
// free-text box (typos/inconsistent casing made page filters unreliable);
// "other" covers anything outside it (/login, /reset-password…).
export const PAGE_CHOICES: { value: string; label: string }[] = NAV.map(e => ({ value: e.path, label: `${e.label} · ${e.path}` }))
export const PAGE_OPTIONS: readonly string[] = PAGE_CHOICES.map(c => c.value)

// A request captured from a route outside the list still needs a value to
// preselect — falls back to "other" so the dropdown never shows nothing.
export function pageOptionFor(pathname: string): string {
  return PAGE_OPTIONS.includes(pathname) ? pathname : 'other'
}
