import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { parseFunctionErrorBody } from '../../../shared/utils/functionError'
import { ClaudeJobError } from './claudeApi'
import {
  CASE_COLUMNS, checkedSaveReport, CORRECTION_COLUMNS, EVAL_COLUMNS, JOB_LEARNING_COLUMNS, LESSON_COLUMNS, readCase, readCorrection, readEvalRun, readJobLearning,
  readLesson, readList, readRule, readSource, RULE_COLUMNS, SOURCE_COLUMNS,
  type AiCase, type AiCorrection, type AiLesson, type AiRule, type AiSource, type CaseState, type EvalRun, type JobLearning, type LessonState, type RuleState, type SaveReport,
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

/** Re-quarantine everything from one source, or everything after a day: lessons wait again, cases are set aside, rules go back to waiting. */
export async function quarantineLearning(source: string | null, after: string | null): Promise<number> {
  const { data, error } = await supabase.rpc('ai_learn_quarantine', { p_source: source, p_after: after })
  if (error) throw isMissing(error) ? new Error(NOT_MIGRATED_204) : error
  return typeof data === 'number' ? data : 0
}

/** One-click rollback of a lesson to its previous version. */
export async function rollbackLesson(lessonKey: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('ai_lesson_rollback', { p_lesson_key: lessonKey })
  if (error) throw isMissing(error) ? new Error(NOT_MIGRATED_204) : error
  return data === 'rolled_back'
}

async function callFunction(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke('claude', { body })
  if (error) {
    const status = (error as { context?: { status?: number } })?.context?.status
    if (status === 401 || status === 403) throw new ClaudeJobError('error', 'Session error — refresh the page and sign in again.')
    const said = await parseFunctionErrorBody(error)
    throw new ClaudeJobError('error', (typeof said?.message === 'string' && said.message.trim().slice(0, 300)) || 'The AI function didn’t answer — try again in a moment.')
  }
  return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
}

const said = (data: Record<string, unknown>, fallback: string): string => (typeof data.message === 'string' ? data.message.slice(0, 300) : fallback)

/** The owner saved what an AI answer filled: the call id and the saved values only (the function compares them with its own copy). */
export async function reportAiSave(report: SaveReport): Promise<number> {
  const checked = checkedSaveReport(report)
  if (!checked) return 0
  const data = await callFunction({ action: 'learn_save', call_id: checked.callId, saved: checked.saved, unticked: checked.unticked, dismissed: checked.dismissed })
  if (data.ok !== true) throw new Error(said(data, 'The save could not be noted for learning.'))
  return typeof data.recorded === 'number' ? data.recorded : 0
}

/** Approve, reject or roll back a job's setup in Tuning. Answers the function's own sentence. */
export async function decideTuning(input: { runId?: string; job: string; decision: 'approve' | 'reject' | 'roll_back' }): Promise<string> {
  const data = await callFunction({ action: 'learn_decide', run_id: input.runId, job: input.job, decision: input.decision })
  if (data.ok !== true) throw new Error(said(data, 'The decision could not be saved.'))
  return said(data, 'Saved')
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
