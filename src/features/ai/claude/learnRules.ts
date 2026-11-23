// What the AI learned, as the app reads it (migration 204; docs/features/ai.md "Learning"). Every row is read field by
// field where it enters: the tables are written by the `claude` function (a model's text among them), so a row that does
// not fit is dropped, never repaired. The browser may change one column of a row, `state`; everything else is the
// function's. Nothing here builds a link from a row's text.

export const LEARN_VIEWS = ['corrections', 'rules', 'cases', 'lessons', 'tuning', 'sources'] as const
export type LearnView = typeof LEARN_VIEWS[number]
export const LEARN_VIEW_LABEL: Record<LearnView, string> = { corrections: 'Fixes', rules: 'Rules', cases: 'Cases', lessons: 'Notes', tuning: 'Tuning', sources: 'Sites' }
/** One line under each view's switcher: what it is, for an owner learning the words. */
export const LEARN_VIEW_MEANING: Record<LearnView, string> = {
  corrections: 'Fixes: each AI-filled field you saved — kept, changed or left out. Ignore one to stop it counting toward a rule.',
  rules: 'Rules: the same fix made three times becomes a rule that code applies with no AI. It waits for your tap.',
  cases: 'Cases: answers you saved, sent with similar calls as examples (as data, never as instructions). Each expires after a year.',
  lessons: 'Notes: short facts and preferences. Only a plain fact in your own typed words turns on by itself; everything else waits for you.',
  tuning: 'Tuning: once a week your saved cases are sent again with other setups and scored by code. A clear winner waits for your Approve. With only a few cases nothing can win yet — that can take weeks.',
  sources: 'Sites: how reading a page went per site. Used only to put sites that read well first; never a link the app follows by itself.',
}

/** Where the learning comes from today (shown in the empty states, so they say only what is true). */
export const LEARN_WIRED = 'Shop → Tidy up, Food → Describe it (words or a photo), a preset\'s Suggest options, ✨ on the item screen, a recipe pasted or read from a link, a recipe\'s Estimate, a Dev Request\'s Tidy up, and Ask AI\'s Confirm and Cancel. Not yet: a receipt read and the Quick list.'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
// Control characters and the zero-width and text-direction ones draw nothing and can hide a word: a text holding one is dropped.
// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const HIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max && !HIDDEN.test(v) ? v : null)
const when = (v: unknown): string => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : '')
const whole = (v: unknown, max: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(Math.floor(v), max)) : 0)
const pick = <T extends string>(list: readonly T[], v: unknown): T | null => (list as readonly unknown[]).includes(v) ? v as T : null

/** A field in words: "items.0.category_id" → "line 1 · category id". */
export function fieldWords(field: string): string {
  const row = /^items\.(\d+)\.(.+)$/.exec(field)
  return row ? `line ${Number(row[1]) + 1} · ${row[2].replace(/_/g, ' ')}` : field.replace(/_/g, ' ')
}

/** A job's name in words ("shop_tidy" → "shop tidy"). */
export const jobWords = (job: string): string => job.replace(/_/g, ' ')

// ── Corrections ──
export const CORRECTION_KINDS = ['edited', 'unticked', 'kept', 'dismissed'] as const
export type CorrectionKind = typeof CORRECTION_KINDS[number]
export const CORRECTION_KIND_LABEL: Record<CorrectionKind, string> = { edited: 'Changed', unticked: 'Left out', kept: 'Kept', dismissed: 'Dismissed' }
export const CORRECTION_COLUMNS = 'id, job, call_id, field, match_key, ai_value, saved_value, kind, source, state, created_at'
export interface AiCorrection { id: string; job: string; call_id: string | null; field: string; match_key: string | null; ai_value: string | null; saved_value: string | null; kind: CorrectionKind; source: string; state: 'counted' | 'ignored'; created_at: string }
export function readCorrection(raw: unknown): AiCorrection | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !UUID.test(raw.id)) return null
  const kind = pick(CORRECTION_KINDS, raw.kind)
  const job = text(raw.job, 40)
  const field = text(raw.field, 90)
  if (!kind || !job || !field) return null
  return {
    id: raw.id, job, field, kind, call_id: typeof raw.call_id === 'string' && UUID.test(raw.call_id) ? raw.call_id : null,
    match_key: text(raw.match_key, 200), ai_value: text(raw.ai_value, 2000), saved_value: text(raw.saved_value, 2000),
    source: text(raw.source, 20) ?? 'save', state: raw.state === 'ignored' ? 'ignored' : 'counted', created_at: when(raw.created_at),
  }
}

// ── Rules ──
export const RULE_STATES = ['proposed', 'active', 'removed'] as const
export type RuleState = typeof RULE_STATES[number]
export const RULE_STATE_LABEL: Record<RuleState, string> = { proposed: 'Waiting', active: 'On', removed: 'Off' }
export const RULE_COLUMNS = 'id, job, field, match_key, value, evidence, source_correction_id, state, uses, last_used_at, approved_at, created_at'
export interface AiRule { id: string; job: string; field: string; match_key: string; value: string; evidence: number; source_correction_id: string | null; state: RuleState; uses: number; last_used_at: string; approved_at: string; created_at: string }
export function readRule(raw: unknown): AiRule | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !UUID.test(raw.id)) return null
  const state = pick(RULE_STATES, raw.state)
  const job = text(raw.job, 40), field = text(raw.field, 40), key = text(raw.match_key, 200), value = text(raw.value, 200)
  if (!state || !job || !field || !key || value === null) return null
  return {
    id: raw.id, job, field, match_key: key, value, state, evidence: Math.max(1, whole(raw.evidence, 100_000)),
    source_correction_id: typeof raw.source_correction_id === 'string' && UUID.test(raw.source_correction_id) ? raw.source_correction_id : null,
    uses: whole(raw.uses, 1e8), last_used_at: when(raw.last_used_at), approved_at: when(raw.approved_at), created_at: when(raw.created_at),
  }
}

// ── Cases ──
export const CASE_STATES = ['active', 'quarantined', 'removed'] as const
export type CaseState = typeof CASE_STATES[number]
export const CASE_STATE_LABEL: Record<CaseState, string> = { active: 'In use', quarantined: 'Set aside', removed: 'Off' }
// Never `input` (the function's own copy for the weekly replay: the browser's grant leaves it out).
export const CASE_COLUMNS = 'id, job, call_id, input_text, output, diffs, source_kind, split, state, expires_at, created_at'
export interface AiCase { id: string; job: string; call_id: string | null; input_text: string; output: [string, string][]; changed: number; source_kind: 'owner_typed' | 'owner_confirmed'; split: 'train' | 'test' | 'sealed'; state: CaseState; expires_at: string; created_at: string }
export function readCase(raw: unknown): AiCase | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !UUID.test(raw.id)) return null
  const state = pick(CASE_STATES, raw.state)
  const job = text(raw.job, 40), input = text(raw.input_text, 2000)
  const split = pick(['train', 'test', 'sealed'] as const, raw.split)
  const source = pick(['owner_typed', 'owner_confirmed'] as const, raw.source_kind)
  if (!state || !job || !input || !split || !source || !isObj(raw.output)) return null
  const output = Object.entries(raw.output).flatMap(([k, v]) => (text(k, 90) && typeof v === 'string' && text(v, 2000) !== null ? [[k, v] as [string, string]] : [])).slice(0, 60)
  return {
    id: raw.id, job, input_text: input, output, state, split, source_kind: source, changed: Array.isArray(raw.diffs) ? Math.min(raw.diffs.length, 999) : 0,
    call_id: typeof raw.call_id === 'string' && UUID.test(raw.call_id) ? raw.call_id : null, expires_at: when(raw.expires_at), created_at: when(raw.created_at),
  }
}

// ── Lessons ──
export const LESSON_STATES = ['pending', 'active', 'retired'] as const
export type LessonState = typeof LESSON_STATES[number]
export const LESSON_STATE_LABEL: Record<LessonState, string> = { pending: 'Waiting', active: 'On', retired: 'Off' }
export const LESSON_KINDS = ['fact', 'preference', 'instruction'] as const
export type LessonKind = typeof LESSON_KINDS[number]
export const LESSON_SOURCES = ['owner_typed', 'owner_data', 'weekly_batch', 'chat_tool', 'repo_doc', 'web'] as const
export type LessonSource = typeof LESSON_SOURCES[number]
/** What can be set aside together: a note's source, or a case's (typed by you, or read text you only confirmed by saving). */
export const SET_ASIDE_SOURCES = ['weekly_batch', 'chat_tool', 'owner_typed', 'owner_confirmed', 'owner_data', 'repo_doc', 'web', 'save'] as const
export type SetAsideSource = typeof SET_ASIDE_SOURCES[number]
export const SET_ASIDE_LABEL: Record<SetAsideSource, string> = {
  weekly_batch: 'notes from the weekly self-test', chat_tool: 'notes from Ask AI', owner_typed: 'your typed notes and cases', owner_confirmed: 'cases whose input was read text',
  owner_data: 'notes from your data', repo_doc: 'notes from the app\'s docs', web: 'notes from a web page', save: 'rules from your fixes',
}

export const LESSON_SOURCE_LABEL: Record<LessonSource, string> = {
  owner_typed: 'your own words', owner_data: 'your data', weekly_batch: 'the weekly self-test', chat_tool: 'Ask AI', repo_doc: 'the app\'s docs', web: 'a web page',
}
export const LESSON_COLUMNS = 'id, scope, kind, text, example_case_id, source_kind, source_ref, source_call_id, trust, needs_owner, state, lesson_key, version, supersedes, approved_at, expires_at, created_at'
export interface AiLesson { id: string; scope: string; kind: LessonKind; text: string; source_kind: LessonSource; source_ref: string | null; trust: 'high' | 'medium' | 'low'; needs_owner: boolean; state: LessonState; lesson_key: string; version: number; approved_at: string; expires_at: string; created_at: string }
export function readLesson(raw: unknown): AiLesson | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !UUID.test(raw.id) || typeof raw.lesson_key !== 'string' || !UUID.test(raw.lesson_key)) return null
  const state = pick(LESSON_STATES, raw.state), kind = pick(LESSON_KINDS, raw.kind), source = pick(LESSON_SOURCES, raw.source_kind)
  const trust = pick(['high', 'medium', 'low'] as const, raw.trust)
  const scope = text(raw.scope, 40), body = text(raw.text, 300)
  if (!state || !kind || !source || !trust || !scope || !body || /[<>[\]`]/.test(body)) return null
  return {
    id: raw.id, scope, kind, text: body, source_kind: source, source_ref: text(raw.source_ref, 200), trust, state, lesson_key: raw.lesson_key,
    // The database works it out; read again here so a row that says otherwise still waits for the owner.
    needs_owner: raw.needs_owner !== false || kind !== 'fact' || trust !== 'high',
    version: Math.max(1, whole(raw.version, 10_000)), approved_at: when(raw.approved_at), expires_at: when(raw.expires_at), created_at: when(raw.created_at),
  }
}
/** The newest version of each lesson, with how many versions it has (the list shows one card per lesson). */
export function latestLessons(rows: readonly AiLesson[]): { lesson: AiLesson; versions: number }[] {
  const by = new Map<string, AiLesson[]>()
  for (const l of rows) by.set(l.lesson_key, [...(by.get(l.lesson_key) ?? []), l])
  return [...by.values()].map(list => {
    const sorted = [...list].sort((a, b) => b.version - a.version)
    return { lesson: sorted.find(l => l.state === 'active') ?? sorted[0], versions: list.length }
  })
}

// ── Tuning ──
export const EVAL_COLUMNS = 'id, week_start, made_by, status, call_id, requests, jobs, result, decision_state, batch_deleted_at, batch_delete_note, failure, created_at, finished_at'
export interface EvalSetup { setup: string; mean: number; perField: [string, number][]; tokens: number; answered: number; failed: number; reasons: string[]; wins: boolean }
export interface EvalJob { job: string; decision: 'none' | 'proposed' | 'approved' | 'rejected'; champion: EvalSetup | null; challengers: EvalSetup[]; winner: { setup: string; strategy: string; k: number; lessons: string[]; lessonIds: string[] } | null; notesAdded: number; skipped: string | null; cases: number }
export interface EvalRun { id: string; week_start: string; made_by: 'schedule' | 'app'; status: 'queued' | 'done' | 'failed' | 'skipped'; call_id: string | null; requests: number; jobs: EvalJob[]; decision_state: string; batch_deleted_at: string; batch_delete_note: string | null; failure: string | null; cost_usd: number; created_at: string; finished_at: string }

function setupOf(raw: unknown, reasons: string[] = [], wins = false): EvalSetup | null {
  if (!isObj(raw) || typeof raw.setup !== 'string' || !/^[a-z_]{1,40}$/.test(raw.setup) || !isObj(raw.perCase)) return null
  const cases = Object.values(raw.perCase).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const perField = isObj(raw.perField) ? Object.entries(raw.perField).flatMap(([k, v]) => (text(k, 90) && typeof v === 'number' && Number.isFinite(v) ? [[k, v] as [string, number]] : [])).slice(0, 40) : []
  return { setup: raw.setup, mean: cases.length ? cases.reduce((s, v) => s + v, 0) / cases.length : 0, perField, tokens: whole(raw.tokensPerRequest, 1e7), answered: whole(raw.answered, 1e5), failed: whole(raw.failed, 1e5), reasons, wins }
}

function evalJobOf(raw: unknown, summary: Record<string, unknown> | undefined): EvalJob | null {
  if (!isObj(raw) || typeof raw.job !== 'string' || !/^[a-z_]{1,40}$/.test(raw.job)) return null
  const decision = pick(['none', 'proposed', 'approved', 'rejected'] as const, raw.decision) ?? 'none'
  const challengers = (Array.isArray(raw.challengers) ? raw.challengers : []).flatMap(c => {
    const d = isObj(c) && isObj(c.decision) ? c.decision : {}
    const reasons = Array.isArray(d.reasons) ? d.reasons.flatMap(r => (text(r, 300) ? [r as string] : [])).slice(0, 6) : []
    const s = setupOf(c, reasons, d.wins === true)
    return s ? [s] : []
  })
  const w = isObj(raw.winner) ? raw.winner : null
  const lessons = w && Array.isArray(w.lessons) ? w.lessons.flatMap(l => (text(l, 300) && !/[<>[\]`]/.test(l as string) ? [l as string] : [])).slice(0, 8) : []
  const lessonIds = w && Array.isArray(w.lesson_ids) ? w.lesson_ids.filter((x): x is string => typeof x === 'string' && UUID.test(x)).slice(0, 8) : []
  return {
    job: raw.job, decision, champion: setupOf(raw.champion), challengers,
    winner: w && typeof w.setup === 'string' && /^[a-z_]{1,40}$/.test(w.setup) ? { setup: w.setup, strategy: text(w.strategy, 10) ?? '', k: whole(w.k, 5), lessons, lessonIds } : null,
    notesAdded: whole(raw.notes_added, 100), skipped: text(summary?.skipped ?? summary?.replay, 200), cases: whole(summary?.test_cases, 1e5),
  }
}

export function readEvalRun(raw: unknown): EvalRun | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !UUID.test(raw.id)) return null
  const status = pick(['queued', 'done', 'failed', 'skipped'] as const, raw.status)
  if (!status || typeof raw.week_start !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.week_start)) return null
  const summaries = new Map((Array.isArray(raw.jobs) ? raw.jobs : []).filter(isObj).filter(j => typeof j.job === 'string').map(j => [j.job as string, j]))
  const result = isObj(raw.result) ? raw.result : {}
  const scored = (Array.isArray(result.jobs) ? result.jobs : []).flatMap(j => { const e = evalJobOf(j, isObj(j) ? summaries.get(String(j.job)) : undefined); return e ? [e] : [] })
  // A job that was skipped (no new corrections, too few cases) is listed with its reason.
  for (const [job, s] of summaries) {
    if (!scored.some(e => e.job === job) && /^[a-z_]{1,40}$/.test(job)) scored.push({ job, decision: 'none', champion: null, challengers: [], winner: null, notesAdded: 0, skipped: text(s.skipped ?? s.replay, 200), cases: whole(s.test_cases, 1e5) })
  }
  const cost = typeof result.cost_usd === 'number' && Number.isFinite(result.cost_usd) ? Math.max(0, result.cost_usd) : 0
  return {
    id: raw.id, week_start: raw.week_start, made_by: raw.made_by === 'schedule' ? 'schedule' : 'app', status, call_id: typeof raw.call_id === 'string' && UUID.test(raw.call_id) ? raw.call_id : null,
    requests: whole(raw.requests, 1e5), jobs: scored, decision_state: text(raw.decision_state, 20) ?? 'none', batch_deleted_at: when(raw.batch_deleted_at),
    batch_delete_note: text(raw.batch_delete_note, 300), failure: text(raw.failure, 300), cost_usd: cost, created_at: when(raw.created_at), finished_at: when(raw.finished_at),
  }
}

export const JOB_LEARNING_COLUMNS = 'job, example_strategy, examples_k, previous_strategy, previous_k, changed_at, tripwire_left, tripwire_baseline, tripwire_saves, tripwire_corrected, last_event, last_event_at'
export interface JobLearning { job: string; strategy: 'none' | 'knn' | 'mmr'; k: number; previous: string | null; changed_at: string; tripwire_left: number; tripwire_saves: number; tripwire_corrected: number; last_event: string | null; last_event_at: string }
export function readJobLearning(raw: unknown): JobLearning | null {
  if (!isObj(raw) || typeof raw.job !== 'string' || !/^[a-z_]{1,40}$/.test(raw.job)) return null
  const strategy = pick(['none', 'knn', 'mmr'] as const, raw.example_strategy) ?? 'mmr'
  const prev = pick(['none', 'knn', 'mmr'] as const, raw.previous_strategy)
  return {
    job: raw.job, strategy, k: whole(raw.examples_k, 5), previous: prev ? `${prev} · ${whole(raw.previous_k, 5)}` : null, changed_at: when(raw.changed_at),
    tripwire_left: whole(raw.tripwire_left, 100), tripwire_saves: whole(raw.tripwire_saves, 1000), tripwire_corrected: whole(raw.tripwire_corrected, 1000),
    last_event: text(raw.last_event, 300), last_event_at: when(raw.last_event_at),
  }
}
export const STRATEGY_LABEL: Record<string, string> = { none: 'no examples', knn: 'the most similar', mmr: 'similar but varied' }
export const SETUP_LABEL = (setup: string): string => (setup === 'champion' ? 'Today\'s setup' : setup === 'with_new_notes' ? 'With the waiting notes' : setup.startsWith('examples_') ? `Examples: ${STRATEGY_LABEL[setup.slice(9)] ?? setup.slice(9)}` : setup)

// ── Sources ──
export const SOURCE_COLUMNS = 'id, job, host, ok_count, fail_count, last_ok_at, last_fail_at, last_reason, state, updated_at'
export interface AiSource { id: string; job: string; host: string; ok: number; fail: number; last_ok_at: string; last_fail_at: string; last_reason: string | null; state: 'on' | 'ignored'; updated_at: string }
const HOST = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/
export function readSource(raw: unknown): AiSource | null {
  if (!isObj(raw) || typeof raw.id !== 'string' || !UUID.test(raw.id) || typeof raw.host !== 'string' || raw.host.length > 253 || !HOST.test(raw.host)) return null
  const job = text(raw.job, 40)
  if (!job) return null
  return {
    id: raw.id, job, host: raw.host, ok: whole(raw.ok_count, 1e8), fail: whole(raw.fail_count, 1e8), last_ok_at: when(raw.last_ok_at), last_fail_at: when(raw.last_fail_at),
    last_reason: text(raw.last_reason, 40), state: raw.state === 'ignored' ? 'ignored' : 'on', updated_at: when(raw.updated_at),
  }
}

/** What waits for the owner in Learned: rules to turn on, notes to decide, and self-test winners to approve (the badges). */
export function learnWaiting(rules: readonly AiRule[], lessons: readonly AiLesson[], runs: readonly EvalRun[]): { rules: number; lessons: number; tuning: number; total: number } {
  const r = rules.filter(x => x.state === 'proposed').length
  const l = latestLessons(lessons).filter(x => x.lesson.state === 'pending').length
  const t = runs.filter(x => x.status === 'done').slice(0, 1).flatMap(x => x.jobs).filter(j => j.decision === 'proposed').length
  return { rules: r, lessons: l, tuning: t, total: r + l + t }
}

/** What a "Set aside" moved, as the database answers it (for the Undo, which puts each back). */
export interface MovedRow { t: 'lessons' | 'cases' | 'rules'; id: string; was: 'active' }
export function readMoved(raw: unknown): MovedRow[] {
  return (Array.isArray(raw) ? raw : []).flatMap(m => (isObj(m) && (m.t === 'lessons' || m.t === 'cases' || m.t === 'rules') && typeof m.id === 'string' && UUID.test(m.id) ? [{ t: m.t, id: m.id, was: 'active' as const }] : []))
}

export const readList = <T>(rows: unknown, read: (r: unknown) => T | null): T[] => (Array.isArray(rows) ? rows.map(read).filter((x): x is T => x !== null) : [])

/** A share as a whole percent ("83 %"). */
export const percent = (n: number): string => `${Math.round(Math.max(0, Math.min(1, n)) * 100)} %`

// The owner's save (what the browser reports) lives in learnSave.ts: a form that reports a save loads only that.
export type { SaveReport } from './learnSave'
