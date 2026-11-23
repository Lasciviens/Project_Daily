// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · Ask AI, the loop
//
//  One answer of the chat, from the person's message to the finished reply, with OUR OWN loop (the owner's decision,
//  20.11.2026: full control over tool execution, logging, error handling and the database):
//
//    1. the walls, in order: the caller (the app only), the rate caps, the input, the settings, the switches, the key;
//    2. the chat: a new one is started with the tools that are not off (frozen with the instructions' hash), an old one
//       is loaded, its history checked (numbers, hash chain) and refused if it changed, or if the code's tools or
//       instructions are no longer the ones it began with, or if it is full (the wall at 90 000 prompt tokens);
//    3. each round: the worst case is RESERVED against the budget, the request is sent (streamed), the answer is stored
//       exactly as it came, and the ledger row of the round (same run_id, the next step) gets the real numbers;
//    4. when the model asks for tools, they run side by side as the owner, and ALL their results go back in ONE message
//       with the results first; a failure is an `is_error` result that says what to try;
//    5. at most CHAT_LIMITS.maxRounds rounds; the last may not call a tool, so an answer always ends in words;
//    6. the citations the model made are checked against what the tools really returned and against the owner's own rows.
//
//  The writes the model proposes are rows in ai_chat_proposals until the owner taps Confirm (`decideChatProposal`).
//  This part never imports the SDK: it talks to the provider through the neutral ChatRequest.
// ─────────────────────────────────────────────────────────────────────────────

import type { Block, ChatMessage, ChatRequest, ChatTool, ModelFailure, TokenUsage } from './types.ts'
import { costOf, worstCostOf } from './prices.ts'
import {
  cutChars, hideSecrets, LIMITS, MODELS, ownValue, rateCapProblem, reservationBudgetProblem, settingsFor, trimForLog, trimText, TEXT_LOG_MAX_BYTES,
} from './guard.ts'
import { finishCall, readGate, readSettingRows, reserveCall, type CallRow } from './ledger.ts'
import { gateScopeOf, newRow, RUN_ERROR_MAX, RUN_MAY_BE_BILLED, RUN_NO_TOKENS, type RunContext } from './run.ts'
import { osloDay } from './week-facts.ts'
import { checkedImage } from './image-rules.ts'
import {
  canonicalJson, CHAT_JOB, CHAT_LIMITS, CHAT_VERSION, holdsNul, liveContextText, messageDigest, needsLiveContext, ownerInstructionsBlock, cleanOwnerInstructions, sha256Hex, systemFor,
  toolsForNewChat, type ChatMode,
} from './chat-rules.ts'
import { applyProposal, checkedProposal, chatToolKind, chatToolsNamed, KNOWN_TOOL_NAMES, runChatTool, SOURCE_PATTERN, type ProposalDraft, type ToolOutput } from './chat-tools.ts'
import {
  appendMessage, asChatMessages, createConversation, decideProposal, decidedProposalsSince, historyIsIntact, insertProposal, isUuid, markProposalFailed, ownRowTitle, readConversation,
  readChatControls, readMessages, readProposal, setConversationDeleted, setProposalResult, updateConversation, type ConversationRow, type StoredMessage,
} from './chat-store.ts'

/** The only events the app ever gets from a chat: our own small ones. */
export type ChatEvent =
  | { event: 'start'; conversation_id: string; is_new: boolean }
  | { event: 'text'; t: string }
  | { event: 'step'; name: string; label: string }
  | { event: 'retract' }
  /** The tool call as the code understood it (checked inputs), after it ran: shown on its step. */
  | { event: 'detail'; name: string; input: Record<string, string | number>; ok: boolean }
  | { event: 'proposal'; id: string; tool: string; summary: string; expires_at: string }
  | { event: 'done'; conversation_id: string; text: string; citations: ChatCitation[]; proposals: ChatProposalCard[]; rounds: number; cost_usd: number; wall: boolean; run_id: string; ending: 'complete' | 'cut_off'; prompt_tokens: number; thinking: string }
  | { event: 'error'; reason: ChatReason; message: string; conversation_id?: string; cost_usd?: number; run_id?: string }

export type ChatReason = 'bad_input' | 'busy' | 'off' | 'not_configured' | 'budget' | 'wall' | 'stale' | 'changed' | 'not_found' | 'declined' | 'timeout' | 'conflict' | 'error'

export interface ChatCitation { kind: 'task' | 'diary'; id: string; title: string; day: string | null }
export interface ChatProposalCard { id: string; tool: string; summary: string; expires_at: string }

export type ChatResult = Extract<ChatEvent, { event: 'done' }> | Extract<ChatEvent, { event: 'error' }>

const STEP_LABELS: Record<string, string> = {
  get_day_plan: "Looking at the day's plan",
  get_week_figures: "Looking up the week's figures",
  get_food_day: "Looking up the day's food",
  find_text: 'Searching your tasks and diary',
  ask_database: 'Asking the database',
  propose_add_task: 'Preparing a task for you to confirm',
  propose_log_food: 'Preparing a food line for you to confirm',
  get_training_week: "Looking at the week's training",
  get_health_trends: "Looking at the week's health figures",
  get_pt_verdicts: "Reading the coach's saved verdicts",
}

const TOOL_USE_ID = /^[A-Za-z0-9_-]{1,100}$/
const NO_ANSWER = 'The model gave no answer text.'

/** A message from the person: control characters out (a new line stays), trimmed, 1 to 4000 characters, or null. */
export function cleanChatText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is taken out
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim()
  const length = [...text].length
  return length >= 1 && length <= CHAT_LIMITS.textMax ? text : null
}

const errorEvent = (reason: ChatReason, message: string, conversationId?: string, spent?: { cost: number; runId: string }): Extract<ChatEvent, { event: 'error' }> =>
  ({ event: 'error', reason, message, ...(conversationId ? { conversation_id: conversationId } : {}), ...(spent && spent.cost > 0 ? { cost_usd: Math.round(spent.cost * 1_000_000) / 1_000_000, run_id: spent.runId } : {}) })

/** The shape of one tool call for the ledger (and phase 4c's suggestions): its name, which fields it filled, how much came back. Never a value. */
interface ToolShape { name: string; fields: string[]; ok: boolean; rows: number | null; bytes: number; ms: number; fingerprint?: string }

/** Every `search_result` source a tool really returned, over the whole history: what a citation may point to. */
function knownSources(messages: readonly { content: Block[] }[]): Set<string> {
  const out = new Set<string>()
  for (const m of messages) {
    for (const block of m.content) {
      if (block.type !== 'tool_result' || !Array.isArray(block.content)) continue
      for (const inner of block.content as Block[]) if (inner.type === 'search_result' && typeof inner.source === 'string') out.add(inner.source)
    }
  }
  return out
}

/**
 * The citations an answer may show: each must be a source a tool returned in this chat (so the model cannot invent a
 * link), must have the exact shape of ours, and must be a row the owner's own client reads (a source is input too).
 * The title shown is the row's own, never the model's.
 */
async function checkedCitations(ctx: RunContext, content: readonly Block[], known: ReadonlySet<string>): Promise<ChatCitation[]> {
  const out: ChatCitation[] = []
  const seen = new Set<string>()
  for (const block of content) {
    if (block.type !== 'text' || !Array.isArray(block.citations)) continue
    for (const citation of block.citations as Block[]) {
      const source = citation.type === 'search_result_location' ? citation.source : null
      if (typeof source !== 'string' || seen.has(source) || !known.has(source) || out.length >= 10) continue
      const match = SOURCE_PATTERN.exec(source)
      if (!match) continue
      seen.add(source)
      const row = await ownRowTitle(ctx.userDb, ctx.userId, match[1] as 'task' | 'diary', match[2])
      if (row) out.push({ kind: match[1] as 'task' | 'diary', id: match[2], title: row.title.slice(0, 100), day: row.day })
    }
  }
  return out
}

/** The text blocks of an answer, joined. */
const textOf = (content: readonly Block[]): string => content.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text as string).join('')

/** What a tool result block holds for one finished tool call. */
function resultBlock(toolUseId: string, output: ToolOutput): Block {
  if (!output.ok) return { type: 'tool_result', tool_use_id: toolUseId, content: output.message, is_error: true }
  return { type: 'tool_result', tool_use_id: toolUseId, content: output.blocks && output.blocks.length ? output.blocks : output.text }
}

async function withTimeout<T>(run: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<T>(resolve => { timer = setTimeout(() => resolve(onTimeout), ms) })
  try { return await Promise.race([run, late]) } finally { if (timer) clearTimeout(timer) }
}

/** What the system and the tools of a chat are, hashed: a chat is continued only with the very same ones. */
async function chatHashes(tools: readonly ChatTool[], system: string, ownerBlock: string): Promise<{ tools: string; system: string }> {
  return { tools: await sha256Hex(canonicalJson(tools)), system: await sha256Hex(`${system}\n---\n${ownerBlock}`) }
}

/** The photos of a message list: image blocks. */
const imageBlocksOf = (messages: readonly { content: Block[] }[]): number => messages.reduce((n, m) => n + m.content.filter(b => b.type === 'image').length, 0)

/** The prompt's size in characters with each photo's base64 left out (a photo costs tokens by its pixels, never by its text): the reservation adds the photos' worst case itself. */
const promptChars = (messages: readonly ChatMessage[]): number =>
  JSON.stringify(messages, (key, value) => (key === 'data' && typeof value === 'string' && value.length > 1000 ? '' : value)).length

/** Runs one answer. `emit` gets the events as they happen (the stream); the return value is the final one. */
export async function runChat(ctx: RunContext, input: unknown, emit: (event: ChatEvent) => void, signal?: AbortSignal): Promise<ChatResult> {
  const result = await chatAnswer(ctx, input, emit, signal)
  emit(result)
  return result
}

async function chatAnswer(ctx: RunContext, input: unknown, emit: (event: ChatEvent) => void, signal?: AbortSignal): Promise<ChatResult> {
  const job = CHAT_JOB
  const started = Date.now()
  // 1 · The walls. The chat is the app's own: a device cannot start it.
  if (ctx.caller !== 'app' || ctx.readAs !== 'owner') return errorEvent('bad_input', 'Ask AI can only be started from the app.')
  const gate = await readGate(ctx.userDb, job.name, gateScopeOf(ctx))
  if (!gate) {
    ctx.report('the usage could not be read, so nothing was sent')
    return errorEvent('error', 'The AI usage could not be read, so nothing was sent. Try again in a moment.')
  }
  const tooMany = rateCapProblem(gate, ctx.caller)
  if (tooMany) return errorEvent('busy', tooMany)

  const text = cleanChatText(ownValue(input, 'text'))
  if (text === null) return errorEvent('bad_input', `Write a message of 1 to ${CHAT_LIMITS.textMax} characters.`)
  const askedId = ownValue(input, 'conversation_id')
  if (askedId !== null && askedId !== undefined && !isUuid(askedId)) return errorEvent('bad_input', 'That is not a chat this app knows.')
  // A new chat is the everyday one or the Training coach's; a chat that exists keeps the kind it started as.
  const askedMode = ownValue(input, 'mode')
  if (askedMode !== undefined && askedMode !== null && askedMode !== 'chat' && askedMode !== 'coach') return errorEvent('bad_input', 'That kind of chat does not exist.')
  // Photos: each is checked from its own bytes (type, header, size) like every photo; the count is checked again against the whole chat below.
  const rawImages = ownValue(input, 'images')
  if (rawImages !== undefined && rawImages !== null && !Array.isArray(rawImages)) return errorEvent('bad_input', 'The photos must be a list.')
  if (Array.isArray(rawImages) && rawImages.length > CHAT_LIMITS.imagesPerMessage) return errorEvent('bad_input', `At most ${CHAT_LIMITS.imagesPerMessage} photos in one message.`)
  const newImages: { block: Block; tokens: number }[] = []
  for (const raw of Array.isArray(rawImages) ? rawImages : []) {
    const checked = checkedImage(raw, CHAT_LIMITS.imageBase64Max)
    if (!checked.ok) return errorEvent('bad_input', checked.problem)
    newImages.push({ block: { type: 'image', source: { type: 'base64', media_type: checked.image.mediaType, data: checked.image.base64 } }, tokens: Math.min(checked.tokens, CHAT_LIMITS.imageTokensWorst) })
  }

  const stored = await readSettingRows(ctx.userDb, ctx.userId, job.name)
  if (!stored) return errorEvent('error', 'Your AI settings could not be read, so nothing was sent. Try again in a moment.')
  const settings = settingsFor(job, stored.account, stored.job)
  if (!settings.aiEnabled) return errorEvent('off', 'All AI is switched off in Developer → AI → Settings.')
  if (!settings.enabled) return errorEvent('off', `"${job.title}" is switched off in Developer → AI → Settings.`)
  const provider = ctx.provider
  if (!provider) return errorEvent('not_configured', 'AI is not set up yet: the server has no API key for it.')

  // 2 · The chat. What the owner chose (each tool's mode, their own instructions) is read now, as input: the modes are the
  //     wall for every round, the instructions are copied into a NEW chat only.
  const controls = await readChatControls(ctx.userDb, ctx.userId)
  if (!controls) return errorEvent('error', 'Your Ask AI settings could not be read, so nothing was sent. Try again in a moment.')
  const modes = controls.modes
  let conversation: ConversationRow | null = null
  let history: StoredMessage[] = []
  if (typeof askedId === 'string') {
    const found = await readConversation(ctx.adminDb, ctx.userId, askedId)
    if (found.error) return errorEvent('error', 'The chat could not be read, so nothing was sent. Try again in a moment.')
    if (!found.conversation || found.conversation.deleted_at) return errorEvent('not_found', 'That chat was not found. Start a new one.')
    conversation = found.conversation
    if (conversation.status !== 'open') return errorEvent('wall', 'This chat is full. Start a new chat: it keeps working at its best when it is short.', conversation.id)
    if (!MODELS.some(m => m.id === conversation?.model)) return errorEvent('changed', 'This chat uses a model this app no longer offers. Start a new chat.', conversation.id)
    const messages = await readMessages(ctx.adminDb, ctx.userId, conversation.id)
    if (!messages) return errorEvent('error', 'The chat could not be read, so nothing was sent. Try again in a moment.')
    // The history is replayed byte for byte, so it is checked first: a changed or damaged history is never sent.
    if (!(await historyIsIntact(messages))) {
      ctx.report('a chat history failed its check and was not sent')
      return errorEvent('changed', "This chat's saved history does not match what was stored, so it was not sent. Start a new chat.", conversation.id)
    }
    history = messages
  }
  const chatMode: ChatMode = conversation ? conversation.mode : askedMode === 'coach' ? 'coach' : 'chat'
  const toolNames = conversation ? conversation.tool_names : toolsForNewChat(modes, chatMode)
  // A chat that names a tool this code no longer has cannot be replayed with the same tool list.
  if (conversation && toolNames.some(n => !KNOWN_TOOL_NAMES.includes(n))) return errorEvent('stale', 'This chat was started before an update changed the assistant. Start a new chat.', conversation.id)
  const tools = chatToolsNamed(toolNames)
  // The owner's instructions are frozen into the chat when it starts (a second, cached system block); later changes reach new chats only.
  const frozenInstructions = conversation ? cleanOwnerInstructions(conversation.owner_instructions) : controls.instructions
  const ownerInstructions = ownerInstructionsBlock(frozenInstructions)
  const system = systemFor(chatMode)
  const hashes = await chatHashes(tools, system, ownerInstructions)
  if (conversation && (conversation.tools_hash !== hashes.tools || conversation.system_hash !== hashes.system)) {
    return errorEvent('stale', 'This chat was started before an update changed the assistant. Start a new chat.', conversation.id)
  }
  const model = conversation ? conversation.model : settings.model
  const effort = conversation ? conversation.effort : settings.effort
  const thinking = conversation ? conversation.thinking : settings.thinking
  const maxOutputTokens = Math.max(CHAT_LIMITS.minOutputTokens, settings.maxOutputTokens)
  if (newImages.length && imageBlocksOf(history) + newImages.length > CHAT_LIMITS.imagesPerChat) {
    return errorEvent('bad_input', `A chat holds at most ${CHAT_LIMITS.imagesPerChat} photos (each stays in the chat). Start a new chat to send more.`, conversation?.id)
  }
  const conversationId = conversation ? conversation.id : ctx.newId()

  // The new message: results of an interrupted tool call first (when the last answer never got its results), then the
  // app's own notices (the date, what happened to earlier proposals), each in its own block, then the person's words.
  const now = ctx.now()
  const last = history[history.length - 1]
  const blocks: Block[] = []
  if (last && last.role === 'assistant') {
    for (const b of last.content) {
      if (b.type === 'tool_use' && typeof b.id === 'string') {
        blocks.push({ type: 'tool_result', tool_use_id: b.id, content: 'This tool call was interrupted before it finished. Call it again if it is still needed.', is_error: true })
      }
    }
  }
  const liveAt = [...history].reverse().find(m => typeof m.meta.live_at === 'string')?.meta.live_at as string | undefined
  const withDate = needsLiveContext(liveAt ?? null, now)
  if (withDate) blocks.push({ type: 'text', text: liveContextText(now) })
  if (conversation && last) {
    const decided = await decidedProposalsSince(ctx.adminDb, ctx.userId, conversation.id, last.created_at)
    if (decided.length) {
      // Only the kind of proposal and what happened: the owner's words (a title they may have edited) never go into this block.
      blocks.push({ type: 'text', text: `<app_updates>${decided.map(p => `The proposal to ${p.tool === 'add_task' ? 'add a task' : 'log a food line'} was ${p.status === 'confirmed' ? 'confirmed by the person and saved' : p.status === 'cancelled' ? 'cancelled by the person (not saved)' : 'confirmed, but saving it failed (not saved)'}.`).join(' ')} This note comes from the app, not from the person.</app_updates>` })
    }
  }
  // Photos come before the words (Anthropic's advice), each its own block; the person's words are the last block.
  for (const image of newImages) blocks.push(image.block)
  blocks.push({ type: 'text', text })
  const newMessage: ChatMessage = { role: 'user', content: blocks }
  const wire: ChatMessage[] = [...asChatMessages(history), newMessage]
  const baseRequest = (messages: ChatMessage[], noTools: boolean, timeoutMs: number, clocks?: { firstEventTimeoutMs: number; idleTimeoutMs: number }): ChatRequest => ({
    model, maxOutputTokens, effort, thinking, system, ownerInstructions, tools, noTools, messages,
    previousMessageId: typeof history.filter(m => m.role === 'assistant').pop()?.meta.message_id === 'string' ? history.filter(m => m.role === 'assistant').pop()?.meta.message_id as string : null,
    contextEditing: { ...CHAT_LIMITS.contextEditing }, timeoutMs, ...(clocks ?? {}), signal,
  })

  // The wall: the last prompt's size plus the new words is an estimate; near the line the provider counts it exactly (free).
  if (conversation) {
    let estimate = conversation.last_prompt_tokens + Math.ceil(text.length / 3) + 200 + newImages.reduce((n, i) => n + i.tokens, 0)
    if (estimate >= CHAT_LIMITS.preciseCountFromTokens) {
      const counted = await provider.countChat(baseRequest(wire, false, 20_000))
      if (counted.ok) estimate = counted.inputTokens
    }
    if (estimate >= CHAT_LIMITS.wallTokens) {
      await updateConversation(ctx.adminDb, ctx.userId, conversation.id, { status: 'full' })
      return errorEvent('wall', 'This chat is full. Start a new chat: it keeps working at its best when it is short.', conversation.id)
    }
  }

  // 3 · The rounds.
  const runId = ctx.newId()
  const toolsRun: ToolShape[] = []
  const proposals: ChatProposalCard[] = []
  const answerMessages: { content: Block[] }[] = []
  let seq = history.length
  let previousDigest: string | null = last ? last.digest : null
  let previousMessageId = baseRequest(wire, false, 0).previousMessageId
  let costTotal = 0
  let streamed = false
  let lastPrompt = conversation ? conversation.last_prompt_tokens : 0
  let createdNow = false
  let forceNoTools = false
  let thinkingSummary = ''
  let endedWith: { text: string; ending: 'complete' | 'cut_off' } | null = null
  let finalCitations: ChatCitation[] = []
  const messages: ChatMessage[] = [...wire]
  let pendingUser: { content: Block[]; meta: Record<string, unknown> } | null = { content: blocks, meta: withDate ? { live_at: now.toISOString() } : {} }
  const known = knownSources(history)

  /** Adds one message to the stored chat. */
  const store = async (role: 'user' | 'assistant', content: Block[], callId: string | null, meta: Record<string, unknown>): Promise<'ok' | 'conflict' | 'error'> => {
    const digest = await messageDigest(previousDigest, role, content)
    const result = await appendMessage(ctx.adminDb, { conversation_id: conversationId, user_id: ctx.userId, seq: seq + 1, role, content, digest, call_id: callId, meta })
    if (result === 'ok') { seq += 1; previousDigest = digest }
    return result
  }
  const fail = (reason: ChatReason, message: string): ChatResult => {
    if (streamed) emit({ event: 'retract' })
    return errorEvent(reason, hideSecrets(message, ctx.secrets), createdNow || conversation ? conversationId : undefined, { cost: costTotal, runId })
  }

  for (let round = 1; round <= CHAT_LIMITS.maxRounds; round++) {
    if (signal?.aborted) return fail('error', 'The request was cancelled.')
    const remaining = CHAT_LIMITS.answerDeadlineMs - (Date.now() - started)
    if (remaining < 8000) return fail('timeout', 'The answer took too long and was stopped. Try a narrower question.')
    const request = baseRequest(messages, round === CHAT_LIMITS.maxRounds || forceNoTools, remaining, { firstEventTimeoutMs: Math.min(CHAT_LIMITS.firstEventMs, remaining), idleTimeoutMs: Math.min(CHAT_LIMITS.idleMs, remaining) })
    request.previousMessageId = previousMessageId

    // The reservation of this round: its worst case is held against the budget before anything is sent.
    const row: CallRow = newRow(ctx, job)
    row.run_id = runId
    row.step = round
    row.model = model
    row.effort = effort
    const worstCost = worstCostOf(model, system.length + ownerInstructions.length + JSON.stringify(tools).length + promptChars(messages), maxOutputTokens, 'live', { imageTokens: imageBlocksOf(messages) * CHAT_LIMITS.imageTokensWorst })
    const reservation = await reserveCall(ctx.adminDb, {
      userId: ctx.userId, job: job.name, caller: ctx.caller, mode: row.mode, provider: ctx.providerName, model, effort, instructionsVersion: CHAT_VERSION,
      worstCostUsd: worstCost, budgetUsd: settings.monthlyBudgetUsd, jobBudgetUsd: settings.jobBudgetUsd,
      perMinute: LIMITS.callsPerMinute, perDay: LIMITS.callsPerDay, callerPerDay: LIMITS.callsPerDay,
    })
    if (!reservation) {
      ctx.report('the budget could not be reserved, so nothing was sent')
      return fail('error', 'The AI budget could not be checked, so nothing was sent. Try again in a moment.')
    }
    if (reservation.kind === 'busy') {
      return fail('busy', `That is more than ${LIMITS.callsPerMinute} AI calls in a minute or ${LIMITS.callsPerDay} today. Wait a moment and try again.`)
    }
    row.id = reservation.id
    if (reservation.kind === 'budget') {
      row.outcome = 'budget'
      row.error = cutChars(reservationBudgetProblem(settings, job.title), RUN_ERROR_MAX)
      await finishCall(ctx.adminDb, row)
      return fail('budget', reservationBudgetProblem(settings, job.title))
    }

    // A new chat's row and its first message are written only now: a chat that was refused leaves nothing behind.
    if (pendingUser) {
      if (!conversation) {
        const problem = await createConversation(ctx.adminDb, {
          id: conversationId, user_id: ctx.userId, title: cutChars(text.replace(/\s+/g, ' '), 60), model, effort, thinking,
          tools_hash: hashes.tools, system_hash: hashes.system, tool_names: toolNames, mode: chatMode, owner_instructions: frozenInstructions,
        })
        if (problem) {
          row.outcome = 'error'; row.error = 'The chat could not be started.'
          await finishCall(ctx.adminDb, row)
          return fail('error', 'The chat could not be started. Try again in a moment.')
        }
        createdNow = true
        emit({ event: 'start', conversation_id: conversationId, is_new: true })
      } else emit({ event: 'start', conversation_id: conversationId, is_new: false })
      const wrote = await store('user', pendingUser.content, null, pendingUser.meta)
      pendingUser = null
      if (wrote !== 'ok') {
        row.outcome = 'error'; row.error = 'The message could not be stored.'
        await finishCall(ctx.adminDb, row)
        return fail(wrote === 'conflict' ? 'conflict' : 'error', wrote === 'conflict' ? 'Another message in this chat is still being answered. Wait for it, then try again.' : 'The message could not be saved, so nothing was sent. Try again in a moment.')
      }
    }

    const roundStarted = Date.now()
    const answer = await provider.chatRound(request, delta => {
      if (delta.kind === 'text') { streamed = true; emit({ event: 'text', t: delta.text }) }
      else if (delta.kind === 'tool') emit({ event: 'step', name: delta.name, label: STEP_LABELS[delta.name] ?? 'Working on it' })
    }).catch((): ModelFailure => ({ ok: false, kind: 'unknown', status: null, message: 'The AI call failed unexpectedly.', detail: '', requestId: null, sent: null }))
    row.duration_ms = Math.max(0, Date.now() - roundStarted)

    const usage: TokenUsage = answer.ok ? answer.usage : RUN_NO_TOKENS
    const price = costOf(usage, model, row.mode)
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
    costTotal += row.cost_usd

    // The ledger row of the round says how it ended; the text log (only while the owner keeps it on) says what was sent.
    const logRound = (): void => {
      row.tools = toolsRunThisRound
      if (!settings.logText) return
      row.request = trimForLog({
        conversation_id: conversationId, round, instructions_version: CHAT_VERSION, mode: chatMode, model, effort, thinking, tools: toolNames,
        ...(round === 1 ? { user_text: text, ...(newImages.length ? { photos: newImages.length } : {}) } : {}), ...(answer.sent ? { sent_to_provider: answer.sent } : {}),
      }, TEXT_LOG_MAX_BYTES)
      if (answer.ok) {
        row.response = trimForLog({ text: textOf(answer.content), ending: answer.ending, ...(answer.refusal ? { refusal: answer.refusal } : {}) }, TEXT_LOG_MAX_BYTES)
        row.thinking = answer.thinking ? trimText(answer.thinking, TEXT_LOG_MAX_BYTES) : null
      }
    }
    const toolsRunThisRound: ToolShape[] = []

    if (!answer.ok) {
      row.outcome = 'error'
      row.error = cutChars(hideSecrets(settings.logText ? `${answer.message}${answer.detail ? ` — ${answer.detail}` : ''}` : answer.message, ctx.secrets), RUN_ERROR_MAX)
      logRound()
      await finishCall(ctx.adminDb, row)
      // A round that was cut for taking too long: stopped, its row finished as an error (the worst case stays held, the
      // bill is unknown), nothing of it stored, and the person told plainly.
      return fail(answer.kind === 'timeout' ? 'timeout' : 'error', answer.message)
    }
    if (answer.ending === 'refused') {
      row.outcome = 'refused'
      row.error = cutChars(hideSecrets(settings.logText ? `The model declined to answer this one. — ${answer.refusal}` : 'The model declined to answer this one.', ctx.secrets), RUN_ERROR_MAX)
      logRound()
      await finishCall(ctx.adminDb, row)
      // A refusal can arrive after some text has streamed: that text is taken back, and nothing of the round is stored.
      return fail('declined', 'The model declined to answer this one. Try asking it in other words.')
    }
    const toolCalls = answer.content.filter(b => b.type === 'tool_use')
    const unusable = answer.ending === 'unexpected' || (answer.ending === 'cut_off' && toolCalls.length > 0) || (answer.ending === 'tool_calls' && toolCalls.length === 0) || holdsNul(answer.content)
    if (unusable) {
      row.outcome = answer.ending === 'cut_off' ? 'cut_off' : 'error'
      row.error = answer.ending === 'cut_off' ? `The answer was cut off at its limit of ${maxOutputTokens} tokens.` : `The model stopped in a way this app does not handle yet (${answer.stopReason}).`
      logRound()
      await finishCall(ctx.adminDb, row)
      return fail(answer.ending === 'cut_off' ? 'error' : 'error', answer.ending === 'cut_off' ? 'The answer was cut off before it finished. Ask a narrower question.' : 'The model stopped in a way this app does not handle yet.')
    }

    // The answer is stored exactly as it came (thinking blocks with their signatures included) and sent back unchanged.
    row.outcome = answer.ending === 'cut_off' ? 'cut_off' : 'ok'
    if (answer.ending === 'cut_off') row.error = `The answer was cut off at its limit of ${maxOutputTokens} tokens.`
    lastPrompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWrite5mTokens + usage.cacheWrite1hTokens
    const assistantMeta: Record<string, unknown> = {
      ...(answer.messageId ? { message_id: answer.messageId } : {}), round, ending: answer.ending, prompt_tokens: lastPrompt,
      ...(answer.cacheMiss ? { cache_miss: answer.cacheMiss } : {}), ...(answer.cleared ? { cleared: answer.cleared } : {}),
      cost_usd: row.cost_usd, run_id: runId,
    }
    if (answer.thinking) thinkingSummary = trimText(`${thinkingSummary}${thinkingSummary ? '\n\n' : ''}${answer.thinking}`, 8000)
    messages.push({ role: 'assistant', content: answer.content })
    answerMessages.push({ content: answer.content })
    if (answer.messageId) previousMessageId = answer.messageId

    if (answer.ending !== 'tool_calls') {
      logRound()
      await finishCall(ctx.adminDb, row)
      // The citations are checked BEFORE the answer is stored and kept with it, so a chat opened later shows the same links.
      finalCitations = await checkedCitations(ctx, answerMessages.flatMap(m => m.content), known)
      if (finalCitations.length) assistantMeta.citations = finalCitations
      const wrote = await store('assistant', answer.content, row.id, assistantMeta)
      if (wrote !== 'ok') return fail('error', 'The answer could not be saved. Try again in a moment.')
      await updateConversation(ctx.adminDb, ctx.userId, conversationId, { message_count: seq, last_prompt_tokens: lastPrompt, cost_usd: (conversation?.cost_usd ?? 0) + costTotal })
      endedWith = { text: textOf(answer.content) || NO_ANSWER, ending: answer.ending === 'cut_off' ? 'cut_off' : 'complete' }
      break
    }

    // 4 · The tools: side by side, as the owner, each with a time limit; every call gets a result, in the order asked.
    const wroteCall = await store('assistant', answer.content, row.id, assistantMeta)
    if (wroteCall !== 'ok') {
      logRound()
      await finishCall(ctx.adminDb, row)
      return fail('error', 'The answer could not be saved. Try again in a moment.')
    }
    // The caps: more than 8 calls in a round, or more than 3 proposals in an answer, are not run: each gets an error result.
    let writesLeft = CHAT_LIMITS.maxProposalsPerAnswer - proposals.length
    const verdicts = toolCalls.map((call, i): string | null => {
      if (i >= CHAT_LIMITS.maxToolCallsPerRound) return `Too many tool calls in one round (the most is ${CHAT_LIMITS.maxToolCallsPerRound}): this call did not run. Ask for fewer things at once.`
      if (chatToolKind(typeof call.name === 'string' ? call.name : '') === 'write') {
        if (writesLeft <= 0) return `At most ${CHAT_LIMITS.maxProposalsPerAnswer} proposals in one answer: this one did not run. Tell the person what is left to propose and let them ask again.`
        writesLeft -= 1
      }
      return null
    })
    const results = await Promise.all(toolCalls.map(async (call, index): Promise<{ block: Block; shape: ToolShape; proposal: ProposalCard | null }> => {
      const toolStarted = Date.now()
      const name = typeof call.name === 'string' ? call.name : ''
      const id = typeof call.id === 'string' && TOOL_USE_ID.test(call.id) ? call.id : ''
      const timedOut: ToolOutput = { ok: false, message: 'That tool took too long. Try again with a narrower question, or answer without it.' }
      const blocked = verdicts[index]
      const output: ToolOutput = blocked
        ? { ok: false, message: blocked }
        : await withTimeout(
          runChatTool(name, call.input, toolNames, modes, { db: ctx.userDb, userId: ctx.userId, now, readAs: ctx.readAs }),
          CHAT_LIMITS.toolTimeoutMs, timedOut,
        )
      let finalOutput = output
      let card: ProposalCard | null = null
      // Only a write tool can make a proposal.
      if (output.ok && output.proposal && chatToolKind(name) === 'write') {
        const made = await makeProposal(ctx, conversationId, id, output.proposal, now)
        if (made) card = made
        else finalOutput = { ok: false, message: 'The proposal could not be saved. Try again.' }
      }
      if (output.inputs) emit({ event: 'detail', name, input: output.inputs, ok: finalOutput.ok })
      const block = resultBlock(id, finalOutput)
      const bytes = JSON.stringify(block).length
      const fields = call.input !== null && typeof call.input === 'object' ? Object.entries(call.input as Record<string, unknown>).filter(([, v]) => v !== '' && v !== 'any' && v !== null && v !== undefined).map(([k]) => k) : []
      return {
        block,
        proposal: card,
        shape: { name, fields, ok: finalOutput.ok, rows: output.ok ? output.rows ?? null : null, bytes, ms: Date.now() - toolStarted, ...(output.ok && output.fingerprint ? { fingerprint: output.fingerprint } : {}) },
      }
    }))
    const resultBlocks = results.map(r => r.block)
    for (const r of results) {
      toolsRunThisRound.push(r.shape)
      toolsRun.push(r.shape)
      if (r.proposal) { proposals.push(r.proposal); emit({ event: 'proposal', ...r.proposal }) }
      for (const inner of Array.isArray(r.block.content) ? r.block.content as Block[] : []) if (inner.type === 'search_result' && typeof inner.source === 'string') known.add(inner.source)
    }
    logRound()
    await finishCall(ctx.adminDb, row)
    const wroteResults = await store('user', resultBlocks, null, {})
    if (wroteResults !== 'ok') return fail('error', 'The tool results could not be saved. Try again in a moment.')
    messages.push({ role: 'user', content: resultBlocks })
    // The wall inside an answer: this round's prompt + what it wrote + the new results is what the next request would carry.
    const nextPrompt = lastPrompt + usage.outputTokens + Math.ceil(JSON.stringify(resultBlocks).length / 3)
    if (nextPrompt >= CHAT_LIMITS.stopFromTokens) {
      await updateConversation(ctx.adminDb, ctx.userId, conversationId, { message_count: seq, last_prompt_tokens: lastPrompt, cost_usd: (conversation?.cost_usd ?? 0) + costTotal, status: 'full' })
      return fail('wall', 'This chat grew too long while looking things up. Start a new chat and ask again.')
    }
    if (nextPrompt >= CHAT_LIMITS.forceAnswerFromTokens) forceNoTools = true
    await updateConversation(ctx.adminDb, ctx.userId, conversationId, { message_count: seq, last_prompt_tokens: lastPrompt, cost_usd: (conversation?.cost_usd ?? 0) + costTotal })
  }

  if (!endedWith) return fail('error', 'The answer did not finish. Try again.')
  const citations = finalCitations
  // The wall after this answer: a prompt near the line means the next message would not fit.
  const wall = lastPrompt >= CHAT_LIMITS.wallTokens
  if (wall) await updateConversation(ctx.adminDb, ctx.userId, conversationId, { status: 'full' })
  return {
    event: 'done', conversation_id: conversationId, text: endedWith.text, citations, proposals, rounds: answerMessages.length,
    cost_usd: Math.round(costTotal * 1_000_000) / 1_000_000, wall, run_id: runId, ending: endedWith.ending,
    prompt_tokens: lastPrompt, thinking: thinkingSummary,
  }
}

type ProposalCard = ChatProposalCard

/** Writes a proposal row for one tool call and returns the card; null when it could not be saved. One tool call makes one proposal. */
async function makeProposal(ctx: RunContext, conversationId: string, toolUseId: string, draft: ProposalDraft, now: Date): Promise<ProposalCard | null> {
  if (!TOOL_USE_ID.test(toolUseId)) return null
  const id = ctx.newId()
  const expiresAt = new Date(now.getTime() + CHAT_LIMITS.proposalHours * 3_600_000).toISOString()
  const saved = await insertProposal(ctx.adminDb, { id, user_id: ctx.userId, conversation_id: conversationId, tool_use_id: toolUseId, tool: draft.tool, args: draft.args, summary: draft.summary, expires_at: expiresAt })
  return saved ? { id, tool: draft.tool, summary: draft.summary, expires_at: expiresAt } : null
}

// ── The owner's tap ─────────────────────────────────────────────────────────

export type ProposalDecision =
  | { ok: true; status: 'confirmed' | 'cancelled'; summary: string; result_id: string | null; tool: string; date?: string | null }
  | { ok: false; reason: 'bad_input' | 'not_found' | 'already_decided' | 'expired' | 'failed' | 'off' | 'error'; message: string }

/**
 * Confirm or Cancel of a proposal. The proposal is read BY ID AND VERIFIED USER (a forged or another account's id finds
 * nothing), decided at most once (the update only matches a row that is still pending), checked again with the same code
 * that made it, and written with the owner's own rights. A proposal that is expired or already decided writes nothing.
 */
export async function decideChatProposal(ctx: RunContext, input: unknown): Promise<ProposalDecision> {
  if (ctx.caller !== 'app' || ctx.readAs !== 'owner') return { ok: false, reason: 'bad_input', message: 'A proposal can only be decided in the app.' }
  const id = ownValue(input, 'proposal_id')
  const decision = ownValue(input, 'decision')
  if (!isUuid(id) || (decision !== 'confirm' && decision !== 'cancel')) return { ok: false, reason: 'bad_input', message: 'That is not a proposal this app knows.' }
  const found = await readProposal(ctx.adminDb, ctx.userId, id)
  if (found.error) return { ok: false, reason: 'error', message: 'The proposal could not be read. Try again in a moment.' }
  const proposal = found.proposal
  if (!proposal) return { ok: false, reason: 'not_found', message: 'That proposal was not found.' }
  if (proposal.status !== 'pending') return { ok: false, reason: 'already_decided', message: `That proposal was already ${proposal.status === 'confirmed' ? 'confirmed' : proposal.status === 'cancelled' ? 'cancelled' : 'decided (saving it failed)'}.` }
  const now = ctx.now()
  // Fail closed: a date that cannot be read counts as expired.
  if (!(Date.parse(proposal.expires_at) > now.getTime())) {
    await decideProposal(ctx.adminDb, ctx.userId, id, 'cancelled', now.toISOString())
    return { ok: false, reason: 'expired', message: 'That proposal expired. Ask again.' }
  }
  if (decision === 'cancel') {
    const won = await decideProposal(ctx.adminDb, ctx.userId, id, 'cancelled', now.toISOString())
    return won ? { ok: true, status: 'cancelled', summary: proposal.summary, result_id: null, tool: proposal.tool } : { ok: false, reason: 'already_decided', message: 'That proposal was already decided.' }
  }
  // The owner may edit the title and the date on the card; the edited values go through the same check as the proposal did.
  const today = osloDay(now)
  const editedTitle = ownValue(input, 'title')
  const editedDate = ownValue(input, 'date')
  if ((editedTitle !== undefined && typeof editedTitle !== 'string') || (editedDate !== undefined && typeof editedDate !== 'string')) {
    return { ok: false, reason: 'bad_input', message: 'The title and the date must be text.' }
  }
  const stored = proposal.args !== null && typeof proposal.args === 'object' && !Array.isArray(proposal.args) ? proposal.args as Record<string, unknown> : {}
  const merged: Record<string, unknown> = {
    ...stored,
    ...(editedTitle !== undefined ? { title: editedTitle } : {}),
    ...(editedDate !== undefined ? (proposal.tool === 'add_task' ? { due_date: editedDate === '' ? null : editedDate } : { date: editedDate }) : {}),
  }
  // The tool must still be "ask first": a tool the owner has since switched off writes nothing (the setting is read now, not when the chat began).
  const controls = await readChatControls(ctx.userDb, ctx.userId)
  if (!controls) return { ok: false, reason: 'error', message: 'Your Ask AI settings could not be read, so nothing was saved. Try again in a moment.' }
  if (controls.modes[proposal.tool === 'add_task' ? 'propose_add_task' : 'propose_log_food'] !== 'ask') {
    await decideProposal(ctx.adminDb, ctx.userId, id, 'cancelled', now.toISOString())
    return { ok: false, reason: 'off', message: 'That kind of change is switched off for Ask AI, so nothing was saved.' }
  }
  // Check before claiming, so a stored or edited value that does not pass never uses up the one decision as a success.
  const rechecked = checkedProposal(proposal.tool, merged, today)
  if (!rechecked.ok) {
    if (editedTitle !== undefined || editedDate !== undefined) return { ok: false, reason: 'bad_input', message: rechecked.message }
    await decideProposal(ctx.adminDb, ctx.userId, id, 'failed', now.toISOString())
    return { ok: false, reason: 'failed', message: 'That proposal is not valid any more, so nothing was saved.' }
  }
  const won = await decideProposal(ctx.adminDb, ctx.userId, id, 'confirmed', now.toISOString(), rechecked.draft.args)
  if (!won) return { ok: false, reason: 'already_decided', message: 'That proposal was already decided.' }
  const written = await applyProposal(ctx.userDb, ctx.userId, proposal.tool, rechecked.draft.args, today)
  if (!written.ok) {
    await markProposalFailed(ctx.adminDb, ctx.userId, id)
    return { ok: false, reason: 'failed', message: written.message }
  }
  await setProposalResult(ctx.adminDb, ctx.userId, id, written.id)
  return { ok: true, status: 'confirmed', summary: rechecked.draft.summary, result_id: written.id, tool: proposal.tool, date: proposal.tool === 'log_food' ? String(rechecked.draft.args.date) : null }
}

/** Deletes a chat softly (the Undo window; ai_chats_purge removes it for good later) or brings it back. */
export async function setChatDeleted(ctx: RunContext, input: unknown, deleted: boolean): Promise<{ ok: true; id: string; title: string } | { ok: false; reason: 'bad_input' | 'not_found' | 'error'; message: string }> {
  if (ctx.caller !== 'app' || ctx.readAs !== 'owner') return { ok: false, reason: 'bad_input', message: 'A chat can only be deleted in the app.' }
  const id = ownValue(input, 'conversation_id')
  if (!isUuid(id)) return { ok: false, reason: 'bad_input', message: 'That is not a chat this app knows.' }
  const found = await readConversation(ctx.adminDb, ctx.userId, id)
  if (found.error) return { ok: false, reason: 'error', message: 'The chat could not be read. Try again in a moment.' }
  const c = found.conversation
  // Deleting needs a chat that is there; restoring needs one that is deleted (and not yet purged).
  if (!c || (deleted ? c.deleted_at !== null : c.deleted_at === null)) return { ok: false, reason: 'not_found', message: deleted ? 'That chat was already deleted.' : 'That chat is not there to restore.' }
  const changed = await setConversationDeleted(ctx.adminDb, ctx.userId, id, deleted ? ctx.now().toISOString() : null)
  return changed ? { ok: true, id, title: c.title ?? 'Chat' } : { ok: false, reason: 'error', message: 'The chat could not be changed. Try again in a moment.' }
}
