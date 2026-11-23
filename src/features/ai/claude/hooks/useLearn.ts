import { useQuery } from '@tanstack/react-query'
import { toast } from '../../../../app/store'
import { useMutationWithFeedback } from '../../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../../shared/query'
import {
  decideTuning, fetchCases, fetchCorrections, fetchEvalRuns, fetchJobLearning, fetchLessons, fetchRules, fetchSources, quarantineLearning, reportAiSave,
  restoreMoved, rollbackLesson, runSelfTestNow, setLearnState, type LearnState, type TuningDecision,
} from '../learnApi'
import { learnWaiting, type MovedRow, type SaveReport } from '../learnRules'

// Developer → AI → Learned: the reads and the owner's actions. One action = one hook. Every change says what happened with
// an Undo that puts it back (a state, a Set aside, a note's rollback, a Tuning decision).

export const useLearnCorrections = () => useQuery({ queryKey: qk.aiLearn.corrections(), queryFn: fetchCorrections, staleTime: STALE.short })
export const useLearnRules = () => useQuery({ queryKey: qk.aiLearn.rules(), queryFn: fetchRules, staleTime: STALE.short })
export const useLearnCases = () => useQuery({ queryKey: qk.aiLearn.cases(), queryFn: fetchCases, staleTime: STALE.short })
export const useLearnLessons = () => useQuery({ queryKey: qk.aiLearn.lessons(), queryFn: fetchLessons, staleTime: STALE.short })
export const useLearnEvalRuns = () => useQuery({ queryKey: qk.aiLearn.evalRuns(), queryFn: fetchEvalRuns, staleTime: STALE.short })
export const useLearnJobs = () => useQuery({ queryKey: qk.aiLearn.jobs(), queryFn: fetchJobLearning, staleTime: STALE.short })
export const useLearnSources = () => useQuery({ queryKey: qk.aiLearn.sources(), queryFn: fetchSources, staleTime: STALE.short })

/** What waits for the owner (the Learned badge and its views' badges). A failed read counts nothing: a badge only adds. */
export function useLearnWaiting() {
  const rules = useLearnRules()
  const lessons = useLearnLessons()
  const runs = useLearnEvalRuns()
  return learnWaiting(rules.data ?? [], lessons.data ?? [], runs.data ?? [])
}

type StateTable = Parameters<typeof setLearnState>[0]
export interface StateChange { table: StateTable; id: string; state: LearnState; said: string }

/** Turn on · turn off · set aside · ignore · bring back: one row's state, with "… · Undo" that puts the state it had back. */
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

/** Set aside everything from one source, or after a day. "N set aside · Undo" puts each moved row back. */
export function useQuarantineLearning() {
  const undo = useMutationWithFeedback({
    action: 'ai_learn_quarantine_undo',
    successMessage: (n: number) => `Put back · ${n}`,
    mutationFn: (rows: MovedRow[]) => restoreMoved(rows),
    invalidates: ['aiLearn'],
  })
  return useMutationWithFeedback({
    action: 'ai_learn_quarantine',
    silent: 'its own toast with Undo says how many were set aside',
    mutationFn: ({ source, after }: { source: string | null; after: string | null }) => quarantineLearning(source, after),
    onSuccess: (moved) => {
      if (!moved.length) { toast.info('Nothing was in use from there'); return }
      toast.undo(`${moved.length} set aside`, () => undo.mutate(moved))
    },
    invalidates: ['aiLearn'],
  })
}

/** A note's rollback to the previous version that was once on. Undo rolls forward again. */
export function useRollbackLesson() {
  const undo = useMutationWithFeedback({
    action: 'ai_lesson_rollback_undo',
    successMessage: 'Rolled forward again',
    mutationFn: (retired: string) => setLearnState('ai_lessons', retired, 'active'),
    invalidates: ['aiLearn'],
  })
  return useMutationWithFeedback({
    action: 'ai_lesson_rollback',
    silent: 'its own toast with Undo says what happened',
    mutationFn: (lessonKey: string) => rollbackLesson(lessonKey),
    onSuccess: (done) => {
      if (!done) { toast.info('There is no earlier version that was ever on'); return }
      toast.undo('Rolled back to the previous version', () => undo.mutate(done.retired))
    },
    invalidates: ['aiLearn'],
  })
}

/**
 * Approve · Reject · Roll back in Tuning. Approve: the function decides first (with its own copy of the run), then the
 * notes it TESTED are turned on with the owner's own rights, and ONE toast says it all: "Approved · N notes on · Undo".
 * Undo of Approve or Reject puts the decision back (reopen: an Approve is rolled back first).
 */
export function useDecideTuning() {
  const undo = useMutationWithFeedback({
    action: 'ai_tuning_undo',
    successMessage: (message: string) => message,
    mutationFn: async (input: { runId: string; job: string }) => (await decideTuning({ ...input, decision: 'reopen' })).message,
    invalidates: ['aiLearn'],
  })
  return useMutationWithFeedback({
    action: 'ai_tuning_decide',
    silent: 'its own toast (with Undo for Approve and Reject) says what changed',
    mutationFn: async (input: { runId?: string; job: string; decision: Exclude<TuningDecision, 'reopen'> }) => {
      const decided = await decideTuning(input)
      let on = 0
      for (const id of decided.lessonIds) { await setLearnState('ai_lessons', id, 'active'); on += 1 }
      return { ...decided, on }
    },
    onSuccess: (r, input) => {
      if (input.decision === 'roll_back' || !input.runId) { toast.success(r.message); return }
      const runId = input.runId
      const said = input.decision === 'approve' ? `Approved${r.on ? ` · ${r.on} ${r.on === 1 ? 'note' : 'notes'} on` : ''}` : 'Rejected'
      toast.undo(said, () => undo.mutate({ runId, job: input.job }))
    },
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
 * Several saves (Tidy up all) go as one report.
 */
export function useReportAiSave() {
  return useMutationWithFeedback({
    action: 'ai_learn_save',
    silent: 'a background note for Developer → AI → Learned; the save itself reports its result',
    // Saved values are the owner's data (a title, a place): never in the error log.
    logPayload: false,
    mutationFn: (report: SaveReport | readonly SaveReport[]) => reportAiSave(report),
    invalidates: ['aiLearn'],
  })
}
