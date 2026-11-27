import type { CurrentAction } from '../progress-engine/types'
import type { Tone } from '../../../shared/ui/Tone'

// The status tone of each engine action — the one map every screen uses (the
// Today card, the session rows, Results' exercise list). Moving up is success;
// building, repeating, a new weight and a step back are ordinary training
// (info) — a step back is never a warning (S6: "not a setback"), and reps falling at
// a load is information, never danger (S14: slow progress is not failure).
export const ACTION_TONE: Record<CurrentAction, Tone> = {
  READY_TO_INCREASE:         'success',
  ALMOST_READY:              'success',
  REPEAT_AT_TOP:             'info',
  BUILD_AT_CURRENT_LOAD:     'info',
  NEW_WEIGHT:                'info',
  STEP_BACK:                 'info',
  CONFIRM_AT_CURRENT_LOAD:   'warn',
  REVIEW_LOAD_REDUCTION:     'neutral',
  HOLD_STEADY:               'info',
  WATCH_FOR_PLATEAU:         'warn',
  WATCH_FOR_REGRESSION:      'neutral',
  INSUFFICIENT_DATA:         'neutral',
  LOG_COMPARABLE_SESSION:    'neutral',
}
