// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · the phone's question with tools (phase 4b)
//
//  `phone_ask` used to be one model call with no tools: the gateway looked a small context up by code and handed it
//  over. Now the model may also read, through four tools of its own (the day's plan, a week's figures, a day's food, a
//  words search), when the context does not already answer. The limits that keep it a phone answer:
//
//    · a small read-only set (`phoneChatTools`: day plan, week figures, food day, find text, About me; no proposals, no
//      database tool, nothing that writes) that FOLLOWS THE OWNER'S CONTROLS like the chat does: a tool switched off in
//      Settings is not offered, and the owner's own instructions go in as the same second system block. The code decides
//      which tools exist at all; the settings can only take some away. The device path may not name another tool;
//    · at most two requests: the first may call tools, the second may not (an answer always ends in words), and at most
//      four tool calls run, side by side, each with a short time limit;
//    · low effort, thinking off, not streamed to the phone, and under 19 seconds in all (the gateway gives up at 22);
//    · every round is reserved against the budget and ledgered under the same run_id, the device's 100 calls a day and
//      the master switch and the job's switch apply like any call. Nothing is stored (no conversation).
//
//  The tools run with the service client, so EVERY query names the verified user id (`HEVY_USER_ID` from this
//  function's own environment, set by main.ts for a device caller): a device never names an account, a table or a query.
//  What a tool returns is data in a `tool_result` block, never an instruction (said in the instructions).
// ─────────────────────────────────────────────────────────────────────────────

import type { Block, ChatMessage, ChatRequest, ModelFailure, RunReply, TokenUsage } from './types.ts'
import { costOf, worstCostOf } from './prices.ts'
import {
  callerDailyCap, cutChars, hideSecrets, LIMITS, rateCapProblem, reservationBudgetProblem, settingsFor, trimForLog, TEXT_LOG_MAX_BYTES,
} from './guard.ts'
import { finishCall, readGate, readSettingRows, reserveCall, summaryOf, writeCall, type CallRow } from './ledger.ts'
import { gateScopeOf, newRow, RUN_ERROR_MAX, RUN_MAY_BE_BILLED, RUN_NO_TOKENS, type RunContext } from './run.ts'
import { CHAT_LIMITS, ownerInstructionsBlock } from './chat-rules.ts'
import { phoneChatTools, phoneToolNames, runPhoneTool, type ToolOutput } from './chat-tools.ts'
import { readChatControls } from './chat-store.ts'
import { PHONE_ASK_JOB } from './job-device.ts'

/** The whole question, tools included, is over after this long: the gateway gives up at 22 s. */
const PHONE_DEADLINE_MS = 19_000
/** One tool may take this long: a slower one is an error result, not a hung answer. */
const PHONE_TOOL_MS = 5_000

const phoneTextOf = (content: readonly Block[]): string => content.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text as string).join('')

async function phoneWithTimeout<T>(run: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<T>(resolve => { timer = setTimeout(() => resolve(onTimeout), ms) })
  try { return await Promise.race([run, late]) } finally { if (timer) clearTimeout(timer) }
}

export async function runPhoneAsk(ctx: RunContext, input: unknown): Promise<RunReply> {
  const job = PHONE_ASK_JOB
  const started = Date.now()
  const runId = ctx.newId()
  const base = newRow(ctx, job)
  base.run_id = runId
  /** Ends the run before any model call: a ledger row with no tokens and the reason. */
  const stop = async (reason: 'bad_input' | 'off' | 'not_configured' | 'error', message: string): Promise<RunReply> => {
    base.outcome = reason
    base.error = cutChars(message, RUN_ERROR_MAX)
    const problem = await writeCall(ctx.adminDb, base)
    if (problem) ctx.report(`a call was not written to the ledger: ${problem}`)
    return { ok: false, reason, message, call: summaryOf(base) }
  }

  // 1 · The walls, in the order of runJob: the device's caller, the rate caps, the input, the settings, the switches, the key.
  if (ctx.caller !== 'phone') return { ok: false, reason: 'bad_input', message: `"${job.title}" can't be started from here.` }
  const gate = await readGate(ctx.userDb, job.name, gateScopeOf(ctx))
  if (!gate) {
    ctx.report('the usage could not be read, so nothing was sent')
    return { ok: false, reason: 'error', message: 'The AI usage could not be read, so nothing was sent. Try again in a moment.' }
  }
  const tooMany = rateCapProblem(gate, ctx.caller)
  if (tooMany) return { ok: false, reason: 'busy', message: tooMany }
  const prepared = job.prepare(input, ctx.now())
  if ('problem' in prepared) return stop('bad_input', prepared.problem)
  const stored = await readSettingRows(ctx.userDb, ctx.userId, job.name)
  if (!stored) return stop('error', 'Your AI settings could not be read, so nothing was sent. Try again in a moment.')
  const settings = settingsFor(job, stored.account, stored.job)
  if (!settings.aiEnabled) return stop('off', 'All AI is switched off in Developer → AI → Settings.')
  if (!settings.enabled) return stop('off', `"${job.title}" is switched off in Developer → AI → Settings.`)
  const provider = ctx.provider
  if (!provider) return stop('not_configured', 'AI is not set up yet: the server has no API key for it.')

  // 1b · The owner's controls, read as input (any failure reading the tool rows: nothing is sent): the tools that are on, and their words.
  const controls = await readChatControls(ctx.userDb, ctx.userId)
  if (!controls) return stop('error', 'Your Ask AI settings could not be read, so nothing was sent. Try again in a moment.')
  const toolNames = phoneToolNames(controls.modes)
  const ownerInstructions = ownerInstructionsBlock(controls.instructions)

  // 2 · The rounds: the first may call a tool, the second may not.
  const tools = phoneChatTools(toolNames)
  const messages: ChatMessage[] = [{ role: 'user', content: [{ type: 'text', text: prepared.userText }] }]
  let lastRow: CallRow = base
  for (let round = 1; round <= CHAT_LIMITS.phoneRounds; round++) {
    const remaining = PHONE_DEADLINE_MS - (Date.now() - started)
    if (remaining < 3000) return { ok: false, reason: 'error', message: 'That took too long for the phone. Try again in a moment.', call: summaryOf(lastRow) }
    const noTools = round === CHAT_LIMITS.phoneRounds || tools.length === 0
    const request: ChatRequest = {
      model: settings.model, maxOutputTokens: settings.maxOutputTokens, effort: settings.effort, thinking: 'off',
      system: job.instructions, ownerInstructions, tools, noTools, messages, previousMessageId: null,
      contextEditing: { ...CHAT_LIMITS.contextEditing }, timeoutMs: remaining,
      firstEventTimeoutMs: Math.min(CHAT_LIMITS.firstEventMs, remaining), idleTimeoutMs: Math.min(CHAT_LIMITS.idleMs, remaining),
    }
    const row: CallRow = newRow(ctx, job)
    row.run_id = runId
    row.step = round
    row.model = settings.model
    row.effort = settings.effort
    lastRow = row
    const worstCost = worstCostOf(settings.model, job.instructions.length + ownerInstructions.length + JSON.stringify(tools).length + JSON.stringify(messages).length, settings.maxOutputTokens)
    const reservation = await reserveCall(ctx.adminDb, {
      userId: ctx.userId, job: job.name, caller: ctx.caller, mode: row.mode, provider: ctx.providerName, model: settings.model, effort: settings.effort,
      instructionsVersion: job.version, worstCostUsd: worstCost, budgetUsd: settings.monthlyBudgetUsd, jobBudgetUsd: settings.jobBudgetUsd,
      perMinute: LIMITS.callsPerMinute, perDay: LIMITS.callsPerDay, callerPerDay: callerDailyCap(ctx.caller),
    })
    if (!reservation) {
      ctx.report('the budget could not be reserved, so nothing was sent')
      return { ok: false, reason: 'error', message: 'The AI budget could not be checked, so nothing was sent. Try again in a moment.' }
    }
    if (reservation.kind === 'busy') {
      return { ok: false, reason: 'busy', message: `That is more than ${LIMITS.callsPerMinute} AI calls in a minute, ${LIMITS.callsPerDay} today, or ${callerDailyCap(ctx.caller)} in 24 hours from this device. Wait a moment and try again.` }
    }
    row.id = reservation.id
    if (reservation.kind === 'budget') {
      row.outcome = 'budget'
      row.error = cutChars(reservationBudgetProblem(settings, job.title), RUN_ERROR_MAX)
      await finishCall(ctx.adminDb, row)
      return { ok: false, reason: 'budget', message: reservationBudgetProblem(settings, job.title), call: summaryOf(row) }
    }

    const roundStarted = Date.now()
    const answer = await provider.chatRound(request, () => {}).catch((): ModelFailure => ({ ok: false, kind: 'unknown', status: null, message: 'The AI call failed unexpectedly.', detail: '', requestId: null, sent: null }))
    row.duration_ms = Math.max(0, Date.now() - roundStarted)
    const usage: TokenUsage = answer.ok ? answer.usage : RUN_NO_TOKENS
    const price = costOf(usage, settings.model, row.mode)
    row.input_tokens = usage.inputTokens
    row.cache_read_tokens = usage.cacheReadTokens
    row.cache_write_5m_tokens = usage.cacheWrite5mTokens
    row.cache_write_1h_tokens = usage.cacheWrite1hTokens
    row.output_tokens = usage.outputTokens
    row.thinking_tokens = usage.thinkingTokens
    row.long_prompt = price.longPrompt
    row.request_id = answer.requestId
    row.stop_reason = answer.ok ? answer.stopReason : null
    row.served_model = answer.ok ? answer.servedModel : null
    row.cost_usd = !answer.ok && RUN_MAY_BE_BILLED.includes(answer.kind) ? worstCost : price.costUsd
    const logRound = (toolShapes: { name: string; ok: boolean; ms: number }[]): void => {
      row.tools = toolShapes
      if (!settings.logText) return
      row.request = trimForLog({ instructions_version: job.version, round, model: settings.model, tools: tools.map(t => t.name), ...(round === 1 ? { user_text: prepared.userText } : {}), ...(answer.ok && answer.sent ? { sent_to_provider: answer.sent } : {}) }, TEXT_LOG_MAX_BYTES)
      if (answer.ok) row.response = trimForLog({ text: phoneTextOf(answer.content), ending: answer.ending }, TEXT_LOG_MAX_BYTES)
    }
    const fail = async (outcome: 'error' | 'refused' | 'cut_off', message: string, logLine: string): Promise<RunReply> => {
      row.outcome = outcome
      row.error = cutChars(hideSecrets(settings.logText ? logLine : message, ctx.secrets), RUN_ERROR_MAX)
      logRound([])
      await finishCall(ctx.adminDb, row)
      return { ok: false, reason: outcome, message: hideSecrets(message, ctx.secrets), call: summaryOf(row) }
    }
    if (!answer.ok) return fail('error', answer.message, answer.detail ? `${answer.message} — ${answer.detail}` : answer.message)
    if (answer.ending === 'refused') return fail('refused', 'The model declined to answer this one.', `The model declined to answer this one. — ${answer.refusal}`)
    if (answer.ending === 'cut_off') return fail('cut_off', `The answer was cut off at its limit of ${settings.maxOutputTokens} tokens. Raise the longest answer for this job in Developer → AI → Settings.`, 'cut off')

    const calls = answer.content.filter(b => b.type === 'tool_use')
    if (answer.ending === 'tool_calls') {
      // The last round may not call a tool; a model that did anyway has no answer, which is a failure, never a loop.
      if (noTools || !calls.length) return fail('error', 'The model stopped in a way this app does not handle yet.', `unexpected tool call (${answer.stopReason})`)
      messages.push({ role: 'assistant', content: answer.content })
      const shapes: { name: string; ok: boolean; ms: number }[] = []
      const results = await Promise.all(calls.map(async (call, index): Promise<Block> => {
        const at = Date.now()
        const id = typeof call.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(call.id) ? call.id : ''
        const name = typeof call.name === 'string' ? call.name : ''
        const output: ToolOutput = index >= CHAT_LIMITS.phoneToolCalls
          ? { ok: false, message: `Too many tool calls (the most is ${CHAT_LIMITS.phoneToolCalls}): this one did not run. Answer with what you have.` }
          : await phoneWithTimeout(runPhoneTool(name, call.input, toolNames, { db: ctx.userDb, userId: ctx.userId, now: ctx.now(), readAs: ctx.readAs }),
            Math.min(PHONE_TOOL_MS, Math.max(1000, PHONE_DEADLINE_MS - (Date.now() - started) - 3000)), { ok: false, message: 'That tool took too long. Answer without it.' } as ToolOutput)
        shapes.push({ name, ok: output.ok, ms: Date.now() - at })
        return output.ok
          ? { type: 'tool_result', tool_use_id: id, content: output.blocks && output.blocks.length ? output.blocks : output.text }
          : { type: 'tool_result', tool_use_id: id, content: output.message, is_error: true }
      }))
      row.outcome = 'ok'
      logRound(shapes)
      await finishCall(ctx.adminDb, row)
      messages.push({ role: 'user', content: results })
      continue
    }

    // The answer: the job's own check (length, plain text), never repaired.
    let check
    try { check = prepared.read(phoneTextOf(answer.content), { thinking: answer.thinking, servedModel: answer.servedModel, webSearches: 0 }) } catch { check = { ok: false as const, problem: 'its check failed' } }
    if (!check.ok) {
      row.outcome = 'invalid'
      row.error = cutChars(`The model's answer could not be used: ${check.problem}.`, RUN_ERROR_MAX)
      logRound([])
      await finishCall(ctx.adminDb, row)
      return { ok: false, reason: 'invalid', message: `The model's answer could not be used: ${check.problem}.`, call: summaryOf(row) }
    }
    row.outcome = 'ok'
    logRound([])
    await finishCall(ctx.adminDb, row)
    return { ok: true, job: job.name, result: check.result, call: summaryOf(row) }
  }
  return { ok: false, reason: 'error', message: 'The answer did not finish. Try again.', call: summaryOf(lastRow) }
}
