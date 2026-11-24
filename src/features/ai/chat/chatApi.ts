import { supabase } from '../../../integrations/supabase/client'
import { parseFunctionErrorBody } from '../../../shared/utils/functionError'
import { requireUser } from '../../../shared/utils/requireUser'
import { isSessionRefusal, parseSse, readChatEvent, sendWithSession, type ChatEvent, type ChatMode, type StoredMessageRow, type StoredProposalRow } from './chatRules'

// The app's door to Ask AI (the `claude` function, job `chat`, migration 197). The answer streams in as server-sent
// events, so it goes through `fetch` (supabase.functions.invoke cannot stream). The owner's sign-in token is the only
// credential; the function checks it and the owner list. Everything that comes back is input: chatRules reads it.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_KEY = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string

/** A chat that could not be started or ended in the middle: the function's own sentence, or ours. */
export class ChatError extends Error {
  readonly reason: string
  constructor(reason: string, message: string) {
    super(message)
    this.name = 'ChatError'
    this.reason = reason
  }
}

/**
 * Sends one message and calls `onEvent` for each event of the answer. Resolves when the stream ends. A request the
 * function refused before streaming (a bad sign-in, a body it will not read) throws a ChatError; an error inside the
 * stream arrives as an `error` event (the caller shows it).
 */
export async function streamChat(input: { conversationId: string | null; text: string; images?: readonly { media_type: 'image/jpeg'; data: string }[]; mode?: ChatMode }, onEvent: (event: ChatEvent) => void, signal: AbortSignal): Promise<void> {
  // The token is read right before each request: getSession() refreshes an expired one, and a 401 gets one refresh and one retry.
  let res: Response | null
  try {
    res = await sendWithSession({
      currentToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null,
      refreshedToken: async () => (await supabase.auth.refreshSession()).data.session?.access_token ?? null,
      send: token => fetch(`${SUPABASE_URL}/functions/v1/claude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY },
        body: JSON.stringify({ action: 'chat', stream: true, conversation_id: input.conversationId, text: input.text, ...(input.images?.length ? { images: input.images } : {}), ...(input.conversationId === null && input.mode === 'coach' ? { mode: 'coach' } : {}) }),
        signal,
      }),
    })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return
    throw new ChatError('error', 'The AI function could not be reached — check the connection and try again.')
  }
  if (!res || isSessionRefusal(res.status)) throw new ChatError('error', 'Session error — refresh the page and sign in again.')
  if (res.status === 503) {
    // The function could not check the sign-in (not a bad token): its own sentence, no refresh, no "sign in again".
    const said = await res.json().then((b: unknown) => (b !== null && typeof b === 'object' && typeof (b as { error?: unknown }).error === 'string' ? (b as { error: string }).error.slice(0, 200) : ''), () => '')
    throw new ChatError('error', said || 'The AI function could not check your sign-in — try again in a moment.')
  }
  if (!res.ok || !res.body) throw new ChatError('error', 'The AI function did not answer — try again in a moment.')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const { events, rest } = parseSse(buffer)
      buffer = rest
      for (const raw of events) {
        const event = readChatEvent(raw.name, raw.data)
        if (event) onEvent(event)
      }
    }
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return
    throw new ChatError('error', 'The answer was interrupted — try again.')
  }
}

export type ProposalOutcome =
  | { ok: true; status: 'confirmed' | 'cancelled'; summary: string; resultId: string | null; tool: string; date: string | null }
  | { ok: false; reason: string; message: string }

/**
 * The owner's Confirm or Cancel. The function checks the proposal against the signed-in account and writes (on Confirm)
 * with the owner's own rights; `edits` (a changed title or date) are checked there again.
 */
export async function decideProposal(id: string, decision: 'confirm' | 'cancel', edits?: { title?: string; date?: string }): Promise<ProposalOutcome> {
  const { data, error } = await supabase.functions.invoke('claude', { body: { action: 'chat_confirm', proposal_id: id, decision, ...(decision === 'confirm' ? edits ?? {} : {}) } })
  if (error) {
    const body = await parseFunctionErrorBody(error)
    throw new ChatError('error', typeof body?.error === 'string' ? body.error : 'The AI function did not answer — try again in a moment.')
  }
  if (data?.ok === true && (data.status === 'confirmed' || data.status === 'cancelled')) {
    return {
      ok: true, status: data.status, summary: typeof data.summary === 'string' ? data.summary.slice(0, 300) : '', tool: String(data.tool ?? ''),
      resultId: typeof data.result_id === 'string' ? data.result_id : null, date: typeof data.date === 'string' ? data.date : null,
    }
  }
  return { ok: false, reason: typeof data?.reason === 'string' ? data.reason : 'error', message: typeof data?.message === 'string' ? data.message.slice(0, 300) : 'That did not work.' }
}

/** What a proposal stores (read from the table: the card shows these, not the model's summary). */
export async function fetchProposalArgs(ids: readonly string[]): Promise<{ id: string; args: Record<string, unknown> | null; status: string }[]> {
  if (!ids.length) return []
  const { data, error } = await supabase.from('ai_chat_proposals').select('id, args, status').in('id', [...ids])
  if (error) throw error
  return (data ?? []).map(r => ({ id: String(r.id), args: r.args && typeof r.args === 'object' && !Array.isArray(r.args) ? r.args as Record<string, unknown> : null, status: String(r.status) }))
}

/** Takes back a row a confirmed proposal made (the card's Undo): the owner's own row, by id, with the owner's rights. */
export async function removeCreatedRow(tool: string, id: string): Promise<void> {
  const user = await requireUser()
  const table = tool === 'add_task' ? 'tasks' : 'food_log_entries'
  const { error } = await supabase.from(table).delete().eq('id', id).eq('user_id', user.id)
  if (error) throw error
}

/** The columns a confirmed change may have written, by the names its stored proposal uses (chat-tools.ts `applyChange`). */
const CHANGE_COLUMNS: Record<string, Record<string, string>> = {
  update_food: { title: 'custom_title', calories: 'calories', protein_g: 'protein_g', carbs_g: 'carbs_g', fat_g: 'fat_g' },
  update_task: { title: 'title' },
}

/**
 * The card's Undo of a confirmed change: the owner's own row, by id, with the owner's rights, gets back what it said before,
 * in the changed columns only (read from the stored proposal, never from the card). A value of the wrong type is refused.
 */
export async function restoreChangedRow(tool: string, id: string, before: Record<string, unknown>, changed: readonly string[]): Promise<void> {
  const columns = CHANGE_COLUMNS[tool]
  if (!columns) throw new Error('That change cannot be undone here.')
  const user = await requireUser()
  const patch: Record<string, unknown> = {}
  for (const key of changed) {
    const column = columns[key]
    const value = before[key]
    if (!column) continue
    if (key === 'title' ? typeof value !== 'string' || !value.trim() : typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('The old value could not be read, so nothing was changed.')
    patch[column] = value
  }
  if (!Object.keys(patch).length) throw new Error('Nothing to put back.')
  const table = tool === 'update_task' ? 'tasks' : 'food_log_entries'
  const { error } = await supabase.from(table).update(patch).eq('id', id).eq('user_id', user.id)
  if (error) throw error
}

/** Deletes a chat (softly: the function keeps it for 7 days, so Undo works) or brings it back. */
export async function setChatDeleted(id: string, deleted: boolean): Promise<{ id: string; title: string }> {
  const { data, error } = await supabase.functions.invoke('claude', { body: { action: deleted ? 'chat_delete' : 'chat_restore', conversation_id: id } })
  if (error) {
    const body = await parseFunctionErrorBody(error)
    throw new ChatError('error', typeof body?.error === 'string' ? body.error : 'The AI function did not answer — try again in a moment.')
  }
  if (data?.ok !== true) throw new ChatError(String(data?.reason ?? 'error'), typeof data?.message === 'string' ? data.message.slice(0, 200) : 'That did not work.')
  return { id, title: typeof data.title === 'string' ? data.title : 'Chat' }
}

export interface ConversationListItem { id: string; title: string; updatedAt: string; status: string; lastPromptTokens: number; costUsd: number; mode: ChatMode }

interface PgError { code?: string; message?: string }
const isMissing = (e: PgError | null): boolean => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /could not find the table/i.test(e.message ?? ''))

/** The owner's chats, newest first. Before migration 197 runs the list is empty. */
export async function fetchConversations(): Promise<ConversationListItem[]> {
  let { data, error } = await supabase.from('ai_conversations').select('id, title, updated_at, status, last_prompt_tokens, cost_usd, mode').is('deleted_at', null).order('updated_at', { ascending: false }).limit(50)
  // Before migration 198 there is no kind: every chat is the everyday one.
  if (isMissingColumn(error)) ({ data, error } = await supabase.from('ai_conversations').select('id, title, updated_at, status, last_prompt_tokens, cost_usd').is('deleted_at', null).order('updated_at', { ascending: false }).limit(50) as unknown as { data: typeof data; error: typeof error })
  if (error) {
    if (isMissing(error)) return []
    throw error
  }
  return (Array.isArray(data) ? data : []).flatMap(r => typeof r.id === 'string'
    ? [{ id: r.id as string, title: typeof r.title === 'string' && r.title ? r.title : 'Chat', updatedAt: String(r.updated_at ?? ''), status: String(r.status ?? 'open'), lastPromptTokens: Number(r.last_prompt_tokens) || 0, costUsd: Number(r.cost_usd) || 0, mode: (r as { mode?: unknown }).mode === 'coach' ? 'coach' as const : 'chat' as const }]
    : [])
}

/** What a chat was started with (frozen by the function): its kind, its tools and whether the owner's own words were in it. */
export interface ChatSetup { mode: ChatMode; toolNames: string[]; ownerInstructions: string }

const isMissingColumn = (e: PgError | null): boolean => !!e && (e.code === '42703' || e.code === 'PGRST204')

/** The setup of one chat. Before migration 198 there is no kind and no frozen words: the everyday chat with no words of the owner's. */
export async function fetchChatSetup(id: string): Promise<ChatSetup | null> {
  let { data, error } = await supabase.from('ai_conversations').select('mode, tool_names, owner_instructions').eq('id', id).maybeSingle()
  if (isMissingColumn(error)) ({ data, error } = await supabase.from('ai_conversations').select('tool_names').eq('id', id).maybeSingle() as unknown as { data: typeof data; error: typeof error })
  if (error || !data) return null
  const names = Array.isArray(data.tool_names) ? data.tool_names.filter((n: unknown): n is string => typeof n === 'string').slice(0, 20) : []
  return { mode: data.mode === 'coach' ? 'coach' : 'chat', toolNames: names, ownerInstructions: typeof data.owner_instructions === 'string' ? data.owner_instructions.slice(0, 1000) : '' }
}

/** A chat's stored messages and proposals, for drawing it. */
export async function fetchConversationRows(id: string): Promise<{ messages: StoredMessageRow[]; proposals: StoredProposalRow[]; status: string; lastPromptTokens: number; setup: ChatSetup | null }> {
  const [messages, proposals, conversation, setup] = await Promise.all([
    supabase.from('ai_messages').select('seq, role, content, meta').eq('conversation_id', id).order('seq', { ascending: true }).limit(600),
    supabase.from('ai_chat_proposals').select('id, tool_use_id, tool, summary, status, expires_at, args, result_id').eq('conversation_id', id).limit(100),
    supabase.from('ai_conversations').select('status, last_prompt_tokens').eq('id', id).maybeSingle(),
    fetchChatSetup(id),
  ])
  for (const r of [messages, proposals, conversation]) if (r.error) throw r.error
  return {
    messages: (messages.data ?? []).filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.seq === 'number') as StoredMessageRow[],
    proposals: (proposals.data ?? []) as StoredProposalRow[],
    status: String(conversation.data?.status ?? 'open'),
    lastPromptTokens: Number(conversation.data?.last_prompt_tokens) || 0,
    setup,
  }
}

export interface CallMeta { cacheMiss: { reason: string; tokens: number | null } | null; cleared: { toolUses: number; tokens: number } | null; conversationId: string }

/** The cache-miss reason and the context-editing numbers kept with the answer a call produced (Developer → AI → Calls). */
export async function fetchCallMeta(callId: string): Promise<CallMeta | null> {
  const { data, error } = await supabase.from('ai_messages').select('conversation_id, meta').eq('call_id', callId).maybeSingle()
  if (error) {
    if (isMissing(error)) return null
    throw error
  }
  const meta = data && typeof data.meta === 'object' && data.meta ? data.meta as Record<string, unknown> : null
  if (!data || !meta) return null
  const miss = meta.cache_miss as { reason?: unknown; tokens?: unknown } | undefined
  const cleared = meta.cleared as { toolUses?: unknown; tokens?: unknown } | undefined
  return {
    conversationId: String(data.conversation_id),
    cacheMiss: miss && typeof miss.reason === 'string' ? { reason: miss.reason.slice(0, 40), tokens: typeof miss.tokens === 'number' ? miss.tokens : null } : null,
    cleared: cleared && typeof cleared.toolUses === 'number' && typeof cleared.tokens === 'number' ? { toolUses: cleared.toolUses, tokens: cleared.tokens } : null,
  }
}
