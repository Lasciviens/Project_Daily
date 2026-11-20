import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { readCallWithText, readCalls, readJobSettings, readUsageRows } from './ledgerRules'
import type { AiCallWithText, AiCallsFilter, AiCallsPage, AiJobSettings, AiSettings, AiUsageRow } from './types'

// The ledger and the owner's AI settings (migration 194). `ai_calls` is written only by the `claude` function
// (service role); the browser reads its own rows. `ai_settings` and `ai_job_settings` are the owner's to write —
// and input to the function, which checks every value again against its own lists and limits.
// Before 194 runs: a read answers empty, a write names the migration. Remove the guard once 194 is live.

const NOT_MIGRATED_194 = 'AI settings are not available yet — migration 194 (ai_ledger) has not been applied.'

interface PgError { code?: string; message?: string }
const isMissing = (e: PgError | null): boolean =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || e.code === '42883' || /could not find the (table|function)/i.test(e.message ?? ''))

/** Every column of a call but its text (request, response, thinking): the list never downloads those. */
const CALL_COLUMNS = 'id, created_at, run_id, step, job, caller, mode, provider, model, served_model, effort, outcome, stop_reason, error, request_id, '
  + 'input_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, output_tokens, thinking_tokens, long_prompt, cost_usd, duration_ms, '
  + 'instructions_version, tools'

export const CALLS_PAGE_SIZE = 50

/** `ai_usage`: the caller's calls from `from` up to `to`, summed per Oslo day, job, mode and model. */
export async function fetchAiUsage(from: string, to: string): Promise<AiUsageRow[]> {
  const { data, error } = await supabase.rpc('ai_usage', { p_from: from, p_to: to })
  if (error) {
    if (isMissing(error)) return []
    throw error
  }
  return readUsageRows(data)
}

/** One page of the ledger, newest first, without the text. */
export async function fetchAiCallsPage(filter: AiCallsFilter, page: number): Promise<AiCallsPage> {
  const from = Math.max(0, page) * CALLS_PAGE_SIZE
  let q = supabase.from('ai_calls').select(CALL_COLUMNS, { count: 'exact' })
  if (filter.job) q = q.eq('job', filter.job)
  if (filter.outcome) q = q.eq('outcome', filter.outcome)
  const { data, error, count } = await q.order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, from + CALLS_PAGE_SIZE - 1)
  if (error) {
    if (isMissing(error)) return { calls: [], total: 0 }
    throw error
  }
  const calls = readCalls(data)
  return { calls, total: typeof count === 'number' ? count : from + calls.length }
}

/** One call with its text log; null when the row is gone. */
export async function fetchAiCall(id: string): Promise<AiCallWithText | null> {
  const { data, error } = await supabase.from('ai_calls').select(`${CALL_COLUMNS}, request, response, thinking`).eq('id', id).maybeSingle()
  if (error) {
    if (isMissing(error)) return null
    throw error
  }
  return readCallWithText(data)
}

/** The account's settings row as stored; null with no row yet (the function's defaults apply). */
export async function fetchAiSettings(): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from('ai_settings').select('monthly_budget_usd, log_text, log_days').maybeSingle()
  if (error) {
    if (isMissing(error)) return null
    throw error
  }
  return data ?? null
}

export async function saveAiSettings(input: AiSettings): Promise<AiSettings> {
  const user = await requireUser()
  const { error } = await supabase.from('ai_settings').upsert({ user_id: user.id, ...input }, { onConflict: 'user_id' })
  if (error) throw isMissing(error) ? new Error(NOT_MIGRATED_194) : error
  return input
}

export async function fetchAiJobSettings(): Promise<AiJobSettings[]> {
  const { data, error } = await supabase.from('ai_job_settings').select('job, enabled, model, effort, max_output_tokens, monthly_budget_usd')
  if (error) {
    if (isMissing(error)) return []
    throw error
  }
  return readJobSettings(data)
}

/** One job's row: a null column is "the job's default" (back to default is this same write, with nulls). */
export async function saveAiJobSettings(input: AiJobSettings): Promise<AiJobSettings> {
  const user = await requireUser()
  const { error } = await supabase.from('ai_job_settings').upsert({ user_id: user.id, ...input }, { onConflict: 'user_id,job' })
  if (error) throw isMissing(error) ? new Error(NOT_MIGRATED_194) : error
  return input
}
