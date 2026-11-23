import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { callLearnFunction as callFunction, learnSaid as said } from './learnSave'
import {
  CASE_COLUMNS, CORRECTION_COLUMNS, EVAL_COLUMNS, JOB_LEARNING_COLUMNS, LESSON_COLUMNS, readCase, readCorrection, readEvalRun, readJobLearning,
  readLesson, readList, readMoved, readRule, readSource, RULE_COLUMNS, SOURCE_COLUMNS,
  type AiCase, type AiCorrection, type AiLesson, type AiRule, type AiSource, type CaseState, type EvalRun, type JobLearning, type LessonState, type MovedRow, type RuleState,
} from './learnRules'

// What the AI learned (migration 204). The tables are written by the `claude` function; the browser reads its own rows and may
// change ONE column, `state` (a column grant, a trigger and a policy say it three ways). The owner's quarantine and a lesson's
// rollback are two database functions that run with the owner's own rights. A save report and a tuning decision go to the
// function. Before 204 runs: a read answers empty and a write names the migration. Remove the guards once 204 is live.

const NOT_MIGRATED_204 = 'Learning is not available yet — migration 204 (ai_learning) has not been applied.'

interface PgError { code?: string; message?: string }
const isMissing = (e: PgError | null): boolean => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /could not find the (table|function)/i.test(e.message ?? ''))

async function readTable<T>(table: string, columns: string, read: (r: unknown) => T | null, order = 'created_at', limit = 500): Promise<T[]> {
  const { data, error } = await supabase.from(table).select(columns).order(order, { ascending: false }).limit(limit)
  if (error) {
    if (isMissing(error)) return []
    throw error
  }
  return readList(data, read)
}

export const fetchCorrections = (): Promise<AiCorrection[]> => readTable('ai_corrections', CORRECTION_COLUMNS, readCorrection)
export const fetchRules = (): Promise<AiRule[]> => readTable('ai_rules', RULE_COLUMNS, readRule)
export const fetchCases = (): Promise<AiCase[]> => readTable('ai_cases', CASE_COLUMNS, readCase)
export const fetchLessons = (): Promise<AiLesson[]> => readTable('ai_lessons', LESSON_COLUMNS, readLesson)
export const fetchEvalRuns = (): Promise<EvalRun[]> => readTable('ai_eval_runs', EVAL_COLUMNS, readEvalRun, 'created_at', 20)
export const fetchSources = (): Promise<AiSource[]> => readTable('ai_source_stats', SOURCE_COLUMNS, readSource, 'updated_at')
export const fetchJobLearning = (): Promise<JobLearning[]> => readTable('ai_job_learning', JOB_LEARNING_COLUMNS, readJobLearning, 'updated_at', 50)

type StateTable = 'ai_corrections' | 'ai_rules' | 'ai_cases' | 'ai_lessons' | 'ai_source_stats'
export type LearnState = RuleState | CaseState | LessonState | 'counted' | 'ignored' | 'on'

/** The one thing the browser may change: a row's state. Answers the state it had before (for the Undo). */
export async function setLearnState(table: StateTable, id: string, state: LearnState): Promise<string> {
  const user = await requireUser()
  const { data: before, error: readError } = await supabase.from(table).select('state').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (readError) throw isMissing(readError) ? new Error(NOT_MIGRATED_204) : readError
  const was = (before as { state?: unknown } | null)?.state
  if (typeof was !== 'string') throw new Error('That row is not in your list any more.')
  const { data, error } = await supabase.from(table).update({ state }).eq('id', id).eq('user_id', user.id).select('id')
  if (error) throw isMissing(error) ? new Error(NOT_MIGRATED_204) : error
  if (!Array.isArray(data) || data.length !== 1) throw new Error('That row is not in your list any more.')
  return was
}

/** Set aside everything from one source, or everything after a day: notes wait again, cases are set aside, rules wait again. Answers what moved (for the Undo). */
export async function quarantineLearning(source: string | null, after: string | null): Promise<MovedRow[]> {
  const { data, error } = await supabase.rpc('ai_learn_quarantine', { p_source: source, p_after: after })
  if (error) throw isMissing(error) ? new Error(NOT_MIGRATED_204) : error
  return readMoved(data)
}

/** The Undo of a Set aside: each moved row back to what it was (the owner's own rights; turning on is the owner's). */
export async function restoreMoved(rows: readonly MovedRow[]): Promise<number> {
  const table = { lessons: 'ai_lessons', cases: 'ai_cases', rules: 'ai_rules' } as const
  let n = 0
  for (const r of rows) { await setLearnState(table[r.t], r.id, r.was); n += 1 }
  return n
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** One-click rollback of a note to the previous version that was once on. Answers the two ids (for the Undo, which rolls forward), or null. */
export async function rollbackLesson(lessonKey: string): Promise<{ retired: string; activated: string } | null> {
  const { data, error } = await supabase.rpc('ai_lesson_rollback', { p_lesson_key: lessonKey })
  if (error) throw isMissing(error) ? new Error(NOT_MIGRATED_204) : error
  const d = data as { result?: unknown; retired?: unknown; activated?: unknown } | null
  return d?.result === 'rolled_back' && typeof d.retired === 'string' && UUID_RE.test(d.retired) && typeof d.activated === 'string' && UUID_RE.test(d.activated)
    ? { retired: d.retired, activated: d.activated } : null
}


export type TuningDecision = 'approve' | 'reject' | 'roll_back' | 'reopen'

/** Approve, reject, roll back, or undo a decision (reopen) in Tuning. Answers the function's own sentence and, for an Approve, the tested notes to turn on. */
export async function decideTuning(input: { runId?: string; job: string; decision: TuningDecision }): Promise<{ message: string; lessonIds: string[] }> {
  const data = await callFunction({ action: 'learn_decide', run_id: input.runId, job: input.job, decision: input.decision })
  if (data.ok !== true) throw new Error(said(data, 'The decision could not be saved.'))
  const ids = Array.isArray(data.lesson_ids) ? data.lesson_ids.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)).slice(0, 20) : []
  return { message: said(data, 'Saved'), lessonIds: ids }
}

/** "Run the self-test now": the function builds the test and queues one batch. Answers what happened, in words. */
export async function runSelfTestNow(): Promise<string> {
  const data = await callFunction({ action: 'learn_eval_make' })
  if (data.ok !== true) throw new Error(said(data, 'The self-test could not be queued.'))
  if (data.queued === true) return `Self-test queued: ${typeof data.requests === 'number' ? data.requests : 'some'} requests at half price`
  const skipped = typeof data.skipped === 'string' ? data.skipped : ''
  return skipped === 'already_queued' ? 'A self-test is already waiting for its results'
    : skipped === 'nothing_to_test' ? 'Nothing to test yet: no new corrections, or too few saved cases'
      : 'Nothing was queued'
}
