// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · the suggestions' tables (migration 199)
//
//  Every call here is made with the service-role client and names the verified user id. An idea is written only through
//  `ai_suggestion_add` (dedupe, the dismissed-never-returns rule and the caps are in the database too); the counting is
//  `ai_suggest_patterns` (shapes, counts and costs of the account's own ledger, never a value). The weekly batch's own
//  bookkeeping (`ai_suggest_runs`) follows the weekly report's (report-store.ts): `batch_id` is read only here, from this
//  table, and used for one thing — asking Anthropic about that batch.
//  A failure here is returned as a word or null and never thrown: the suggestions are a watcher and never stop an answer.
// ─────────────────────────────────────────────────────────────────────────────

import type { Db } from './ledger.ts'
import { SUGGEST_KINDS, SUGGEST_LIMITS, readPatterns, type CheckedIdea, type Pattern } from './suggest-rules.ts'

export type AddResult = 'added' | 'seen' | 'dismissed' | 'full' | 'limit' | 'invalid' | 'error'
const ADD_RESULTS: readonly string[] = ['added', 'seen', 'dismissed', 'full', 'limit', 'invalid']
const SUGGEST_ROW_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Writes one idea (or counts one more sighting of it). The database refuses a dismissed idea, a full table and a flood. */
export async function addSuggestion(
  db: Db, userId: string, idea: CheckedIdea, key: string, source: 'answer' | 'weekly',
  saving: { times: number; tokens: number; cost: number }, callId: string | null,
): Promise<AddResult> {
  try {
    const { data, error } = await db.rpc('ai_suggestion_add', {
      p_user_id: userId, p_kind: idea.kind, p_title: idea.title, p_why: idea.why, p_source: source, p_key: key,
      p_times: Math.max(1, Math.floor(saving.times)), p_tokens: Math.max(0, Math.floor(saving.tokens)), p_cost: saving.cost,
      p_call: callId && SUGGEST_ROW_UUID.test(callId) ? callId : null,
    })
    if (error) return 'error'
    return typeof data === 'string' && ADD_RESULTS.includes(data) ? data as AddResult : 'error'
  } catch {
    return 'error'
  }
}

/** The counted patterns of the account's last 30 days, checked again. Null when they could not be counted. */
export async function countPatterns(db: Db, userId: string): Promise<Pattern[] | null> {
  try {
    const { data, error } = await db.rpc('ai_suggest_patterns', { p_user_id: userId, p_days: SUGGEST_LIMITS.days, p_min_times: SUGGEST_LIMITS.minTimes })
    if (error) return null
    return readPatterns(data)
  } catch {
    return null
  }
}

/** The ideas that exist, by title, kind and state only (the weekly job is told not to repeat them). Null when they could not be read. */
export async function readEarlierIdeas(db: Db, userId: string): Promise<{ title: string; state: string; kind: string }[] | null> {
  try {
    const { data, error } = await db.from('ai_suggestions').select('title, state, kind').eq('user_id', userId).order('created_at', { ascending: false }).limit(SUGGEST_LIMITS.existingSent)
    if (error || !Array.isArray(data)) return null
    return data.flatMap(r => {
      const row = r as Record<string, unknown>
      return typeof row.title === 'string' && typeof row.state === 'string' && SUGGEST_KINDS.some(k => k === row.kind) ? [{ title: row.title, state: row.state, kind: String(row.kind) }] : []
    })
  } catch {
    return null
  }
}

// ── The weekly batch's bookkeeping ──────────────────────────────────────────

export type RunStatus = 'queued' | 'done' | 'failed'

export interface RunRow {
  id: string
  user_id: string
  week_start: string
  made_by: 'schedule' | 'app'
  status: RunStatus
  batch_id: string | null
  call_id: string | null
  claimed_at: string | null
  created_at: string
  /** What the weekly answer is read against: `{ patterns: Pattern[] }`, as the function checked them when it queued the run. */
  facts: unknown
}

const RUN_COLUMNS = 'id, user_id, week_start, made_by, status, batch_id, call_id, claimed_at, created_at, facts'

function runOf(value: unknown): RunRow | null {
  if (value === null || typeof value !== 'object') return null
  const r = value as Record<string, unknown>
  const text = (k: string): string | null => (typeof r[k] === 'string' ? (r[k] as string) : null)
  const id = text('id'), userId = text('user_id'), weekStart = text('week_start')
  const madeBy = r.made_by === 'schedule' || r.made_by === 'app' ? r.made_by : null
  const status = r.status === 'queued' || r.status === 'done' || r.status === 'failed' ? r.status : null
  if (!id || !SUGGEST_ROW_UUID.test(id) || !userId || !weekStart || !madeBy || !status) return null
  return { id, user_id: userId, week_start: weekStart, made_by: madeBy, status, batch_id: text('batch_id'), call_id: text('call_id'), claimed_at: text('claimed_at'), created_at: text('created_at') ?? '', facts: r.facts }
}

/** The run of a week and a maker: the row, null when there is none, undefined when it could not be read. */
export async function findRun(db: Db, userId: string, weekStart: string, madeBy: 'schedule' | 'app'): Promise<RunRow | null | undefined> {
  try {
    const { data, error } = await db.from('ai_suggest_runs').select(RUN_COLUMNS).eq('user_id', userId).eq('week_start', weekStart).eq('made_by', madeBy).maybeSingle()
    if (error) return undefined
    return data ? runOf(data) ?? undefined : null
  } catch {
    return undefined
  }
}

/** Adds a queued run. `exists`: the (user, week, maker) row is already there. */
export async function insertRun(db: Db, row: { id: string; user_id: string; week_start: string; made_by: 'schedule' | 'app'; sent_text: string; patterns: number; facts: Record<string, unknown> }): Promise<'ok' | 'exists' | 'error'> {
  try {
    const { error } = await db.from('ai_suggest_runs').insert({ ...row, status: 'queued' })
    if (!error) return 'ok'
    return error.code === '23505' ? 'exists' : 'error'
  } catch {
    return 'error'
  }
}

/** Puts a finished run back to a fresh queued one (the button asking again). True when a row changed. */
export async function requeueRun(db: Db, userId: string, id: string, sentText: string, patterns: number, facts: Record<string, unknown>, nowIso: string): Promise<boolean> {
  try {
    const { data, error } = await db.from('ai_suggest_runs').update({
      status: 'queued', failure: null, added: 0, sent_text: sentText, patterns, facts, batch_id: null, call_id: null, claimed_at: null, finished_at: null, created_at: nowIso,
    }).eq('id', id).eq('user_id', userId).neq('status', 'queued').select('id')
    return !error && Array.isArray(data) && data.length === 1
  } catch {
    return false
  }
}

/** Changes a run; with `onlyQueued` only while it is queued, with `createdAt` only while it is the run the caller read. True when a row changed. */
export async function patchRun(db: Db, userId: string, id: string, patch: Record<string, unknown>, onlyQueued = false, createdAt: string | null = null): Promise<boolean> {
  try {
    let q = db.from('ai_suggest_runs').update(patch).eq('id', id).eq('user_id', userId)
    if (onlyQueued) q = q.eq('status', 'queued')
    if (createdAt !== null) q = q.eq('created_at', createdAt)
    const { data, error } = await q.select('id')
    return !error && Array.isArray(data) && data.length === 1
  } catch {
    return false
  }
}

/** The queued runs, oldest first (at most three). Null when they can't be read. */
export async function queuedRuns(db: Db, userId: string): Promise<RunRow[] | null> {
  try {
    const { data, error } = await db.from('ai_suggest_runs').select(RUN_COLUMNS).eq('user_id', userId).eq('status', 'queued').order('created_at', { ascending: true }).limit(3)
    if (error || !Array.isArray(data)) return null
    return data.map(runOf).filter((r): r is RunRow => r !== null)
  } catch {
    return null
  }
}

/** A check that died holds its claim for ten minutes; then another may take the run. */
export async function releaseStaleRunClaims(db: Db, userId: string, olderThanIso: string): Promise<void> {
  try {
    await db.from('ai_suggest_runs').update({ claimed_at: null }).eq('user_id', userId).eq('status', 'queued').lt('claimed_at', olderThanIso)
  } catch { /* the next check tries again */ }
}

/** Takes the run for this check: true for exactly one of two overlapping checks. */
export async function claimRun(db: Db, userId: string, id: string, createdAt: string, nowIso: string): Promise<boolean> {
  try {
    const { data, error } = await db.from('ai_suggest_runs').update({ claimed_at: nowIso }).eq('id', id).eq('user_id', userId).eq('created_at', createdAt).eq('status', 'queued').is('claimed_at', null).select('id')
    return !error && Array.isArray(data) && data.length === 1
  } catch {
    return false
  }
}
