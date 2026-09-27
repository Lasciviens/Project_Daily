import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { localDayOf, shiftDateStr } from '../../../shared/utils/dateUtils'
import { useTrainingBlocks } from '../../daily/hooks/useSchedule'
import { createTrainingSkip, deleteTrainingSkip, fetchTrainingSkips, type CreateTrainingSkipInput } from '../api/trainingSkipsApi'
import { lastTrainedByRoutine } from '../progress-engine'
import { readMissedSessions, shiftDay, weekStartOf, type RoutineAttention } from '../plan/skippedRoutines'
import type { PlannedRef } from '../plan/nextSession'
import { useHevyRoutines } from './useHevyRoutines'
import { useCurrentProgramRoutines } from './useAthleteProfile'
import { useTrainingHistory } from './useTrainingProgress'
import { useTodayStr, NEXT_SESSION_LOOKAHEAD_DAYS } from './useTrainingSessions'

/** How far back skips are read: the rule only needs last week's, the coach
 *  context shows a few weeks. */
export const SKIP_LOOKBACK_WEEKS = 8

export function skipsFromWeek(today: string): string {
  return shiftDay(weekStartOf(today), -7 * SKIP_LOOKBACK_WEEKS)
}

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
  const blocks = blocksQ.data
  const skips = skipsQ.data

  const items = useMemo<RoutineAttention[]>(() => {
    if (isLoading || !routines || !program || !history || !blocks || !skips) return []
    const joined = new Map(program.map(p => [p.routine_id, localDayOf(p.created_at)]))
    const current = routines.filter(r => joined.has(r.id)).map(r => ({ id: r.id, title: r.title, joinedOn: joined.get(r.id) ?? null }))
    // One-off blocks only: a recurring template always has a next occurrence
    // and would silence the flag for good (see skippedRoutines.ts).
    const upcoming: PlannedRef[] = blocks.map(b => ({
      title: b.title, date: b.date, startTime: b.start_time?.slice(0, 5) ?? null,
      sourceId: b.source_type === 'training_session' ? b.source_id ?? null : null,
    }))
    return readMissedSessions({ program: current, routines, lastTrained: lastTrainedByRoutine(history.sets), upcoming, skips, today })
  }, [isLoading, routines, program, history, blocks, skips, today])

  return { isLoading, items, today }
}
