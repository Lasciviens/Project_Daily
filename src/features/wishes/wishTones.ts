import type { Tone } from '../../shared/ui'
import type { WishWindowState } from './wishRules'

export { PRIORITY_TONE as WISH_PRIORITY_TONE } from '../todo/taskTones'

// A period is a reminder, never a deadline — so a PASSED window is neutral,
// the same weight as "anytime". Never danger, never an overdue mark.
export const WINDOW_TONE: Record<WishWindowState, Tone> = {
  open:     'accent',
  upcoming: 'neutral',
  passed:   'neutral',
  anytime:  'neutral',
}
