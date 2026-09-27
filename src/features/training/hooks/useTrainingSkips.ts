import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { useTrainingBlocks } from '../../daily/hooks/useSchedule'
import { createTrainingSkip, deleteTrainingSkip, fetchTrainingSkips, type CreateTrainingSkipInput } from '../api/trainingSkipsApi'
import { lastTrainedByRoutine } from '../progress-engine'
import { missedSessionsFrom, skipsFromWeek, type RoutineAttention } from '../plan/skippedRoutines'
import { useHevyRoutines } from './useHevyRoutines'
import { useCurrentProgramRoutines } from './useAthleteProfile'
import { useTrainingHistory } from './useTrainingProgress'
import { useTodayStr, NEXT_SESSION_LOOKAHEAD_DAYS } from './useTrainingSessions'

export function useTrainingSkips() {
  const fromWeek = skipsFromWeek(useTodayStr())
  return useQuery({ queryKey: qk.training.skips(fromWeek), queryFn: () => fetchTrainingSkips(fromWeek), staleTime: STALE.default })
}

export function useSkipTrainingSession() {
  return useMutationWithFeedback({
    action:         'skip_training_session',
    successMessage: 'Skipped',
    mutationFn:     (input: CreateTrainingSkipInput) => createTrainingSkip(input),
    invalidates:    [qk.training.skipsAll],
  })
}

export function useUndoTrainingSkip() {
  return useMutationWithFeedback({
    action:         'undo_training_skip',
    successMessage: 'Skip undone',
    mutationFn:     (id: string) => deleteTrainingSkip(id),
    invalidates:    [qk.training.skipsAll],
  })
}

export interface MissedSessions {
  isLoading: boolean
  items: RoutineAttention[]
  today: string
}

/** Current-program routines not done for more than 7 days, with their skip
 *  or one-off plan (plan/skippedRoutines.ts). Reuses the reads the Training
 *  tabs already make (routines, program, history, the next-session block
 *  range); only the skips are new. Nothing is flagged until every read is in
 *  — a half-loaded history would flag everything. */
export function useMissedSessions(): MissedSessions {
  const today = useTodayStr()
  const routinesQ = useHevyRoutines()
  const programQ = useCurrentProgramRoutines()
  const historyQ = useTrainingHistory()
  const blocksQ = useTrainingBlocks(today, shiftDateStr(today, NEXT_SESSION_LOOKAHEAD_DAYS))
  const skipsQ = useTrainingSkips()

  const isLoading = routinesQ.isLoading || programQ.isLoading || historyQ.isLoading || blocksQ.isLoading || skipsQ.isLoading
  const routines = routinesQ.data
  const program = programQ.data
  const history = historyQ.data
  const blocksData = blocksQ.data
  const blocksFailed = blocksQ.isError
  const skipsData = skipsQ.data
  const skipsFailed = skipsQ.isError

  const items = useMemo<RoutineAttention[]>(() => {
    // A failed plan/skip read shows the flags rather than hiding them (the
    // worst case is a flag for a session already skipped or planned).
    const blocks = blocksData ?? (blocksFailed ? [] : undefined)
    const skips = skipsData ?? (skipsFailed ? [] : undefined)
    if (isLoading || !routines || !program || !history || !blocks || !skips) return []
    // One-off blocks only (this range query never returns recurring
    // templates): a weekly repeat always has a next date and would silence
    // the flag for good (see skippedRoutines.ts).
    return missedSessionsFrom({ routines, program, lastTrained: lastTrainedByRoutine(history.sets), blocks, skips, today })
  }, [isLoading, routines, program, history, blocksData, blocksFailed, skipsData, skipsFailed, today])

  return { isLoading, items, today }
}
