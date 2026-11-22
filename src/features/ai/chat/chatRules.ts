// Ask AI's pure logic (no React, no network): reading what the `claude` function streams (every event is input and is
// checked), turning events and stored messages into the turns the panel draws, and the words for the wall.
// verify-ai-chat-ui.cjs runs this file as it is.

/** The "start a new chat" line, in prompt tokens (the function's wall; the panel warns a little before it). */
export const CHAT_WALL_TOKENS = 90_000
export const CHAT_WARN_TOKENS = 70_000
/** The longest message the function takes. */
export const CHAT_TEXT_MAX = 4000

export interface ChatCitation { kind: 'task' | 'diary'; id: string; title: string; day: string | null }

export type CardState = 'pending' | 'confirmed' | 'cancelled' | 'failed' | 'expired' | 'busy'

/** A proposed write waiting for the owner's tap. */
export interface ChatCard { id: string; tool: 'add_task' | 'log_food'; summary: string; expiresAt: string; state: CardState }

export interface ChatTurn {
  key: string
  role: 'user' | 'assistant'
  text: string
  /** The lookups the answer made, in order ("Looking up the week's figures"). */
  steps: string[]
  citations: ChatCitation[]
  cards: ChatCard[]
  costUsd: number | null
  /** The answer is still arriving. */
  streaming: boolean
  /** A plain sentence when the answer failed (its text was taken back). */
  error: string | null
  cutOff: boolean
  /** A lookup just happened: the next text starts a new paragraph. */
  pendingBreak?: boolean
}

/** The only events the function sends. */
export type ChatEvent =
  | { event: 'start'; conversationId: string; isNew: boolean }
  | { event: 'text'; text: string }
  | { event: 'step'; name: string; label: string }
  | { event: 'retract' }
  | { event: 'proposal'; card: ChatCard }
  | { event: 'done'; conversationId: string; text: string; citations: ChatCitation[]; cards: ChatCard[]; costUsd: number; wall: boolean; cutOff: boolean }
  | { event: 'error'; reason: string; message: string; conversationId: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

function readCard(v: unknown): ChatCard | null {
  if (!isObject(v) || typeof v.id !== 'string' || !UUID.test(v.id)) return null
  if (v.tool !== 'add_task' && v.tool !== 'log_food') return null
  const summary = str(v.summary, 300)
  if (!summary) return null
  return { id: v.id, tool: v.tool, summary, expiresAt: str(v.expires_at ?? v.expiresAt, 40), state: 'pending' }
}

export function readCitations(v: unknown): ChatCitation[] {
  if (!Array.isArray(v)) return []
  const out: ChatCitation[] = []
  for (const c of v.slice(0, 10)) {
    if (!isObject(c) || (c.kind !== 'task' && c.kind !== 'diary') || typeof c.id !== 'string' || !UUID.test(c.id)) continue
    const day = typeof c.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.day) ? c.day : null
    out.push({ kind: c.kind, id: c.id, title: str(c.title, 100) || (c.kind === 'diary' ? 'Diary' : 'Task'), day })
  }
  return out
}

/** One event of the stream as the app's own type, or null for anything this app does not know (it is ignored). */
export function readChatEvent(name: string, data: unknown): ChatEvent | null {
  if (!isObject(data)) return null
  switch (name) {
    case 'start':
      return typeof data.conversation_id === 'string' && UUID.test(data.conversation_id) ? { event: 'start', conversationId: data.conversation_id, isNew: data.is_new === true } : null
    case 'text':
      return typeof data.t === 'string' ? { event: 'text', text: data.t.slice(0, 20_000) } : null
    case 'step':
      return { event: 'step', name: str(data.name, 60), label: str(data.label, 80) || 'Working on it' }
    case 'retract':
      return { event: 'retract' }
    case 'proposal': {
      const card = readCard(data)
      return card ? { event: 'proposal', card } : null
    }
    case 'done': {
      if (typeof data.conversation_id !== 'string' || !UUID.test(data.conversation_id)) return null
      const cost = typeof data.cost_usd === 'number' && Number.isFinite(data.cost_usd) && data.cost_usd >= 0 ? data.cost_usd : 0
      return {
        event: 'done', conversationId: data.conversation_id, text: str(data.text, 40_000), citations: readCitations(data.citations),
        cards: (Array.isArray(data.proposals) ? data.proposals : []).map(readCard).filter((c): c is ChatCard => c !== null).slice(0, 10),
        costUsd: cost, wall: data.wall === true, cutOff: data.ending === 'cut_off',
      }
    }
    case 'error':
      return { event: 'error', reason: str(data.reason, 30) || 'error', message: str(data.message, 400) || 'Something went wrong.', conversationId: typeof data.conversation_id === 'string' && UUID.test(data.conversation_id) ? data.conversation_id : null }
    default:
      return null
  }
}

/** Splits a server-sent-events buffer into its complete events; `rest` is the unfinished tail to keep. */
export function parseSse(buffer: string): { events: { name: string; data: unknown }[]; rest: string } {
  const parts = buffer.replace(/\r\n/g, '\n').split('\n\n')
  const rest = parts.pop() ?? ''
  const events: { name: string; data: unknown }[] = []
  for (const part of parts) {
    let name = 'message'
    const data: string[] = []
    for (const line of part.split('\n')) {
      if (line.startsWith('event:')) name = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (!data.length) continue
    try { events.push({ name, data: JSON.parse(data.join('\n')) }) } catch { /* a line that is not JSON is skipped */ }
  }
  return { events, rest }
}

export const newTurn = (key: string, role: ChatTurn['role'], text = ''): ChatTurn =>
  ({ key, role, text, steps: [], citations: [], cards: [], costUsd: null, streaming: role === 'assistant', error: null, cutOff: false })

/**
 * The answer's turn after one more event. Text from a later request of the same answer (after a lookup) starts a new
 * paragraph. A retract takes the streamed text back; an error says why; `done` carries the checked final text.
 */
export function applyChatEvent(turn: ChatTurn, event: ChatEvent): ChatTurn {
  switch (event.event) {
    case 'text': {
      const gap = turn.text && turn.pendingBreak ? '\n\n' : ''
      return { ...turn, text: turn.text + gap + event.text, pendingBreak: false }
    }
    case 'step':
      return { ...turn, steps: turn.steps.includes(event.label) ? turn.steps : [...turn.steps, event.label], pendingBreak: true }
    case 'retract':
      return { ...turn, text: '' }
    case 'proposal':
      return { ...turn, cards: turn.cards.some(c => c.id === event.card.id) ? turn.cards : [...turn.cards, event.card] }
    case 'done':
      return { ...turn, text: event.text || turn.text, citations: event.citations, cards: event.cards.length ? event.cards : turn.cards, costUsd: event.costUsd, streaming: false, cutOff: event.cutOff, error: null }
    case 'error':
      return { ...turn, text: '', streaming: false, error: event.message }
    default:
      return turn
  }
}

// ── Turns from a stored chat ────────────────────────────────────────────────

export interface StoredMessageRow { seq: number; role: 'user' | 'assistant'; content: unknown; meta: unknown }
export interface StoredProposalRow { id: string; tool_use_id: string; tool: string; summary: string; status: string; expires_at: string }

const isBlock = (b: unknown): b is Record<string, unknown> => isObject(b) && typeof b.type === 'string'

/** The words a person typed in a stored user message: its last text block that is not one of the app's own notices. */
function typedText(content: unknown): string | null {
  if (!Array.isArray(content)) return null
  const texts = content.filter(isBlock).filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text as string)
  if (content.some(b => isBlock(b) && b.type === 'tool_result')) return null
  const own = texts.filter(t => !/^<(live_context|app_updates)>/.test(t))
  return own.length ? own[own.length - 1] : null
}

const STEP_WORDS: Record<string, string> = {
  get_day_plan: "Looking at the day's plan", get_week_figures: "Looking up the week's figures", get_food_day: "Looking up the day's food",
  find_text: 'Searching your tasks and diary', ask_database: 'Asking the database', propose_add_task: 'Preparing a task for you to confirm', propose_log_food: 'Preparing a food line for you to confirm',
}

function cardState(status: string, expiresAt: string, now: number): CardState {
  if (status === 'confirmed' || status === 'cancelled' || status === 'failed') return status
  return Date.parse(expiresAt) < now ? 'expired' : 'pending'
}

/** The conversation as the panel draws it: one turn per message of the person, one per answer (its requests joined). */
export function turnsFromStored(messages: readonly StoredMessageRow[], proposals: readonly StoredProposalRow[], now = Date.now()): ChatTurn[] {
  const turns: ChatTurn[] = []
  let answer: ChatTurn | null = null
  const sorted = [...messages].sort((a, b) => a.seq - b.seq)
  for (const m of sorted) {
    if (m.role === 'user') {
      const typed = typedText(m.content)
      if (typed === null) continue // the tool results of an answer in progress
      answer = null
      turns.push(newTurn(`u${m.seq}`, 'user', typed))
      continue
    }
    if (!Array.isArray(m.content)) continue
    if (!answer) { answer = newTurn(`a${m.seq}`, 'assistant'); answer.streaming = false; turns.push(answer) }
    const text = m.content.filter(isBlock).filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text as string).join('')
    if (text) answer.text = answer.text ? `${answer.text}\n\n${text}` : text
    for (const b of m.content.filter(isBlock)) {
      if (b.type !== 'tool_use' || typeof b.name !== 'string') continue
      const label = STEP_WORDS[b.name] ?? 'Working on it'
      if (!answer.steps.includes(label)) answer.steps.push(label)
      const p = proposals.find(x => x.tool_use_id === b.id)
      if (p && (p.tool === 'add_task' || p.tool === 'log_food') && !answer.cards.some(c => c.id === p.id)) {
        answer.cards.push({ id: p.id, tool: p.tool, summary: p.summary, expiresAt: p.expires_at, state: cardState(p.status, p.expires_at, now) })
      }
    }
    const meta = isObject(m.meta) ? m.meta : {}
    if (typeof meta.cost_usd === 'number' && Number.isFinite(meta.cost_usd)) answer.costUsd = (answer.costUsd ?? 0) + meta.cost_usd
    if (Array.isArray(meta.citations)) answer.citations = readCitations(meta.citations)
    if (meta.ending === 'cut_off') answer.cutOff = true
  }
  return turns
}

/** The state of the wall for a conversation: `ok`, `near` (say so), or `full` (new chat needed). */
export function wallState(lastPromptTokens: number, status: string): 'ok' | 'near' | 'full' {
  if (status !== 'open' || lastPromptTokens >= CHAT_WALL_TOKENS) return 'full'
  return lastPromptTokens >= CHAT_WARN_TOKENS ? 'near' : 'ok'
}

/** Where a citation opens: a task opens in the task popup, a diary line opens its day in Personal. */
export function citationTarget(c: ChatCitation): { kind: 'task'; id: string } | { kind: 'route'; path: string } {
  return c.kind === 'task' ? { kind: 'task', id: c.id } : { kind: 'route', path: `/daily?date=${c.day ?? ''}` }
}

/** The words for a card that is not waiting any more. */
export function cardStateLabel(state: CardState): string {
  return state === 'confirmed' ? 'Saved' : state === 'cancelled' ? 'Cancelled' : state === 'expired' ? 'Expired' : state === 'failed' ? 'Could not be saved' : state === 'busy' ? 'Working…' : ''
}

/** A reply's `**bold**` markers as parts (no markdown library: the model is told to use only this). */
export function boldParts(text: string): { text: string; bold: boolean }[] {
  return text.split(/(\*\*[^*\n]+?\*\*)/g).filter(Boolean).map(part => (/^\*\*[^*\n]+\*\*$/.test(part) ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false }))
}
