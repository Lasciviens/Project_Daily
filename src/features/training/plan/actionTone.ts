import type { CurrentAction } from '../progress-engine/types'
import type { Tone } from '../../../shared/ui/Tone'

// The status tone of each engine action — the one map every screen uses (the
// Next card, the session rows, the Progress table). Moving up is success;
// building, repeating, a new weight and a step back are ordinary training
// (info) — a step back is never a warning (S6: "not a setback").
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
  WATCH_FOR_REGRESSION:      'danger',
  INSUFFICIENT_DATA:         'neutral',
  LOG_COMPARABLE_SESSION:    'neutral',
}
