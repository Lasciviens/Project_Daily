// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · learning: the weekly self-test (Message Batches, half price; migration 204)
//
//    makeWeeklyEval   — Monday 05:00 Oslo (after the report and the suggestions, from the same timer) or Tuning's button:
//                       code alone builds the test from the owner's own confirmed cases (the stable test split by hash),
//                       and ONE batch replays each test case with the champion setup and up to two challengers (another
//                       example pick; the champion plus the lessons waiting for the owner), twice each — Haiku has no
//                       temperature, so two repeats show the noise. A job with corrections also gets one "reflect"
//                       request that may propose up to three notes (pending lessons). The worst case of the whole batch
//                       is reserved first, at the batch price, and ledgered as one row.
//    checkEvalRuns    — when Anthropic has ended the batch: every line found by its exact custom id, every answer read by
//                       the job's OWN check and scored by code against the owner's saved values; the decision rule
//                       (learn-score.ts) per job; the batch is then DELETED at Anthropic (the owner: "delete right
//                       after"), and the run row says when. A winner is only PROPOSED: the owner approves it in Tuning.
//  Nothing the model writes here is ever an id, a target or an instruction: a reflect note is plain text checked by code
//  and stored as a pending lesson that only the owner can turn on (the database refuses the function).
// ─────────────────────────────────────────────────────────────────────────────

import type { JobDefinition, ModelAnswer, ModelRequest } from './types.ts'
import { costOf, worstCostOf } from './prices.ts'
import { callerDailyCap, cutChars, errorPlace, hideSecrets, LIMITS, rateCapProblem, reservationBudgetProblem, settingsFor, type RunSettings } from './guard.ts'
import { answerValue, checkedList, readAnswerObject } from './answer-reader.ts'
import { readGate, readSettingRows, reserveCall, writeCall, type CallRow } from './ledger.ts'
import { buildRequest, gateScopeOf, type RunContext } from './run.ts'
import { BATCH_GIVE_UP_MS, BATCH_NO_ID_MS, BATCH_REQUEST_MS, BATCH_STATUS_MS, CLAIM_MS, FAILURE_MAX, ledgerRow, letGoOfBatch, MAY_BE_BILLED } from './batch.ts'
import { patchCall } from './report-store.ts'
import { osloWeekOf, scheduledReportWeek } from './week-facts.ts'
import { findJob } from './jobs.ts'
import { LEARN_EVAL_JOB } from './job-learn-eval.ts'
import { isLearnObj, LEARN_SPECS, LEARN_UUID, type LearnSpec } from './learn-specs.ts'
import { pickExamples, type CaseCandidate, type ExampleStrategy } from './learn-pick.ts'
import { decideChallenger, scoreCase, setupScore, type Decision, type SetupScore } from './learn-score.ts'
import { knowledgeFor } from './learn-run.ts'
import { insertLesson, lessonExists, readJobLearning, readLessons, type LessonRow } from './learn-store.ts'
import { learnEscape, LESSON_DAYS, lessonStart, plainLine, type LessonKind } from './learn-text.ts'

/**
 * The bounds of one self-test. They bound COST and the batch's size (the budget wall still decides), never what the app
 * may learn from: every confirmed case stays in the pool, the newest test cases are replayed first.
 */
export const EVAL_LIMITS = { minTestCases: 4, testCasesPerJob: 40, reps: 2, maxRequests: 800, reflectCorrections: 40, notesPerJob: 3 } as const

export type EvalMakeReply =
  | { ok: true; queued: true; run_id: string; requests: number }
  | { ok: true; queued: false; skipped: 'not_the_time' | 'already_made' | 'already_queued' | 'nothing_to_test'; jobs?: unknown[] }
  | { ok: false; reason: 'error' | 'off' | 'not_configured' | 'busy' | 'budget' | 'bad_input' | 'failed'; message: string }

export type EvalCheckReply = { ok: true; checked: number; done: number; failed: number; waiting: number } | { ok: false; message: string }

interface EvalCase { id: string; input: Record<string, unknown>; input_text: string; output: Record<string, string>; split: string; created_at: string }

/** One request of the batch, as kept in the run's server-only plan (the custom id is `<ledger row id>-<i>`). */
type PlanEntry =
  | { i: number; kind: 'replay'; job: string; case_id: string; setup: string; rep: number }
  | { i: number; kind: 'reflect'; job: string }

interface Setup { name: string; strategy: ExampleStrategy; k: number; lessons: LessonRow[]; pendingLessons: LessonRow[] }

/** The cases of a job that can be replayed: the newest first, read field by field. */
async function readEvalCases(ctx: RunContext, job: string): Promise<EvalCase[] | null> {
  try {
    const { data, error } = await ctx.adminDb.from('ai_cases').select('id, input, input_text, output, split, created_at')
      .eq('user_id', ctx.userId).eq('job', job).eq('state', 'active').not('input', 'is', null).gt('expires_at', ctx.now().toISOString())
      .order('created_at', { ascending: false }).limit(1000)
    if (error || !Array.isArray(data)) return null
    return data.flatMap(r => {
      if (!isLearnObj(r) || typeof r.id !== 'string' || !LEARN_UUID.test(r.id) || !isLearnObj(r.input) || !isLearnObj(r.output) || typeof r.input_text !== 'string') return []
      const output: Record<string, string> = {}
      for (const [k, v] of Object.entries(r.output)) if (typeof v === 'string') output[k] = v
      return [{ id: r.id, input: r.input, input_text: r.input_text, output, split: String(r.split), created_at: String(r.created_at) }]
    })
  } catch {
    return null
  }
}

/** The corrections of a job since a time (for the "anything new?" test and the reflect request), newest first. */
async function readRecentCorrections(ctx: RunContext, job: string, sinceIso: string): Promise<{ field: string; ai_value: string | null; saved_value: string | null; kind: string }[] | null> {
  try {
    const { data, error } = await ctx.adminDb.from('ai_corrections').select('field, ai_value, saved_value, kind')
      .eq('user_id', ctx.userId).eq('job', job).eq('state', 'counted').gte('created_at', sinceIso).in('kind', ['edited', 'unticked'])
      .order('created_at', { ascending: false }).limit(200)
    if (error || !Array.isArray(data)) return null
    return data.flatMap(r => (isLearnObj(r) && typeof r.field === 'string' && typeof r.kind === 'string'
      ? [{ field: r.field, ai_value: typeof r.ai_value === 'string' ? r.ai_value : null, saved_value: typeof r.saved_value === 'string' ? r.saved_value : null, kind: r.kind }] : []))
  } catch {
    return null
  }
}

/** The setups of a job's test: the champion, another example pick, and the champion with the lessons waiting for the owner. */
export function setupsFor(strategy: ExampleStrategy, k: number, active: LessonRow[], pending: LessonRow[]): Setup[] {
  const champion: Setup = { name: 'champion', strategy, k, lessons: active, pendingLessons: [] }
  const other: ExampleStrategy = strategy === 'mmr' ? 'knn' : 'mmr'
  const setups: Setup[] = [champion, { name: `examples_${other}`, strategy: other, k: k || 3, lessons: active, pendingLessons: [] }]
  if (pending.length) setups.push({ name: 'with_new_notes', strategy, k, lessons: [...active, ...pending].slice(0, 8), pendingLessons: pending })
  return setups
}

/** The reflect request's live text: the job and the owner's corrections, escaped, one per line. */
export function reflectText(job: string, corrections: readonly { field: string; ai_value: string | null; saved_value: string | null; kind: string }[]): string {
  const lines = corrections.slice(0, EVAL_LIMITS.reflectCorrections).map(c =>
    `${learnEscape(c.field)} | ${learnEscape((c.ai_value ?? 'none').slice(0, 200))} | ${learnEscape(c.kind === 'unticked' ? '(left out)' : (c.saved_value ?? 'none').slice(0, 200))}`)
  return `<job>${learnEscape(job)}</job>\n<corrections>\n${lines.join('\n')}\n</corrections>`
}

/** A reflect answer's notes, each checked by code: a kind from the list, one plain sentence. Never repaired. */
export function readReflectNotes(answerText: string): { kind: LessonKind; text: string }[] {
  const answer = readAnswerObject(answerText)
  if (!answer.ok) return []
  const out: { kind: LessonKind; text: string }[] = []
  for (const raw of checkedList(answerValue(answer.value, 'notes'), 10)) {
    if (!isLearnObj(raw)) continue
    const kind = raw.kind === 'fact' || raw.kind === 'preference' ? raw.kind : null
    const text = plainLine(raw.text, 200, 8)
    if (kind && text && out.length < EVAL_LIMITS.notesPerJob && !out.some(n => n.text === text)) out.push({ kind, text })
  }
  return out
}

// ── Step 1: make ────────────────────────────────────────────────────────────

export async function makeWeeklyEval(ctx: RunContext): Promise<EvalMakeReply> {
  const job = LEARN_EVAL_JOB
  const scheduled = ctx.caller === 'schedule'
  if (!job.callers.includes(ctx.caller)) return { ok: false, reason: 'bad_input', message: `"${job.title}" can't be started from here.` }
  const now = ctx.now()
  const week = scheduled ? scheduledReportWeek(now)?.start ?? null : osloWeekOf(now).start
  if (!week) return { ok: true, queued: false, skipped: 'not_the_time' }
  const madeBy: 'schedule' | 'app' = scheduled ? 'schedule' : 'app'

  const { data: existing, error: readError } = await ctx.adminDb.from('ai_eval_runs').select('id, status, created_at').eq('user_id', ctx.userId).eq('week_start', week).eq('made_by', madeBy).maybeSingle()
  if (readError) return { ok: false, reason: 'error', message: 'The earlier self-tests could not be read, so nothing was queued. Try again in a moment.' }
  if (isLearnObj(existing) && existing.status === 'queued') return { ok: true, queued: false, skipped: 'already_queued' }
  if (isLearnObj(existing) && scheduled) return { ok: true, queued: false, skipped: 'already_made' }

  const gate = await readGate(ctx.userDb, job.name, gateScopeOf(ctx))
  if (!gate) return { ok: false, reason: 'error', message: 'The AI usage could not be read, so nothing was queued. Try again in a moment.' }
  const tooMany = rateCapProblem(gate, ctx.caller)
  if (tooMany) return { ok: false, reason: 'busy', message: tooMany }
  const stored = await readSettingRows(ctx.userDb, ctx.userId, job.name)
  if (!stored) return { ok: false, reason: 'error', message: 'Your AI settings could not be read, so nothing was queued. Try again in a moment.' }
  const settings = settingsFor(job, stored.account, stored.job)
  const off = async (reason: 'off' | 'not_configured', message: string): Promise<EvalMakeReply> => {
    if (!scheduled) {
      const row = ledgerRow(ctx, settings.model, job)
      row.outcome = reason
      row.error = cutChars(message, FAILURE_MAX)
      const problem = await writeCall(ctx.adminDb, row)
      if (problem) ctx.report(`a call was not written to the ledger: ${problem}`)
    }
    return { ok: false, reason, message }
  }
  if (!settings.aiEnabled) return off('off', 'All AI is switched off in Developer → AI → Settings.')
  if (!settings.enabled) return off('off', `"${job.title}" is switched off in Developer → AI → Settings.`)
  if (!ctx.provider) return off('not_configured', 'AI is not set up yet: the server has no API key for it.')

  // The last self-test of this maker: "new corrections" are the ones since then.
  const { data: last } = await ctx.adminDb.from('ai_eval_runs').select('created_at').eq('user_id', ctx.userId).neq('status', 'skipped').order('created_at', { ascending: false }).limit(1)
  const since = Array.isArray(last) && isLearnObj(last[0]) && typeof last[0].created_at === 'string' ? last[0].created_at : '1970-01-01T00:00:00Z'

  const plan: PlanEntry[] = []
  const requests: ModelRequest[] = []
  const summary: Record<string, unknown>[] = []
  let worst = 0
  for (const spec of LEARN_SPECS.values()) {
    const target = findJob(spec.job)
    if (!target) continue
    const fresh = await readRecentCorrections(ctx, spec.job, since)
    if (!fresh) return { ok: false, reason: 'error', message: 'The corrections could not be read, so nothing was queued. Try again in a moment.' }
    if (!fresh.length) { summary.push({ job: spec.job, skipped: 'no new corrections since the last self-test' }); continue }
    const jobStored = await readSettingRows(ctx.userDb, ctx.userId, spec.job)
    if (!jobStored) return { ok: false, reason: 'error', message: 'Your AI settings could not be read, so nothing was queued. Try again in a moment.' }
    const jobSettings = settingsFor(target, jobStored.account, jobStored.job)
    if (!jobSettings.enabled) { summary.push({ job: spec.job, skipped: 'the job is switched off' }); continue }
    const built = await buildJobTest(ctx, spec, target, jobSettings, plan.length)
    if (built.kind === 'error') return { ok: false, reason: 'error', message: built.message }
    // The reflect request (notes from corrections) needs no replayable case: a receipt's corrections teach too.
    const reflect = buildRequest(job, settings, reflectText(spec.job, fresh), settings.thinking)
    const entries = built.kind === 'ok' ? built.entries : []
    const reqs = built.kind === 'ok' ? built.requests : []
    if (plan.length + entries.length + 1 > EVAL_LIMITS.maxRequests) { summary.push({ job: spec.job, skipped: 'the batch is full this week' }); continue }
    plan.push(...entries)
    requests.push(...reqs)
    plan.push({ i: plan.length, kind: 'reflect', job: spec.job })
    requests.push(reflect)
    summary.push({
      job: spec.job, test_cases: built.kind === 'ok' ? built.cases : 0, setups: built.kind === 'ok' ? built.setups : [], reps: EVAL_LIMITS.reps, new_corrections: fresh.length,
      ...(built.kind === 'ok' ? { trial_lessons: built.trial, strategies: built.strategies } : {}), ...(built.kind === 'skip' ? { replay: built.why } : {}),
    })
  }
  for (const r of requests) worst += worstCostOf(r.model, r.instructions.length + r.userText.length + (r.knowledge ?? []).reduce((s, k) => s + k.text.length + k.source.length + k.title.length, 0), r.maxOutputTokens, 'batch')

  const runId = isLearnObj(existing) && typeof existing.id === 'string' ? existing.id : ctx.newId()
  const base = { requests: requests.length, jobs: summary, plan: plan as unknown, result: null, decision_state: 'none', batch_id: null, call_id: null, failure: null, finished_at: null, claimed_at: null, batch_deleted_at: null, batch_delete_note: null }
  if (!requests.length) {
    const row = { id: runId, user_id: ctx.userId, week_start: week, made_by: madeBy, ...base, plan: [], status: 'skipped' }
    const { error } = isLearnObj(existing) ? await ctx.adminDb.from('ai_eval_runs').update(row).eq('id', runId).eq('user_id', ctx.userId) : await ctx.adminDb.from('ai_eval_runs').insert(row)
    if (error) ctx.report('a skipped self-test could not be saved')
    return { ok: true, queued: false, skipped: 'nothing_to_test', jobs: summary }
  }
  const saveRow = { id: runId, user_id: ctx.userId, week_start: week, made_by: madeBy, ...base, status: 'queued', created_at: now.toISOString() }
  const saved = isLearnObj(existing)
    ? await ctx.adminDb.from('ai_eval_runs').update(saveRow).eq('id', runId).eq('user_id', ctx.userId).neq('status', 'queued').select('id')
    : await ctx.adminDb.from('ai_eval_runs').insert(saveRow).select('id')
  if (saved.error || !Array.isArray(saved.data) || !saved.data.length) {
    return saved.error?.code === '23505' ? { ok: true, queued: false, skipped: 'already_queued' } : { ok: false, reason: 'error', message: 'The self-test could not be saved, so nothing was queued. Try again in a moment.' }
  }
  const fail = (message: string) => ctx.adminDb.from('ai_eval_runs').update({ status: 'failed', failure: cutChars(message, FAILURE_MAX), finished_at: ctx.now().toISOString() }).eq('id', runId).eq('user_id', ctx.userId)

  const reservation = await reserveCall(ctx.adminDb, {
    userId: ctx.userId, job: job.name, caller: ctx.caller, mode: 'batch', provider: ctx.providerName, model: settings.model,
    effort: settings.effort, instructionsVersion: job.version, worstCostUsd: Math.round(worst * 1_000_000) / 1_000_000,
    budgetUsd: settings.monthlyBudgetUsd, jobBudgetUsd: settings.jobBudgetUsd,
    perMinute: LIMITS.callsPerMinute, perDay: LIMITS.callsPerDay, callerPerDay: callerDailyCap(ctx.caller),
  })
  if (!reservation) { await fail('The AI budget could not be checked, so nothing was queued.'); return { ok: false, reason: 'error', message: 'The AI budget could not be checked, so nothing was queued. Try again in a moment.' } }
  if (reservation.kind === 'busy') { await fail('Too many AI calls at the moment, so nothing was queued.'); return { ok: false, reason: 'busy', message: 'Too many AI calls at the moment. Wait a moment and try again.' } }
  if (reservation.kind === 'budget') { const m = reservationBudgetProblem(settings, job.title); await fail(m); return { ok: false, reason: 'budget', message: m } }
  const callId = reservation.id
  await ctx.adminDb.from('ai_eval_runs').update({ call_id: callId }).eq('id', runId).eq('user_id', ctx.userId)

  let submitted
  try {
    submitted = await ctx.provider.submitBatch(requests.map((request, i) => ({ customId: `${callId}-${i}`, request })), BATCH_REQUEST_MS)
  } catch (error) {
    ctx.report(`the provider part threw: ${errorPlace(error)}`)
    submitted = { ok: false as const, kind: 'unknown' as const, status: null, message: 'The batch could not be queued: the AI call failed unexpectedly.', detail: '', requestId: null, sent: null }
  }
  if (!submitted.ok) {
    const message = hideSecrets(submitted.message, ctx.secrets)
    await fail(message)
    const problem = await patchCall(ctx.adminDb, ctx.userId, callId, { outcome: 'error', stop_reason: 'batch_not_queued', error: cutChars(message, FAILURE_MAX), ...(MAY_BE_BILLED.includes(submitted.kind) ? {} : { cost_usd: 0 }) })
    if (problem) ctx.report(`a call could not be finished in the ledger (it stays at its reserved cost): ${problem}`)
    return { ok: false, reason: 'failed', message }
  }
  const { error: idError } = await ctx.adminDb.from('ai_eval_runs').update({ batch_id: submitted.batchId }).eq('id', runId).eq('user_id', ctx.userId)
  if (idError) {
    // A batch nobody can find again is cancelled at once and never read (guardian S2); the run says why.
    const gone = await letGoOfBatch(ctx, submitted.batchId)
    await fail(`The batch's id could not be saved, so it was cancelled at Anthropic. ${gone.batch_delete_note ?? ''}`.trim())
    await patchCall(ctx.adminDb, ctx.userId, callId, { outcome: 'error', stop_reason: 'batch_cancelled', error: 'The batch id could not be saved.' })
    return { ok: false, reason: 'failed', message: 'The self-test could not be saved after it was queued, so it was cancelled. Try again in a moment.' }
  }
  await patchCall(ctx.adminDb, ctx.userId, callId, { stop_reason: 'batch_queued', duration_ms: 0, tools: [{ name: 'self_test', requests: requests.length }] })
  return { ok: true, queued: true, run_id: runId, requests: requests.length }
}

/** One job's replays: every test case × setup × repeat, each request built exactly as a live run of the job would be. */
async function buildJobTest(ctx: RunContext, spec: LearnSpec, target: JobDefinition, settings: RunSettings, offset: number): Promise<
  | { kind: 'ok'; entries: PlanEntry[]; requests: ModelRequest[]; cases: number; setups: string[]; trial: { id: string; text: string }[]; strategies: Record<string, { strategy: ExampleStrategy; k: number }> }
  | { kind: 'skip'; why: string }
  | { kind: 'error'; message: string }
> {
  if (!spec.replayable) return { kind: 'skip', why: 'its input (a photo or a file) is never kept, so it cannot be sent again' }
  const cases = await readEvalCases(ctx, spec.job)
  if (!cases) return { kind: 'error', message: 'The cases could not be read, so nothing was queued. Try again in a moment.' }
  const test = cases.filter(c => c.split === 'test').slice(0, EVAL_LIMITS.testCasesPerJob)
  if (test.length < EVAL_LIMITS.minTestCases) return { kind: 'skip', why: `${test.length} test cases so far; the test needs ${EVAL_LIMITS.minTestCases}` }
  const pool: CaseCandidate[] = cases.filter(c => c.split === 'train').map(c => ({ id: c.id, input_text: c.input_text, output: c.output }))
  const inputs = new Map(cases.map(c => [c.id, c.input]))
  const [state, active, pending] = await Promise.all([
    readJobLearning(ctx.adminDb, ctx.userId, spec.job), readLessons(ctx.adminDb, ctx.userId, spec.job, 'active'), readLessons(ctx.adminDb, ctx.userId, spec.job, 'pending'),
  ])
  if (!state || !active || !pending) return { kind: 'error', message: 'The learning setup could not be read, so nothing was queued. Try again in a moment.' }
  const setups = setupsFor(state.strategy, state.k, active, pending)
  const entries: PlanEntry[] = []
  const requests: ModelRequest[] = []
  for (const c of test) {
    // The case is prepared as it was asked (its own day: "Tuesday" meant the Tuesday after that day).
    const prepared = target.prepare(c.input, new Date(c.created_at))
    if ('problem' in prepared || prepared.early || prepared.images?.length || prepared.documents?.length) continue
    for (const setup of setups) {
      const picked = pickExamples(c.input_text, pool, setup.strategy, setup.k, { exclude: new Set([c.id]) })
      // The waiting notes are labelled as on trial (never "approved"): the model reads that they are the self-test's only.
      const knowledge = knowledgeFor(spec, picked, setup.lessons, x => inputs.get(x.id) ?? null, new Set(setup.pendingLessons.map(l => l.id)))
      // No web search in a replay: the answer must come from the setup, not from a page found that day.
      const request = buildRequest(target, settings, prepared.userText, settings.thinking, undefined, { knowledge })
      for (let rep = 1; rep <= EVAL_LIMITS.reps; rep++) {
        entries.push({ i: offset + entries.length, kind: 'replay', job: spec.job, case_id: c.id, setup: setup.name, rep })
        requests.push(request)
      }
    }
  }
  // The notes this run tests, by id, kept with the run: an Approve turns on exactly these, never a note added later (critic 2).
  const trial = setups.flatMap(s => s.pendingLessons).map(l => ({ id: l.id, text: l.text }))
  return { kind: 'ok', entries, requests, cases: test.length, setups: setups.map(s => s.name), trial, strategies: Object.fromEntries(setups.map(s => [s.name, { strategy: s.strategy, k: s.k }])) }
}

// ── Step 2: check ───────────────────────────────────────────────────────────

interface EvalRun { id: string; call_id: string | null; batch_id: string | null; plan: PlanEntry[]; jobs: Record<string, unknown>[]; created_at: string }

function planOf(value: unknown): PlanEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((v): PlanEntry[] => {
    if (!isLearnObj(v) || typeof v.i !== 'number' || typeof v.job !== 'string') return []
    if (v.kind === 'reflect') return [{ i: v.i, kind: 'reflect' as const, job: v.job }]
    if (v.kind === 'replay' && typeof v.case_id === 'string' && typeof v.setup === 'string' && typeof v.rep === 'number') return [{ i: v.i, kind: 'replay' as const, job: v.job, case_id: v.case_id, setup: v.setup, rep: v.rep }]
    return []
  })
}

export async function checkEvalRuns(ctx: RunContext): Promise<EvalCheckReply> {
  if (!ctx.provider) return { ok: false, message: 'AI is not set up yet: the server has no API key for it.' }
  const now = ctx.now()
  // Nothing queued (the usual case): nothing is written.
  const { count, error: countError } = await ctx.adminDb.from('ai_eval_runs').select('id', { count: 'exact', head: true }).eq('user_id', ctx.userId).eq('status', 'queued')
  if (countError) return { ok: false, message: 'The self-tests could not be read. Try again in a moment.' }
  if (!count) return { ok: true, checked: 0, done: 0, failed: 0, waiting: 0 }
  // A claim older than the claim time is a check that died: released.
  await ctx.adminDb.from('ai_eval_runs').update({ claimed_at: null }).eq('user_id', ctx.userId).eq('status', 'queued').lt('claimed_at', new Date(now.getTime() - CLAIM_MS).toISOString())
  const { data, error } = await ctx.adminDb.from('ai_eval_runs').select('id, call_id, batch_id, plan, jobs, created_at').eq('user_id', ctx.userId).eq('status', 'queued').is('claimed_at', null).limit(5)
  if (error || !Array.isArray(data)) return { ok: false, message: 'The self-tests could not be read. Try again in a moment.' }
  const tally = { checked: 0, done: 0, failed: 0, waiting: 0 }
  for (const raw of data) {
    if (!isLearnObj(raw) || typeof raw.id !== 'string') continue
    const run: EvalRun = { id: raw.id, call_id: typeof raw.call_id === 'string' ? raw.call_id : null, batch_id: typeof raw.batch_id === 'string' ? raw.batch_id : null, plan: planOf(raw.plan), jobs: Array.isArray(raw.jobs) ? raw.jobs.filter(isLearnObj) : [], created_at: String(raw.created_at) }
    // A claim: one check at a time per run, tied to the run it read (created_at).
    const claim = await ctx.adminDb.from('ai_eval_runs').update({ claimed_at: now.toISOString() }).eq('id', run.id).eq('user_id', ctx.userId).eq('status', 'queued').is('claimed_at', null).eq('created_at', run.created_at).select('id')
    if (claim.error || !Array.isArray(claim.data) || !claim.data.length) continue
    tally.checked += 1
    let outcome: 'done' | 'failed' | 'waiting'
    try {
      outcome = await checkOneEval(ctx, run)
    } catch (e) {
      ctx.report(`a self-test check threw: ${errorPlace(e)}`)
      outcome = 'waiting'
    }
    tally[outcome] += 1
    if (outcome === 'waiting') await ctx.adminDb.from('ai_eval_runs').update({ claimed_at: null }).eq('id', run.id).eq('user_id', ctx.userId).eq('created_at', run.created_at)
  }
  return { ok: true, ...tally }
}

async function endEval(ctx: RunContext, run: EvalRun, message: string, stopReason: string): Promise<'failed'> {
  // Delete right after, on an error path too: cancelled first when it has not ended (guardian S2).
  const gone = await letGoOfBatch(ctx, run.batch_id)
  if (run.call_id) {
    const problem = await patchCall(ctx.adminDb, ctx.userId, run.call_id, { outcome: 'error', stop_reason: stopReason, error: cutChars(message, FAILURE_MAX) })
    if (problem) ctx.report(`a call could not be finished in the ledger (it stays at its reserved cost): ${problem}`)
  }
  const { error } = await ctx.adminDb.from('ai_eval_runs').update({ status: 'failed', failure: cutChars(message, FAILURE_MAX), finished_at: ctx.now().toISOString(), claimed_at: null, ...(run.batch_id ? gone : {}) }).eq('id', run.id).eq('user_id', ctx.userId).eq('created_at', run.created_at)
  if (error) ctx.report('a failed self-test could not be saved as failed')
  return 'failed'
}

async function checkOneEval(ctx: RunContext, run: EvalRun): Promise<'done' | 'failed' | 'waiting'> {
  const provider = ctx.provider
  if (!provider) return 'waiting'
  const age = ctx.now().getTime() - Date.parse(run.created_at)
  const tooOld = Number.isFinite(age) && age > BATCH_GIVE_UP_MS
  if (!run.batch_id || !run.call_id) return age > BATCH_NO_ID_MS || tooOld ? endEval(ctx, run, 'The batch was never registered, so there is nothing to read.', 'batch_not_registered') : 'waiting'
  const status = await provider.batchStatus(run.batch_id, BATCH_STATUS_MS)
  if (!status.ok) return tooOld ? endEval(ctx, run, 'Anthropic could not be asked about the batch for more than a day.', 'batch_unreachable') : 'waiting'
  if (status.status !== 'ended') return tooOld ? endEval(ctx, run, 'The batch did not end within a day.', 'batch_expired') : 'waiting'
  const results = await provider.batchResults(run.batch_id, BATCH_REQUEST_MS, run.plan.length + 10)
  if (!results.ok) return tooOld ? endEval(ctx, run, 'The results could not be read for more than a day.', 'batch_unreachable') : 'waiting'

  // Every line by its EXACT custom id (`<ledger row id>-<i>`); anything else is ignored.
  const byId = new Map(results.lines.map(l => [l.customId, l]))
  const cases = new Map<string, EvalCase>()
  for (const spec of LEARN_SPECS.values()) {
    if (!run.plan.some(p => p.kind === 'replay' && p.job === spec.job)) continue
    for (const c of (await readEvalCases(ctx, spec.job)) ?? []) cases.set(c.id, c)
  }
  let cost = 0
  const usage = { input: 0, output: 0, cacheRead: 0 }
  const lines = new Map<string, Map<string, { caseId: string; score: { mean: number; fields: Record<string, number> } | null; tokens: number }[]>>()
  const notesAdded: Record<string, number> = {}
  for (const entry of run.plan) {
    const line = byId.get(`${run.call_id}-${entry.i}`)
    const answer: ModelAnswer | null = line && line.kind === 'succeeded' ? line.answer : null
    if (answer) {
      cost += costOf(answer.usage, answer.servedModel ?? LEARN_EVAL_JOB.defaults.model, 'batch').costUsd
      usage.input += answer.usage.inputTokens + answer.usage.cacheWrite5mTokens + answer.usage.cacheWrite1hTokens
      usage.cacheRead += answer.usage.cacheReadTokens
      usage.output += answer.usage.outputTokens
    }
    if (entry.kind === 'reflect') {
      if (!answer || answer.ending !== 'complete') continue
      notesAdded[entry.job] = await saveReflectNotes(ctx, entry.job, run.call_id, readReflectNotes(answer.text))
      continue
    }
    const c = cases.get(entry.case_id)
    const spec = LEARN_SPECS.get(entry.job)
    const target = findJob(entry.job)
    if (!c || !spec || !target) continue
    let score: { mean: number; fields: Record<string, number> } | null = null
    if (answer && answer.ending === 'complete') {
      const prepared = target.prepare(c.input, new Date(c.created_at))
      if (!('problem' in prepared)) {
        let check
        try { check = prepared.read(answer.text, { thinking: answer.thinking, servedModel: answer.servedModel, webSearches: 0 }) } catch { check = null }
        if (check?.ok) score = scoreCase(c.output, spec.values(check.result), new Set(spec.freeFields))
      }
    }
    const tokens = answer ? answer.usage.inputTokens + answer.usage.cacheReadTokens + answer.usage.cacheWrite5mTokens + answer.usage.cacheWrite1hTokens + answer.usage.outputTokens : 0
    const perJob = lines.get(entry.job) ?? new Map()
    perJob.set(entry.setup, [...(perJob.get(entry.setup) ?? []), { caseId: c.id, score, tokens }])
    lines.set(entry.job, perJob)
  }

  // The decision per job: the best challenger that passes every part of the rule is PROPOSED; nothing changes yet.
  const jobs: Record<string, unknown>[] = []
  for (const [job, setups] of lines) {
    const scores = [...setups.entries()].map(([name, l]) => setupScore(name, l))
    const champion = scores.find(s => s.setup === 'champion')
    const decisions: { setup: SetupScore; decision: Decision }[] = champion ? scores.filter(s => s !== champion).map(s => ({ setup: s, decision: decideChallenger(champion, s, 2) })) : []
    const best = decisions.filter(d => d.decision.wins).sort((a, b) => b.decision.challenger - a.decision.challenger)[0]
    // The winner as it was TESTED (the run's own summary), never as the tables are now: a note added since is not part of it.
    const summary = run.jobs.find(j => j.job === job) ?? {}
    const tried = (Array.isArray(summary.trial_lessons) ? summary.trial_lessons : []).filter(isLearnObj)
      .filter(l => typeof l.id === 'string' && LEARN_UUID.test(l.id) && typeof l.text === 'string') as { id: string; text: string }[]
    const used = isLearnObj(summary.strategies) && best ? summary.strategies[best.setup.setup] : null
    const winner = best && isLearnObj(used) ? {
      setup: best.setup.setup, strategy: used.strategy, k: used.k,
      lessons: best.setup.setup === 'with_new_notes' ? tried.map(l => l.text) : [], lesson_ids: best.setup.setup === 'with_new_notes' ? tried.map(l => l.id) : [],
    } : null
    jobs.push({
      job, champion: champion ?? null,
      challengers: decisions.map(d => ({ ...d.setup, decision: d.decision })),
      decision: winner ? 'proposed' : 'none', winner, notes_added: notesAdded[job] ?? 0,
    })
  }
  for (const [job, n] of Object.entries(notesAdded)) if (!lines.has(job)) jobs.push({ job, decision: 'none', notes_added: n })

  const deleted = await letGoOfBatch(ctx, run.batch_id, true)
  const problem = await patchCall(ctx.adminDb, ctx.userId, run.call_id, {
    outcome: 'ok', error: null, stop_reason: 'batch_ended', cost_usd: Math.round(cost * 1_000_000) / 1_000_000,
    input_tokens: usage.input, cache_read_tokens: usage.cacheRead, output_tokens: usage.output, duration_ms: Number.isFinite(age) ? Math.max(0, Math.round(age)) : 0,
  })
  if (problem) ctx.report(`a call could not be finished in the ledger (it stays at its reserved cost): ${problem}`)
  const proposed = jobs.some(j => j.decision === 'proposed')
  const { error } = await ctx.adminDb.from('ai_eval_runs').update({
    status: 'done', result: { jobs, cost_usd: Math.round(cost * 1_000_000) / 1_000_000 }, decision_state: proposed ? 'proposed' : 'none',
    finished_at: ctx.now().toISOString(), claimed_at: null, plan: [], ...deleted,
  }).eq('id', run.id).eq('user_id', ctx.userId).eq('created_at', run.created_at)
  if (error) {
    // Never "waiting": the batch is already deleted, a second read would find nothing. A smaller write says what happened.
    ctx.report('a finished self-test could not be saved')
    await ctx.adminDb.from('ai_eval_runs').update({ status: 'failed', failure: 'The scores could not be saved.', finished_at: ctx.now().toISOString(), claimed_at: null, plan: [], ...deleted })
      .eq('id', run.id).eq('user_id', ctx.userId).eq('created_at', run.created_at)
    return 'failed'
  }
  return 'done'
}

/** The reflect notes as PENDING lessons (trust medium: a model wrote them from the owner's corrections). Answers how many. */
async function saveReflectNotes(ctx: RunContext, job: string, callId: string, notes: readonly { kind: LessonKind; text: string }[]): Promise<number> {
  let added = 0
  for (const note of notes) {
    const start = lessonStart(note.kind, 'weekly_batch', note.text)
    // A model's note never turns on by itself (the database refuses it too).
    if (start.state !== 'pending') continue
    if (await lessonExists(ctx.adminDb, ctx.userId, job, note.text)) continue
    const r = await insertLesson(ctx.adminDb, {
      user_id: ctx.userId, scope: job, kind: note.kind, text: note.text, source_kind: 'weekly_batch', source_ref: 'the weekly self-test',
      source_call_id: callId, trust: start.trust, state: 'pending', expires_at: new Date(ctx.now().getTime() + LESSON_DAYS[note.kind] * 86_400_000).toISOString(),
    })
    if (r === 'ok') added += 1
  }
  return added
}
