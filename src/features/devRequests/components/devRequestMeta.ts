import type { DevRequestCategory, DevRequestPriority } from '../types'

// Split out from DevRequestCard.tsx — a component file can only export
// components for Fast Refresh to work, not also share constants.
export const CATEGORY_BADGE: Record<DevRequestCategory, string> = {
  bug:         'bg-red-50 text-red-700 border-red-200',
  feature:     'bg-blue-50 text-blue-700 border-blue-200',
  improvement: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  integration: 'bg-violet-50 text-violet-700 border-violet-200',
  longterm:    'bg-amber-50 text-amber-700 border-amber-200',
  question:    'bg-sky-50 text-sky-700 border-sky-200',
  other:       'bg-ink-100 text-ink-600 border-ink-200',
}

export const PRIORITY_DOT: Record<DevRequestPriority, string> = {
  low:    'bg-ink-300',
  medium: 'bg-accent-400',
  high:   'bg-orange-500',
  urgent: 'bg-red-600',
}
