// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · the weekly reports' table (migration 196)
//
//  Every call here is made with the service-role client and names the verified user id in the query: the browser can
//  read the finished reports (never `batch_id` or the claim), and writes none. `batch_id` is a link to an outside
//  service: it is only ever read here, from this table, for the user id main.ts verified, and used for one thing (to
//  ask Anthropic about that batch); no browser-writable table can supply it (AGENTS.md, the boxed warning).
//  The claims make "once" true when two checks overlap: a report is worked on by one check at a time, and its push
//  is stamped before it is sent, so a second check finds the stamp and sends nothing.
// ─────────────────────────────────────────────────────────────────────────────

import type { Db } from './ledger.ts'
import type { CallRow } from './ledger.ts'

export type ReportStatus = 'queued' | 'ready' | 'failed'

/** The columns of one report as the checks read them. */
export interface ReportRow {
  id: string
  user_id: string
  week_start: string
  made_by: 'schedule' | 'app'
  status: ReportStatus
  batch_id: string | null
  call_id: string | null
  claimed_at: string | null
  created_at: string
  pushed_at: string | null
  /** A push is owed for this finished report (the real report of an owner's week): sent from 07:00, once. */
  push_due: boolean
  /** The figures the model read (`facts.sent_text`), for the answer's number check; '' when there are none. */
  figures_sent: string
}

const COLUMNS = 'id, user_id, week_start, made_by, status, batch_id, call_id, claimed_at, created_at, pushed_at, push_due, facts'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function reportOf(value: unknown): ReportRow | null {
  if (value === null || typeof value !== 'object') return null
  const r = value as Record<string, unknown>
  const text = (k: string): string | null => (typeof r[k] === 'string' ? (r[k] as string) : null)
  const id = text('id'), userId = text('user_id'), weekStart = text('week_start')
  const madeBy = r.made_by === 'schedule' || r.made_by === 'app' ? r.made_by : null
  const status = r.status === 'queued' || r.status === 'ready' || r.status === 'failed' ? r.status : null
  if (!id || !UUID.test(id) || !userId || !weekStart || !madeBy || !status) return null
  const facts = r.facts !== null && typeof r.facts === 'object' && !Array.isArray(r.facts) ? r.facts as Record<string, unknown> : {}
  const figuresSent = typeof facts.sent_text === 'string' ? facts.sent_text.slice(0, 20_000) : ''
  return { id, user_id: userId, week_start: weekStart, made_by: madeBy, status, batch_id: text('batch_id'), call_id: text('call_id'), claimed_at: text('claimed_at'), created_at: text('created_at') ?? '', pushed_at: text('pushed_at'), push_due: r.push_due === true, figures_sent: figuresSent }
}

/** The report of a week and a maker: the row, null when there is none, undefined when it could not be read. */
export async function findReport(db: Db, userId: string, weekStart: string, madeBy: 'schedule' | 'app'): Promise<ReportRow | null | undefined> {
  try {
    const { data, error } = await db.from('ai_reports').select(COLUMNS).eq('user_id', userId).eq('week_start', weekStart).eq('made_by', madeBy).maybeSingle()
    if (error) return undefined
    return data ? reportOf(data) ?? undefined : null
  } catch {
    return undefined
  }
}

/** Adds a queued report. `exists`: the (user, week, maker) row is already there (the unique key refused it). */
export async function insertReport(db: Db, row: { id: string; user_id: string; week_start: string; made_by: 'schedule' | 'app'; facts: Record<string, unknown>; push_due: boolean }): Promise<'ok' | 'exists' | 'error'> {
  try {
    const { error } = await db.from('ai_reports').insert({ ...row, status: 'queued' })
    if (!error) return 'ok'
    return error.code === '23505' ? 'exists' : 'error'
  } catch {
    return 'error'
  }
}

/** Puts a finished report (ready or failed) back to a fresh queued one: the "make it now" button, for testing. */
export async function requeueReport(db: Db, userId: string, id: string, facts: Record<string, unknown>, nowIso: string, pushDue: boolean): Promise<boolean> {
  try {
    const { data, error } = await db.from('ai_reports').update({
      status: 'queued', failure: null, content: null, facts, batch_id: null, call_id: null, claimed_at: null, pushed_at: null, push_due: pushDue, ready_at: null, created_at: nowIso,
    }).eq('id', id).eq('user_id', userId).neq('status', 'queued').select('id')
    return !error && Array.isArray(data) && data.length === 1
  } catch {
    return false
  }
}

/**
 * Changes a report; with `onlyQueued` only while it is still queued, and with `createdAt` only while it is still the
 * report the caller read: a re-made report gets a new `created_at`, so a check that read the old one (a stale claim, a slow
 * request) can never write into the new one (security review, 22.11.2026). True when a row changed.
 */
export async function patchReport(db: Db, userId: string, id: string, patch: Record<string, unknown>, onlyQueued = false, createdAt: string | null = null): Promise<boolean> {
  try {
    let q = db.from('ai_reports').update(patch).eq('id', id).eq('user_id', userId)
    if (onlyQueued) q = q.eq('status', 'queued')
    if (createdAt !== null) q = q.eq('created_at', createdAt)
    const { data, error } = await q.select('id')
    return !error && Array.isArray(data) && data.length === 1
  } catch {
    return false
  }
}

/** The queued reports, oldest first (at most five). Null when they can't be read. */
export async function queuedReports(db: Db, userId: string): Promise<ReportRow[] | null> {
  try {
    const { data, error } = await db.from('ai_reports').select(COLUMNS).eq('user_id', userId).eq('status', 'queued').order('created_at', { ascending: true }).limit(5)
    if (error || !Array.isArray(data)) return null
    return data.map(reportOf).filter((r): r is ReportRow => r !== null)
  } catch {
    return null
  }
}

/** The finished reports whose push is owed and not yet sent (at most five). Null when they can't be read. */
export async function pendingPushes(db: Db, userId: string): Promise<ReportRow[] | null> {
  try {
    const { data, error } = await db.from('ai_reports').select(COLUMNS).eq('user_id', userId).eq('push_due', true).is('pushed_at', null).in('status', ['ready', 'failed']).order('created_at', { ascending: true }).limit(5)
    if (error || !Array.isArray(data)) return null
    return data.map(reportOf).filter((r): r is ReportRow => r !== null)
  } catch {
    return null
  }
}

/** A check that died holds its claim for ten minutes; then another may take the report. */
export async function releaseStaleClaims(db: Db, userId: string, olderThanIso: string): Promise<void> {
  try {
    await db.from('ai_reports').update({ claimed_at: null }).eq('user_id', userId).eq('status', 'queued').lt('claimed_at', olderThanIso)
  } catch { /* the next check tries again */ }
}

/** Takes the report for this check: true for exactly one of two overlapping checks. */
export async function claimReport(db: Db, userId: string, id: string, createdAt: string, nowIso: string): Promise<boolean> {
  try {
    const { data, error } = await db.from('ai_reports').update({ claimed_at: nowIso }).eq('id', id).eq('user_id', userId).eq('created_at', createdAt).eq('status', 'queued').is('claimed_at', null).select('id')
    return !error && Array.isArray(data) && data.length === 1
  } catch {
    return false
  }
}

/** Gives the claim back (a check that found nothing to do yet). */
export async function releaseClaim(db: Db, userId: string, id: string, createdAt: string): Promise<void> {
  await patchReport(db, userId, id, { claimed_at: null }, true, createdAt)
}

/** Stamps the push before it is sent: true for exactly one check, so a report is announced once at most. */
export async function claimPush(db: Db, userId: string, id: string, createdAt: string, nowIso: string): Promise<boolean> {
  try {
    const { data, error } = await db.from('ai_reports').update({ pushed_at: nowIso }).eq('id', id).eq('user_id', userId).eq('created_at', createdAt).eq('push_due', true).is('pushed_at', null).select('id')
    return !error && Array.isArray(data) && data.length === 1
  } catch {
    return false
  }
}

/**
 * Changes some columns of a ledger row by its id and the verified user (the reserved row of a batch: its text log at
 * submit, its real cost when the batch has ended). A failed write leaves the row at its reserved worst case, which is
 * the safe side. Answers null, or a short word for what went wrong.
 */
export async function patchCall(db: Db, userId: string, id: string, patch: Partial<CallRow>): Promise<string | null> {
  try {
    const { error } = await db.from('ai_calls').update(patch).eq('id', id).eq('user_id', userId)
    return error ? `database error ${error.code ?? 'without a code'}` : null
  } catch {
    return 'the database could not be reached'
  }
}
