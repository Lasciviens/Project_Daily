// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · the ledger
//
//  The function's whole use of the database (migration 194), in four calls:
//    · the owner's settings and the month's usage are READ with the owner's own
//      database client, so row level security decides what comes back;
//    · a call is WRITTEN to `ai_calls` with the service-role client, because
//      the browser has no right to write that table. The user id on the row
//      is the one main.ts verified, never a value from the request.
//
//  Both clients are arguments: main.ts creates them, and a test passes fakes.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import type { CallMode, CallSummary, Caller, Effort, Outcome } from './types.ts'
import { gateOf, ownValue, type Gate } from './guard.ts'

/** A Supabase database client. The type is all this part takes from the library: main.ts creates the clients. */
export type Db = SupabaseClient

/** One row of `ai_calls`: one request to the model, or one request that was stopped before it. */
export interface CallRow {
  id: string
  user_id: string
  /** One answer. Its steps share it (phase 4 has several steps; phase 1 has one). */
  run_id: string
  step: number
  job: string
  caller: Caller
  mode: CallMode
  provider: string
  /** The model asked for; `served_model` is the one that answered. */
  model: string
  served_model: string | null
  effort: Effort | null
  outcome: Outcome
  stop_reason: string | null
  error: string | null
  request_id: string | null
  input_tokens: number
  cache_read_tokens: number
  cache_write_5m_tokens: number
  cache_write_1h_tokens: number
  output_tokens: number
  thinking_tokens: number
  long_prompt: boolean
  cost_usd: number
  duration_ms: number
  instructions_version: string | null
  tools: unknown[]
  /** The text log: what was sent and what came back. Null while the owner keeps the text log off. */
  request: Record<string, unknown> | null
  response: Record<string, unknown> | null
  thinking: string | null
}

/**
 * What the ledger says about the account right now: this month's cost and the recent calls (`ai_gate`).
 * Null when it can't be read: the caller then sends nothing.
 */
export async function readGate(userDb: Db, job: string): Promise<Gate | null> {
  try {
    const { data, error } = await userDb.rpc('ai_gate', { p_job: job })
    return error ? null : gateOf(data)
  } catch {
    return null
  }
}

/**
 * The owner's stored settings for a job: the account's row and the job's row, each null when not saved yet.
 * Null when they can't be read. They are returned as they are: guard.ts checks every value.
 */
export async function readSettingRows(userDb: Db, userId: string, job: string): Promise<{ account: unknown; job: unknown } | null> {
  try {
    const [account, perJob] = await Promise.all([
      userDb.from('ai_settings').select('monthly_budget_usd, log_text').eq('user_id', userId).maybeSingle(),
      userDb.from('ai_job_settings').select('enabled, model, effort, max_output_tokens, monthly_budget_usd')
        .eq('user_id', userId).eq('job', job).maybeSingle(),
    ])
    return account.error || perJob.error ? null : { account: account.data, job: perJob.data }
  } catch {
    return null
  }
}

/** What `ai_reserve` decided. `reserved`: a row with outcome 'pending' now holds the worst case against the budget. */
export type Reservation =
  | { kind: 'reserved'; id: string }
  | { kind: 'busy' }
  | { kind: 'budget'; id: string }

/** The arguments of `ai_reserve`: everything is a value this function worked out, none comes from the request. */
export interface ReserveArgs {
  userId: string
  job: string
  caller: Caller
  mode: CallMode
  provider: string
  model: string
  effort: Effort
  instructionsVersion: string
  worstCostUsd: number
  budgetUsd: number
  jobBudgetUsd: number | null
  perMinute: number
  perDay: number
}

const RESERVE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Asks the database to hold the worst case of this call against the budget, in one step under a lock, with the
 * service-role client. Null when the answer can't be read or isn't one we know: the caller then sends nothing.
 */
export async function reserveCall(adminDb: Db, a: ReserveArgs): Promise<Reservation | null> {
  try {
    const { data, error } = await adminDb.rpc('ai_reserve', {
      p_user: a.userId, p_job: a.job, p_caller: a.caller, p_mode: a.mode, p_provider: a.provider, p_model: a.model,
      p_effort: a.effort, p_instructions_version: a.instructionsVersion, p_worst_cost: a.worstCostUsd,
      p_budget: a.budgetUsd, p_job_budget: a.jobBudgetUsd, p_per_minute: a.perMinute, p_per_day: a.perDay,
    })
    if (error) return null
    const answer = Array.isArray(data) ? data[0] : data
    const reason = ownValue(answer, 'reason')
    const id = ownValue(answer, 'call_id')
    if (reason === 'busy') return { kind: 'busy' }
    if (typeof id !== 'string' || !RESERVE_UUID.test(id)) return null
    if (reason === 'budget') return { kind: 'budget', id }
    return reason === null || reason === undefined ? { kind: 'reserved', id } : null
  } catch {
    return null
  }
}

/**
 * Puts the real numbers on a reserved row, by its id and the verified user. If this fails the row keeps its worst-case
 * cost, which is the safe side. Answers null, or a short word for what went wrong.
 */
export async function finishCall(adminDb: Db, row: CallRow): Promise<string | null> {
  try {
    const { id, user_id: userId, ...values } = row
    const { error } = await adminDb.from('ai_calls').update(values).eq('id', id).eq('user_id', userId)
    return error ? `database error ${error.code ?? 'without a code'}` : null
  } catch {
    return 'the database could not be reached'
  }
}

/** Writes one call. Answers null, or a short word for what went wrong: never the row, never its text. */
export async function writeCall(adminDb: Db, row: CallRow): Promise<string | null> {
  try {
    const { error } = await adminDb.from('ai_calls').insert({ ...row })
    return error ? `database error ${error.code ?? 'without a code'}` : null
  } catch {
    return 'the database could not be reached'
  }
}

/** The numbers of a row, as every answer carries them. */
export function summaryOf(row: CallRow): CallSummary {
  return {
    id: row.id,
    run_id: row.run_id,
    job: row.job,
    model: row.model,
    outcome: row.outcome,
    input_tokens: row.input_tokens,
    cache_read_tokens: row.cache_read_tokens,
    cache_write_tokens: row.cache_write_5m_tokens + row.cache_write_1h_tokens,
    output_tokens: row.output_tokens,
    thinking_tokens: row.thinking_tokens,
    cost_usd: row.cost_usd,
    duration_ms: row.duration_ms,
  }
}
