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
  AnswerCheck, Caller, ModelAnswer, ModelFailure, ModelRequest, Outcome, PreparedRun, Provider, RunReply, TokenUsage,
} from './types.ts'
import { costOf } from './prices.ts'
import {
  budgetProblem, errorPlace, hideSecrets, rateCapProblem, settingsFor, trimForLog, trimText, TEXT_LOG_MAX_BYTES,
} from './guard.ts'
import { readGate, readSettingRows, summaryOf, writeCall, type CallRow, type Db } from './ledger.ts'
import { findJob } from './jobs.ts'

/** Everything a run needs from outside, handed in by main.ts (or by a test). */
export interface RunContext {
  /** The account the session belongs to, as main.ts verified it. Never a value from the request. */
  userId: string
  caller: Caller
  /** The owner's own database client: row level security decides what it reads. */
  userDb: Db
  /** The service-role client: the only writer of the ledger. */
  adminDb: Db
  /** The model provider, or null while no API key is configured. */
  provider: Provider | null
  providerName: string
  /** The secrets this function holds, to keep out of every message. */
  secrets: readonly (string | null | undefined)[]
  now: () => Date
  newId: () => string
  /** One line for the server log. It never gets a secret or any of the owner's text. */
  report: (line: string) => void
}

// What the ledger shows for a request that named no job this function has.
const RUN_UNKNOWN_JOB = 'unknown'
const RUN_NO_MODEL = 'none'
const RUN_ERROR_MAX = 500
const RUN_NO_TOKENS: TokenUsage = {
  inputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0, outputTokens: 0, thinkingTokens: 0,
}

export async function runJob(ctx: RunContext, jobName: unknown, input: unknown): Promise<RunReply> {
  const job = findJob(jobName)
  const row: CallRow = {
    id: ctx.newId(), user_id: ctx.userId, run_id: ctx.newId(), step: 1,
    job: job?.name ?? RUN_UNKNOWN_JOB, caller: ctx.caller, mode: 'live', provider: ctx.providerName,
    model: job?.defaults.model ?? RUN_NO_MODEL, served_model: null, effort: null,
    outcome: 'error', stop_reason: null, error: null, request_id: null,
    input_tokens: 0, cache_read_tokens: 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0,
    output_tokens: 0, thinking_tokens: 0, long_prompt: false, cost_usd: 0, duration_ms: 0,
    instructions_version: job?.version ?? null, tools: [], request: null, response: null, thinking: null,
  }
  /** Ends the run before the model is called: a ledger row with no tokens, and the reason for the app. */
  const stop = async (reason: Exclude<Outcome, 'ok'>, message: string): Promise<RunReply> => {
    row.outcome = reason
    row.error = message.slice(0, RUN_ERROR_MAX)
    await record(ctx, row)
    return { ok: false, reason, message, call: summaryOf(row) }
  }

  // 1 · The rate caps. They come before anything is written, so a flood of requests (bad ones included) fills
  //     neither the ledger nor the bill: over a cap, the answer is "busy" and no row is written.
  const gate = await readGate(ctx.userDb, row.job)
  if (!gate) {
    ctx.report('the usage could not be read, so nothing was sent')
    return { ok: false, reason: 'error', message: 'The AI usage could not be read, so nothing was sent. Try again in a moment.' }
  }
  const tooMany = rateCapProblem(gate)
  if (tooMany) return { ok: false, reason: 'busy', message: tooMany }

  // 2 · The job, by name from the fixed list, and its own check of the input.
  if (!job) return stop('bad_input', 'There is no AI job with that name.')
  if (!job.callers.includes(ctx.caller)) return stop('bad_input', `"${job.title}" can't be started from here.`)
  const prepared = job.prepare(input, ctx.now())
  if ('problem' in prepared) return stop('bad_input', prepared.problem)

  // 3 · The owner's settings. They are stored where the browser can write, so each value is input:
  //     settingsFor puts every one through its list or its limits.
  const stored = await readSettingRows(ctx.userDb, ctx.userId, job.name)
  if (!stored) return stop('error', 'Your AI settings could not be read, so nothing was sent. Try again in a moment.')
  const settings = settingsFor(job, stored.account, stored.job)
  row.model = settings.model
  row.effort = settings.effort

  // 4 · The walls: the job's switch, the budgets, the API key.
  if (!settings.enabled) return stop('off', `"${job.title}" is switched off in Developer → AI → Settings.`)
  const overBudget = budgetProblem(gate, settings, job.title)
  if (overBudget) return stop('budget', overBudget)
  if (!ctx.provider) return stop('not_configured', 'AI is not set up yet: the server has no API key for it.')

  // 5 · The request: the fixed instructions first (the provider caches them), then the part that changes.
  const request: ModelRequest = {
    model: settings.model,
    maxOutputTokens: settings.maxOutputTokens,
    effort: settings.effort,
    instructions: job.instructions,
    userText: prepared.userText,
    answerSchema: job.answerSchema,
  }
  const started = Date.now()
  const answer = await send(ctx, ctx.provider, request)
  row.duration_ms = Math.max(0, Date.now() - started)
  // One step is the whole run in phase 1. Phase 4 puts the tool loop here: while the answer asks for a tool,
  // run the tool as the owner, add its result to the conversation and send again. Each round gets its own
  // ledger row with this run_id and the next step number.

  // 6 · Reading the answer: how it ended first, then the job's own check of what it says.
  const verdict = judge(answer, prepared, settings.maxOutputTokens)

  // 7 · The ledger: what it cost, how long it took, how it ended. The cost comes from this code's price table.
  const usage = answer.ok ? answer.usage : RUN_NO_TOKENS
  const price = costOf(usage, request.model, row.mode)
  row.outcome = verdict.ok ? 'ok' : verdict.outcome
  row.error = verdict.ok ? null : hideSecrets(verdict.logLine, ctx.secrets).slice(0, RUN_ERROR_MAX)
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
  row.cost_usd = price.costUsd
  if (settings.logText) {
    // The text log, only while the owner keeps it on: what was sent, and what came back.
    row.request = trimForLog({
      model: request.model, effort: request.effort, max_output_tokens: request.maxOutputTokens,
      instructions_version: job.version, instructions: request.instructions, user_text: request.userText,
      answer_schema: request.answerSchema,
    }, TEXT_LOG_MAX_BYTES)
    if (answer.ok) {
      row.response = trimForLog({ text: answer.text, ...(answer.refusal ? { refusal: answer.refusal } : {}) }, TEXT_LOG_MAX_BYTES)
      row.thinking = answer.thinking ? trimText(answer.thinking, TEXT_LOG_MAX_BYTES) : null
    }
  }
  await record(ctx, row)

  // 8 · The reply. A message leaves only through hideSecrets.
  if (verdict.ok) return { ok: true, job: job.name, result: verdict.result, call: summaryOf(row) }
  return { ok: false, reason: verdict.outcome, message: hideSecrets(verdict.message, ctx.secrets), call: summaryOf(row) }
}

/** One request to the model. A provider that throws (it shouldn't) is a failed call, not a crashed run. */
async function send(ctx: RunContext, provider: Provider, request: ModelRequest): Promise<ModelAnswer | ModelFailure> {
  try {
    return await provider.send(request)
  } catch (error) {
    ctx.report(`the provider part threw: ${errorPlace(error)}`)
    return { ok: false, kind: 'unknown', status: null, message: 'The AI call failed unexpectedly.', detail: '', requestId: null }
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
    check = prepared.read(answer.text)
  } catch {
    check = { ok: false, problem: 'its check failed' }
  }
  // A failed check is never repaired: the answer is thrown away and the owner is told.
  return check.ok ? { ok: true, result: check.result } : failed('invalid', `The model's answer could not be used: ${check.problem}.`)
}

/** Writes the row. A failed write never fails the answer, but it is said in the server log. */
async function record(ctx: RunContext, row: CallRow): Promise<void> {
  const problem = await writeCall(ctx.adminDb, row)
  if (problem) ctx.report(`a call was not written to the ledger: ${problem}`)
}
