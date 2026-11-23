// Ask AI's pure logic (no React, no network): reading what the `claude` function streams (every event is input and is
// checked), turning events and stored messages into the turns the panel draws, and the words for the wall.
// verify-ai-chat-ui.cjs runs this file as it is.

/** The "start a new chat" line, in prompt tokens (the function's wall; the panel warns a little before it). */
export const CHAT_WALL_TOKENS = 90_000
export const CHAT_WARN_TOKENS = 70_000
/** The longest message the function takes. */
export const CHAT_TEXT_MAX = 4000
/** Photos: the function's limits (verify-ai-chat-ui compares them). A photo stays in the stored chat, so a chat holds few. */
export const CHAT_IMAGES_PER_MESSAGE = 2
export const CHAT_IMAGES_PER_CHAT = 4
/** One shrunk photo as base64 text (the function refuses more); the bytes are ¾ of it. */
export const CHAT_PHOTO_BASE64_MAX = 450_000
export const CHAT_PHOTO_MAX_BYTES = Math.floor(CHAT_PHOTO_BASE64_MAX * 0.75) - 1000
/** The owner's own instructions: the most characters (the database and the function say the same). */
export const CHAT_INSTRUCTIONS_MAX = 1000

export type ChatMode = 'chat' | 'coach'

/** The tools in plain words, for the settings card and for "the tools in this chat". Names the app does not know show as they are. */
export const TOOL_LABELS: Record<string, { label: string; what: string }> = {
  get_day_plan: { label: 'Day plan', what: "Reads a day's tasks and scheduled blocks." },
  get_week_figures: { label: 'Week figures', what: "Reads a week's training, health, food and task figures." },
  get_food_day: { label: 'Food day', what: "Reads one day's food and water against your targets." },
  find_text: { label: 'Find text', what: 'Searches your tasks and diary lines by words.' },
  get_about_me: { label: 'About me', what: 'Reads the notes you saved about yourself (Developer → Memory).' },
  ask_database: { label: 'Ask the database', what: 'The last resort: one read-only database question when no other tool fits.' },
  propose_add_task: { label: 'Propose a task', what: 'Proposes a new task. Nothing is saved until you tap Confirm.' },
  propose_log_food: { label: 'Propose a food line', what: 'Proposes a food line. Nothing is saved until you tap Confirm.' },
  get_training_week: { label: 'Training week', what: "Reads a week's sessions, sets, muscles and key lifts." },
  get_health_trends: { label: 'Health trends', what: "Reads a week's sleep, steps, energy, heart rate and weight." },
  get_pt_verdicts: { label: 'Coach verdicts', what: 'Reads the verdicts the coaching rules reached when you last tapped Assess.' },
  note_shortcut: { label: 'Note a suggestion', what: 'Writes one suggestion into Developer → AI → Learn → Suggestions when the app could show the answer without AI. It changes nothing else and nothing is built by it.' },
  get_transit: { label: 'Bus and train times', what: "Looks up live public transport from Entur (open data): departures from a stop, or a trip from A to B. Your saved places (home, work) are sent to Entur only as a stop or a position." },
}
export const toolLabel = (name: string): string => TOOL_LABELS[name]?.label ?? name

/** A stored photo block's source as a data address for a small picture, or nothing when it is not a plain base64 JPEG, PNG or WebP. */
export function photoUrlOf(source: unknown): string[] {
  if (!isObject(source) || source.type !== 'base64' || typeof source.data !== 'string') return []
  const type = source.media_type
  if ((type !== 'image/jpeg' && type !== 'image/png' && type !== 'image/webp') || !/^[A-Za-z0-9+/]+={0,2}$/.test(source.data)) return []
  return [`data:${type};base64,${source.data}`]
}

/** The voice languages the microphone offers: the device's own, or one of three. The tag is what the browser's recognizer takes. */
export const VOICE_LANGUAGES = [
  { id: 'auto', short: 'Auto', name: 'Device language', tag: null },
  { id: 'nb', short: 'NO', name: 'Norwegian', tag: 'nb-NO' },
  { id: 'en', short: 'EN', name: 'English', tag: 'en-GB' },
  { id: 'tr', short: 'TR', name: 'Turkish', tag: 'tr-TR' },
] as const
export type VoiceLanguageId = (typeof VOICE_LANGUAGES)[number]['id']
export const voiceLanguageOf = (id: unknown): VoiceLanguageId => VOICE_LANGUAGES.find(l => l.id === id)?.id ?? 'auto'
export const voiceTagOf = (id: VoiceLanguageId): string | null => VOICE_LANGUAGES.find(l => l.id === id)?.tag ?? null

/**
 * What an empty chat says it can do and what it suggests, built from the tools that are ON in this chat: nothing is promised
 * that a switched-off tool would break (no "propose a task" when that tool is off, no food question without the food tool).
 */
export function chatIntro(mode: ChatMode, tools: readonly string[]): { text: string; suggestions: string[] } {
  const has = (n: string) => tools.includes(n)
  const list = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)
  if (mode === 'coach') {
    const reads = [has('get_training_week') && 'sessions', has('get_health_trends') && 'health figures', has('get_pt_verdicts') && 'the verdicts from your last assessment', has('get_day_plan') && 'what is planned'].filter(Boolean) as string[]
    const suggestions = [
      has('get_training_week') && 'How did my training go this week?',
      has('get_pt_verdicts') && 'Am I recovered enough to train hard today?',
      has('get_pt_verdicts') && 'What did the coach say last time, and is it still true?',
      has('get_health_trends') && 'How is my sleep trending?',
      has('get_day_plan') && 'What training is planned today?',
    ].filter(Boolean) as string[]
    return {
      text: reads.length ? `Ask your coach about your training, recovery and sleep. It reads ${list(reads)}, and changes nothing.` : 'Every coach tool is switched off in Settings, so your coach can only answer from what you tell it.',
      suggestions: suggestions.slice(0, 4),
    }
  }
  const reads = [has('get_day_plan') && 'plan', has('get_week_figures') && 'week', has('get_food_day') && 'food', has('find_text') && 'tasks and diary', has('get_about_me') && 'notes about you', has('ask_database') && 'data (a database question as a last resort)'].filter(Boolean) as string[]
  const writes = [has('propose_add_task') && 'a task', has('propose_log_food') && 'a food line'].filter(Boolean) as string[]
  const suggestions = [
    has('get_day_plan') && 'What is on my plan today?',
    has('get_week_figures') && 'How is my week going so far?',
    has('get_food_day') && 'What have I eaten today against my targets?',
    has('find_text') && 'Find my tasks and notes about the dentist',
  ].filter(Boolean) as string[]
  const can = [reads.length ? `read your ${list(reads)}` : '', has('get_transit') ? 'look up live bus and train times' : '', writes.length ? `propose ${list(writes.map(w => w))} for you to confirm` : ''].filter(Boolean)
  return {
    text: can.length ? `What can I look up for you? I can ${can.join(', and ')}.` : 'Every tool is switched off in Settings, so I can only answer from what you tell me.',
    suggestions: suggestions.slice(0, 4),
  }
}

/** The words in the box with what was just spoken added after them (one space between, nothing doubled). */
export function joinSpoken(typed: string, spoken: string): string {
  const said = spoken.replace(/\s+/g, ' ').trim()
  if (!said) return typed
  return (typed && !/\s$/.test(typed) ? `${typed} ` : typed) + said
}

export interface ChatCitation { kind: 'task' | 'diary'; id: string; title: string; day: string | null }

export type CardState = 'pending' | 'confirmed' | 'cancelled' | 'failed' | 'expired' | 'busy' | 'undone'

/**
 * A proposed write waiting for the owner's tap. `args` is what is stored in ai_chat_proposals (read from the table, never
 * the summary): the card shows every field that would be written. null while it is being read.
 */
export interface ChatCard {
  id: string
  tool: 'add_task' | 'log_food'
  summary: string
  expiresAt: string
  state: CardState
  args: Record<string, unknown> | null
  /** The row a confirmed proposal made (for Open and Undo). */
  resultId: string | null
}

/** One lookup of an answer, with the inputs the code checked and used (the date, the words, the SQL). */
export interface ChatStep { name: string; label: string; input: { key: string; label: string; value: string; long: boolean }[] | null }

export interface ChatTurn {
  key: string
  role: 'user' | 'assistant'
  text: string
  /** The lookups the answer made, in order ("Looking up the week's figures"). */
  steps: ChatStep[]
  citations: ChatCitation[]
  cards: ChatCard[]
  costUsd: number | null
  /** The ledger's run of this answer (the cost line links to its calls). */
  runId: string | null
  /** The model's reasoning summary, when it gave one (shown behind a peek). */
  thinking: string
  /** Why the answer failed (`declined` offers editing the question). */
  errorReason: string | null
  /** The answer is still arriving. */
  streaming: boolean
  /** A plain sentence when the answer failed (its text was taken back). */
  error: string | null
  cutOff: boolean
  /** A lookup just happened: the next text starts a new paragraph. */
  pendingBreak?: boolean
  /** How many photos went with this message (a person's turn). */
  photos: number
  /** The photos themselves as data addresses, to draw small pictures (a person's turn; read from the stored message or kept from the send). */
  photoUrls: string[]
  /** The kind of idea this answer noted for the Suggestions list (`widget`, `chart`…), or null. Only the kind: the idea's own text is shown in the list, never here. */
  suggestion: string | null
}

/** The only events the function sends. */
export type ChatEvent =
  | { event: 'start'; conversationId: string; isNew: boolean }
  | { event: 'text'; text: string }
  | { event: 'step'; name: string; label: string }
  | { event: 'retract' }
  | { event: 'detail'; name: string; input: Record<string, string | number>; ok: boolean }
  | { event: 'proposal'; card: ChatCard }
  | { event: 'done'; conversationId: string; text: string; citations: ChatCitation[]; cards: ChatCard[]; costUsd: number; wall: boolean; cutOff: boolean; promptTokens: number; runId: string | null; thinking: string; suggestion: string | null }
  | { event: 'error'; reason: string; message: string; conversationId: string | null; costUsd: number; runId: string | null }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

function readCard(v: unknown): ChatCard | null {
  if (!isObject(v) || typeof v.id !== 'string' || !UUID.test(v.id)) return null
  if (v.tool !== 'add_task' && v.tool !== 'log_food') return null
  const summary = str(v.summary, 300)
  if (!summary) return null
  return { id: v.id, tool: v.tool, summary, expiresAt: str(v.expires_at ?? v.expiresAt, 40), state: 'pending', args: null, resultId: null }
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
    case 'detail': {
      if (!isObject(data.input)) return null
      const input: Record<string, string | number> = {}
      for (const [k, v] of Object.entries(data.input).slice(0, 12)) if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) input[k.slice(0, 30)] = typeof v === 'string' ? v.slice(0, 1500) : v
      return { event: 'detail', name: str(data.name, 60), input, ok: data.ok === true }
    }
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
        promptTokens: typeof data.prompt_tokens === 'number' && Number.isFinite(data.prompt_tokens) && data.prompt_tokens >= 0 ? data.prompt_tokens : 0,
        runId: typeof data.run_id === 'string' && UUID.test(data.run_id) ? data.run_id : null, thinking: str(data.thinking, 8000),
        suggestion: isObject(data.suggestion) && typeof data.suggestion.kind === 'string' && /^[a-z_]{3,20}$/.test(data.suggestion.kind) ? data.suggestion.kind : null,
      }
    }
    case 'error':
      return {
        event: 'error', reason: str(data.reason, 30) || 'error', message: str(data.message, 400) || 'Something went wrong.',
        conversationId: typeof data.conversation_id === 'string' && UUID.test(data.conversation_id) ? data.conversation_id : null,
        costUsd: typeof data.cost_usd === 'number' && Number.isFinite(data.cost_usd) && data.cost_usd > 0 ? data.cost_usd : 0,
        runId: typeof data.run_id === 'string' && UUID.test(data.run_id) ? data.run_id : null,
      }
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
  ({ key, role, text, steps: [], citations: [], cards: [], costUsd: null, runId: null, thinking: '', errorReason: null, streaming: role === 'assistant', error: null, cutOff: false, photos: 0, photoUrls: [], suggestion: null })

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
      return { ...turn, steps: [...turn.steps, { name: event.name, label: event.label, input: null }], pendingBreak: true }
    case 'detail': {
      // The checked inputs belong to the latest step of that tool that has none yet; a tool the stream never announced gets its own step.
      const at = turn.steps.map(st => st.name === event.name && st.input === null).lastIndexOf(true)
      const input = describeInput(event.input)
      if (at < 0) return { ...turn, steps: [...turn.steps, { name: event.name, label: STEP_WORDS[event.name] ?? 'Working on it', input }] }
      return { ...turn, steps: turn.steps.map((st, i) => (i === at ? { ...st, label: STEP_WORDS[event.name] ?? st.label, input } : st)) }
    }
    case 'retract':
      return { ...turn, text: '' }
    case 'proposal':
      return { ...turn, cards: turn.cards.some(c => c.id === event.card.id) ? turn.cards : [...turn.cards, event.card] }
    case 'done':
      return {
        ...turn, text: event.text || turn.text, citations: event.citations, costUsd: event.costUsd, runId: event.runId, thinking: event.thinking, suggestion: event.suggestion,
        // The cards already shown keep what has been read for them; a card the stream did not announce is added.
        cards: [...turn.cards, ...event.cards.filter(c => !turn.cards.some(x => x.id === c.id))],
        streaming: false, cutOff: event.cutOff, error: null, errorReason: null,
      }
    case 'error':
      return { ...turn, text: '', streaming: false, error: event.message, errorReason: event.reason, costUsd: event.costUsd > 0 ? event.costUsd : turn.costUsd, runId: event.runId ?? turn.runId }
    default:
      return turn
  }
}

// ── What a step shows, and what a card shows ────────────────────────────────

const INPUT_LABELS: Record<string, string> = { date: 'Date', week: 'Week', section: 'Part', query: 'Words', kind: 'Kind', sql: 'SQL', title: 'Title', note: 'Note', due_date: 'Due date', priority: 'Priority', meal: 'Meal', why: 'Why' }

/** "2026-11-24" as "24.11.2026"; anything else as it is. */
export function dmy(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value
}

/** The inputs a lookup used, as label and value (empty and "any" left out); the SQL is `long`, shown behind a peek. */
export function describeInput(input: Record<string, unknown>): ChatStep['input'] {
  const out: NonNullable<ChatStep['input']> = []
  for (const [key, raw] of Object.entries(input).slice(0, 12)) {
    if ((typeof raw !== 'string' && typeof raw !== 'number') || raw === '' || raw === 'any') continue
    const value = typeof raw === 'number' ? String(raw) : /date/.test(key) ? dmy(raw) : raw
    out.push({ key, label: INPUT_LABELS[key] ?? key, value: value.slice(0, 1500), long: key === 'sql' })
  }
  return out
}

const PRIORITY_WORDS: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High' }
const MEAL_WORDS: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }
const BASIS_WORDS: Record<string, string> = { preset: 'Your own saved preset (exact figures)', recipe: 'Your own recipe (per serving)', diary: 'Your earlier diary line (one portion)', estimate: 'The AI\'s estimate' }

/**
 * Every field a confirmed proposal would write, as label and value, from the stored arguments: nothing is cut. The
 * constant parts the function adds (area, status, source, amount) are shown too, so the card says exactly what is saved.
 * `today` is the Oslo day (YYYY-MM-DD): a task due today goes to Today, a task with a later date to Backlog, none to Inbox.
 */
export function proposalFields(tool: string, args: Record<string, unknown>, today: string): { label: string; value: string }[] {
  const text = (k: string) => (typeof args[k] === 'string' ? args[k] as string : '')
  const num = (k: string) => (typeof args[k] === 'number' ? String(args[k]) : '?')
  if (tool === 'add_task') {
    const due = typeof args.due_date === 'string' ? args.due_date : ''
    return [
      { label: 'Title', value: text('title') },
      { label: 'Note', value: text('description') || 'none' },
      { label: 'Due date', value: due ? dmy(due) : 'none' },
      { label: 'Priority', value: PRIORITY_WORDS[text('priority')] ?? text('priority') },
      { label: 'Goes to', value: due === today ? 'Today' : due ? 'Backlog' : 'Inbox' },
      { label: 'Area', value: 'Personal' },
      { label: 'Status', value: 'Open' },
      { label: 'Source', value: 'Added by Ask AI' },
    ]
  }
  return [
    { label: 'Title', value: text('title') },
    { label: 'Meal', value: MEAL_WORDS[text('meal')] ?? text('meal') },
    { label: 'Date', value: dmy(text('date')) },
    { label: 'Amount', value: '1 serving' },
    { label: 'Calories', value: `${num('calories')} kcal` },
    { label: 'Protein', value: `${num('protein_g')} g` },
    { label: 'Carbs', value: `${num('carbs_g')} g` },
    { label: 'Fat', value: `${num('fat_g')} g` },
    { label: 'Status', value: 'Eaten' },
    { label: 'Figures from', value: BASIS_WORDS[text('basis')] ?? BASIS_WORDS.estimate },
  ]
}

// ── Turns from a stored chat ────────────────────────────────────────────────

export interface StoredMessageRow { seq: number; role: 'user' | 'assistant'; content: unknown; meta: unknown }
export interface StoredProposalRow { id: string; tool_use_id: string; tool: string; summary: string; status: string; expires_at: string; args?: unknown; result_id?: string | null }

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
  get_training_week: "Looking at the week's training", get_health_trends: "Looking at the week's health figures", get_pt_verdicts: "Reading the coach's saved verdicts", note_shortcut: 'Noting a suggestion', get_transit: 'Looking up bus and train times',
}

function cardState(status: string, expiresAt: string, now: number): CardState {
  if (status === 'confirmed' || status === 'cancelled' || status === 'failed') return status
  // Fail closed: a time that cannot be read counts as past.
  return Date.parse(expiresAt) > now ? 'pending' : 'expired'
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
      const turn = newTurn(`u${m.seq}`, 'user', typed)
      const images = Array.isArray(m.content) ? m.content.filter(isBlock).filter(b => b.type === 'image') : []
      turn.photos = images.length
      turn.photoUrls = images.slice(0, CHAT_IMAGES_PER_MESSAGE).flatMap(b => photoUrlOf(b.source))
      turns.push(turn)
      continue
    }
    if (!Array.isArray(m.content)) continue
    if (!answer) { answer = newTurn(`a${m.seq}`, 'assistant'); answer.streaming = false; turns.push(answer) }
    const text = m.content.filter(isBlock).filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text as string).join('')
    if (text) answer.text = answer.text ? `${answer.text}\n\n${text}` : text
    for (const b of m.content.filter(isBlock)) {
      if (b.type !== 'tool_use' || typeof b.name !== 'string') continue
      const input = isObject(b.input) ? describeInput(b.input) : []
      answer.steps.push({ name: b.name, label: STEP_WORDS[b.name] ?? 'Working on it', input })
      const p = proposals.find(x => x.tool_use_id === b.id)
      if (p && (p.tool === 'add_task' || p.tool === 'log_food') && !answer.cards.some(c => c.id === p.id)) {
        answer.cards.push({ id: p.id, tool: p.tool, summary: p.summary, expiresAt: p.expires_at, state: cardState(p.status, p.expires_at, now), args: isObject(p.args) ? p.args : null, resultId: typeof p.result_id === 'string' ? p.result_id : null })
      }
    }
    const thought = m.content.filter(isBlock).filter(b => b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking).map(b => b.thinking as string).join('\n\n')
    if (thought) answer.thinking = answer.thinking ? `${answer.thinking}\n\n${thought}` : thought
    const meta = isObject(m.meta) ? m.meta : {}
    if (typeof meta.run_id === 'string' && UUID.test(meta.run_id)) answer.runId = meta.run_id
    if (typeof meta.cost_usd === 'number' && Number.isFinite(meta.cost_usd)) answer.costUsd = (answer.costUsd ?? 0) + meta.cost_usd
    if (Array.isArray(meta.citations)) answer.citations = readCitations(meta.citations)
    if (isObject(meta.suggestion) && typeof meta.suggestion.kind === 'string' && /^[a-z_]{3,20}$/.test(meta.suggestion.kind)) answer.suggestion = meta.suggestion.kind
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

// ── The sign-in token of a request ───────────────────────────────────────────

/** What a request to the function needs from the sign-in, so the logic below is pure and a test can fake it. */
export interface SessionDeps {
  /** The current access token right now (the client refreshes an expired one before it answers), or null when signed out. */
  currentToken: () => Promise<string | null>
  /** Asks for a new token with the refresh token, or null when that fails. */
  refreshedToken: () => Promise<string | null>
  /** The request itself, with the token it should carry. */
  send: (token: string) => Promise<Response>
}

/**
 * Sends one request with a token read just now (never one kept from earlier: it may have expired while the panel was
 * open). A 401 means the function did not accept the token, so it is refreshed ONCE and the request is sent ONCE more;
 * only a second refusal (or no refresh) is the caller's "session" message. The token is never logged or stored here.
 * `null` is "no session at all".
 */
export async function sendWithSession(deps: SessionDeps): Promise<Response | null> {
  const token = await deps.currentToken()
  if (!token) return null
  const first = await deps.send(token)
  if (first.status !== 401) return first
  const fresh = await deps.refreshedToken()
  if (!fresh) return first
  return deps.send(fresh)
}

/** True when a response means "sign in again" and nothing else can help (a second 401 or a 403). */
export const isSessionRefusal = (status: number): boolean => status === 401 || status === 403
