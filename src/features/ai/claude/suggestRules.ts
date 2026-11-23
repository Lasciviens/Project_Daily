// Pure rules of the suggestions' app side (phase 4c, migration 199): reading the database's rows where they enter, the plain
// words for an idea's saving, the grouping of the list, and the Dev Request draft an idea can become. An idea was written by a
// model, so it is read as plain text and never as markup or a link (the database checks the same). No imports:
// scripts/verify-ai-suggestions-ui.cjs runs it through sucrase.

export const SUGGESTION_KINDS = ['widget', 'chart', 'automation', 'notification', 'report', 'existing_feature', 'new_tool', 'cheaper_setting'] as const
export type SuggestionKind = typeof SUGGESTION_KINDS[number]

export const SUGGESTION_COMPLEXITY = ['small', 'medium', 'large'] as const
export type SuggestionComplexity = typeof SUGGESTION_COMPLEXITY[number]

/** What the size of a change is called on the card. */
export const SUGGESTION_COMPLEXITY_LABEL: Record<SuggestionComplexity, string> = { small: 'Small change', medium: 'Medium change', large: 'Large change' }

export const SUGGESTION_STATES = ['new', 'kept', 'dismissed', 'built'] as const
export type SuggestionState = typeof SUGGESTION_STATES[number]

/** What an idea is, in two or three words (the pill on its card). */
export const SUGGESTION_KIND_LABEL: Record<SuggestionKind, string> = {
  widget: 'Widget', chart: 'Chart', automation: 'Automation', notification: 'Notification', report: 'Report',
  existing_feature: 'Existing feature', new_tool: 'New tool', cheaper_setting: 'Cheaper setting',
}

/** One sentence of what a kind means: shown once under the list, because the owner is learning the words. */
export const SUGGESTION_KIND_MEANING: Record<SuggestionKind, string> = {
  widget: 'a small block on a page that shows the answer with no AI',
  chart: 'a graph the app draws from your data with no AI',
  automation: 'a rule that does it by itself on a schedule or when something happens',
  notification: 'a message the app sends you when something is true',
  report: 'a written summary the app builds from your figures',
  existing_feature: 'a screen the app already has for it',
  new_tool: 'one saved, reviewed question the assistant can use instead of writing its own',
  cheaper_setting: 'a smaller model, less effort or less text sent',
}

/** The quiet line under an answer that noted an idea. */
export const SUGGESTION_LINE: Record<SuggestionKind, string> = {
  widget: 'This could be a widget', chart: 'This could be a chart', automation: 'This could be an automation', notification: 'This could be a notification',
  report: 'This could be a report', existing_feature: 'The app may already show this', new_tool: 'This could be a saved query', cheaper_setting: 'This could be done cheaper',
}

export const SUGGESTION_STATE_LABEL: Record<SuggestionState, string> = { new: 'New', kept: 'Kept', dismissed: 'Dismissed', built: 'Built' }

export interface AiSuggestion {
  id: string
  kind: SuggestionKind
  title: string
  why: string
  /** One plain line on what the owner gains (written by the model, checked like the rest). */
  benefit: string
  complexity: SuggestionComplexity
  source: 'answer' | 'weekly'
  times_seen: number
  tokens_each: number
  cost_each_usd: number
  first_call_id: string | null
  /** The ledger run of that call (the answer it came from), found by the app; null for a weekly idea or when it is gone. */
  run_id: string | null
  state: SuggestionState
  created_at: string
  last_seen_at: string
}

/** The columns the app asks for (the table's whole shape: the browser reads all of it and writes only `state`). */
export const SUGGESTION_COLUMNS = 'id, kind, title, why, benefit, complexity, source, times_seen, tokens_each, cost_each_usd, first_call_id, state, created_at, last_seen_at'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const count = (v: unknown, max: number): number => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0
}
// A model's text is plain text: no angle or square bracket (the Dev Requests window reads [[…]] as marks), backtick, control character,
// zero-width or text-direction character, link (any name.tld) or figure of the owner's own (grams, calories, steps). A row that fails is
// not shown at all. The database says the same (ai_suggestion_plain); this is the check on what it hands back.
const HIDDEN_RANGES: readonly (readonly [number, number])[] = [[0, 31], [127, 159], [0x200b, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]]
const hasHidden = (text: string): boolean => [...text].some(c => { const n = c.codePointAt(0) ?? 0; return HIDDEN_RANGES.some(([from, to]) => n >= from && n <= to) })
const NOT_PLAIN = /[<>`[\]]|https?:|www\.|\/\/|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/i
const PERSONAL_FIGURE = /\d\s?(?:g|kg|mg|kcal|cal|steps|bpm|ml|lbs?|cm|km)\b/i

export function isSuggestionId(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

const plain = (v: unknown, min: number, max: number): string | null => {
  if (typeof v !== 'string') return null
  const text = v.trim()
  const n = [...text].length
  return n >= min && n <= max && !hasHidden(text) && !NOT_PLAIN.test(text) && !PERSONAL_FIGURE.test(text) ? text : null
}

export function readSuggestion(raw: unknown): AiSuggestion | null {
  const r = rec(raw)
  const kind = SUGGESTION_KINDS.find(k => k === r.kind)
  const state = SUGGESTION_STATES.find(s => s === r.state)
  const title = plain(r.title, 3, 120)
  const why = plain(r.why, 3, 400)
  const benefit = plain(r.benefit, 3, 160)
  const complexity = SUGGESTION_COMPLEXITY.find(c => c === r.complexity)
  if (!isSuggestionId(r.id) || !kind || !state || !title || !why || !benefit || !complexity) return null
  return {
    id: r.id, kind, title, why, benefit, complexity, source: r.source === 'weekly' ? 'weekly' : 'answer',
    times_seen: Math.max(1, Math.floor(count(r.times_seen, 1_000_000))), tokens_each: Math.floor(count(r.tokens_each, 10_000_000)), cost_each_usd: count(r.cost_each_usd, 999_999),
    first_call_id: isSuggestionId(r.first_call_id) ? r.first_call_id : null, run_id: isSuggestionId(r.run_id) ? r.run_id : null,
    state, created_at: typeof r.created_at === 'string' ? r.created_at : '', last_seen_at: typeof r.last_seen_at === 'string' ? r.last_seen_at : '',
  }
}

export function readSuggestions(raw: unknown): AiSuggestion[] {
  return (Array.isArray(raw) ? raw : []).map(readSuggestion).filter((s): s is AiSuggestion => s !== null)
}

// ── The saving in plain words ───────────────────────────────────────────────

/** A dollar amount for a few cents or less: "$0.0123", "$0.07", "$1.20". */
export function suggestionUsd(amount: number): string {
  if (!(amount > 0)) return '$0.00'
  if (amount >= 0.05) return `$${amount.toFixed(2)}`
  if (amount < 0.0001) return '< $0.0001'
  return `$${amount.toFixed(4)}`
}

const digits = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

/** What it cost in all so far: times seen × what one time cost. */
export function suggestionTotalUsd(s: Pick<AiSuggestion, 'times_seen' | 'cost_each_usd'>): number {
  return s.times_seen * s.cost_each_usd
}

/**
 * The benefit in one plain line. A counted pattern's count is a 30-day total, so its cost in all is a month's: "Would save about
 * $0.05 a month". An idea noted in an answer has seen the question once or a few times, so it says what one asking cost. "No AI
 * wait" is said for everything that takes the AI out (not for a cheaper setting, which keeps it). No tokens: only money and waiting.
 */
export function benefitLine(s: Pick<AiSuggestion, 'kind' | 'source' | 'times_seen' | 'cost_each_usd'>): string {
  const money = s.source === 'weekly' ? `Would save about ${suggestionUsd(suggestionTotalUsd(s))} a month` : `Costs about ${suggestionUsd(s.cost_each_usd)} each time it is asked`
  return s.kind === 'cheaper_setting' ? money : `${money} · no AI wait`
}

/** How often it came up, in words. */
export function seenWords(s: Pick<AiSuggestion, 'times_seen'>): string {
  return s.times_seen === 1 ? 'Seen once' : `Seen ${digits(s.times_seen)} times`
}

// ── The list ────────────────────────────────────────────────────────────────

export interface SuggestionGroups { fresh: AiSuggestion[]; kept: AiSuggestion[]; built: AiSuggestion[]; dismissed: AiSuggestion[] }

const SIZE_WEIGHT: Record<SuggestionComplexity, number> = { small: 1, medium: 2, large: 4 }
/** What an idea is worth against its size: the money it saves for each step of change (a small change counts once, a large one four times). */
export const valueOf = (s: Pick<AiSuggestion, 'times_seen' | 'cost_each_usd' | 'complexity'>): number => suggestionTotalUsd(s) / SIZE_WEIGHT[s.complexity]

/** The ideas in four groups, each the best benefit for its size first, then the latest seen. A dismissed idea only sits at the bottom: it is never deleted (it is what stops it coming back). */
export function groupSuggestions(list: readonly AiSuggestion[]): SuggestionGroups {
  const order = (a: AiSuggestion, b: AiSuggestion) => valueOf(b) - valueOf(a) || b.times_seen - a.times_seen || b.last_seen_at.localeCompare(a.last_seen_at)
  const of = (state: SuggestionState) => list.filter(s => s.state === state).sort(order)
  return { fresh: of('new'), kept: of('kept'), built: of('built'), dismissed: of('dismissed') }
}

/** How many ideas wait for a decision (the dot beside the Suggestions page's name). */
export function waitingCount(list: readonly AiSuggestion[]): number {
  return list.filter(s => s.state === 'new').length
}

// ── Send to Dev Requests ────────────────────────────────────────────────────

export interface SuggestionDraft { title: string; points: string[]; category: 'feature'; priority: 'low' }

/** The line that links a Dev Request back to its suggestion: when the request is marked done, the suggestion becomes built. */
const REF = /^Suggestion ref: ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/im
export const suggestionRefOf = (description: string | null | undefined): string | null => REF.exec(description ?? '')?.[1] ?? null

/**
 * The Dev Request draft a suggestion can become. The owner reviews and saves it themselves: nothing is created here. Only the title,
 * the kind, the size and the plain benefit go over (never the model's longer reason), the first line says a model wrote it, and
 * the last line is our own link back (the suggestion's id). Every text was checked as plain text, so no `[[…]]` mark can be
 * made; the window checks the finished text once more with its own parser.
 */
export function draftFromSuggestion(s: AiSuggestion): SuggestionDraft {
  return {
    title: s.title,
    points: [
      'Written by a model — check before saving.',
      `${SUGGESTION_KIND_LABEL[s.kind]} · ${SUGGESTION_COMPLEXITY_LABEL[s.complexity].toLowerCase()}`,
      s.benefit,
      `Suggestion ref: ${s.id}`,
    ],
    category: 'feature', priority: 'low',
  }
}

// ── The function's answers ──────────────────────────────────────────────────

export function suggestMakeMessage(answer: unknown): { ok: boolean; message: string } {
  const a = rec(answer)
  if (a.ok === true && a.queued === true) return { ok: true, message: 'Looking for suggestions. It is ready within about an hour, at half price; the list updates when it is.' }
  if (a.ok === true && a.skipped === 'already_queued') return { ok: false, message: 'A look for suggestions is already waiting for its answer.' }
  if (a.ok === true && a.skipped === 'nothing_repeats') return { ok: true, message: 'Nothing repeats often enough yet to be a suggestion. No AI call was made.' }
  if (a.ok === true) return { ok: false, message: 'Nothing was queued.' }
  return { ok: false, message: typeof a.message === 'string' && a.message ? a.message.slice(0, 300) : 'The look for suggestions could not be queued.' }
}

/** The answer of a "Check now" for the suggestions' batch, when the function says anything about it. */
export function suggestCheckNote(answer: unknown): string | null {
  const s = rec(rec(answer).suggestions)
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  if (s.ok !== true) return null
  if (n(s.done)) return 'The suggestions are in.'
  if (n(s.failed)) return 'The look for suggestions ended without a usable answer.'
  if (n(s.waiting)) return 'The look for suggestions is still waiting for Anthropic.'
  return null
}

/** One server run of the weekly look, as the browser may read it (never the batch id). */
export interface AiSuggestRun {
  id: string
  week_start: string
  made_by: 'schedule' | 'app'
  status: 'queued' | 'done' | 'failed'
  failure: string | null
  added: number
  patterns: number
  created_at: string
  finished_at: string | null
}

export const SUGGEST_RUN_COLUMNS = 'id, week_start, made_by, status, failure, added, patterns, created_at, finished_at'

export function readSuggestRuns(raw: unknown): AiSuggestRun[] {
  const out: AiSuggestRun[] = []
  for (const row of Array.isArray(raw) ? raw : []) {
    const r = rec(row)
    const status = r.status === 'queued' || r.status === 'done' || r.status === 'failed' ? r.status : null
    if (!isSuggestionId(r.id) || typeof r.week_start !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.week_start) || !status) continue
    out.push({
      id: r.id, week_start: r.week_start, made_by: r.made_by === 'app' ? 'app' : 'schedule', status, failure: typeof r.failure === 'string' && r.failure ? r.failure.slice(0, 300) : null,
      added: Math.floor(count(r.added, 5)), patterns: Math.floor(count(r.patterns, 100)), created_at: typeof r.created_at === 'string' ? r.created_at : '', finished_at: typeof r.finished_at === 'string' ? r.finished_at : null,
    })
  }
  return out
}

/** What the last run says, in one plain sentence. */
export function runSentence(run: AiSuggestRun | null, formatDay: (iso: string) => string): string {
  if (!run) return 'No look for suggestions yet. The first is made on the coming Monday, or press the button.'
  if (run.status === 'queued') return 'A look for suggestions is waiting for Anthropic. It is checked every 15 minutes.'
  const when = formatDay(run.finished_at ?? run.created_at)
  if (run.status === 'failed') return `The look on ${when} failed: ${run.failure ?? 'no reason was kept'}`
  if (run.patterns === 0) return `The look on ${when} found nothing that repeats often enough. No AI call was made.`
  return `The look on ${when} read ${run.patterns} repeat${run.patterns === 1 ? '' : 's'} and added ${run.added} suggestion${run.added === 1 ? '' : 's'}.`
}
