// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · learning: the database (migration 204)
//
//  Every read and write of the learning tables, with the SERVICE-ROLE client and the verified user id named in every
//  query (the service client has no row level security). Whatever comes back is input: rows are read field by field and
//  through the code's own lists (a strategy, a state, a number range); a row that does not fit is skipped.
//  A failed read means "nothing learned" (the call goes on as it always did); a failed write is said in the server log
//  and never fails an answer.
// ─────────────────────────────────────────────────────────────────────────────

import type { Db } from './ledger.ts'
import { EXAMPLE_STRATEGIES, PICK_LIMITS, type CaseCandidate, type ExampleStrategy } from './learn-pick.ts'
import { isLearnObj, LEARN_UUID, type LearnRule } from './learn-specs.ts'
import type { CorrectionRow, RuleProposal } from './learn-diff.ts'
import { LESSON_KINDS, LESSON_SOURCES, type LessonKind, type LessonSource, type Split, type Trust } from './learn-text.ts'

const storeStr = (v: unknown, max = 2000): string | null => (typeof v === 'string' && v.length <= max ? v : null)

export interface JobLearning {
  strategy: ExampleStrategy
  k: number
  previousStrategy: ExampleStrategy | null
  previousK: number | null
  tripwireLeft: number
  tripwireBaseline: number | null
  tripwireSaves: number
  tripwireCorrected: number
  /** The notes the last approved win turned on (a rollback retires exactly these). */
  approvedLessons: string[]
}

export const DEFAULT_LEARNING: JobLearning = { strategy: 'mmr', k: 3, previousStrategy: null, previousK: null, tripwireLeft: 0, tripwireBaseline: null, tripwireSaves: 0, tripwireCorrected: 0, approvedLessons: [] }

const strategyOf = (v: unknown): ExampleStrategy | null => (EXAMPLE_STRATEGIES as readonly unknown[]).includes(v) ? v as ExampleStrategy : null
const kOf = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= PICK_LIMITS.kMax ? v : null)
const countOf = (v: unknown, max: number): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? Math.min(v, max) : 0)

/** The job's champion setup (its example strategy and count) and its tripwire. Defaults when there is no row; null when it can't be read. */
export async function readJobLearning(db: Db, userId: string, job: string): Promise<JobLearning | null> {
  try {
    const { data, error } = await db.from('ai_job_learning')
      .select('example_strategy, examples_k, previous_strategy, previous_k, tripwire_left, tripwire_baseline, tripwire_saves, tripwire_corrected, approved_lessons')
      .eq('user_id', userId).eq('job', job).maybeSingle()
    if (error) return null
    if (!isLearnObj(data)) return { ...DEFAULT_LEARNING }
    const baseline = Number(data.tripwire_baseline)
    return {
      strategy: strategyOf(data.example_strategy) ?? DEFAULT_LEARNING.strategy,
      k: kOf(data.examples_k) ?? DEFAULT_LEARNING.k,
      previousStrategy: strategyOf(data.previous_strategy),
      previousK: kOf(data.previous_k),
      tripwireLeft: countOf(data.tripwire_left, 100),
      tripwireBaseline: data.tripwire_baseline !== null && Number.isFinite(baseline) && baseline >= 0 && baseline <= 1 ? baseline : null,
      tripwireSaves: countOf(data.tripwire_saves, 1000),
      tripwireCorrected: countOf(data.tripwire_corrected, 1000),
      approvedLessons: Array.isArray(data.approved_lessons) ? data.approved_lessons.filter((x): x is string => typeof x === 'string' && LEARN_UUID.test(x)).slice(0, 20) : [],
    }
  } catch {
    return null
  }
}

/** Writes the job's row (insert or update), named by the verified user. */
export async function writeJobLearning(db: Db, userId: string, job: string, patch: Record<string, unknown>): Promise<boolean> {
  try {
    const { error } = await db.from('ai_job_learning').upsert({ user_id: userId, job, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id,job' })
    return !error
  } catch {
    return false
  }
}

/** The job's active rules (the owner turned each one on). */
export async function readActiveRules(db: Db, userId: string, job: string): Promise<LearnRule[] | null> {
  try {
    const { data, error } = await db.from('ai_rules').select('id, field, match_key, value').eq('user_id', userId).eq('job', job).eq('state', 'active').limit(1000)
    if (error || !Array.isArray(data)) return null
    return data.flatMap(r => (isLearnObj(r) && typeof r.id === 'string' && LEARN_UUID.test(r.id) && storeStr(r.field, 40) && storeStr(r.match_key, 200) && storeStr(r.value, 200)
      ? [{ id: r.id, field: r.field as string, match_key: r.match_key as string, value: r.value as string }] : []))
  } catch {
    return null
  }
}

/** One more use of each rule (best effort: a count for the Rules view). */
export async function noteRuleUses(db: Db, userId: string, ids: readonly string[], nowIso: string): Promise<void> {
  for (const id of ids.slice(0, 50)) {
    try {
      const { data } = await db.from('ai_rules').select('uses').eq('id', id).eq('user_id', userId).maybeSingle()
      const uses = isLearnObj(data) ? countOf(data.uses, 100_000_000) : 0
      await db.from('ai_rules').update({ uses: uses + 1, last_used_at: nowIso }).eq('id', id).eq('user_id', userId).eq('state', 'active')
    } catch { /* a count only */ }
  }
}

/** The owner-confirmed cases most like a text (the database's full-text search and trigram similarity). */
export async function readCaseCandidates(db: Db, userId: string, job: string, query: string, limit: number = PICK_LIMITS.candidates): Promise<CaseCandidate[] | null> {
  try {
    const { data, error } = await db.rpc('ai_case_candidates', { p_user: userId, p_job: job, p_query: query.slice(0, 2000), p_limit: limit })
    if (error || !Array.isArray(data)) return null
    return data.flatMap(r => (isLearnObj(r) && typeof r.id === 'string' && LEARN_UUID.test(r.id) && typeof r.input_text === 'string' && isLearnObj(r.output)
      ? [{ id: r.id, input_text: r.input_text.slice(0, 2000), output: r.output, source_kind: r.source_kind === 'owner_typed' ? 'owner_typed' as const : 'owner_confirmed' as const, relevance: Number(r.relevance) || 0 }] : []))
  } catch {
    return null
  }
}

export interface LessonRow {
  id: string
  lesson_key: string
  version: number
  kind: LessonKind
  text: string
  source_kind: LessonSource
  trust: Trust
  approved_at: string | null
  created_at: string
}

function lessonOf(r: unknown): LessonRow | null {
  if (!isLearnObj(r) || typeof r.id !== 'string' || !LEARN_UUID.test(r.id) || typeof r.lesson_key !== 'string' || !LEARN_UUID.test(r.lesson_key)) return null
  const kind = (LESSON_KINDS as readonly unknown[]).includes(r.kind) ? r.kind as LessonKind : null
  const source = (LESSON_SOURCES as readonly unknown[]).includes(r.source_kind) ? r.source_kind as LessonSource : null
  const trust = r.trust === 'high' || r.trust === 'medium' || r.trust === 'low' ? r.trust : null
  const text = storeStr(r.text, 300)
  if (!kind || !source || !trust || !text) return null
  return {
    id: r.id, lesson_key: r.lesson_key, version: typeof r.version === 'number' ? r.version : 1, kind, text, source_kind: source, trust,
    approved_at: typeof r.approved_at === 'string' ? r.approved_at : null, created_at: typeof r.created_at === 'string' ? r.created_at : '',
  }
}

const LESSON_COLUMNS = 'id, lesson_key, version, kind, text, source_kind, trust, approved_at, created_at'

/** The scope's lessons in a state (active: what a call gets; pending: what a challenger tries). */
export async function readLessons(db: Db, userId: string, scope: string, state: 'active' | 'pending', limit = 30): Promise<LessonRow[] | null> {
  try {
    const { data, error } = await db.from('ai_lessons').select(LESSON_COLUMNS).eq('user_id', userId).eq('scope', scope).eq('state', state)
      .gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(limit)
    if (error || !Array.isArray(data)) return null
    return data.map(lessonOf).filter((l): l is LessonRow => l !== null)
  } catch {
    return null
  }
}

/** A new lesson (always a new row: versions are append-only). The database refuses an active one that needs the owner. */
export async function insertLesson(db: Db, row: {
  user_id: string; scope: string; kind: LessonKind; text: string; source_kind: LessonSource; source_ref: string | null; source_call_id: string | null;
  trust: Trust; state: 'active' | 'pending'; expires_at: string; example_case_id?: string | null; lesson_key?: string; version?: number; supersedes?: string | null
}): Promise<'ok' | 'error'> {
  try {
    const { error } = await db.from('ai_lessons').insert(row)
    return error ? 'error' : 'ok'
  } catch {
    return 'error'
  }
}

/** Whether the scope already holds a lesson with this text (any state but retired): the same note is never added twice. */
export async function lessonExists(db: Db, userId: string, scope: string, text: string): Promise<boolean | null> {
  try {
    const { data, error } = await db.from('ai_lessons').select('id').eq('user_id', userId).eq('scope', scope).eq('text', text).neq('state', 'retired').limit(1)
    return error || !Array.isArray(data) ? null : data.length > 0
  } catch {
    return null
  }
}

/** The AI's own values of one answer, kept for the owner's save (server-only table). */
export async function saveLearnAnswer(db: Db, row: {
  call_id: string; user_id: string; job: string; ai_values: Record<string, string>; input: Record<string, unknown> | null; input_text: string | null;
  input_trust: 'owner_typed' | 'owner_confirmed'; rules_applied: string[]; knowledge: string[]; setup: string
}): Promise<boolean> {
  try {
    const { error } = await db.from('ai_learn_answers').insert(row)
    return !error
  } catch {
    return false
  }
}

export interface LearnAnswer {
  call_id: string
  job: string
  ai_values: Record<string, string>
  input: Record<string, unknown> | null
  input_text: string | null
  input_trust: 'owner_typed' | 'owner_confirmed'
  setup: string | null
}

/**
 * Claims an answer for the owner's save: once only (a second report of the same call finds nothing), and only the
 * verified user's own. Null when there is none to claim.
 */
export async function claimLearnAnswer(db: Db, userId: string, callId: string, nowIso: string): Promise<LearnAnswer | null | undefined> {
  try {
    const { data, error } = await db.from('ai_learn_answers').update({ reported_at: nowIso })
      .eq('call_id', callId).eq('user_id', userId).is('reported_at', null)
      .select('call_id, job, ai_values, input, input_text, input_trust, setup')
    if (error) return undefined
    const row = Array.isArray(data) ? data[0] : null
    if (!isLearnObj(row) || !isLearnObj(row.ai_values) || typeof row.job !== 'string') return null
    const values: Record<string, string> = {}
    for (const [k, v] of Object.entries(row.ai_values)) if (typeof v === 'string') values[k] = v
    return {
      call_id: callId, job: row.job, ai_values: values, input: isLearnObj(row.input) ? row.input : null,
      input_text: typeof row.input_text === 'string' ? row.input_text : null,
      input_trust: row.input_trust === 'owner_typed' ? 'owner_typed' : 'owner_confirmed',
      setup: typeof row.setup === 'string' ? row.setup : null,
    }
  } catch {
    return undefined
  }
}

/** The corrections of one save, written for the verified user. Answers the first row's id (a rule's source), or null. */
export async function insertCorrections(db: Db, userId: string, job: string, callId: string | null, source: 'save' | 'chat_proposal', rows: readonly CorrectionRow[]): Promise<string | null | undefined> {
  if (!rows.length) return null
  try {
    const { data, error } = await db.from('ai_corrections').insert(rows.map(r => ({ user_id: userId, job, call_id: callId, source, ...r }))).select('id')
    if (error) return undefined
    const first = Array.isArray(data) ? data[0] : null
    return isLearnObj(first) && typeof first.id === 'string' ? first.id : null
  } catch {
    return undefined
  }
}

/** A job's recent corrections that may become rules (newest first). */
export async function readCorrectionHistory(db: Db, userId: string, job: string): Promise<{ field: string; match_key: string | null; saved_value: string | null; kind: string; state: string }[] | null> {
  try {
    const { data, error } = await db.from('ai_corrections').select('field, match_key, saved_value, kind, state')
      .eq('user_id', userId).eq('job', job).eq('kind', 'edited').not('match_key', 'is', null).order('created_at', { ascending: false }).limit(1000)
    if (error || !Array.isArray(data)) return null
    return data.flatMap(r => (isLearnObj(r) && typeof r.field === 'string' && typeof r.kind === 'string'
      ? [{ field: r.field, match_key: typeof r.match_key === 'string' ? r.match_key : null, saved_value: typeof r.saved_value === 'string' ? r.saved_value : null, kind: r.kind, state: typeof r.state === 'string' ? r.state : 'counted' }] : []))
  } catch {
    return null
  }
}

/**
 * A rule proposal. New: written as `proposed`. Already proposed: its value and evidence follow the corrections. Active
 * with another value now: back to `proposed` with the new value (the owner decides again; the database refuses the
 * function turning anything on). Removed by the owner: left alone. Answers whether a row was written.
 */
export async function proposeRule(db: Db, userId: string, job: string, p: RuleProposal, correctionId: string | null): Promise<boolean> {
  try {
    const { data, error } = await db.from('ai_rules').select('id, state, value').eq('user_id', userId).eq('job', job).eq('field', p.field).eq('match_key', p.match_key).maybeSingle()
    if (error) return false
    if (!isLearnObj(data)) {
      const { error: e } = await db.from('ai_rules').insert({ user_id: userId, job, field: p.field, match_key: p.match_key, value: p.value, evidence: p.evidence, source_correction_id: correctionId, state: 'proposed' })
      return !e
    }
    if (data.state === 'removed') return false
    if (data.state === 'active' && data.value === p.value) return false
    const { error: e } = await db.from('ai_rules').update({ value: p.value, evidence: p.evidence, source_correction_id: correctionId, state: 'proposed' })
      .eq('id', data.id as string).eq('user_id', userId)
    return !e
  } catch {
    return false
  }
}

/** A new case (owner-typed or owner-confirmed only: the table's CHECK says it again). */
export async function insertCase(db: Db, row: {
  user_id: string; job: string; call_id: string | null; input_text: string; input: Record<string, unknown> | null; output: Record<string, string>;
  diffs: unknown[]; source_kind: 'owner_typed' | 'owner_confirmed'; split: Split; expires_at: string; id: string
}): Promise<boolean> {
  try {
    const { error } = await db.from('ai_cases').insert(row)
    return !error
  } catch {
    return false
  }
}

/** One page read's outcome for a host (a count; never a target). Best effort. */
export async function noteSource(db: Db, userId: string, job: string, host: string, ok: boolean, reason: string): Promise<void> {
  try {
    await db.rpc('ai_source_note', { p_user: userId, p_job: job, p_host: host, p_ok: ok, p_reason: reason })
  } catch { /* a count only */ }
}

/** The hosts of a job the owner has not switched off, best first (code orders candidates with it; never a fetch target). */
export async function readSourceStats(db: Db, userId: string, job: string): Promise<{ host: string; ok: number; fail: number; lastOk: string | null }[] | null> {
  try {
    const { data, error } = await db.from('ai_source_stats').select('host, ok_count, fail_count, last_ok_at').eq('user_id', userId).eq('job', job).eq('state', 'on').limit(500)
    if (error || !Array.isArray(data)) return null
    return data.flatMap(r => (isLearnObj(r) && typeof r.host === 'string' ? [{ host: r.host, ok: countOf(r.ok_count, 1e8), fail: countOf(r.fail_count, 1e8), lastOk: typeof r.last_ok_at === 'string' ? r.last_ok_at : null }] : []))
  } catch {
    return null
  }
}
