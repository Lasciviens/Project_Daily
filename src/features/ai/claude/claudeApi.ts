import { supabase } from '../../../integrations/supabase/client'
import { parseFunctionErrorBody } from '../../../shared/utils/functionError'
import { readDescribe, readDiagnoseAnswer, readRunAnswer } from './ledgerRules'
import type { CallSummary, ClaudeReason, Describe, DiagnoseStep } from './types'

// The app's one door to the `claude` edge function (supabase/claude-src): it holds ANTHROPIC_API_KEY, checks
// who asks, the owner's settings and the budget, calls the model and writes the ledger. The browser only names
// a job and gives its input; the function's answer is input here all the same (ledgerRules reads it).

/** A run that gave no result: the function's reason and its own sentence (shown as it is). */
export class ClaudeJobError extends Error {
  readonly reason: ClaudeReason
  readonly call?: CallSummary
  constructor(reason: ClaudeReason, message: string, call?: CallSummary) {
    super(message)
    this.name = 'ClaudeJobError'
    this.reason = reason
    this.call = call
  }
}

/** A refused request (401/403/400) or no answer at all, in plain words. */
async function notAnswered(error: unknown): Promise<ClaudeJobError> {
  const status = (error as { context?: { status?: number } })?.context?.status
  if (status === 401 || status === 403) return new ClaudeJobError('error', 'Session error — refresh the page and sign in again.')
  const body = await parseFunctionErrorBody(error)
  const said = typeof body?.message === 'string' ? body.message.trim().slice(0, 300) : ''
  return new ClaudeJobError('error', said || 'The AI function didn\'t answer — try again in a moment.')
}

/**
 * Runs one job (`item_fill`, …) and hands back its result with the call's own numbers. `ok: false` throws a
 * ClaudeJobError with the reason (`off`, `budget`, `busy`, `not_configured`, `refused`, …) and the server's
 * sentence. The result is the caller's to check (✨ runs `cleanItemFill` on it again).
 */
export async function runClaudeJob<T>(job: string, input: Record<string, unknown>): Promise<{ result: T; call: CallSummary | undefined; source: 'page' | undefined }> {
  const { data, error } = await supabase.functions.invoke('claude', { body: { action: 'run', job, input } })
  if (error) throw await notAnswered(error)
  const answer = readRunAnswer(data)
  if (!answer.ok) throw new ClaudeJobError(answer.reason, answer.message, answer.call)
  return { result: answer.result as T, call: answer.call, source: answer.source }
}

/** What the function says about itself: whether the key is set, its models, limits, prices, jobs and parts. */
export async function describeClaude(): Promise<Describe> {
  const { data, error } = await supabase.functions.invoke('claude', { body: { action: 'describe' } })
  if (error) throw await notAnswered(error)
  if (data?.ok !== true || !data.about || typeof data.about !== 'object') throw new Error('The AI function gave no description of itself.')
  return readDescribe(data.about)
}

/**
 * Diagnose: the function's four checks of ✨'s road to Anthropic (the network and key, the request's shape, a tiny
 * answer, ✨'s own request with a 90 s limit). It can take up to two minutes. A Diagnose that did not run (one was
 * run in the last minute, the usage could not be read) throws a ClaudeJobError with the function's sentence.
 */
export async function diagnoseClaude(): Promise<DiagnoseStep[]> {
  const { data, error } = await supabase.functions.invoke('claude', { body: { action: 'diagnose' } })
  if (error) throw await notAnswered(error)
  const answer = readDiagnoseAnswer(data)
  if (!answer.ok) throw new ClaudeJobError(answer.reason, answer.message)
  return answer.steps
}
