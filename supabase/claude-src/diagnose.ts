// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · Diagnose
//
//  `{ action: 'diagnose' }`, behind the Diagnose button on Developer → AI → How
//  it works. When ✨ is slow or times out, this answers the one question that
//  matters: does the request not reach Anthropic at all, or does Anthropic get
//  it and take long? Four checks, in order, each timed:
//    1 · Network and key   list the models (free)
//    2 · Request shape     count the tokens of ✨'s real request (free): a 400 here would say the answer shape is refused
//    3 · Tiny answer       the job `diagnose` ("Reply with the word OK.") through the normal run path
//    4 · ✨'s real request  the job `item_fill` with a made-up sentence, through the normal run path, 90 s limit
//  Steps 3 and 4 are real calls: each is reserved against the budget and written to the ledger like any other.
//  Nothing in a request chooses anything here: the sentence, the models and the limits are fixed in this file.
//
//  The answer carries only our own sentences and numbers. A message goes out through hideSecrets, and no raw
//  provider object is ever put in one.
// ─────────────────────────────────────────────────────────────────────────────

import type { DiagnoseReply, DiagnoseStep, ModelFailure, ModelRequest, RunReply } from './types.ts'
import { cutChars, errorPlace, hideSecrets, settingsFor } from './guard.ts'
import { hasRecentCall, readSettingRows } from './ledger.ts'
import { findJob } from './jobs.ts'
import { runJob, type RunContext } from './run.ts'

/** The made-up sentence every check uses: ✨'s own example. No personal data. */
export const DIAGNOSE_SENTENCE = 'Dentist on Tuesday at 14:00 for an hour at Jernbanetorget, remind me a day before'

/** At most one Diagnose a minute for an account: the `diagnose` rows of the ledger are the count. */
export const DIAGNOSE_PAUSE_MS = 60_000
/** Steps 1 to 3 wait at most this long each. */
export const DIAGNOSE_SHORT_MS = 20_000
/** Step 4 waits this long: three times ✨'s own 30 s, so its true time shows. */
export const DIAGNOSE_LONG_MS = 90_000
/** The whole action stays under Supabase's 150 s limit, with room to answer. */
export const DIAGNOSE_TOTAL_MS = 140_000
// A step 4 with less time than this left would only time out: it is skipped and says so.
const DIAGNOSE_LONG_MIN_MS = 10_000
const DIAGNOSE_DETAIL_MAX = 400
// ✨'s default model: the list must hold it for ✨ to work with its default settings.
const FILL_MODEL = 'claude-haiku-5-5'

const diagnoseSecs = (ms: number) => (ms / 1000).toFixed(1)
const diagnoseUsd = (usd: number) => `$${usd.toFixed(5)}`
const diagnoseTokens = (n: number) => `${n} token${n === 1 ? '' : 's'}`

/** One plain sentence for a failed call: our own wording, the status and the provider's short explanation. */
function diagnoseFailure(what: string, failure: ModelFailure, ms: number): string {
  const status = failure.status === null ? '' : ` (HTTP ${failure.status})`
  const said = failure.detail ? ` Anthropic says: ${failure.detail}` : ''
  return `${what} failed after ${diagnoseSecs(ms)} s${status}: ${failure.message}${said}`
}

/** What a real call (steps 3 and 4) amounts to, as one sentence. */
function diagnoseRunSentence(what: string, reply: RunReply, ms: number): string {
  if (reply.ok) {
    const c = reply.call
    // Only a job with a step before the model can answer without a call; Diagnose runs none of those.
    if (!c) return `${what} came back in ${diagnoseSecs(ms)} s without asking the model.`
    const promptTokens = c.input_tokens + c.cache_read_tokens + c.cache_write_tokens
    return `${what} came back in ${diagnoseSecs(ms)} s: ${diagnoseTokens(promptTokens)} in, ${diagnoseTokens(c.output_tokens)} out (${c.thinking_tokens} of them thinking), cost ${diagnoseUsd(c.cost_usd)}.`
  }
  const c = reply.call
  const numbers = c && (c.input_tokens || c.output_tokens)
    ? ` It used ${diagnoseTokens(c.input_tokens + c.cache_read_tokens + c.cache_write_tokens)} in and ${diagnoseTokens(c.output_tokens)} out.`
    : ' It used 0 tokens.'
  return `${what} did not give a usable answer after ${diagnoseSecs(ms)} s (${reply.reason}): ${reply.message}${numbers}`
}

export async function runDiagnose(ctx: RunContext): Promise<DiagnoseReply> {
  // One a minute: a Diagnose leaves a `diagnose` row in the ledger (step 3 reserves one even when the budget
  // refuses it), so the ledger itself is the clock. A read that fails answers "error": nothing runs unchecked.
  const since = new Date(ctx.now().getTime() - DIAGNOSE_PAUSE_MS).toISOString()
  const recent = await hasRecentCall(ctx.userDb, ctx.userId, 'diagnose', since)
  if (recent === null) return { ok: false, reason: 'error', message: 'The AI usage could not be read, so nothing was tried. Try again in a moment.' }
  if (recent) return { ok: false, reason: 'busy', message: 'Diagnose already ran in the last minute. Wait a moment and run it again.' }

  const started = Date.now()
  const steps: DiagnoseStep[] = []
  /** Runs one check, times it and records its sentence. A check that throws is a failed check, never a crash. */
  const check = async (name: DiagnoseStep['name'], title: string, body: () => Promise<{ ok: boolean; detail: string }>): Promise<void> => {
    const t0 = Date.now()
    let outcome: { ok: boolean; detail: string }
    try {
      outcome = await body()
    } catch (error) {
      ctx.report(`a diagnose step threw: ${errorPlace(error)}`)
      outcome = { ok: false, detail: 'This check failed in a way the function does not know.' }
    }
    steps.push({ name, title, ok: outcome.ok, ms: Math.max(0, Date.now() - t0), detail: cutChars(hideSecrets(outcome.detail, ctx.secrets), DIAGNOSE_DETAIL_MAX) })
  }
  const provider = ctx.provider

  // 1 · Network and key.
  let reached = false
  await check('network_key', 'Network and key', async () => {
    if (!provider) return { ok: false, detail: 'The server has no Anthropic key (ANTHROPIC_API_KEY is not set), so nothing was tried.' }
    const t0 = Date.now()
    const list = await provider.listModels(DIAGNOSE_SHORT_MS)
    const ms = Date.now() - t0
    if (!list.ok) return { ok: false, detail: diagnoseFailure('Listing the models', list, ms) }
    reached = true
    const has = list.modelIds.includes(FILL_MODEL)
    return {
      ok: has,
      detail: `Anthropic listed ${list.modelIds.length} model${list.modelIds.length === 1 ? '' : 's'} in ${diagnoseSecs(ms)} s, so the network and the key work; ${FILL_MODEL} ${has ? 'is' : 'is NOT'} in the list.`,
    }
  })
  // Without a connection nothing after it can tell us anything.
  if (!reached || !provider) return { ok: true, steps }

  // The request ✨ sends, built the way a run builds it (the owner's own settings for the job included).
  const fillJob = findJob('item_fill')
  const prepared = fillJob ? fillJob.prepare({ text: DIAGNOSE_SENTENCE }, ctx.now()) : { problem: 'the ✨ job is missing' }
  const stored = await readSettingRows(ctx.userDb, ctx.userId, 'item_fill')
  const settings = fillJob ? settingsFor(fillJob, stored?.account ?? null, stored?.job ?? null) : null

  // 2 · Request shape.
  await check('request_shape', 'Request shape', async () => {
    if (!fillJob || !settings || 'problem' in prepared) return { ok: false, detail: 'The ✨ request could not be built here.' }
    const request: ModelRequest = {
      model: settings.model, maxOutputTokens: settings.maxOutputTokens, effort: settings.effort, instructions: fillJob.instructions,
      userText: prepared.userText, answerSchema: fillJob.enforceAnswerSchema ? fillJob.answerSchema : null, thinking: settings.thinking, timeoutMs: DIAGNOSE_SHORT_MS,
    }
    const t0 = Date.now()
    const count = await provider.countTokens(request)
    const ms = Date.now() - t0
    if (count.ok) return { ok: true, detail: `Anthropic accepted ✨'s request and its answer shape and counted ${diagnoseTokens(count.inputTokens)} in ${diagnoseSecs(ms)} s.` }
    const refused = count.kind === 'refused_request' ? ' The request as built is refused, so the answer shape may be the problem.' : ''
    return { ok: false, detail: `${diagnoseFailure('Counting the tokens', count, ms)}${refused}` }
  })

  // 3 · A tiny answer, through the normal run path.
  await check('tiny_answer', 'Tiny answer', async () => {
    const t0 = Date.now()
    const reply = await runJob({ ...ctx, timeoutMs: DIAGNOSE_SHORT_MS }, 'diagnose', {})
    return { ok: reply.ok, detail: diagnoseRunSentence('A tiny answer', reply, Date.now() - t0) }
  })

  // 4 · ✨'s real request, with room: 90 s, or what is left of the whole action.
  const timeLeft = DIAGNOSE_TOTAL_MS - (Date.now() - started)
  const longLimit = Math.min(DIAGNOSE_LONG_MS, timeLeft)
  await check('fill_request', "✨'s real request", async () => {
    if (longLimit < DIAGNOSE_LONG_MIN_MS) {
      return { ok: false, detail: `Skipped: the earlier checks used ${diagnoseSecs(DIAGNOSE_TOTAL_MS - Math.max(timeLeft, 0))} s of the ${DIAGNOSE_TOTAL_MS / 1000} s this action has in all.` }
    }
    const t0 = Date.now()
    const reply = await runJob({ ...ctx, timeoutMs: longLimit }, 'item_fill', { text: DIAGNOSE_SENTENCE })
    return { ok: reply.ok, detail: diagnoseRunSentence("✨'s request", reply, Date.now() - t0) }
  })

  return { ok: true, steps }
}
