import type { Tone } from '../../shared/ui'
import type { WishWindowState } from './wishRules'

export { PRIORITY_TONE as WISH_PRIORITY_TONE } from '../todo/taskTones'

// A period is a reminder, never a deadline — so a PASSED window is neutral,
// the same weight as "anytime". Never danger, never an overdue mark. Status
// never uses the accent (THEME.md §2.4): an open window is "on now" = success.
export const WINDOW_TONE: Record<WishWindowState, Tone> = {
  open:     'success',
  upcoming: 'neutral',
  passed:   'neutral',
  anytime:  'neutral',
}

/** A task was created from the wish — informational, not a call to action. */
export const SCHEDULED_TONE: Tone = 'info'
