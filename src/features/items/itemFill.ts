// ─────────────────────────────────────────────────────────────────────────────
//  ✨ on the item screen (step 4 of docs/features/item-screen-plan.md): the
//  sentence the owner types, and the field values the assistant may suggest
//  from it — checked here field by field. ai-proxy's `itemFill` action runs
//  this check on the model's answer and the browser runs it again on the
//  server's (scripts/sync-item-fill-shared.mjs copies this file and what it
//  imports into ai-proxy; verify-item-fill runs both copies). Pure.
//
//  Everything the model says is input (AGENTS.md → the Apple Calendar
//  warning): a kind, a repeat or an alert only from its allow-list; a real day
//  in a range, a real time; text capped, on one line (the notes may break
//  lines), with no control, direction or invisible characters; a link only as
//  https through the app's own link check (cleanItemUrl), taken from the
//  sentence itself, never from the model. A value that fails is DROPPED, never fixed up;
//  any other key is ignored. The model gets no tools and no data — only the
//  sentence, today's date and the time zone — so the worst it can do is
//  suggest a wrong value, which the owner sees marked before anything saves.
// ─────────────────────────────────────────────────────────────────────────────

import { ALERT_MINUTES, MAX_ITEM_ALERTS, TRAVEL_MINUTES } from '../calendar/calendarEventRules'
import { MAX_REPEAT_COUNT, MAX_REPEAT_INTERVAL } from '../daily/recurrence'
import { PLACE_NAME_MAX } from './itemPlace'
import { cleanItemUrl } from './itemCalendarFields'

/** The sentence: at most this many characters. */
export const FILL_TEXT_MAX = 500
/** A suggested title, and the notes: at most this many characters (a longer one is dropped). */
export const FILL_TITLE_MAX = 200
export const FILL_NOTES_MAX = 1000
/** A length in minutes (planModal.config's MAX_DURATION_MINUTES: one day; verify-item-fill compares). */
export const FILL_LENGTH_MAX = 1440
/** A suggested day lies at most this far back, and this far ahead of today (five years). */
export const FILL_DAYS_BACK = 366
export const FILL_DAYS_AHEAD = 1830

export const FILL_REPEATS = ['daily', 'weekdays', 'weekly', 'monthly', 'every'] as const
export const FILL_UNITS = ['day', 'week', 'month'] as const
export const FILL_PRIORITIES = ['low', 'medium', 'high'] as const
export const FILL_SHOW_AS = ['busy', 'free'] as const

export type FillRepeat = typeof FILL_REPEATS[number]
export type FillUnit = typeof FILL_UNITS[number]

/**
 * What a fill may hold — the model's answer and the server's are this one flat shape, so the browser checks the
 * server's answer with the same function. Every key is optional: the sentence said it, or it isn't there.
 */
export interface ItemFill {
  title?: string
  /** YYYY-MM-DD — the day it happens. */
  date?: string
  /** HH:MM, 24-hour. */
  startTime?: string
  /** HH:MM — only beside a start (the next day when not after it). */
  endTime?: string
  /** 1–1440 minutes — only when there is no end time. */
  durationMinutes?: number
  /** Only `true`, and only without a start time. */
  allDay?: true
  repeat?: FillRepeat
  /** 0 = Sunday … 6 = Saturday, distinct, sorted — only for 'weekly' or every N weeks. */
  repeatDays?: number[]
  /** Only with 'every'. */
  repeatEvery?: number
  repeatUnit?: FillUnit
  /** End Repeat: a day, or a number of times — never both. */
  repeatUntil?: string
  repeatCount?: number
  /** A place's name (no map pin: the owner searches EnTur for one). */
  place?: string
  travelMinutes?: number
  /** Alert and Second Alert: one or two of ALERT_MINUTES, distinct, in order. */
  alerts?: number[]
  showAs?: typeof FILL_SHOW_AS[number]
  /** The one https:// link written in the sentence (linkOfSentence) — never the model's. */
  url?: string
  notes?: string
  deadlineDate?: string
  deadlineTime?: string
  /** "Do it between": the first day of the window (tasks.start_date) — never after the deadline. */
  doFrom?: string
  priority?: typeof FILL_PRIORITIES[number]
}

/** Each key of ItemFill, in the order a fill is built — the model's schema has exactly these (verify-item-fill). */
export const FILL_KEYS = [
  'title', 'date', 'startTime', 'endTime', 'durationMinutes', 'allDay', 'repeat', 'repeatDays', 'repeatEvery', 'repeatUnit',
  'repeatUntil', 'repeatCount', 'place', 'travelMinutes', 'alerts', 'showAs', 'url', 'notes', 'deadlineDate', 'deadlineTime',
  'doFrom', 'priority',
] as const

// One line: no C0/C1 control character, no bidi mark, override or isolate, no zero-width, filler or invisible character
// (the astral ones too: tag characters, the supplementary variation selectors, musical formatting), no line or
// paragraph separator, no lone surrogate. The notes may hold a line break (\n) and nothing else of these. The joiner
// (U+200D) and the emoji variation selectors (U+FE0E, U+FE0F) stay: an emoji is built from them (a subdivision flag,
// built from tag characters, is refused).
// eslint-disable-next-line no-control-regex, no-misleading-character-class -- control and combining characters, alone, are exactly what is refused
const FILL_NOT_ONE_LINE = /[\u0000-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B\u200C\u200E\u200F\u2028-\u202E\u2060-\u206F\u3164\uFE00-\uFE0D\uFEFF\uFFA0\uFFF9-\uFFFB\u{1D173}-\u{1D17A}\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]|\p{Cs}/u
// eslint-disable-next-line no-control-regex, no-misleading-character-class -- control and combining characters, alone, are exactly what is refused
const FILL_NOT_TEXT = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B\u200C\u200E\u200F\u2028-\u202E\u2060-\u206F\u3164\uFE00-\uFE0D\uFEFF\uFFA0\uFFF9-\uFFFB\u{1D173}-\u{1D17A}\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]|\p{Cs}/u
const FILL_DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const FILL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/

/** Why the sentence can't be sent, or null: a string, 1–500 characters, one line of plain text. */
export function itemFillTextProblem(text: unknown): string | null {
  if (typeof text !== 'string') return 'Type what it is'
  if (text.length > FILL_TEXT_MAX * 4) return `At most ${FILL_TEXT_MAX} characters`
  const t = text.trim()
  if (!t) return 'Type what it is'
  if ([...t].length > FILL_TEXT_MAX) return `At most ${FILL_TEXT_MAX} characters`
  if (FILL_NOT_ONE_LINE.test(t)) return 'Plain text on one line'
  return null
}

/** Only the object's own value: a key like "constructor" or "__proto__" never reads Object's. */
function fillOwn(o: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined
}

function fillText(v: unknown, max: number, lines: boolean): string | undefined {
  if (typeof v !== 'string' || v.length > max * 4) return undefined
  const t = v.trim()
  if (!t || [...t].length > max) return undefined
  return (lines ? FILL_NOT_TEXT : FILL_NOT_ONE_LINE).test(t) ? undefined : t
}

/** A day as a whole number (days since 1970-01-01), or null when it isn't a real YYYY-MM-DD day. */
function fillDayNumber(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const m = FILL_DAY.exec(v)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = Date.UTC(y, mo - 1, d)
  const back = new Date(t)
  if (y < 1971 || back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null
  return t / 86_400_000
}

function fillDay(v: unknown, today: number | null): string | undefined {
  const n = fillDayNumber(v)
  if (n === null || today === null || n < today - FILL_DAYS_BACK || n > today + FILL_DAYS_AHEAD) return undefined
  return v as string
}

function fillTime(v: unknown): string | undefined {
  return typeof v === 'string' && FILL_TIME.test(v) ? v : undefined
}

function fillInt(v: unknown, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined
}

function fillOneOf<T extends string>(v: unknown, list: readonly T[]): T | undefined {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T : undefined
}

function fillWeekdays(v: unknown): number[] | undefined {
  if (!Array.isArray(v) || v.length < 1 || v.length > 7) return undefined
  if (!v.every(d => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)) return undefined
  return new Set(v).size === v.length ? [...v as number[]].sort((a, b) => a - b) : undefined
}

function fillAlerts(v: unknown): number[] | undefined {
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_ITEM_ALERTS) return undefined
  if (!v.every(m => typeof m === 'number' && ALERT_MINUTES.includes(m))) return undefined
  return new Set(v).size === v.length ? [...v as number[]] : undefined
}

/** A host a link may name: a dot, letters as the last label (no IPv4, no "localhost", no "router"). */
const FILL_LINK_HOST = /^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/

/**
 * The link: never the model's — the one https:// address written in the sentence itself. Each word (brackets and
 * quotes around it and trailing punctuation off) that starts with https:// goes through cleanItemUrl and needs a host with a dot and a top-level name
 * of letters; exactly one such link (the same one twice is one) fills the URL, none or two fill nothing.
 */
export function linkOfSentence(sentence: unknown): string | undefined {
  if (typeof sentence !== 'string' || sentence.length > FILL_TEXT_MAX * 4) return undefined
  const links = new Set<string>()
  for (const word of sentence.split(/\s+/)) {
    const token = word.replace(/^[([<"']+/, '').replace(/[.,;:!?)\]>"']+$/, '')
    if (!/^https:\/\//i.test(token)) continue
    const link = cleanItemUrl(token)
    if (!('url' in link) || !link.url) continue
    if (!FILL_LINK_HOST.test(new URL(link.url).hostname)) continue
    links.add(link.url)
  }
  return links.size === 1 ? [...links][0] : undefined
}

/**
 * The model's (or the server's) answer as a fill: each field checked on its own, then the pairs that only mean
 * something together — a failing value is left out, never mended. `today` is YYYY-MM-DD (a day that isn't real
 * drops every day); `sentence` is what the owner typed (a link must be in it).
 */
export function cleanItemFill(raw: unknown, ctx: { today: string; sentence: string }): ItemFill {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const o = raw as Record<string, unknown>
  const get = (k: typeof FILL_KEYS[number]) => fillOwn(o, k)
  const today = fillDayNumber(ctx.today)
  const out: ItemFill = {}

  const title = fillText(get('title'), FILL_TITLE_MAX, false)
  if (title) out.title = title
  const date = fillDay(get('date'), today)
  if (date) out.date = date

  // A start, then either an end or a length; all day only without a start.
  const start = fillTime(get('startTime'))
  if (start) {
    out.startTime = start
    const end = fillTime(get('endTime'))
    if (end && end !== start) out.endTime = end
  }
  const length = fillInt(get('durationMinutes'), 1, FILL_LENGTH_MAX)
  if (length !== undefined && !out.endTime) out.durationMinutes = length
  if (get('allDay') === true && !start) out.allDay = true

  // A repeat: every N needs its N and unit; days only where the app's day bubbles take several.
  const repeat = fillOneOf(get('repeat'), FILL_REPEATS)
  const every = fillInt(get('repeatEvery'), 1, MAX_REPEAT_INTERVAL)
  const unit = fillOneOf(get('repeatUnit'), FILL_UNITS)
  if (repeat && (repeat !== 'every' || (every !== undefined && unit))) {
    out.repeat = repeat
    const days = fillWeekdays(get('repeatDays'))
    if (days && (repeat === 'weekly' || (repeat === 'every' && unit === 'week'))) out.repeatDays = days
    if (repeat === 'every') { out.repeatEvery = every; out.repeatUnit = unit }
  }
  // End Repeat: a day (not before the item's own) or a count — both at once say two things, so neither is taken.
  const until = fillDay(get('repeatUntil'), today)
  const count = fillInt(get('repeatCount'), 1, MAX_REPEAT_COUNT)
  if (until && count === undefined && (!date || until >= date)) out.repeatUntil = until
  if (count !== undefined && !until) out.repeatCount = count

  const place = fillText(get('place'), PLACE_NAME_MAX, false)
  if (place) out.place = place
  const travel = get('travelMinutes')
  if (typeof travel === 'number' && TRAVEL_MINUTES.includes(travel)) out.travelMinutes = travel
  const alerts = fillAlerts(get('alerts'))
  if (alerts) out.alerts = alerts
  const showAs = fillOneOf(get('showAs'), FILL_SHOW_AS)
  if (showAs) out.showAs = showAs
  // The model's url is never read: the link comes from the sentence (linkOfSentence).
  const url = linkOfSentence(ctx.sentence)
  if (url) out.url = url
  const notes = fillText(get('notes'), FILL_NOTES_MAX, true)
  if (notes) out.notes = notes

  const deadline = fillDay(get('deadlineDate'), today)
  if (deadline) out.deadlineDate = deadline
  const deadlineTime = fillTime(get('deadlineTime'))
  if (deadlineTime) out.deadlineTime = deadlineTime
  const doFrom = fillDay(get('doFrom'), today)
  if (doFrom && (!deadline || doFrom <= deadline)) out.doFrom = doFrom

  const priority = fillOneOf(get('priority'), FILL_PRIORITIES)
  if (priority) out.priority = priority
  return out
}

/** The model's answer shape (Gemini's responseSchema): the ItemFill keys, every one optional, the lists as enums. */
export const ITEM_FILL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    date: { type: 'STRING', description: 'YYYY-MM-DD' },
    startTime: { type: 'STRING', description: 'HH:MM, 24-hour' },
    endTime: { type: 'STRING', description: 'HH:MM, 24-hour' },
    durationMinutes: { type: 'INTEGER' },
    allDay: { type: 'BOOLEAN' },
    repeat: { type: 'STRING', enum: [...FILL_REPEATS] },
    repeatDays: { type: 'ARRAY', items: { type: 'INTEGER' }, description: '0 = Sunday … 6 = Saturday' },
    repeatEvery: { type: 'INTEGER' },
    repeatUnit: { type: 'STRING', enum: [...FILL_UNITS] },
    repeatUntil: { type: 'STRING', description: 'YYYY-MM-DD' },
    repeatCount: { type: 'INTEGER' },
    place: { type: 'STRING' },
    travelMinutes: { type: 'INTEGER' },
    alerts: { type: 'ARRAY', items: { type: 'INTEGER' }, description: 'minutes before the start' },
    showAs: { type: 'STRING', enum: [...FILL_SHOW_AS] },
    notes: { type: 'STRING' },
    deadlineDate: { type: 'STRING', description: 'YYYY-MM-DD' },
    deadlineTime: { type: 'STRING', description: 'HH:MM, 24-hour' },
    doFrom: { type: 'STRING', description: 'YYYY-MM-DD' },
    priority: { type: 'STRING', enum: [...FILL_PRIORITIES] },
  },
} as const
