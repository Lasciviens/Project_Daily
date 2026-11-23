import { useQuery } from '@tanstack/react-query'
import { toast } from '../../../../app/store'
import { useMutationWithFeedback } from '../../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../../shared/query'
import {
  decideTuning, fetchCases, fetchCorrections, fetchEvalRuns, fetchJobLearning, fetchLessons, fetchRules, fetchSources, quarantineLearning, reportAiSave,
  rollbackLesson, runSelfTestNow, setLearnState, type LearnState,
} from '../learnApi'
import type { SaveReport } from '../learnRules'

// Developer → AI → Learn → Memory: the reads and the owner's actions. One action = one hook. Every state change says what
// happened with an Undo that puts the previous state back.

export const useLearnCorrections = () => useQuery({ queryKey: qk.aiLearn.corrections(), queryFn: fetchCorrections, staleTime: STALE.short })
export const useLearnRules = () => useQuery({ queryKey: qk.aiLearn.rules(), queryFn: fetchRules, staleTime: STALE.short })
export const useLearnCases = () => useQuery({ queryKey: qk.aiLearn.cases(), queryFn: fetchCases, staleTime: STALE.short })
export const useLearnLessons = () => useQuery({ queryKey: qk.aiLearn.lessons(), queryFn: fetchLessons, staleTime: STALE.short })
export const useLearnEvalRuns = () => useQuery({ queryKey: qk.aiLearn.evalRuns(), queryFn: fetchEvalRuns, staleTime: STALE.short })
export const useLearnJobs = () => useQuery({ queryKey: qk.aiLearn.jobs(), queryFn: fetchJobLearning, staleTime: STALE.short })
export const useLearnSources = () => useQuery({ queryKey: qk.aiLearn.sources(), queryFn: fetchSources, staleTime: STALE.short })

type StateTable = Parameters<typeof setLearnState>[0]
export interface StateChange { table: StateTable; id: string; state: LearnState; said: string }

/** Keep · dismiss · turn on · remove · bring back: one row's state, with "… · Undo" that puts the state it had back. */
export function useSetLearnState() {
  const undo = useMutationWithFeedback({
    action: 'ai_learn_state_undo',
    successMessage: 'Put back',
    mutationFn: ({ table, id, state }: { table: StateTable; id: string; state: LearnState }) => setLearnState(table, id, state),
    invalidates: ['aiLearn'],
  })
  return useMutationWithFeedback({
    action: 'ai_learn_state',
    silent: 'its own toast with Undo says what changed',
    mutationFn: (c: StateChange) => setLearnState(c.table, c.id, c.state),
    onSuccess: (was, c) => toast.undo(c.said, () => undo.mutate({ table: c.table, id: c.id, state: was as LearnState })),
    invalidates: ['aiLearn'],
  })
}

/** Re-quarantine everything from one source, or after a day. Every row it moved can be turned on again, one by one. */
export function useQuarantineLearning() {
  return useMutationWithFeedback({
    action: 'ai_learn_quarantine',
    successMessage: (n: number) => (n === 0 ? 'Nothing was in use from there' : `${n} set aside — turn any of them on again from its card`),
    mutationFn: ({ source, after }: { source: string | null; after: string | null }) => quarantineLearning(source, after),
    invalidates: ['aiLearn'],
  })
}

/** One-click rollback of a note to its previous version. */
export function useRollbackLesson() {
  return useMutationWithFeedback({
    action: 'ai_lesson_rollback',
    successMessage: (done: boolean) => (done ? 'Rolled back to the previous version' : 'There is no earlier version'),
    mutationFn: (lessonKey: string) => rollbackLesson(lessonKey),
    invalidates: ['aiLearn'],
  })
}

/** Approve · Reject · Roll back in Tuning (the function decides with its own copy of the run). */
export function useDecideTuning() {
  return useMutationWithFeedback({
    action: 'ai_tuning_decide',
    successMessage: (message: string) => message,
    mutationFn: (input: { runId?: string; job: string; decision: 'approve' | 'reject' | 'roll_back' }) => decideTuning(input),
    invalidates: ['aiLearn'],
  })
}

export function useRunSelfTestNow() {
  return useMutationWithFeedback({
    action: 'ai_learn_eval_make',
    successMessage: (message: string) => message,
    mutationFn: () => runSelfTestNow(),
    invalidates: ['aiLearn'],
  })
}

/**
 * After the owner saved what an AI answer filled: the call id and the saved values go to the function, which compares them
 * with its own copy of the answer. A background note: the save itself reports, and a failure here never touches it.
 */
export function useReportAiSave() {
  return useMutationWithFeedback({
    action: 'ai_learn_save',
    silent: 'a background note for Developer → AI → Learn; the save itself reports its result',
    // Saved values are the owner's data (a title, a place): never in the error log.
    logPayload: false,
    mutationFn: (report: SaveReport) => reportAiSave(report),
    invalidates: ['aiLearn'],
  })
}
