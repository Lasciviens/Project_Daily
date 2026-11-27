import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { shiftTrainingSessions, undoTrainingShift, type ShiftMove } from '../api/trainingPlanApi'
import { shiftResultLine } from '../plan/sessionState'

const TARGETS = ['taskGraph', 'training'] as const

/** The owner's Move / Pull (sessionState.shiftOffer): one call moves the sessions in the data, then "Moved Lower A,
 *  Upper B, Lower B one day later · Undo" — the words from what the database answered, the Undo through its own
 *  mutation (it reports its result too). */
export function useShiftTrainingSessions() {
  const undo = useMutationWithFeedback({
    action: 'training_shift_undo',
    successMessage: (n: number) => (n > 0 ? 'Moved back' : 'Nothing to move back — they were changed since'),
    mutationFn: (moves: readonly ShiftMove[]) => undoTrainingShift(moves),
    invalidates: TARGETS,
  })
  return useMutationWithFeedback({
    action: 'training_shift',
    silent: 'its own result toast with Undo (onSuccess)',
    mutationFn: ({ taskId, days }: { taskId: string; days: number }) => shiftTrainingSessions(taskId, days),
    invalidates: TARGETS,
    onSuccess: r => {
      const moved = r.moves.filter(m => m.from !== m.to)
      if (moved.length === 0) { toast.info('Nothing moved'); return }
      toast.undo(shiftResultLine(moved.map(m => m.title), r.days), () => undo.mutate(moved))
    },
  })
}
