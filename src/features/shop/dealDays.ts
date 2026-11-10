// Deal days as repeating rules (shop_deal_days, migration 190): the day a rule falls on in a year, and the
// occurrence running on a day or the next one after it. Every day is a calendar day on Oslo's calendar
// (yyyy-mm-dd): a rule names calendar days, so no clock or time zone takes part — `from` is the app's today.
// Pure — scripts/verify-shop-signals.cjs (2026–2030 for 190's rows, and rules that cross a year).
import type { ShopDealDay } from './types'

/**
 * A deal day's rule: a fixed day and month, or the n-th weekday of a month (ISO weekday 1 = Monday … 7 = Sunday;
 * nth 1–4, or -1 = the last), plus `offsetDays` (−31…31; Black Friday is the 4th Thursday + 1), lasting
 * `lengthDays` (1–31). The limits are 190's CHECKs.
 */
export type DealRule =
  | { kind: 'fixed'; month: number; day: number; offsetDays?: number; lengthDays?: number }
  | { kind: 'nth_weekday'; month: number; weekday: number; nth: number; offsetDays?: number; lengthDays?: number }

/** One run of a deal: its first and last day (both yyyy-mm-dd, both counted). */
export interface DealOccurrence { start: string; end: string }

const DAY_MS = 86_400_000
/** The days every year has in each month (no 29.02: a fixed rule must fall every year). */
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const int = (n: unknown, lo: number, hi: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi

function wholeRule(r: DealRule): boolean {
  if (!int(r.month, 1, 12) || !int(r.offsetDays ?? 0, -31, 31) || !int(r.lengthDays ?? 1, 1, 31)) return false
  if (r.kind === 'fixed') return int(r.day, 1, MONTH_DAYS[r.month - 1])
  if (r.kind === 'nth_weekday') return int(r.weekday, 1, 7) && (int(r.nth, 1, 4) || r.nth === -1)
  return false
}

/** A real calendar day as UTC midnight in ms, or null. */
function dayMs(day: string): number | null {
  const m = DAY_RE.exec(day)
  if (!m) return null
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return new Date(ms).toISOString().slice(0, 10) === day ? ms : null
}
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
/** ISO weekday of a UTC midnight: 1 = Monday … 7 = Sunday. */
const isoWeekday = (ms: number) => ((new Date(ms).getUTCDay() + 6) % 7) + 1

/** Whether `day` is a real yyyy-mm-dd day. */
export function isDay(day: unknown): day is string {
  return typeof day === 'string' && dayMs(day) !== null
}

/** `day` plus `n` days. */
export function addDays(day: string, n: number): string {
  const ms = dayMs(day)
  if (ms === null) throw new Error(`Not a day: ${day}`)
  return isoDay(ms + n * DAY_MS)
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function daysFrom(a: string, b: string): number {
  const x = dayMs(a), y = dayMs(b)
  if (x === null || y === null) throw new Error(`Not a day: ${x === null ? a : b}`)
  return Math.round((y - x) / DAY_MS)
}

/**
 * The day a rule falls on in `year`, its offset counted — so a rule near the year's end can land in the next year
 * ("the last Friday of December + 7 days"). Null for a rule that isn't whole or a year outside 1970–9999.
 */
export function dealDayIn(rule: DealRule, year: number): string | null {
  if (!wholeRule(rule) || !int(year, 1970, 9999)) return null
  let ms: number
  if (rule.kind === 'fixed') ms = Date.UTC(year, rule.month - 1, rule.day)
  else if (rule.nth > 0) {
    const first = Date.UTC(year, rule.month - 1, 1)
    ms = first + (((rule.weekday - isoWeekday(first) + 7) % 7) + (rule.nth - 1) * 7) * DAY_MS
  } else {
    const last = Date.UTC(year, rule.month, 0)
    ms = last - ((isoWeekday(last) - rule.weekday + 7) % 7) * DAY_MS
  }
  return isoDay(ms + (rule.offsetDays ?? 0) * DAY_MS)
}

/**
 * The run of a deal going on on `from`, or else the next one — one that began the year before and still runs
 * counts (27.12 for 10 days, seen on 03.01). Null for a rule that isn't whole or a `from` that is no day.
 */
export function nextDeal(rule: DealRule, from: string): DealOccurrence | null {
  if (!isDay(from) || !wholeRule(rule)) return null
  const year = Number(from.slice(0, 4))
  const length = rule.lengthDays ?? 1
  // The years' runs come in order and never overlap (31 days at most, an offset within a month): the first that
  // hasn't ended is the one. A year before (still running) and two after (a negative offset) cover every rule.
  for (const y of [year - 1, year, year + 1, year + 2]) {
    const start = dealDayIn(rule, y)
    if (!start) continue
    const end = addDays(start, length - 1)
    if (end >= from) return { start, end }
  }
  return null
}

/** A deal day's rule from its row, checked where it enters (190's CHECKs): null when the row isn't a whole rule. */
export function dealRuleOf(row: Pick<ShopDealDay, 'rule_kind' | 'month' | 'day' | 'weekday' | 'nth' | 'offset_days' | 'length_days'>): DealRule | null {
  const base = { month: row.month, offsetDays: row.offset_days, lengthDays: row.length_days }
  const rule: DealRule | null = row.rule_kind === 'fixed' && row.weekday == null && row.nth == null
    ? { kind: 'fixed', day: row.day as number, ...base }
    : row.rule_kind === 'nth_weekday' && row.day == null
      ? { kind: 'nth_weekday', weekday: row.weekday as number, nth: row.nth as number, ...base }
      : null
  return rule && wholeRule(rule) ? rule : null
}

const num = (v: unknown): number | null => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)

/** A deal-day row read back from the database, checked where it enters: null unless it is a whole rule with a name. */
export function parseDealDay(row: unknown): ShopDealDay | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.slug !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(r.slug)) return null
  if (typeof r.name !== 'string' || !r.name.trim() || (r.rule_kind !== 'fixed' && r.rule_kind !== 'nth_weekday')) return null
  if (!isDay(r.checked_on)) return null
  const deal: ShopDealDay = {
    id: r.id, slug: r.slug, name: r.name.trim(), rule_kind: r.rule_kind,
    month: num(r.month) as number, day: num(r.day), weekday: num(r.weekday), nth: num(r.nth),
    offset_days: num(r.offset_days) ?? 0, length_days: num(r.length_days) ?? 1,
    source_url: typeof r.source_url === 'string' && /^https:\/\/\S+$/.test(r.source_url) ? r.source_url : null,
    checked_on: r.checked_on, created_at: String(r.created_at ?? ''), updated_at: String(r.updated_at ?? ''),
  }
  return dealRuleOf(deal) ? deal : null
}

/** A deal day's next run as seen from a day: how many days until it starts (0 while it runs). */
export interface DealAhead extends DealOccurrence {
  deal: ShopDealDay
  daysUntil: number
  running: boolean
}

/**
 * Each deal day's run going on on `today` or next, soonest first (a tie by name); only those starting within
 * `withinDays` when given ("Black Friday in 17 days"). Rows that aren't whole rules are left out.
 */
export function dealsAhead(rows: readonly ShopDealDay[], today: string, withinDays?: number): DealAhead[] {
  if (!isDay(today)) return []
  const out: DealAhead[] = []
  for (const deal of rows) {
    const rule = dealRuleOf(deal)
    const run = rule ? nextDeal(rule, today) : null
    if (!run) continue
    const daysUntil = Math.max(0, daysFrom(today, run.start))
    if (withinDays != null && daysUntil > withinDays) continue
    out.push({ deal, ...run, daysUntil, running: run.start <= today })
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.deal.name.localeCompare(b.deal.name, 'en'))
}
