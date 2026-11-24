// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · Ask AI, the stored chats (migration 197)
//
//  The function's whole use of the three chat tables, with the service-role client: that client has no row level
//  security, so EVERY query names the user id main.ts verified (and a message or a proposal is also tied to its
//  conversation by a composite foreign key in the database). Nothing here reads a user id from a request.
//
//  A chat is only added to: this part inserts messages and never updates or deletes one (the database refuses both).
//  A read that fails answers null / an error word and the caller sends nothing.
// ─────────────────────────────────────────────────────────────────────────────

import type { Block, ChatMessage } from './types.ts'
import type { Db } from './ledger.ts'
import { ownValue } from './guard.ts'
import { ALL_TOOL_ORDER, cleanOwnerInstructions, messageDigest, toolModes, type ChatMode, type ToolMode } from './chat-rules.ts'
import { PROPOSAL_TOOLS, type ProposalTool } from './chat-tools.ts'

export interface ConversationRow {
  id: string
  user_id: string
  title: string | null
  model: string
  effort: 'low' | 'medium' | 'high'
  thinking: 'adaptive' | 'off'
  tools_hash: string
  system_hash: string
  tool_names: string[]
  status: 'open' | 'full' | 'closed'
  message_count: number
  last_prompt_tokens: number
  cost_usd: number
  /** Set when the owner deleted the chat (the Undo window): such a chat is treated as not there. */
  deleted_at: string | null
  /** Which kind of chat it was started as (frozen): its instructions and tool set follow from it. */
  mode: ChatMode
  /** The owner's own instructions as they were when the chat started (frozen, cleaned). */
  owner_instructions: string
}

export interface StoredMessage {
  seq: number
  role: 'user' | 'assistant'
  content: Block[]
  digest: string
  call_id: string | null
  meta: Record<string, unknown>
  created_at: string
}

export interface ProposalRow {
  id: string
  user_id: string
  conversation_id: string
  tool_use_id: string
  tool: ProposalTool
  args: unknown
  summary: string
  /** `replaced`: a newer proposal for the same thing took its place (migration 205); it can no longer be decided. */
  status: 'pending' | 'confirmed' | 'cancelled' | 'failed' | 'replaced'
  created_at: string
  expires_at: string
  decided_at: string | null
  result_id: string | null
}

const STORE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STORE_PAGE = 500
const MAX_MESSAGES = 600

export const isUuid = (value: unknown): value is string => typeof value === 'string' && STORE_UUID.test(value)

const CONVERSATION_COLUMNS = 'id, user_id, title, model, effort, thinking, tools_hash, system_hash, tool_names, status, message_count, last_prompt_tokens, cost_usd, deleted_at, mode, owner_instructions'

function conversationOf(row: unknown): ConversationRow | null {
  const effort = ownValue(row, 'effort')
  const thinking = ownValue(row, 'thinking')
  const status = ownValue(row, 'status')
  const names = ownValue(row, 'tool_names')
  const id = ownValue(row, 'id')
  const userId = ownValue(row, 'user_id')
  if (!isUuid(id) || !isUuid(userId) || typeof ownValue(row, 'model') !== 'string') return null
  if (effort !== 'low' && effort !== 'medium' && effort !== 'high') return null
  if (thinking !== 'adaptive' && thinking !== 'off') return null
  if (status !== 'open' && status !== 'full' && status !== 'closed') return null
  if (!Array.isArray(names) || names.some(n => typeof n !== 'string')) return null
  const mode = ownValue(row, 'mode')
  if (mode !== 'chat' && mode !== 'coach') return null
  const frozen = ownValue(row, 'owner_instructions')
  if (typeof frozen !== 'string') return null
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v))
  return {
    id, user_id: userId, title: typeof ownValue(row, 'title') === 'string' ? ownValue(row, 'title') as string : null,
    model: ownValue(row, 'model') as string, effort, thinking,
    tools_hash: String(ownValue(row, 'tools_hash')), system_hash: String(ownValue(row, 'system_hash')),
    tool_names: names as string[], status, message_count: num(ownValue(row, 'message_count')) || 0,
    last_prompt_tokens: num(ownValue(row, 'last_prompt_tokens')) || 0, cost_usd: num(ownValue(row, 'cost_usd')) || 0,
    deleted_at: typeof ownValue(row, 'deleted_at') === 'string' ? ownValue(row, 'deleted_at') as string : null,
    mode, owner_instructions: frozen,
  }
}

export async function createConversation(admin: Db, row: Omit<ConversationRow, 'message_count' | 'last_prompt_tokens' | 'cost_usd' | 'status' | 'deleted_at'>): Promise<string | null> {
  try {
    const { error } = await admin.from('ai_conversations').insert({ ...row })
    return error ? `database error ${error.code || 'without a code'}` : null
  } catch { return 'the database could not be reached' }
}

/** One conversation of this user, or null (also for another user's id: the query names the user). `error`: it could not be read. */
export async function readConversation(admin: Db, userId: string, id: string): Promise<{ conversation: ConversationRow | null; error: boolean }> {
  try {
    const { data, error } = await admin.from('ai_conversations').select(CONVERSATION_COLUMNS).eq('id', id).eq('user_id', userId).maybeSingle()
    if (error) return { conversation: null, error: true }
    return { conversation: data ? conversationOf(data) : null, error: false }
  } catch { return { conversation: null, error: true } }
}

/** Deletes a chat softly (the Undo window) or brings it back. True when a row of this user changed. */
export async function setConversationDeleted(admin: Db, userId: string, id: string, deletedAt: string | null): Promise<boolean> {
  try {
    const { data, error } = await admin.from('ai_conversations').update({ deleted_at: deletedAt }).eq('id', id).eq('user_id', userId).select('id')
    return !error && Array.isArray(data) && data.length === 1
  } catch { return false }
}

export async function updateConversation(admin: Db, userId: string, id: string, patch: Record<string, unknown>): Promise<string | null> {
  try {
    const { error } = await admin.from('ai_conversations').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', userId)
    return error ? `database error ${error.code ?? 'without a code'}` : null
  } catch { return 'the database could not be reached' }
}

function messageOf(row: unknown): StoredMessage | null {
  const seq = ownValue(row, 'seq')
  const role = ownValue(row, 'role')
  const content = ownValue(row, 'content')
  const digest = ownValue(row, 'digest')
  if (typeof seq !== 'number' || (role !== 'user' && role !== 'assistant') || !Array.isArray(content) || typeof digest !== 'string') return null
  const meta = ownValue(row, 'meta')
  const callId = ownValue(row, 'call_id')
  return {
    seq, role, content: content as Block[], digest, call_id: typeof callId === 'string' ? callId : null,
    meta: meta !== null && typeof meta === 'object' && !Array.isArray(meta) ? meta as Record<string, unknown> : {},
    created_at: String(ownValue(row, 'created_at') ?? ''),
  }
}

/** A conversation's messages in order, or null when they cannot be read or are too many. */
export async function readMessages(admin: Db, userId: string, conversationId: string): Promise<StoredMessage[] | null> {
  try {
    const out: StoredMessage[] = []
    for (let page = 0; out.length < MAX_MESSAGES; page++) {
      const { data, error } = await admin.from('ai_messages').select('seq, role, content, digest, call_id, meta, created_at')
        .eq('conversation_id', conversationId).eq('user_id', userId).order('seq', { ascending: true }).range(page * STORE_PAGE, page * STORE_PAGE + STORE_PAGE - 1)
      if (error || !Array.isArray(data)) return null
      for (const row of data) {
        const message = messageOf(row)
        if (!message) return null
        out.push(message)
      }
      if (data.length < STORE_PAGE) return out
    }
    return null
  } catch { return null }
}

/**
 * Checks the history before it is replayed: numbers 1, 2, 3 … with none missing, roles that alternate sensibly, and the
 * hash chain. A history that fails is never sent: the chat is refused as changed.
 */
export async function historyIsIntact(messages: readonly StoredMessage[]): Promise<boolean> {
  let previous: string | null = null
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.seq !== i + 1) return false
    if (m.digest !== await messageDigest(previous, m.role, m.content)) return false
    previous = m.digest
  }
  return true
}

/** The history as the model gets it. */
export function asChatMessages(messages: readonly StoredMessage[]): ChatMessage[] {
  return messages.map(m => ({ role: m.role, content: m.content }))
}

/** Adds one message. `conflict`: another request took that number (two answers at once). */
export async function appendMessage(
  admin: Db, row: { conversation_id: string; user_id: string; seq: number; role: 'user' | 'assistant'; content: Block[]; digest: string; call_id: string | null; meta: Record<string, unknown> },
): Promise<'ok' | 'conflict' | 'error'> {
  try {
    const { error } = await admin.from('ai_messages').insert({ ...row })
    if (!error) return 'ok'
    return error.code === '23505' ? 'conflict' : 'error'
  } catch { return 'error' }
}

function proposalOf(row: unknown): ProposalRow | null {
  const id = ownValue(row, 'id')
  const tool = ownValue(row, 'tool')
  const status = ownValue(row, 'status')
  if (!isUuid(id) || !isUuid(ownValue(row, 'user_id')) || !isUuid(ownValue(row, 'conversation_id'))) return null
  if (!PROPOSAL_TOOLS.includes(tool as ProposalTool)) return null
  if (status !== 'pending' && status !== 'confirmed' && status !== 'cancelled' && status !== 'failed' && status !== 'replaced') return null
  const text = (key: string) => String(ownValue(row, key) ?? '')
  const resultId = ownValue(row, 'result_id')
  return {
    id, user_id: ownValue(row, 'user_id') as string, conversation_id: ownValue(row, 'conversation_id') as string,
    tool_use_id: text('tool_use_id'), tool: tool as ProposalTool, args: ownValue(row, 'args'), summary: text('summary'), status,
    created_at: text('created_at'), expires_at: text('expires_at'),
    decided_at: ownValue(row, 'decided_at') ? text('decided_at') : null, result_id: isUuid(resultId) ? resultId : null,
  }
}

const PROPOSAL_COLUMNS = 'id, user_id, conversation_id, tool_use_id, tool, args, summary, status, created_at, expires_at, decided_at, result_id'

export async function insertProposal(
  admin: Db, row: { id: string; user_id: string; conversation_id: string; tool_use_id: string; tool: ProposalTool; args: Record<string, unknown>; summary: string; expires_at: string },
): Promise<boolean> {
  try {
    const { error } = await admin.from('ai_chat_proposals').insert({ ...row })
    return !error
  } catch { return false }
}

/** One proposal of this user by its id, or null. `error`: it could not be read. */
export async function readProposal(admin: Db, userId: string, id: string): Promise<{ proposal: ProposalRow | null; error: boolean }> {
  try {
    const { data, error } = await admin.from('ai_chat_proposals').select(PROPOSAL_COLUMNS).eq('id', id).eq('user_id', userId).maybeSingle()
    if (error) return { proposal: null, error: true }
    return { proposal: data ? proposalOf(data) : null, error: false }
  } catch { return { proposal: null, error: true } }
}

/**
 * Decides a pending proposal once: the update only matches a row that is still pending, for this user, so two taps (or a
 * tap and a replay) cannot both win. True when this call is the one that decided it.
 */
export async function decideProposal(admin: Db, userId: string, id: string, status: 'confirmed' | 'cancelled' | 'failed', nowIso: string, args?: Record<string, unknown>): Promise<boolean> {
  try {
    // `args`: the owner's edits (a changed title or date), already checked, kept on the row so it says what was written.
    const { data, error } = await admin.from('ai_chat_proposals').update({ status, decided_at: nowIso, ...(args ? { args } : {}) })
      .eq('id', id).eq('user_id', userId).eq('status', 'pending').select('id')
    return !error && Array.isArray(data) && data.length === 1
  } catch { return false }
}

/** The pending proposals of one chat of this user (a new proposal for the same thing replaces one of them). Null: they could not be read. */
export async function pendingProposals(admin: Db, userId: string, conversationId: string): Promise<ProposalRow[] | null> {
  try {
    const { data, error } = await admin.from('ai_chat_proposals').select(PROPOSAL_COLUMNS)
      .eq('conversation_id', conversationId).eq('user_id', userId).eq('status', 'pending').order('created_at', { ascending: true }).limit(50)
    if (error || !Array.isArray(data)) return null
    return data.map(proposalOf).filter((p): p is ProposalRow => p !== null)
  } catch { return null }
}

/**
 * Marks older pending proposals of this chat and user as `replaced`: only rows still pending (a decided one never changes),
 * only these ids. It decides nothing else: no write, no Confirm, no Cancel. The ids that really changed come back.
 */
export async function replaceProposals(admin: Db, userId: string, conversationId: string, ids: readonly string[], nowIso: string): Promise<string[]> {
  if (!ids.length) return []
  try {
    const { data, error } = await admin.from('ai_chat_proposals').update({ status: 'replaced', decided_at: nowIso })
      .eq('conversation_id', conversationId).eq('user_id', userId).eq('status', 'pending').in('id', [...ids]).select('id')
    if (error || !Array.isArray(data)) return []
    return data.map(r => ownValue(r, 'id')).filter(isUuid)
  } catch { return [] }
}

/** A confirmed proposal whose write failed is marked failed (only a confirmed one with no result: never a pending or a finished one). */
export async function markProposalFailed(admin: Db, userId: string, id: string): Promise<void> {
  try {
    await admin.from('ai_chat_proposals').update({ status: 'failed' }).eq('id', id).eq('user_id', userId).eq('status', 'confirmed').is('result_id', null)
  } catch { /* the card then shows confirmed: the row is not there, and the app says so */ }
}

export async function setProposalResult(admin: Db, userId: string, id: string, resultId: string): Promise<void> {
  try {
    await admin.from('ai_chat_proposals').update({ result_id: resultId }).eq('id', id).eq('user_id', userId)
  } catch { /* the row was written; only the card's Open link is missing */ }
}

/** A conversation's proposals decided after `sinceIso`: the model is told about them in its next live-context block. */
export async function decidedProposalsSince(admin: Db, userId: string, conversationId: string, sinceIso: string): Promise<ProposalRow[]> {
  try {
    const { data, error } = await admin.from('ai_chat_proposals').select(PROPOSAL_COLUMNS)
      .eq('conversation_id', conversationId).eq('user_id', userId).gte('decided_at', sinceIso).order('decided_at', { ascending: true }).limit(20)
    if (error || !Array.isArray(data)) return []
    return data.map(proposalOf).filter((p): p is ProposalRow => p !== null)
  } catch { return [] }
}

/** Whether a row the owner's own client can see exists with this id: the citation check (a citation only links to the owner's own rows). */
export async function ownRowTitle(db: Db, userId: string, kind: 'task' | 'diary', id: string): Promise<{ title: string; day: string | null } | null> {
  try {
    if (kind === 'task') {
      const { data, error } = await db.from('tasks').select('title, due_date').eq('id', id).eq('user_id', userId).maybeSingle()
      return error || !data ? null : { title: String(ownValue(data, 'title') ?? ''), day: typeof ownValue(data, 'due_date') === 'string' ? ownValue(data, 'due_date') as string : null }
    }
    const { data, error } = await db.from('diary_entries').select('day').eq('id', id).eq('user_id', userId).maybeSingle()
    const day = ownValue(data, 'day')
    return error || typeof day !== 'string' ? null : { title: 'Diary', day }
  } catch { return null }
}

// ── What the owner chose (migration 198) ────────────────────────────────────

const PG_MISSING = new Set(['42P01', 'PGRST205', '42703', 'PGRST204'])

/**
 * The owner's own controls: each tool's mode (after the code's checks: `toolModes`) and the instructions (cleaned, cut).
 * Both are written by the browser, so both are input.
 * - The tool rows: ANY error reading them means "could not read": nothing is sent. There is no fallback to the defaults
 *   (a tool the owner switched off must never come back because a read failed; migration 198 deploys before the function).
 *   Only the code's own tool names are asked for.
 * - The instructions: a database without the column has none (remove that fallback once 198 has run everywhere).
 * Null when they could not be read.
 */
export async function readChatControls(db: Db, userId: string): Promise<{ modes: Record<string, ToolMode>; instructions: string } | null> {
  try {
    const [tools, account] = await Promise.all([
      db.from('ai_tool_settings').select('tool, mode').eq('user_id', userId).in('tool', [...ALL_TOOL_ORDER]).limit(50),
      db.from('ai_settings').select('chat_instructions').eq('user_id', userId).maybeSingle(),
    ])
    if (tools.error || !Array.isArray(tools.data)) return null
    if (account.error && !PG_MISSING.has(String(account.error.code))) return null
    return {
      modes: toolModes(tools.data),
      instructions: account.error ? '' : cleanOwnerInstructions(ownValue(account.data, 'chat_instructions')),
    }
  } catch { return null }
}
