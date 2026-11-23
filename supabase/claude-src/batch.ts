// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · the batch flow (weekly report, phase 3)
//
//  Two steps, run by two timers (migration 196) or by the app's buttons:
//
//    makeWeeklyReport  — Monday 05:00 Oslo (Sunday is complete): the week's figures (code), the request, the reservation at
//                        the BATCH price (half), one batch with one request, and the report row (`queued`) holding the
//                        batch id. The button makes the last full week again when its real report is missing or failed.
//    checkReports      — every 15 minutes while a report is queued or a push is owed: ask whether the batch ended; when it
//                        did, read the one result line (found by `custom_id` = the ledger row's id, unique per submission,
//                        never by position), check the text, write the report and correct the ledger row to the real cost
//                        at the batch price. The push is a separate step: owed from the moment the real report is done,
//                        sent at the first check from 07:00 Oslo time. Once: a claim makes one check own a report, and the
//                        push is stamped before it is sent. Only the scheduled (real) report of the owner's week pushes.
//
//  A failure never loops. A scheduled make is tried once a week (a report row of that week stops the second run); a
//  check that finds the batch failed, expired, cancelled or unusable ends the report as `failed` for good, keeps the
//  worst case in the ledger (the safe side) and says why in the row. The only thing a check repeats is asking again
//  while Anthropic has not finished.
//
//  The model's text is data: it goes through `readWeeklyReport` (length, five fixed headings, no link or markup), and
//  nothing it says is ever used as an id, an address or a target. The batch id comes only from the report row.
// ─────────────────────────────────────────────────────────────────────────────

import type { JobDefinition, ModelAnswer, ReportCheckReply, ReportMakeReply } from './types.ts'
import { costOf, worstCostOf } from './prices.ts'
import {
  callerDailyCap, cutChars, errorPlace, hideSecrets, LIMITS, rateCapProblem, reservationBudgetProblem, settingsFor, trimForLog, trimText, TEXT_LOG_MAX_BYTES,
} from './guard.ts'
import { readGate, readSettingRows, reserveCall, writeCall, type CallRow } from './ledger.ts'
import { buildRequest, gateScopeOf, type RunContext } from './run.ts'
import { WEEKLY_REPORT_JOB, readWeeklyReport } from './job-weekly-report.ts'
import { dmy, factsText, hasAnyData, lastFullWeek, manualReportPlan, pushWindowOpen, scheduledReportWeek, shiftDay } from './week-facts.ts'
import { readWeekFacts } from './week-data.ts'
import {
  claimPush, claimReport, findReport, insertReport, patchCall, patchReport, pendingPushes, queuedReports, releaseClaim, releaseStaleClaims, requeueReport,
  type ReportRow,
} from './report-store.ts'

export const BATCH_REQUEST_MS = 30_000
export const BATCH_STATUS_MS = 20_000
// Anthropic ends a batch at 24 hours at the latest (what is not done expires). Past 26 hours the report is given up.
export const BATCH_GIVE_UP_MS = 26 * 3_600_000
// A report row with no batch id this old never got its batch registered.
export const BATCH_NO_ID_MS = 30 * 60_000
// A check that died keeps its claim this long.
export const CLAIM_MS = 10 * 60_000
export const FAILURE_MAX = 300
// A failure that may have been billed (the request may have reached Anthropic) stays at the reserved worst case.
export const MAY_BE_BILLED = ['network', 'timeout', 'overloaded', 'provider_fault', 'unknown']

const PUSH_FAILED_BODY = "This week's report could not be made. Developer → AI → Learn → Batches says why."

/** A ledger row for this job, with every column at "nothing happened yet" (the reservation writes the real one). */
export function ledgerRow(ctx: RunContext, model: string, job: JobDefinition = WEEKLY_REPORT_JOB): CallRow {
  return {
    id: ctx.newId(), user_id: ctx.userId, run_id: ctx.newId(), step: 1, job: job.name, caller: ctx.caller, mode: 'batch',
    provider: ctx.providerName, model, served_model: null, effort: null, outcome: 'error', stop_reason: null, error: null, request_id: null,
    input_tokens: 0, cache_read_tokens: 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0, output_tokens: 0, thinking_tokens: 0,
    long_prompt: false, cost_usd: 0, duration_ms: 0, instructions_version: job.version, tools: [], request: null, response: null, thinking: null,
  }
}

// ── Step 1: make ────────────────────────────────────────────────────────────

export async function makeWeeklyReport(ctx: RunContext): Promise<ReportMakeReply> {
  const job = WEEKLY_REPORT_JOB
  const scheduled = ctx.caller === 'schedule'
  if (!job.callers.includes(ctx.caller)) return { ok: false, reason: 'bad_input', message: `"${job.title}" can't be started from here.` }
  const now = ctx.now()
  // Which week, and whose report it is. The timer makes the real report of the week that just ended. The button makes that
  // same real report again when it is missing or failed ("redo"); when it is ready, a test copy of it (Monday, Tuesday) or
  // the week so far: those are the button's own rows, never the real one, and they are never pushed.
  let week = scheduled ? scheduledReportWeek(now) : null
  let madeBy: 'schedule' | 'app' = 'schedule'
  let kind: 'scheduled' | 'redo' | 'copy' | 'so_far' = 'scheduled'
  if (!scheduled) {
    const last = lastFullWeek(now)
    const real = await findReport(ctx.adminDb, ctx.userId, last.start, 'schedule')
    if (real === undefined) return { ok: false, reason: 'error', message: 'The reports could not be read, so nothing was queued. Try again in a moment.' }
    if (real?.status === 'queued') return { ok: true, queued: false, skipped: 'already_queued', week_start: last.start }
    const plan = manualReportPlan(now, real?.status === 'ready')
    week = plan.week
    kind = plan.kind
    madeBy = plan.kind === 'redo' ? 'schedule' : 'app'
  }
  if (!week) return { ok: true, queued: false, skipped: 'not_the_time', week_start: null }
  // Only the owner's real report is announced on the owner's phone (a button copy, another account: never).
  const pushDue = madeBy === 'schedule' && !!ctx.push

  // A report of this week by this maker already exists: the second timer run, a repeated tap. A scheduled report is
  // never made twice by the timer (a failed one is not retried either: no loop); the button may redo a failed real report
  // and any copy of its own.
  const existing = await findReport(ctx.adminDb, ctx.userId, week.start, madeBy)
  if (existing === undefined) return { ok: false, reason: 'error', message: 'The reports could not be read, so nothing was queued. Try again in a moment.' }
  if (existing?.status === 'queued') return { ok: true, queued: false, skipped: 'already_queued', week_start: week.start }
  if (existing && scheduled) return { ok: true, queued: false, skipped: 'already_made', week_start: week.start }
  if (existing?.status === 'ready' && madeBy === 'schedule') return { ok: true, queued: false, skipped: 'already_made', week_start: week.start }

  // The ledger row of a request that stops before anything is queued: no tokens, and the reason.
  const stop = async (reason: 'off' | 'not_configured' | 'busy' | 'error' | 'budget', message: string, model: string): Promise<ReportMakeReply> => {
    if (reason !== 'busy') {
      const row = ledgerRow(ctx, model)
      row.outcome = reason
      row.error = cutChars(message, FAILURE_MAX)
      const problem = await writeCall(ctx.adminDb, row)
      if (problem) ctx.report(`a call was not written to the ledger: ${problem}`)
    }
    // The timer's one try is recorded, so the second run of the night and the next check know it ended here.
    if (scheduled && reason !== 'busy') await recordFailedWeek(ctx, week.start, existing, message)
    return { ok: false, reason, message }
  }

  const gate = await readGate(ctx.userDb, job.name, gateScopeOf(ctx))
  if (!gate) {
    ctx.report('the usage could not be read, so nothing was queued')
    return { ok: false, reason: 'error', message: 'The AI usage could not be read, so nothing was queued. Try again in a moment.' }
  }
  const tooMany = rateCapProblem(gate, ctx.caller)
  if (tooMany) return { ok: false, reason: 'busy', message: tooMany }
  const stored = await readSettingRows(ctx.userDb, ctx.userId, job.name)
  if (!stored) return stop('error', 'Your AI settings could not be read, so nothing was queued. Try again in a moment.', job.defaults.model)
  const settings = settingsFor(job, stored.account, stored.job)
  if (!settings.aiEnabled) return stop('off', 'All AI is switched off in Developer → AI → Settings.', settings.model)
  if (!settings.enabled) return stop('off', `"${job.title}" is switched off in Developer → AI → Settings.`, settings.model)
  if (!ctx.provider) return stop('not_configured', 'AI is not set up yet: the server has no API key for it.', settings.model)

  // AI last: the figures come first, from the database, by code.
  const facts = await readWeekFacts(ctx.adminDb, ctx.userId, week, kind === 'so_far')
  if (facts.unreadable.length === 4) return stop('error', 'The week could not be read from the database, so nothing was queued.', settings.model)
  if (!hasAnyData(facts)) {
    if (scheduled) await recordFailedWeek(ctx, week.start, existing, 'There was no data to report on this week.')
    return { ok: true, queued: false, skipped: 'no_data', week_start: week.start }
  }
  const userText = factsText(facts)
  const request = buildRequest(job, settings, userText, settings.thinking)
  // The most this request could cost, at the batch price: held against the budget before anything is sent.
  const worstCost = worstCostOf(request.model, request.instructions.length + request.userText.length, request.maxOutputTokens, 'batch')

  // The report row first: the unique (user, week, maker) key is what stops two makes of one week at the same moment.
  let reportId = ctx.newId()
  // What the model reads is saved with the figures: the Batches view shows it as "Figures sent".
  const factsJson = { ...facts, sent_text: userText, kind } as unknown as Record<string, unknown>
  if (existing) {
    if (!(await requeueReport(ctx.adminDb, ctx.userId, existing.id, factsJson, now.toISOString(), false))) {
      return { ok: true, queued: false, skipped: 'already_queued', week_start: week.start }
    }
    reportId = existing.id
  } else {
    const added = await insertReport(ctx.adminDb, { id: reportId, user_id: ctx.userId, week_start: week.start, made_by: madeBy, facts: factsJson, push_due: false })
    if (added === 'exists') return { ok: true, queued: false, skipped: 'already_queued', week_start: week.start }
    if (added === 'error') return { ok: false, reason: 'error', message: 'The report could not be saved, so nothing was queued. Try again in a moment.' }
  }
  const fail = (message: string) => patchReport(ctx.adminDb, ctx.userId, reportId, { status: 'failed', failure: cutChars(message, FAILURE_MAX), ready_at: ctx.now().toISOString() }, true)

  const reservation = await reserveCall(ctx.adminDb, {
    userId: ctx.userId, job: job.name, caller: ctx.caller, mode: 'batch', provider: ctx.providerName, model: request.model,
    effort: request.effort, instructionsVersion: job.version, worstCostUsd: worstCost,
    budgetUsd: settings.monthlyBudgetUsd, jobBudgetUsd: settings.jobBudgetUsd,
    perMinute: LIMITS.callsPerMinute, perDay: LIMITS.callsPerDay, callerPerDay: callerDailyCap(ctx.caller),
  })
  if (!reservation) {
    ctx.report('the budget could not be reserved, so nothing was queued')
    await fail('The AI budget could not be checked, so nothing was queued.')
    return { ok: false, reason: 'error', message: 'The AI budget could not be checked, so nothing was queued. Try again in a moment.', report_id: reportId }
  }
  if (reservation.kind === 'busy') {
    await fail('Too many AI calls at the moment, so nothing was queued.')
    return { ok: false, reason: 'busy', message: `That is more than ${LIMITS.callsPerMinute} AI calls in a minute, ${LIMITS.callsPerDay} today, or ${callerDailyCap(ctx.caller)} in 24 hours. Wait a moment and try again.`, report_id: reportId }
  }
  if (reservation.kind === 'budget') {
    const message = reservationBudgetProblem(settings, job.title)
    await fail(message)
    return { ok: false, reason: 'budget', message, report_id: reportId }
  }
  const callId = reservation.id
  await patchReport(ctx.adminDb, ctx.userId, reportId, { call_id: callId }, true)

  // One batch, one request: its custom_id is the ledger row's id (unique per submission, a uuid with nothing of the owner's
  // in it), so a re-made report can never be answered by the line of an earlier batch.
  const started = Date.now()
  let submitted
  try {
    submitted = await ctx.provider.submitBatch([{ customId: callId, request }], BATCH_REQUEST_MS)
  } catch (error) {
    ctx.report(`the provider part threw: ${errorPlace(error)}`)
    submitted = { ok: false as const, kind: 'unknown' as const, status: null, message: 'The batch could not be queued: the AI call failed unexpectedly.', detail: '', requestId: null, sent: null }
  }
  if (!submitted.ok) {
    const message = hideSecrets(submitted.message, ctx.secrets)
    await fail(message)
    const patch: Partial<CallRow> = {
      outcome: 'error', stop_reason: 'batch_not_queued', error: cutChars(hideSecrets(settings.logText ? `${submitted.message} ${submitted.detail}`.trim() : submitted.message, ctx.secrets), FAILURE_MAX),
      duration_ms: Math.max(0, Date.now() - started),
      ...(MAY_BE_BILLED.includes(submitted.kind) ? {} : { cost_usd: 0 }),
    }
    const problem = await patchCall(ctx.adminDb, ctx.userId, callId, patch)
    if (problem) ctx.report(`a call could not be finished in the ledger (it stays at its reserved cost): ${problem}`)
    // The real report the owner expects: its failure is announced too (from 07:00).
    if (pushDue) await patchReport(ctx.adminDb, ctx.userId, reportId, { push_due: true })
    return { ok: false, reason: 'failed', message, report_id: reportId }
  }
  if (!(await patchReport(ctx.adminDb, ctx.userId, reportId, { batch_id: submitted.batchId }, true))) {
    // A batch nobody can find again is cancelled at once and never read ("delete right after", guardian S2); the report says why.
    ctx.report('the batch was queued but its id could not be saved, so it was cancelled at Anthropic')
    const gone = await letGoOfBatch(ctx, submitted.batchId)
    await fail(`The batch's id could not be saved, so it was cancelled at Anthropic. ${gone.batch_delete_note ?? ''}`.trim())
    const problem = await patchCall(ctx.adminDb, ctx.userId, callId, { outcome: 'error', stop_reason: 'batch_cancelled', error: 'The batch id could not be saved.' })
    if (problem) ctx.report(`a call could not be finished in the ledger (it stays at its reserved cost): ${problem}`)
    if (pushDue) await patchReport(ctx.adminDb, ctx.userId, reportId, { push_due: true })
    return { ok: false, reason: 'failed', message: 'The weekly report could not be saved after it was queued, so it was cancelled. Try again in a moment.', report_id: reportId }
  }
  // The text log of the reserved row, while the owner keeps it on. The row stays 'pending' (counted at its worst case).
  const logPatch: Partial<CallRow> = {
    effort: request.effort, stop_reason: 'batch_queued', duration_ms: 0,
    ...(settings.logText ? { request: trimForLog({
      model: request.model, effort: request.effort, max_output_tokens: request.maxOutputTokens, instructions_version: job.version,
      instructions: request.instructions, user_text: request.userText, thinking: request.thinking, mode: 'batch',
    }, TEXT_LOG_MAX_BYTES) } : {}),
  }
  const problem = await patchCall(ctx.adminDb, ctx.userId, callId, logPatch)
  if (problem) ctx.report(`a batch's ledger row could not be updated: ${problem}`)
  return { ok: true, queued: true, report_id: reportId, week_start: week.start, kind }
}

/** The scheduled try of a week that ended without queueing anything: a failed report row says why (no push). */
async function recordFailedWeek(ctx: RunContext, weekStart: string, existing: ReportRow | null, message: string): Promise<void> {
  const id = ctx.newId()
  const added = existing ? 'exists' : await insertReport(ctx.adminDb, { id, user_id: ctx.userId, week_start: weekStart, made_by: 'schedule', facts: {}, push_due: false })
  if (added === 'error') { ctx.report('the failed week could not be recorded'); return }
  await patchReport(ctx.adminDb, ctx.userId, existing ? existing.id : id, { status: 'failed', failure: cutChars(message, FAILURE_MAX), ready_at: ctx.now().toISOString() }, true)
}

// ── Step 2: check ───────────────────────────────────────────────────────────

export async function checkReports(ctx: RunContext): Promise<ReportCheckReply> {
  if (!ctx.provider) return { ok: false, message: 'AI is not set up yet: the server has no API key for it.' }
  const now = ctx.now()
  await releaseStaleClaims(ctx.adminDb, ctx.userId, new Date(now.getTime() - CLAIM_MS).toISOString())
  const queued = await queuedReports(ctx.adminDb, ctx.userId)
  if (!queued) return { ok: false, message: 'The reports could not be read. Try again in a moment.' }
  const tally = { checked: 0, ready: 0, failed: 0, waiting: 0, pushed: 0 }
  for (const report of queued) {
    if (!(await claimReport(ctx.adminDb, ctx.userId, report.id, report.created_at, now.toISOString()))) continue
    tally.checked += 1
    let outcome: 'ready' | 'failed' | 'waiting'
    try {
      outcome = await checkOne(ctx, report)
    } catch (error) {
      ctx.report(`a report check threw: ${errorPlace(error)}`)
      outcome = 'waiting'
    }
    tally[outcome] += 1
    if (outcome === 'waiting') await releaseClaim(ctx.adminDb, ctx.userId, report.id, report.created_at)
  }
  tally.pushed = await pushPending(ctx)
  return { ok: true, ...tally }
}

async function checkOne(ctx: RunContext, report: ReportRow): Promise<'ready' | 'failed' | 'waiting'> {
  const provider = ctx.provider
  if (!provider) return 'waiting'
  const age = ctx.now().getTime() - Date.parse(report.created_at)
  const tooOld = Number.isFinite(age) && age > BATCH_GIVE_UP_MS
  // Whether the batch was already let go of (after its results were read): an error path lets go of it otherwise.
  let released = false
  const letGo = async (ended: boolean): Promise<void> => {
    if (!report.batch_id || released) return
    released = true
    const gone = await letGoOfBatch(ctx, report.batch_id, ended)
    if (gone.batch_deleted_at) await patchReport(ctx.adminDb, ctx.userId, report.id, { batch_deleted_at: gone.batch_deleted_at }, false, report.created_at)
    else ctx.report(`the weekly report's batch was not deleted: ${gone.batch_delete_note ?? 'no reason'}`)
  }
  const giveUp = async (message: string, stopReason: string): Promise<'failed'> => {
    // Delete right after, on an error path too: cancelled first when it has not ended (guardian S2).
    await letGo(false)
    await endFailed(ctx, report, message, stopReason, true)
    return 'failed'
  }
  if (!report.batch_id) {
    return age > BATCH_NO_ID_MS || tooOld ? giveUp('The batch was never registered, so there is nothing to read.', 'batch_not_registered') : 'waiting'
  }
  const status = await provider.batchStatus(report.batch_id, BATCH_STATUS_MS)
  if (!status.ok) return tooOld ? giveUp('Anthropic could not be asked about the batch for more than a day.', 'batch_unreachable') : 'waiting'
  if (status.status !== 'ended') return tooOld ? giveUp('The batch did not end within a day.', 'batch_expired') : 'waiting'

  const results = await provider.batchResults(report.batch_id, BATCH_REQUEST_MS)
  if (!results.ok) return tooOld ? giveUp('The results could not be read for more than a day.', 'batch_unreachable') : 'waiting'
  // Read: the batch is deleted at Anthropic now (owner: "delete right after"); the report row says when (server-only column).
  await letGo(true)
  // Lines come in any order: the one that is ours is found by its custom_id, compared exactly. Others are ignored.
  const line = results.lines.find(l => l.customId === report.call_id)
  if (!line || !report.call_id) return giveUp('The batch ended without a result for this report.', 'batch_no_result')
  if (line.kind !== 'succeeded') {
    const word = line.kind === 'errored' ? 'failed' : line.kind === 'expired' ? 'expired before it was answered' : 'was cancelled'
    return giveUp(`The batch request ${word}.`, `batch_${line.kind}`)
  }
  const answer = line.answer
  const stored = await readSettingRows(ctx.userDb, ctx.userId, WEEKLY_REPORT_JOB.name)
  const logText = stored ? settingsFor(WEEKLY_REPORT_JOB, stored.account, stored.job).logText : false

  const failure = answerProblem(answer)
  const check = failure ? null : readWeeklyReport(answer.text)
  const bad = failure ?? (check && !check.ok ? `The model's answer could not be used: ${check.problem}.` : null)
  // The real numbers, at the batch price. A model that is not on the price list is charged as the dearest one.
  const price = costOf(answer.usage, answer.servedModel ?? WEEKLY_REPORT_JOB.defaults.model, 'batch')
  const real: Partial<CallRow> = {
    served_model: answer.servedModel, request_id: answer.requestId, stop_reason: answer.stopReason,
    input_tokens: answer.usage.inputTokens, cache_read_tokens: answer.usage.cacheReadTokens,
    cache_write_5m_tokens: answer.usage.cacheWrite5mTokens, cache_write_1h_tokens: answer.usage.cacheWrite1hTokens,
    output_tokens: answer.usage.outputTokens, thinking_tokens: answer.usage.thinkingTokens, long_prompt: price.longPrompt,
    cost_usd: price.costUsd, duration_ms: Number.isFinite(age) ? Math.max(0, Math.round(age)) : 0,
    ...(logText ? { response: trimForLog({ text: answer.text, ...(answer.refusal ? { refusal: answer.refusal } : {}) }, TEXT_LOG_MAX_BYTES), thinking: answer.thinking ? trimText(answer.thinking, TEXT_LOG_MAX_BYTES) : null } : {}),
  }
  if (bad || !check || !check.ok) {
    // The model answered, so it was billed: the row gets the real cost, and the report fails.
    await ledgerFinish(ctx, report, { ...real, outcome: answer.ending === 'refused' ? 'refused' : answer.ending === 'cut_off' ? 'cut_off' : 'invalid', error: cutChars(hideSecrets(bad ?? 'unusable', ctx.secrets), FAILURE_MAX) })
    await endFailed(ctx, report, bad ?? 'The answer could not be used.', null, false)
    return 'failed'
  }
  await ledgerFinish(ctx, report, { ...real, outcome: 'ok', error: null })
  const text = String(check.result.text)
  // The push is owed from now on (the real report of the owner's week only) and goes out from 07:00 (pushPending). The
  // write is tied to the report this check read: a report made again meanwhile has a new created_at and is not touched.
  if (!(await patchReport(ctx.adminDb, ctx.userId, report.id, { status: 'ready', content: text, failure: null, ready_at: ctx.now().toISOString(), claimed_at: null, push_due: report.made_by === 'schedule' && !!ctx.push }, true, report.created_at))) {
    // Never "waiting": the batch is already deleted, a second read would find nothing. A smaller write says what happened.
    ctx.report('a finished report could not be saved (it was made again meanwhile, or the write failed)')
    await endFailed(ctx, report, 'The report was written but could not be saved.', null, false)
    return 'failed'
  }
  return 'ready'
}

/** How long a cancelled batch is waited for before it can be deleted (it ends within seconds), and how often it is asked. */
const LET_GO_WAITS = 3
const LET_GO_WAIT_MS = 2_000

/**
 * "Delete right after" (owner, 23.11.2026): a batch is deleted at Anthropic as soon as the function is done with it — after
 * its results were read, and on every error path. One that has not ended is cancelled first and deleted once it has (a few
 * short waits). Answers when it was deleted, or a short sentence of why not (never a secret). Never throws.
 */
export async function letGoOfBatch(ctx: RunContext, batchId: string | null, ended = false): Promise<{ batch_deleted_at: string | null; batch_delete_note: string | null }> {
  const provider = ctx.provider
  if (!batchId || !provider) return { batch_deleted_at: null, batch_delete_note: 'No batch to delete.' }
  try {
    if (!ended) {
      const status = await provider.batchStatus(batchId, BATCH_STATUS_MS)
      if (status.ok && status.status !== 'ended') {
        const cancelled = await provider.cancelBatch(batchId, BATCH_STATUS_MS)
        if (!cancelled.ok) return { batch_deleted_at: null, batch_delete_note: cutChars(`Not cancelled: ${hideSecrets(cancelled.message, ctx.secrets)}`, 300) }
        let over = false
        for (let i = 0; i < LET_GO_WAITS && !over; i++) {
          await new Promise(resolve => setTimeout(resolve, LET_GO_WAIT_MS))
          const again = await provider.batchStatus(batchId, BATCH_STATUS_MS)
          over = again.ok && again.status === 'ended'
        }
        if (!over) return { batch_deleted_at: null, batch_delete_note: 'Cancelled at Anthropic; it had not ended yet, so it could not be deleted.' }
      }
    }
    const deleted = await provider.deleteBatch(batchId, BATCH_STATUS_MS)
    return deleted.ok
      ? { batch_deleted_at: ctx.now().toISOString(), batch_delete_note: null }
      : { batch_deleted_at: null, batch_delete_note: cutChars(`Not deleted: ${hideSecrets(deleted.message, ctx.secrets)}`, 300) }
  } catch (error) {
    return { batch_deleted_at: null, batch_delete_note: cutChars(`Not deleted: ${errorPlace(error)}`, 300) }
  }
}

/** Why a model's answer is no report, or null. */
export function answerProblem(answer: ModelAnswer): string | null {
  if (answer.ending === 'refused') return 'The model declined to write this report.'
  if (answer.ending === 'cut_off') return 'The report was cut off at its length limit.'
  if (answer.ending !== 'complete') return `The model stopped in a way this app does not handle yet (${answer.stopReason}).`
  return null
}

/** The ledger row, corrected with what is now known. A failed write leaves the reserved worst case: the safe side. */
async function ledgerFinish(ctx: RunContext, report: ReportRow, patch: Partial<CallRow>): Promise<void> {
  if (!report.call_id) { ctx.report('a report has no ledger row to correct'); return }
  const problem = await patchCall(ctx.adminDb, ctx.userId, report.call_id, patch)
  if (problem) ctx.report(`a call could not be finished in the ledger (it stays at its reserved cost): ${problem}`)
}

/**
 * Ends a report as failed, for good. With `keepWorstCase` the ledger row keeps the reserved cost (the batch ended
 * without an answer we can price: errored, expired, cancelled or gone) and says how it ended.
 */
async function endFailed(ctx: RunContext, report: ReportRow, message: string, stopReason: string | null, keepWorstCase: boolean): Promise<void> {
  if (keepWorstCase) await ledgerFinish(ctx, report, { outcome: 'error', stop_reason: stopReason, error: cutChars(message, FAILURE_MAX) })
  // A failed real report is announced too (from 07:00): the owner expects one on Monday.
  await patchReport(ctx.adminDb, ctx.userId, report.id, {
    status: 'failed', failure: cutChars(message, FAILURE_MAX), ready_at: ctx.now().toISOString(), claimed_at: null, push_due: report.made_by === 'schedule' && !!ctx.push,
  }, true, report.created_at)
}

/**
 * The pushes that are owed: sent only from 07:00 to 22:00 Oslo time (a report finished at 05:30 is announced at 07:00). Each is
 * stamped before it is sent, so two overlapping checks send one and a push that fails is not repeated. Only the owner's real
 * reports are ever owed (`push_due`), and `ctx.push` is null for any other account (main.ts).
 */
async function pushPending(ctx: RunContext): Promise<number> {
  if (!ctx.push || !pushWindowOpen(ctx.now())) return 0
  const due = await pendingPushes(ctx.adminDb, ctx.userId)
  if (!due) return 0
  let sent = 0
  for (const report of due) {
    if (!(await claimPush(ctx.adminDb, ctx.userId, report.id, report.created_at, ctx.now().toISOString()))) continue
    const message = report.status === 'ready'
      ? { title: 'Weekly report', body: `Your report for ${dmy(report.week_start)} – ${dmy(shiftDay(report.week_start, 6))} is ready.`, url: `#/home?report=${report.id}` }
      : { title: 'Weekly report', body: PUSH_FAILED_BODY, url: '#/developer?tab=ai&view=learn&learn=batches' }
    let delivered = false
    try {
      delivered = await ctx.push(message)
    } catch (error) {
      ctx.report(`the push threw: ${errorPlace(error)}`)
    }
    if (delivered) sent += 1
    else ctx.report('a report push was not delivered (it is not repeated)')
  }
  return sent
}
