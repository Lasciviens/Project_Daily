// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · one run
//
//  One request for one job, from the name in the request to the answer the app
//  gets. The order of the steps below is the design: every wall comes before
//  the model is called, and whatever happens is written to the ledger.
//
//  This part knows no provider. It is handed one (types.ts → Provider) and
//  only ever sees our own request and answer shapes.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AnswerCheck, Caller, CountReply, EarlyStep, JobDefinition, ModelAnswer, ModelFailure, ModelRequest, Outcome, PageEnv,
  PreparedRun, Provider, RequestImage, RunReply, TokenUsage,
} from './types.ts'
import { costOf, WEB_SEARCH_MAX_USES, worstCostOf } from './prices.ts'
import {
  callerDailyCap, checkedChoice, cutChars, errorPlace, hideSecrets, LIMITS, rateCapProblem, requestTimeoutMs, reservationBudgetProblem, settingsFor, trimForLog,
  trimText, TEXT_LOG_MAX_BYTES, type RunSettings,
} from './guard.ts'
import {
  countRecentCalls, finishCall, readGate, readSettingRows, reserveCall, summaryOf, writeCall, type CallRow, type Db, type GateScope,
} from './ledger.ts'
import { findJob } from './jobs.ts'

/** A notification: fixed words built by code, and where a tap opens (a hash route inside the app). */
export interface PushMessage {
  title: string
  body: string
  url: string
}

/** Everything a run needs from outside, handed in by main.ts (or by a test). */
export interface RunContext {
  /** The account the session belongs to, as main.ts verified it. Never a value from the request. */
  userId: string
  caller: Caller
  /**
   * Who reads the owner's settings and the ledger's counts. `owner` (the app): `userDb` carries the owner's own
   * token, so row level security decides what it reads and `ai_gate` answers. `server` (a device run, which has no
   * token): `userDb` is the service-role client, every read of it is scoped to `userId` in the query itself.
   */
  readAs: 'owner' | 'server'
  /** The database client the settings and the ledger counts are read with (see `readAs`). */
  userDb: Db
  /** The service-role client: the only writer of the ledger. */
  adminDb: Db
  /** The model provider, or null while no API key is configured. */
  provider: Provider | null
  providerName: string
  /** The network and the name lookup for a job that reads an outside page (page-fetch.ts). */
  page: PageEnv
  /** The secrets this function holds, to keep out of every message. */
  secrets: readonly (string | null | undefined)[]
  now: () => Date
  newId: () => string
  /** A longer limit for this run's request than the provider's 30 s: only Diagnose sets it. */
  timeoutMs?: number
  /**
   * Sends one notification to the owner's phone (main.ts: push-send, with a secret this function holds), or null when
   * there is no way to. The weekly report is the only caller; the text is built by code, never from the model.
   */
  push?: ((message: PushMessage) => Promise<boolean>) | null
  /** One line for the server log. It never gets a secret or any of the owner's text. */
  report: (line: string) => void
}

// What the ledger shows for a request that named no job this function has.
const RUN_UNKNOWN_JOB = 'unknown'
const RUN_NO_MODEL = 'none'
// The provider column of a row for work code did alone (no model asked).
const RUN_PAGE_PROVIDER = 'page'
export const RUN_ERROR_MAX = 500
// A call that failed in one of these ways may still have been billed (the request may have reached the model), so
// its row keeps the reserved worst-case cost. A refusal at the door (a bad key, a bad request, a spend limit, a 429)
// never started a generation.
export const RUN_MAY_BE_BILLED: readonly ModelFailure['kind'][] = ['network', 'timeout', 'overloaded', 'provider_fault', 'unknown']
export const RUN_NO_TOKENS: TokenUsage = {
  inputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, outputTokens: 0, thinkingTokens: 0,
}

/** A ledger row for this run, with every column at "nothing happened yet". */
export function newRow(ctx: RunContext, job: JobDefinition | null | undefined): CallRow {
  return {
    id: ctx.newId(), user_id: ctx.userId, run_id: ctx.newId(), step: 1,
    job: job?.name ?? RUN_UNKNOWN_JOB, caller: ctx.caller, mode: 'live', provider: ctx.providerName,
    model: job?.defaults.model ?? RUN_NO_MODEL, served_model: null, effort: null,
    outcome: 'error', stop_reason: null, error: null, request_id: null,
    input_tokens: 0, cache_read_tokens: 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0,
    output_tokens: 0, thinking_tokens: 0, long_prompt: false, cost_usd: 0, duration_ms: 0,
    instructions_version: job?.version ?? null, tools: [], request: null, response: null, thinking: null,
  }
}

export async function runJob(ctx: RunContext, jobName: unknown, input: unknown): Promise<RunReply> {
  const job = findJob(jobName)
  const row = newRow(ctx, job)
  /** Ends the run before the model is called: a ledger row with no tokens, and the reason for the app. */
  const stop = async (reason: Exclude<Outcome, 'ok'>, message: string): Promise<RunReply> => {
    row.outcome = reason
    row.error = cutChars(message, RUN_ERROR_MAX)
    await record(ctx, row)
    return { ok: false, reason, message, call: summaryOf(row) }
  }

  // 1 · The rate caps, read early. They come before anything is written, so a flood of requests (bad ones included)
  //     fills neither the ledger nor the bill: over a cap, the answer is "busy" and no row is written. (The
  //     reservation in step 6 checks the caps again, under a lock, for requests that arrive at the same moment.)
  const gate = await readGate(ctx.userDb, row.job, gateScopeOf(ctx))
  if (!gate) {
    ctx.report('the usage could not be read, so nothing was sent')
    return { ok: false, reason: 'error', message: 'The AI usage could not be read, so nothing was sent. Try again in a moment.' }
  }
  const tooMany = rateCapProblem(gate, ctx.caller)
  if (tooMany) return { ok: false, reason: 'busy', message: tooMany }

  // 2 · The job, by name from the fixed list, and its own check of the input.
  if (!job) return stop('bad_input', 'There is no AI job with that name.')
  if (!job.callers.includes(ctx.caller) || job.mode === 'batch') return stop('bad_input', `"${job.title}" can't be started from here.`)
  const prepared = job.prepare(input, ctx.now())
  if ('problem' in prepared) return stop('bad_input', prepared.problem)

  // 3 · The owner's settings. They are stored where the browser can write, so each value is input:
  //     settingsFor puts every one through its list or its limits.
  const stored = await readSettingRows(ctx.userDb, ctx.userId, job.name)
  if (!stored) return stop('error', 'Your AI settings could not be read, so nothing was sent. Try again in a moment.')
  const settings = settingsFor(job, stored.account, stored.job)
  // A job that lets the request pick (the Test bench) still goes through the code's lists: a model or an effort that
  // is not on them is refused here, whatever the job said.
  const choice = prepared.choice ? checkedChoice(prepared.choice) : {}
  if (!choice) return stop('bad_input', 'That model, effort or thinking setting is not one this app offers.')
  if (choice.model) settings.model = choice.model
  if (choice.effort) settings.effort = choice.effort
  row.model = settings.model
  row.effort = settings.effort

  // 4 · The master switch, the job's switch and the API key.
  if (!settings.aiEnabled) return stop('off', 'All AI is switched off in Developer → AI → Settings.')
  if (!settings.enabled) return stop('off', `"${job.title}" is switched off in Developer → AI → Settings.`)
  if (!ctx.provider) return stop('not_configured', 'AI is not set up yet: the server has no API key for it.')

  // 4b · AI last: a job may have work that code does better before any model is asked (reading a recipe page, and
  //      finding the recipe the page already holds). Code that answers alone is no AI call: nothing is reserved or
  //      sent, but a finished zero-cost row is written (so the rate caps count every read), and the reply says
  //      `source: 'page'`.
  let userText = prepared.userText
  if (prepared.early) {
    const earlyStarted = Date.now()
    const early = await runEarly(ctx, prepared.early.bind(prepared))
    if (early.kind === 'stop') return stop(early.outcome, early.message)
    if (early.kind === 'answer') {
      row.outcome = 'ok'
      row.provider = RUN_PAGE_PROVIDER
      row.model = RUN_NO_MODEL
      row.effort = null
      row.cost_usd = 0
      row.duration_ms = Math.max(0, Date.now() - earlyStarted)
      // The link is input and may be long: it goes in only while the owner keeps the text log on.
      if (settings.logText && early.note) row.request = trimForLog({ read_by_code: early.note }, TEXT_LOG_MAX_BYTES)
      await record(ctx, row)
      return { ok: true, job: job.name, result: early.result, source: 'page', call: summaryOf(row) }
    }
    userText = early.userText
  }

  // 5 · The request: the fixed instructions first (the provider caches them), then the part that changes.
  const request = buildRequest(job, settings, userText, choice.thinking ?? settings.thinking, ctx.timeoutMs, { images: prepared.images, webSearchMax: prepared.webSearchMax })

  // 6 · The reservation: the most this call could cost is held against the budget BEFORE it is sent, in one step
  //     under a lock in the database. Requests that arrive at the same moment each hold their own share, so none
  //     can slip past the wall, and a call whose bill is unknown (a timeout) stays charged at that worst case.
  // A photo adds its tokens (worked out from its own header); every search the call may run adds its fee and its results.
  const worstCost = worstCostOf(
    request.model, request.instructions.length + request.userText.length + (request.answerSchema ? JSON.stringify(request.answerSchema).length : 0), request.maxOutputTokens,
    'live', { imageTokens: prepared.imageTokens ?? 0, webSearches: request.webSearch?.maxUses ?? 0 },
  )
  const reservation = await reserveCall(ctx.adminDb, {
    userId: ctx.userId, job: job.name, caller: ctx.caller, mode: row.mode, provider: ctx.providerName, model: request.model,
    effort: request.effort, instructionsVersion: job.version, worstCostUsd: worstCost,
    budgetUsd: settings.monthlyBudgetUsd, jobBudgetUsd: settings.jobBudgetUsd,
    perMinute: LIMITS.callsPerMinute, perDay: LIMITS.callsPerDay, callerPerDay: callerDailyCap(ctx.caller),
  })
  if (!reservation) {
    ctx.report('the budget could not be reserved, so nothing was sent')
    return { ok: false, reason: 'error', message: 'The AI budget could not be checked, so nothing was sent. Try again in a moment.' }
  }
  if (reservation.kind === 'busy') {
    return { ok: false, reason: 'busy', message: `That is more than ${LIMITS.callsPerMinute} AI calls in a minute, ${LIMITS.callsPerDay} today, or ${callerDailyCap(ctx.caller)} in 24 hours from ${ctx.caller === 'app' ? 'the app' : 'this device'}. Wait a moment and try again.` }
  }
  // From here the database holds a row for this call: it is finished by id, never written a second time.
  row.id = reservation.id
  if (reservation.kind === 'budget') {
    row.outcome = 'budget'
    row.error = cutChars(reservationBudgetProblem(settings, job.title), RUN_ERROR_MAX)
    return { ok: false, reason: 'budget', message: reservationBudgetProblem(settings, job.title), call: summaryOf(row) }
  }
  const started = Date.now()
  const answer = await send(ctx, ctx.provider, request)
  row.duration_ms = Math.max(0, Date.now() - started)
  // One step is the whole run in phase 1. Phase 4 puts the tool loop here: while the answer asks for a tool,
  // run the tool as the owner, add its result to the conversation and send again. Each round gets its own
  // ledger row with this run_id and the next step number.

  // 7 · Reading the answer: how it ended first, then the job's own check of what it says.
  const verdict = judge(answer, prepared, settings.maxOutputTokens)

  // 8 · The ledger: what it cost, how long it took, how it ended. The cost comes from this code's price table.
  const usage = answer.ok ? answer.usage : RUN_NO_TOKENS
  const searches = answer.ok ? answer.webSearches : 0
  const price = costOf(usage, request.model, row.mode, searches)
  // The searches the call really ran are logged (the count, never what was found).
  if (searches > 0) row.tools = [{ name: 'web_search', searches }]
  row.outcome = verdict.ok ? 'ok' : verdict.outcome
  // The provider's own explanation goes into the row only while the text log is on: with it off, the row holds
  // nothing but our fixed sentence.
  row.error = verdict.ok ? null : cutChars(hideSecrets(settings.logText ? verdict.logLine : verdict.message, ctx.secrets), RUN_ERROR_MAX)
  row.request_id = answer.requestId
  row.stop_reason = answer.ok ? answer.stopReason : null
  row.served_model = answer.ok ? answer.servedModel : null
  row.input_tokens = usage.inputTokens
  row.cache_read_tokens = usage.cacheReadTokens
  row.cache_write_5m_tokens = usage.cacheWrite5mTokens
  row.cache_write_1h_tokens = usage.cacheWrite1hTokens
  row.output_tokens = usage.outputTokens
  row.thinking_tokens = usage.thinkingTokens
  row.long_prompt = price.longPrompt
  // A failure that may have been billed (a timeout, a network error, a 5xx, an unknown fault) stays at the worst case.
  row.cost_usd = !answer.ok && RUN_MAY_BE_BILLED.includes(answer.kind) ? worstCost : price.costUsd
  if (settings.logText) {
    // The text log, only while the owner keeps it on: what was sent, and what came back.
    row.request = trimForLog({
      model: request.model, effort: request.effort, max_output_tokens: request.maxOutputTokens,
      instructions_version: job.version, instructions: request.instructions, user_text: request.userText,
      answer_schema: request.answerSchema, thinking: request.thinking,
      // A photo is never kept in the log: only how many were sent and how big.
      ...(request.images?.length ? { images: request.images.map(i => ({ media_type: i.mediaType, base64_chars: i.base64.length })) } : {}),
      ...(request.webSearch ? { web_search_max_uses: request.webSearch.maxUses } : {}),
      // The request as the provider part built it (the cache mark, the thinking setting, the time limit …).
      ...(answer.sent ? { sent_to_provider: answer.sent } : {}),
    }, TEXT_LOG_MAX_BYTES)
    if (answer.ok) {
      row.response = trimForLog({ text: answer.text, ...(answer.refusal ? { refusal: answer.refusal } : {}) }, TEXT_LOG_MAX_BYTES)
      row.thinking = answer.thinking ? trimText(answer.thinking, TEXT_LOG_MAX_BYTES) : null
    }
  }
  await finish(ctx, row)

  // 9 · The reply. A message leaves only through hideSecrets.
  if (verdict.ok) return { ok: true, job: job.name, result: verdict.result, call: summaryOf(row) }
  return { ok: false, reason: verdict.outcome, message: hideSecrets(verdict.message, ctx.secrets), call: summaryOf(row) }
}

export function gateScopeOf(ctx: RunContext): GateScope {
  return ctx.readAs === 'owner' ? { kind: 'owner' } : { kind: 'server', userId: ctx.userId, caller: ctx.caller, now: ctx.now() }
}

/**
 * The request a run sends, from the job, the checked settings and the live text. The Test bench's token count
 * builds it the same way, so the number it shows is the number of the request that would be sent.
 */
export function buildRequest(
  job: JobDefinition, settings: RunSettings, userText: string, thinking: 'adaptive' | 'off', timeoutOverride?: number,
  extra: { images?: RequestImage[]; webSearchMax?: number } = {},
): ModelRequest {
  return {
    ...(extra.images?.length && job.acceptsImage ? { images: extra.images } : {}),
    // The tool only for a job whose definition names it (a job's prepare alone can never switch a tool on).
    ...(extra.webSearchMax && extra.webSearchMax > 0 && job.tools?.some(t => t.name === 'web_search') ? { webSearch: { maxUses: Math.min(Math.floor(extra.webSearchMax), WEB_SEARCH_MAX_USES) } } : {}),
    model: settings.model,
    maxOutputTokens: settings.maxOutputTokens,
    effort: settings.effort,
    instructions: job.instructions,
    userText,
    answerSchema: job.enforceAnswerSchema ? job.answerSchema : null,
    thinking,
    // Diagnose's own limit wins; then the job's own (a phone shortcut gives up sooner); else the limit follows the
    // job's longest answer.
    timeoutMs: timeoutOverride ?? job.timeLimitMs ?? requestTimeoutMs(settings.maxOutputTokens),
  }
}

/**
 * The Test bench's "what will this cost": the prompt tokens of the request a run of `jobName` would send, counted by
 * the provider without generating anything (free, nothing reserved, nothing written). The same checks as a run come
 * first: the caller, the input, the lists, the switch and the key; and it refuses while the account is at a rate cap.
 */
export async function countJob(ctx: RunContext, jobName: unknown, input: unknown): Promise<CountReply> {
  const job = findJob(jobName)
  if (!job || !job.pickable || !job.callers.includes(ctx.caller)) return { ok: false, reason: 'bad_input', message: 'There is nothing to count for that job.' }
  const prepared = job.prepare(input, ctx.now())
  if ('problem' in prepared) return { ok: false, reason: 'bad_input', message: prepared.problem }
  const choice = prepared.choice ? checkedChoice(prepared.choice) : {}
  if (!choice) return { ok: false, reason: 'bad_input', message: 'That model, effort or thinking setting is not one this app offers.' }
  const gate = await readGate(ctx.userDb, job.name, gateScopeOf(ctx))
  if (!gate) return { ok: false, reason: 'error', message: 'The AI usage could not be read, so nothing was counted. Try again in a moment.' }
  const tooMany = rateCapProblem(gate, ctx.caller)
  if (tooMany) return { ok: false, reason: 'busy', message: tooMany }
  const stored = await readSettingRows(ctx.userDb, ctx.userId, job.name)
  if (!stored) return { ok: false, reason: 'error', message: 'Your AI settings could not be read, so nothing was counted. Try again in a moment.' }
  const settings = settingsFor(job, stored.account, stored.job)
  if (choice.model) settings.model = choice.model
  if (choice.effort) settings.effort = choice.effort
  if (!settings.aiEnabled) return { ok: false, reason: 'off', message: 'All AI is switched off in Developer → AI → Settings.' }
  if (!settings.enabled) return { ok: false, reason: 'off', message: `"${job.title}" is switched off in Developer → AI → Settings.` }
  if (!ctx.provider) return { ok: false, reason: 'not_configured', message: 'AI is not set up yet: the server has no API key for it.' }
  const thinking = choice.thinking ?? settings.thinking
  // The count costs nothing, but it is a request to Anthropic: a few a minute, counted from the ledger (security
  // review G3). Each count leaves a zero-cost row (stop reason 'count_tokens') that this check reads and that the
  // account's own caps count like any call. Two counts at the same instant may both pass: the cap is small and the
  // count is free, so it is read without a lock.
  const recent = await countRecentCalls(ctx.userDb, ctx.userId, job.name, new Date(ctx.now().getTime() - 60_000).toISOString(), COUNT_STOP_REASON)
  if (recent === null) return { ok: false, reason: 'error', message: 'The AI usage could not be read, so nothing was counted. Try again in a moment.' }
  if (recent >= LIMITS.countsPerMinute) return { ok: false, reason: 'busy', message: `That is more than ${LIMITS.countsPerMinute} token counts in a minute. Wait a moment and try again.` }
  const started = Date.now()
  let counted
  try {
    counted = await ctx.provider.countTokens(buildRequest(job, settings, prepared.userText, thinking, COUNT_TIMEOUT_MS))
  } catch (error) {
    ctx.report(`the provider part threw: ${errorPlace(error)}`)
    counted = null
  }
  const row = newRow(ctx, job)
  row.model = settings.model
  row.effort = settings.effort
  row.outcome = counted?.ok ? 'ok' : 'error'
  row.stop_reason = COUNT_STOP_REASON
  row.error = counted?.ok ? null : 'The token count failed.'
  row.duration_ms = Math.max(0, Date.now() - started)
  await record(ctx, row)
  if (!counted) return { ok: false, reason: 'error', message: 'The token count failed unexpectedly. Try again in a moment.' }
  if (!counted.ok) return { ok: false, reason: 'error', message: hideSecrets(counted.message, ctx.secrets) }
  return { ok: true, input_tokens: counted.inputTokens, model: settings.model, effort: settings.effort, thinking }
}

// The ledger row a token count leaves (zero tokens, zero cost): the app labels it "Token count", and the cap reads it.
const COUNT_STOP_REASON = 'count_tokens'

// The free count waits at most this long: it only reads the prompt, it writes no answer.
const COUNT_TIMEOUT_MS = 20_000

/** A job's step before the model. One that throws (it shouldn't) stops the run with a plain sentence. */
async function runEarly(ctx: RunContext, early: (env: PageEnv) => Promise<EarlyStep>): Promise<EarlyStep> {
  try {
    return await early(ctx.page)
  } catch (error) {
    ctx.report(`a job's step before the model threw: ${errorPlace(error)}`)
    return { kind: 'stop', outcome: 'error', message: 'The step before the AI call failed unexpectedly. Try again in a moment.' }
  }
}

/** One request to the model. A provider that throws (it shouldn't) is a failed call, not a crashed run. */
async function send(ctx: RunContext, provider: Provider, request: ModelRequest): Promise<ModelAnswer | ModelFailure> {
  try {
    return await provider.send(request)
  } catch (error) {
    ctx.report(`the provider part threw: ${errorPlace(error)}`)
    return { ok: false, kind: 'unknown', status: null, message: 'The AI call failed unexpectedly.', detail: '', requestId: null, sent: null }
  }
}

/** What an answer amounts to: a checked result, or how it failed. */
type Verdict =
  | { ok: true; result: Record<string, unknown> }
  // `message` is for the app: one plain sentence. `logLine` is for the ledger: the message, with the
  // provider's own explanation when there is one.
  | { ok: false; outcome: Exclude<Outcome, 'ok'>; message: string; logLine: string }

/** Only a complete answer that passes the job's own check gives a result. */
function judge(answer: ModelAnswer | ModelFailure, prepared: PreparedRun, maxOutputTokens: number): Verdict {
  const failed = (outcome: Exclude<Outcome, 'ok'>, message: string, detail = ''): Verdict =>
    ({ ok: false, outcome, message, logLine: detail ? `${message} — ${detail}` : message })
  if (!answer.ok) return failed('error', answer.message, answer.detail)
  if (answer.ending === 'refused') return failed('refused', 'The model declined to answer this one.', answer.refusal)
  if (answer.ending === 'cut_off') {
    return failed('cut_off', `The answer was cut off at its limit of ${maxOutputTokens} tokens. Raise the longest answer for this job in Developer → AI → Settings.`)
  }
  if (answer.ending !== 'complete') return failed('error', `The model stopped in a way this app does not handle yet (${answer.stopReason}).`)
  let check: AnswerCheck
  try {
    check = prepared.read(answer.text, { thinking: answer.thinking, servedModel: answer.servedModel, webSearches: answer.webSearches })
  } catch {
    check = { ok: false, problem: 'its check failed' }
  }
  // A failed check is never repaired: the answer is thrown away and the owner is told.
  return check.ok ? { ok: true, result: check.result } : failed('invalid', `The model's answer could not be used: ${check.problem}.`)
}

/**
 * Puts the real numbers on the reserved row. A failed update never fails the answer and is said in the server log;
 * the row then keeps its worst-case cost, so the budget is only ever counted too much, never too little.
 */
async function finish(ctx: RunContext, row: CallRow): Promise<void> {
  const problem = await finishCall(ctx.adminDb, row)
  if (problem) ctx.report(`a call could not be finished in the ledger (it stays at its reserved cost): ${problem}`)
}

/** Writes the row. A failed write never fails the answer, but it is said in the server log. */
async function record(ctx: RunContext, row: CallRow): Promise<void> {
  const problem = await writeCall(ctx.adminDb, row)
  if (problem) ctx.report(`a call was not written to the ledger: ${problem}`)
}
