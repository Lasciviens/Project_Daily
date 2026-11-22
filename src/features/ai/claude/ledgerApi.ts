import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { readCallWithText, readCalls, readJobSettings, readUsageRows } from './ledgerRules'
import type { AiCallWithText, AiCallsFilter, AiCallsPage, AiJobSettings, AiSettings, AiUsageRow } from './types'

// The ledger and the owner's AI settings (migration 194). `ai_calls` is written only by the `claude` function
// (service role); the browser reads its own rows. `ai_settings` and `ai_job_settings` are the owner's to write —
// and input to the function, which checks every value again against its own lists and limits.
// Before 194 runs: a read answers empty, a write names the migration. Remove the guard once 194 is live.
// Migration 195 added two settings (`ai_settings.ai_enabled`, `ai_job_settings.thinking`) and `ai_usage`'s times: a read
// of a database that has not run it asks again without them (42703), a write of a default value does the same, and a
// write that needs them names the migration. Remove these fallbacks once 195 is live.

const NOT_MIGRATED_194 = 'AI settings are not available yet — migration 194 (ai_ledger) has not been applied.'
const NOT_MIGRATED_195 = 'This setting is not available yet — migration 195 (ai_controls) has not been applied.'

interface PgError { code?: string; message?: string }
const isMissing = (e: PgError | null): boolean =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || e.code === '42883' || /could not find the (table|function)/i.test(e.message ?? ''))

/** Every column of a call but its text (request, response, thinking): the list never downloads those. */
const CALL_COLUMNS = 'id, created_at, run_id, step, job, caller, mode, provider, model, served_model, effort, outcome, stop_reason, error, request_id, '
  + 'input_tokens, cache_read_tokens, cache_write_5m_tokens, cache_write_1h_tokens, output_tokens, thinking_tokens, long_prompt, cost_usd, duration_ms, '
  + 'instructions_version, tools'

/** 42703 (a SQL column) or PGRST204 (PostgREST's own): the database has no such column yet. */
const isMissingColumn = (e: PgError | null): boolean => !!e && (e.code === '42703' || e.code === 'PGRST204')

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
  if (filter.runId) q = q.eq('run_id', filter.runId)
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
  let { data, error } = await supabase.from('ai_settings').select('monthly_budget_usd, log_text, log_days, ai_enabled').maybeSingle()
  // Before 195 there is no ai_enabled: ask again without it (the switch then reads as on).
  if (isMissingColumn(error)) ({ data, error } = await supabase.from('ai_settings').select('monthly_budget_usd, log_text, log_days').maybeSingle())
  if (error) {
    if (isMissing(error)) return null
    throw error
  }
  return data ?? null
}

export async function saveAiSettings(input: AiSettings): Promise<AiSettings> {
  const user = await requireUser()
  const row = { user_id: user.id, ...input }
  let { error } = await supabase.from('ai_settings').upsert(row, { onConflict: 'user_id' })
  if (isMissingColumn(error)) {
    // The switch is a setting only 195 has: turning AI off cannot be saved without it, and saying so beats a silent no.
    if (!input.ai_enabled) throw new Error(NOT_MIGRATED_195)
    const older: Partial<typeof row> = { ...row }
    delete older.ai_enabled
    ;({ error } = await supabase.from('ai_settings').upsert(older, { onConflict: 'user_id' }))
  }
  if (error) throw isMissing(error) ? new Error(NOT_MIGRATED_194) : error
  return input
}

export async function fetchAiJobSettings(): Promise<AiJobSettings[]> {
  let { data, error } = await supabase.from('ai_job_settings').select('job, enabled, model, effort, max_output_tokens, monthly_budget_usd, thinking')
  if (isMissingColumn(error)) ({ data, error } = await supabase.from('ai_job_settings').select('job, enabled, model, effort, max_output_tokens, monthly_budget_usd'))
  if (error) {
    if (isMissing(error)) return []
    throw error
  }
  return readJobSettings(data)
}

/** One job's row: a null column is "the job's default" (back to default is this same write, with nulls). */
export async function saveAiJobSettings(input: AiJobSettings): Promise<AiJobSettings> {
  const user = await requireUser()
  const row = { user_id: user.id, ...input }
  let { error } = await supabase.from('ai_job_settings').upsert(row, { onConflict: 'user_id,job' })
  if (isMissingColumn(error)) {
    if (input.thinking !== null) throw new Error(NOT_MIGRATED_195)
    const older: Partial<typeof row> = { ...row }
    delete older.thinking
    ;({ error } = await supabase.from('ai_job_settings').upsert(older, { onConflict: 'user_id,job' }))
  }
  if (error) throw isMissing(error) ? new Error(NOT_MIGRATED_194) : error
  return input
}
