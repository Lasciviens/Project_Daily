import { supabase } from '../../../integrations/supabase/client'
import { parseFunctionErrorBody } from '../../../shared/utils/functionError'
import { parseSse, readChatEvent, type ChatEvent, type StoredMessageRow, type StoredProposalRow } from './chatRules'

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
export async function streamChat(input: { conversationId: string | null; text: string }, onEvent: (event: ChatEvent) => void, signal: AbortSignal): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new ChatError('error', 'Session error — refresh the page and sign in again.')
  let res: Response
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/claude`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: SUPABASE_KEY },
      body: JSON.stringify({ action: 'chat', stream: true, conversation_id: input.conversationId, text: input.text }),
      signal,
    })
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') return
    throw new ChatError('error', 'The AI function could not be reached — check the connection and try again.')
  }
  if (res.status === 401 || res.status === 403) throw new ChatError('error', 'Session error — refresh the page and sign in again.')
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
  | { ok: true; status: 'confirmed' | 'cancelled'; summary: string }
  | { ok: false; reason: string; message: string }

/** The owner's Confirm or Cancel. The function checks the proposal against the signed-in account and writes (on Confirm) with the owner's own rights. */
export async function decideProposal(id: string, decision: 'confirm' | 'cancel'): Promise<ProposalOutcome> {
  const { data, error } = await supabase.functions.invoke('claude', { body: { action: 'chat_confirm', proposal_id: id, decision } })
  if (error) {
    const body = await parseFunctionErrorBody(error)
    throw new ChatError('error', typeof body?.error === 'string' ? body.error : 'The AI function did not answer — try again in a moment.')
  }
  if (data?.ok === true && (data.status === 'confirmed' || data.status === 'cancelled')) return { ok: true, status: data.status, summary: typeof data.summary === 'string' ? data.summary.slice(0, 300) : '' }
  return { ok: false, reason: typeof data?.reason === 'string' ? data.reason : 'error', message: typeof data?.message === 'string' ? data.message.slice(0, 300) : 'That did not work.' }
}

export interface ConversationListItem { id: string; title: string; updatedAt: string; status: string; lastPromptTokens: number; costUsd: number }

interface PgError { code?: string; message?: string }
const isMissing = (e: PgError | null): boolean => !!e && (e.code === '42P01' || e.code === 'PGRST205' || /could not find the table/i.test(e.message ?? ''))

/** The owner's chats, newest first. Before migration 197 runs the list is empty. */
export async function fetchConversations(): Promise<ConversationListItem[]> {
  const { data, error } = await supabase.from('ai_conversations').select('id, title, updated_at, status, last_prompt_tokens, cost_usd').order('updated_at', { ascending: false }).limit(50)
  if (error) {
    if (isMissing(error)) return []
    throw error
  }
  return (Array.isArray(data) ? data : []).flatMap(r => typeof r.id === 'string'
    ? [{ id: r.id as string, title: typeof r.title === 'string' && r.title ? r.title : 'Chat', updatedAt: String(r.updated_at ?? ''), status: String(r.status ?? 'open'), lastPromptTokens: Number(r.last_prompt_tokens) || 0, costUsd: Number(r.cost_usd) || 0 }]
    : [])
}

/** A chat's stored messages and proposals, for drawing it. */
export async function fetchConversationRows(id: string): Promise<{ messages: StoredMessageRow[]; proposals: StoredProposalRow[]; status: string; lastPromptTokens: number }> {
  const [messages, proposals, conversation] = await Promise.all([
    supabase.from('ai_messages').select('seq, role, content, meta').eq('conversation_id', id).order('seq', { ascending: true }).limit(600),
    supabase.from('ai_chat_proposals').select('id, tool_use_id, tool, summary, status, expires_at').eq('conversation_id', id).limit(100),
    supabase.from('ai_conversations').select('status, last_prompt_tokens').eq('id', id).maybeSingle(),
  ])
  for (const r of [messages, proposals, conversation]) if (r.error) throw r.error
  return {
    messages: (messages.data ?? []).filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.seq === 'number') as StoredMessageRow[],
    proposals: (proposals.data ?? []) as StoredProposalRow[],
    status: String(conversation.data?.status ?? 'open'),
    lastPromptTokens: Number(conversation.data?.last_prompt_tokens) || 0,
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
