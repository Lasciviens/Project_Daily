import { useTrainingWeek } from '../../hooks/useTrainingWeek'
import { useRecoveryNotes } from './useRecoveryNotes'

/**
 * Starts the reads of the lines around the next session (this week, recovery; the muscle watch moved to Results on 27.11.2026) while the
 * plan is still loading. They don't depend on the plan, but their lines mount only once it is in — so their
 * reads used to start a whole round late (owner, 16.11.2026: "around 1+ s to load from db"). It draws nothing
 * and hands nothing on: each line still reads for itself and keeps its own room (the same query, asked once).
 */
export function NextReadsAhead() {
  useTrainingWeek()
  useRecoveryNotes()
  return null
}
