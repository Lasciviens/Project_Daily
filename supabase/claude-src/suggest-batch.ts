// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · the weekly suggestions' batch (phase 4c, migration 199)
//
//  The same two steps as the weekly report (batch.ts), small:
//    makeWeeklySuggestions  — Monday 05:00 Oslo (after the report, from the same timer) or the Suggestions view's button:
//                             count the repeats in the ledger with code (`ai_suggest_patterns`), and only when something
//                             repeats, queue ONE request at the batch price, reserved against the budget first.
//    checkSuggestRuns       — read the batch back when Anthropic has ended it (the 15-minute check timer), check the
//                             answer, and write at most five ideas through `ai_suggestion_add` (deduped, capped).
//  The model reads counts, costs and shapes and the titles and states of earlier ideas: never a row of the owner's data.
//  Its answer is input: every idea passes `checkedIdea`, names a pattern it was shown, and its key is made from that
//  pattern, never from the model. A failure never loops (a failed week is not tried again by the timer) and never stops
//  anything else: the report and every answer run before and apart from this.
// ─────────────────────────────────────────────────────────────────────────────

import type { ModelAnswer } from './types.ts'
import { costOf, worstCostOf } from './prices.ts'
import { callerDailyCap, cutChars, errorPlace, hideSecrets, LIMITS, rateCapProblem, reservationBudgetProblem, settingsFor, trimForLog, trimText, TEXT_LOG_MAX_BYTES } from './guard.ts'
import { readGate, readSettingRows, reserveCall, writeCall, type CallRow } from './ledger.ts'
import { buildRequest, gateScopeOf, type RunContext } from './run.ts'
import { answerProblem, letGoOfBatch, BATCH_GIVE_UP_MS, BATCH_NO_ID_MS, BATCH_REQUEST_MS, BATCH_STATUS_MS, CLAIM_MS, FAILURE_MAX, ledgerRow, MAY_BE_BILLED } from './batch.ts'
import { patchCall } from './report-store.ts'
import { osloWeekOf, scheduledReportWeek } from './week-facts.ts'
import { SUGGEST_WEEKLY_JOB } from './job-suggest-weekly.ts'
import { patternKey, readWeeklyIdeas, savingOf, storedPatterns, weeklyPrompt } from './suggest-rules.ts'
import {
  addSuggestion, claimRun, countPatterns, findRun, insertRun, patchRun, queuedRuns, readEarlierIdeas, releaseStaleRunClaims, requeueRun, type RunRow,
} from './suggest-store.ts'

export type SuggestMakeReply =
  | { ok: true; queued: true; run_id: string; week_start: string }
  | { ok: true; queued: false; skipped: 'not_the_time' | 'already_made' | 'already_queued' | 'nothing_repeats'; week_start: string | null }
  | { ok: false; reason: 'error' | 'off' | 'not_configured' | 'busy' | 'budget' | 'bad_input' | 'failed'; message: string }

export type SuggestCheckReply =
  | { ok: true; checked: number; done: number; failed: number; waiting: number }
  | { ok: false; message: string }

// ── Step 1: make ────────────────────────────────────────────────────────────

export async function makeWeeklySuggestions(ctx: RunContext): Promise<SuggestMakeReply> {
  const job = SUGGEST_WEEKLY_JOB
  const scheduled = ctx.caller === 'schedule'
  if (!job.callers.includes(ctx.caller)) return { ok: false, reason: 'bad_input', message: `"${job.title}" can't be started from here.` }
  const now = ctx.now()
  // The timer looks at the week that just ended, in the same window as the report (05:00 to 07:00 Monday); the button looks at this week.
  const week = scheduled ? scheduledReportWeek(now)?.start ?? null : osloWeekOf(now).start
  if (!week) return { ok: true, queued: false, skipped: 'not_the_time', week_start: null }
  const madeBy: 'schedule' | 'app' = scheduled ? 'schedule' : 'app'

  const existing = await findRun(ctx.adminDb, ctx.userId, week, madeBy)
  if (existing === undefined) return { ok: false, reason: 'error', message: 'The earlier runs could not be read, so nothing was queued. Try again in a moment.' }
  if (existing?.status === 'queued') return { ok: true, queued: false, skipped: 'already_queued', week_start: week }
  // The timer makes one run a week, a failed one included (no loop); the button may ask again.
  if (existing && scheduled) return { ok: true, queued: false, skipped: 'already_made', week_start: week }

  const stop = async (reason: 'off' | 'not_configured' | 'busy' | 'error' | 'budget', message: string, model: string): Promise<SuggestMakeReply> => {
    // The timer says nothing when AI is off or not set up (the report's own try already said it); only the owner's button leaves a row.
    if (reason !== 'busy' && !scheduled) {
      const row = ledgerRow(ctx, model, job)
      row.outcome = reason
      row.error = cutChars(message, FAILURE_MAX)
      const problem = await writeCall(ctx.adminDb, row)
      if (problem) ctx.report(`a call was not written to the ledger: ${problem}`)
    }
    return { ok: false, reason, message }
  }

  const gate = await readGate(ctx.userDb, job.name, gateScopeOf(ctx))
  if (!gate) return { ok: false, reason: 'error', message: 'The AI usage could not be read, so nothing was queued. Try again in a moment.' }
  const tooMany = rateCapProblem(gate, ctx.caller)
  if (tooMany) return { ok: false, reason: 'busy', message: tooMany }
  const stored = await readSettingRows(ctx.userDb, ctx.userId, job.name)
  if (!stored) return stop('error', 'Your AI settings could not be read, so nothing was queued. Try again in a moment.', job.defaults.model)
  const settings = settingsFor(job, stored.account, stored.job)
  if (!settings.aiEnabled) return stop('off', 'All AI is switched off in Developer → AI → Settings.', settings.model)
  if (!settings.enabled) return stop('off', `"${job.title}" is switched off in Developer → AI → Settings.`, settings.model)
  if (!ctx.provider) return stop('not_configured', 'AI is not set up yet: the server has no API key for it.', settings.model)

  // AI last: the counting is a database function; the model is asked only when something repeats.
  const patterns = await countPatterns(ctx.adminDb, ctx.userId)
  if (!patterns) return { ok: false, reason: 'error', message: 'The ledger could not be counted, so nothing was queued. Try again in a moment.' }
  const earlier = await readEarlierIdeas(ctx.adminDb, ctx.userId)
  if (!earlier) return { ok: false, reason: 'error', message: 'The earlier ideas could not be read, so nothing was queued. Try again in a moment.' }
  const userText = weeklyPrompt(patterns, earlier)
  const factsJson = { patterns } as unknown as Record<string, unknown>

  const runId = existing ? existing.id : ctx.newId()
  const saved = existing
    ? await requeueRun(ctx.adminDb, ctx.userId, existing.id, userText, patterns.length, factsJson, now.toISOString()) ? 'ok' : 'exists'
    : await insertRun(ctx.adminDb, { id: runId, user_id: ctx.userId, week_start: week, made_by: madeBy, sent_text: userText, patterns: patterns.length, facts: factsJson })
  if (saved === 'exists') return { ok: true, queued: false, skipped: 'already_queued', week_start: week }
  if (saved === 'error') return { ok: false, reason: 'error', message: 'The run could not be saved, so nothing was queued. Try again in a moment.' }
  const fail = (message: string) => patchRun(ctx.adminDb, ctx.userId, runId, { status: 'failed', failure: cutChars(message, FAILURE_MAX), finished_at: ctx.now().toISOString() }, true)

  if (patterns.length === 0) {
    // Nothing repeats enough to be an idea: no model call, no cost; the run says so.
    await patchRun(ctx.adminDb, ctx.userId, runId, { status: 'done', added: 0, finished_at: ctx.now().toISOString() }, true)
    return { ok: true, queued: false, skipped: 'nothing_repeats', week_start: week }
  }

  const request = buildRequest(job, settings, userText, settings.thinking)
  const worstCost = worstCostOf(request.model, request.instructions.length + request.userText.length, request.maxOutputTokens, 'batch')
  const reservation = await reserveCall(ctx.adminDb, {
    userId: ctx.userId, job: job.name, caller: ctx.caller, mode: 'batch', provider: ctx.providerName, model: request.model,
    effort: request.effort, instructionsVersion: job.version, worstCostUsd: worstCost,
    budgetUsd: settings.monthlyBudgetUsd, jobBudgetUsd: settings.jobBudgetUsd,
    perMinute: LIMITS.callsPerMinute, perDay: LIMITS.callsPerDay, callerPerDay: callerDailyCap(ctx.caller),
  })
  if (!reservation) {
    await fail('The AI budget could not be checked, so nothing was queued.')
    return { ok: false, reason: 'error', message: 'The AI budget could not be checked, so nothing was queued. Try again in a moment.' }
  }
  if (reservation.kind === 'busy') {
    await fail('Too many AI calls at the moment, so nothing was queued.')
    return { ok: false, reason: 'busy', message: `That is more than ${LIMITS.callsPerMinute} AI calls in a minute, ${LIMITS.callsPerDay} today, or ${callerDailyCap(ctx.caller)} in 24 hours. Wait a moment and try again.` }
  }
  if (reservation.kind === 'budget') {
    const message = reservationBudgetProblem(settings, job.title)
    await fail(message)
    return { ok: false, reason: 'budget', message }
  }
  const callId = reservation.id
  await patchRun(ctx.adminDb, ctx.userId, runId, { call_id: callId }, true)

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
    return { ok: false, reason: 'failed', message }
  }
  if (!(await patchRun(ctx.adminDb, ctx.userId, runId, { batch_id: submitted.batchId }, true))) {
    ctx.report('the suggestions batch was queued but its id could not be saved: the run will be given up after 26 hours (its worst case stays in the ledger)')
  }
  const logPatch: Partial<CallRow> = {
    effort: request.effort, stop_reason: 'batch_queued', duration_ms: 0,
    ...(settings.logText ? { request: trimForLog({
      model: request.model, effort: request.effort, max_output_tokens: request.maxOutputTokens, instructions_version: job.version,
      instructions: request.instructions, user_text: request.userText, thinking: request.thinking, mode: 'batch',
    }, TEXT_LOG_MAX_BYTES) } : {}),
  }
  const problem = await patchCall(ctx.adminDb, ctx.userId, callId, logPatch)
  if (problem) ctx.report(`a batch's ledger row could not be updated: ${problem}`)
  return { ok: true, queued: true, run_id: runId, week_start: week }
}

// ── Step 2: check ───────────────────────────────────────────────────────────

export async function checkSuggestRuns(ctx: RunContext): Promise<SuggestCheckReply> {
  if (!ctx.provider) return { ok: false, message: 'AI is not set up yet: the server has no API key for it.' }
  const now = ctx.now()
  await releaseStaleRunClaims(ctx.adminDb, ctx.userId, new Date(now.getTime() - CLAIM_MS).toISOString())
  const queued = await queuedRuns(ctx.adminDb, ctx.userId)
  if (!queued) return { ok: false, message: 'The suggestion runs could not be read. Try again in a moment.' }
  const tally = { checked: 0, done: 0, failed: 0, waiting: 0 }
  for (const run of queued) {
    if (!(await claimRun(ctx.adminDb, ctx.userId, run.id, run.created_at, now.toISOString()))) continue
    tally.checked += 1
    let outcome: 'done' | 'failed' | 'waiting'
    try {
      outcome = await checkOneRun(ctx, run)
    } catch (error) {
      ctx.report(`a suggestion run check threw: ${errorPlace(error)}`)
      outcome = 'waiting'
    }
    tally[outcome] += 1
    if (outcome === 'waiting') await patchRun(ctx.adminDb, ctx.userId, run.id, { claimed_at: null }, true, run.created_at)
  }
  return { ok: true, ...tally }
}

async function suggestLedgerFinish(ctx: RunContext, run: RunRow, patch: Partial<CallRow>): Promise<void> {
  if (!run.call_id) { ctx.report('a suggestion run has no ledger row to correct'); return }
  const problem = await patchCall(ctx.adminDb, ctx.userId, run.call_id, patch)
  if (problem) ctx.report(`a call could not be finished in the ledger (it stays at its reserved cost): ${problem}`)
}

async function endSuggestRun(ctx: RunContext, run: RunRow, message: string, stopReason: string | null, keepWorstCase: boolean): Promise<void> {
  if (keepWorstCase) await suggestLedgerFinish(ctx, run, { outcome: 'error', stop_reason: stopReason, error: cutChars(message, FAILURE_MAX) })
  await patchRun(ctx.adminDb, ctx.userId, run.id, { status: 'failed', failure: cutChars(message, FAILURE_MAX), finished_at: ctx.now().toISOString(), claimed_at: null }, true, run.created_at)
}

async function checkOneRun(ctx: RunContext, run: RunRow): Promise<'done' | 'failed' | 'waiting'> {
  const provider = ctx.provider
  if (!provider) return 'waiting'
  const age = ctx.now().getTime() - Date.parse(run.created_at)
  const tooOld = Number.isFinite(age) && age > BATCH_GIVE_UP_MS
  const giveUp = async (message: string, stopReason: string): Promise<'failed'> => { await endSuggestRun(ctx, run, message, stopReason, true); return 'failed' }
  if (!run.batch_id) return age > BATCH_NO_ID_MS || tooOld ? giveUp('The batch was never registered, so there is nothing to read.', 'batch_not_registered') : 'waiting'
  const status = await provider.batchStatus(run.batch_id, BATCH_STATUS_MS)
  if (!status.ok) return tooOld ? giveUp('Anthropic could not be asked about the batch for more than a day.', 'batch_unreachable') : 'waiting'
  if (status.status !== 'ended') return tooOld ? giveUp('The batch did not end within a day.', 'batch_expired') : 'waiting'
  const results = await provider.batchResults(run.batch_id, BATCH_REQUEST_MS)
  if (!results.ok) return tooOld ? giveUp('The results could not be read for more than a day.', 'batch_unreachable') : 'waiting'
  // Read: the batch is deleted at Anthropic now (owner: "delete right after"); the run row says when (server-only column).
  const gone = await letGoOfBatch(ctx, run.batch_id, true)
  if (gone.batch_deleted_at) await patchRun(ctx.adminDb, ctx.userId, run.id, { batch_deleted_at: gone.batch_deleted_at }, false, run.created_at)
  else ctx.report(`the suggestions' batch was not deleted: ${gone.batch_delete_note ?? 'no reason'}`)
  const line = results.lines.find(l => l.customId === run.call_id)
  if (!line || !run.call_id) return giveUp('The batch ended without a result for this run.', 'batch_no_result')
  if (line.kind !== 'succeeded') {
    const word = line.kind === 'errored' ? 'failed' : line.kind === 'expired' ? 'expired before it was answered' : 'was cancelled'
    return giveUp(`The batch request ${word}.`, `batch_${line.kind}`)
  }
  const answer: ModelAnswer = line.answer
  const stored = await readSettingRows(ctx.userDb, ctx.userId, SUGGEST_WEEKLY_JOB.name)
  const logText = stored ? settingsFor(SUGGEST_WEEKLY_JOB, stored.account, stored.job).logText : false
  const patterns = storedPatterns(run.facts)
  const failure = answerProblem(answer)
  const read = failure ? null : readWeeklyIdeas(answer.text, patterns)
  const bad = failure ?? (read && !read.ok ? `The model's answer could not be used: ${read.problem}.` : null)
  const price = costOf(answer.usage, answer.servedModel ?? SUGGEST_WEEKLY_JOB.defaults.model, 'batch')
  const real: Partial<CallRow> = {
    served_model: answer.servedModel, request_id: answer.requestId, stop_reason: answer.stopReason,
    input_tokens: answer.usage.inputTokens, cache_read_tokens: answer.usage.cacheReadTokens,
    cache_write_5m_tokens: answer.usage.cacheWrite5mTokens, cache_write_1h_tokens: answer.usage.cacheWrite1hTokens,
    output_tokens: answer.usage.outputTokens, thinking_tokens: answer.usage.thinkingTokens, long_prompt: price.longPrompt,
    cost_usd: price.costUsd, duration_ms: Number.isFinite(age) ? Math.max(0, Math.round(age)) : 0,
    ...(logText ? { response: trimForLog({ text: answer.text, ...(answer.refusal ? { refusal: answer.refusal } : {}) }, TEXT_LOG_MAX_BYTES), thinking: answer.thinking ? trimText(answer.thinking, TEXT_LOG_MAX_BYTES) : null } : {}),
  }
  if (bad || !read || !read.ok) {
    await suggestLedgerFinish(ctx, run, { ...real, outcome: answer.ending === 'refused' ? 'refused' : answer.ending === 'cut_off' ? 'cut_off' : 'invalid', error: cutChars(hideSecrets(bad ?? 'unusable', ctx.secrets), FAILURE_MAX) })
    await endSuggestRun(ctx, run, bad ?? 'The answer could not be used.', null, false)
    return 'failed'
  }
  await suggestLedgerFinish(ctx, run, { ...real, outcome: 'ok', error: null })
  // The ideas: each through the database function (the key from its pattern, a dismissed idea never written, the caps).
  let added = 0
  for (const { pattern, idea } of read.ideas) {
    const result = await addSuggestion(ctx.adminDb, ctx.userId, idea, await patternKey(pattern), 'weekly', savingOf(pattern), pattern.firstCallId)
    if (result === 'added') added += 1
    else if (result === 'error') ctx.report('an idea could not be saved')
  }
  if (!(await patchRun(ctx.adminDb, ctx.userId, run.id, { status: 'done', added: Math.min(added, 5), failure: null, finished_at: ctx.now().toISOString(), claimed_at: null }, true, run.created_at))) {
    ctx.report('a finished suggestion run could not be saved (it was made again meanwhile, or the write failed)')
    return 'waiting'
  }
  return 'done'
}
