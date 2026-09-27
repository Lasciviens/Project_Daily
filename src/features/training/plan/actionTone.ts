import type { CurrentAction } from '../progress-engine/types'
import type { Tone } from '../../../shared/ui/Tone'

// The status tone of each engine action. Same values as
// progress/ExerciseDecisionTable.tsx's private map — the two should become one
// export next to the CurrentAction enum (integrator follow-up: that file and
// progress-engine/ are outside this change).
export const ACTION_TONE: Record<CurrentAction, Tone> = {
  READY_TO_INCREASE:         'success',
  BUILD_AT_CURRENT_LOAD:     'info',
  CONFIRM_BEFORE_INCREASING: 'warn',
  CONFIRM_AT_CURRENT_LOAD:   'warn',
  REVIEW_LOAD_REDUCTION:     'warn',
  HOLD_STEADY:               'info',
  WATCH_FOR_PLATEAU:         'warn',
  WATCH_FOR_REGRESSION:      'danger',
  INSUFFICIENT_DATA:         'neutral',
  LOG_COMPARABLE_SESSION:    'neutral',
}
