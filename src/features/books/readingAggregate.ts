// Reading statistics from KOReader's page events (docs/kobo/PLAN.md §4.3, §5).
// Pure and import-free (type-only); verified by scripts/verify-reading-aggregate.cjs.
//
// Two rules that are not polish:
// - A streak is computed retroactively from whatever rows exist now; a day the
//   Kobo has not reported yet is UNKNOWN, never zero, so a late sync repairs the
//   past by itself and a radio that stayed off never breaks a streak.
// - Minutes are the metric (pages depend on font size). No composite score.

import type { Book, ReadingEvent } from './types'

export const SESSION_GAP_SECONDS = 1800
export const MIN_SESSION_SECONDS = 10

const pad = (n: number) => String(n).padStart(2, '0')

/** yyyy-MM-dd in the browser's local time. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return localDay(new Date(y, m - 1, d + n, 12))
}

/** Every day from `from` to `to`, inclusive. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to && out.length < 4000; d = addDays(d, 1)) out.push(d)
  return out
}

/** Seconds read per local day. */
export function secondsByDay(events: readonly ReadingEvent[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const e of events) {
    const day = localDay(new Date(e.started_at))
    out.set(day, (out.get(day) ?? 0) + e.duration_seconds)
  }
  return out
}

export type DayState = 'read' | 'short' | 'zero' | 'unknown' | 'today'

/**
 * What a day means. `lastSeenDay` is the local day of the device's last
 * complete sync: a later day without rows is unknown, an earlier one is a real
 * zero. Today is never zero (the day is not over).
 */
export function dayState(day: string, seconds: number, today: string, lastSeenDay: string | null, minMinutes: number): DayState {
  if (seconds >= minMinutes * 60) return 'read'
  if (seconds > 0) return day === today ? 'today' : 'short'
  if (day === today) return 'today'
  if (!lastSeenDay || day >= lastSeenDay) return 'unknown'
  return 'zero'
}

export interface Streak { current: number; longest: number; atRisk: boolean }

/**
 * Current streak, walking back from today: a read day counts; today and an
 * unknown day neither count nor break; a short or zero day ends it.
 * `atRisk` = today is not read yet but the streak is alive.
 */
export function computeStreak(byDay: Map<string, number>, today: string, lastSeenDay: string | null, minMinutes: number, firstDay: string | null): Streak {
  let current = 0
  let atRisk = false
  const start = firstDay ?? today
  for (let d = today; d >= start; d = addDays(d, -1)) {
    const st = dayState(d, byDay.get(d) ?? 0, today, lastSeenDay, minMinutes)
    if (st === 'read') current++
    else if (st === 'today') { if (d === today) atRisk = true; continue }
    else if (st === 'unknown') continue
    else break
  }
  if (current === 0) atRisk = false
  let longest = 0, run = 0
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const st = dayState(d, byDay.get(d) ?? 0, today, lastSeenDay, minMinutes)
    if (st === 'read') { run++; longest = Math.max(longest, run) }
    else if (st === 'short' || st === 'zero') run = 0
  }
  return { current, longest: Math.max(longest, current), atRisk }
}

/** A reading session; start/end are epoch SECONDS; firstPage/lastPage = the lowest and highest page seen. */
export interface Session { bookId: string; start: number; end: number; seconds: number; pages: number; firstPage: number; lastPage: number }

/**
 * Reading sessions: a book's events grouped while the gap stays ≤ 30 min.
 * seconds = min(Σ durations, wall clock), so idle time inside is excluded;
 * clusters under 10 s are dropped (a page flicked past).
 */
export function sessions(events: readonly ReadingEvent[]): Session[] {
  const sorted = [...events].sort((a, b) => a.started_at.localeCompare(b.started_at))
  const out: Session[] = []
  let cur: (Session & { sum: number; pageSet: Set<number> }) | null = null
  const close = () => {
    if (!cur) return
    const seconds = Math.min(cur.sum, Math.max(cur.end - cur.start, 0))
    if (seconds >= MIN_SESSION_SECONDS) {
      out.push({ bookId: cur.bookId, start: cur.start, end: cur.end, seconds, pages: cur.pageSet.size, firstPage: cur.firstPage, lastPage: cur.lastPage })
    }
  }
  for (const e of sorted) {
    const t = Date.parse(e.started_at) / 1000
    if (!cur || cur.bookId !== e.book_id || t - cur.end > SESSION_GAP_SECONDS) {
      close()
      cur = { bookId: e.book_id, start: t, end: t + e.duration_seconds, seconds: 0, pages: 0, firstPage: e.page, lastPage: e.page, sum: 0, pageSet: new Set() }
    }
    cur.firstPage = Math.min(cur.firstPage, e.page)
    cur.lastPage = Math.max(cur.lastPage, e.page)
    cur.sum += e.duration_seconds
    cur.end = Math.max(cur.end, t + e.duration_seconds)
    cur.pageSet.add(e.page)
  }
  close()
  return out
}

export interface BookWindow { bookId: string; seconds: number; pages: number; sessions: number; lastAt: number; pagesPerHour: number | null }

/** Per book in a window: time, distinct pages, sessions, speed (≥ 10 minutes of data). */
export function byBook(events: readonly ReadingEvent[]): BookWindow[] {
  const map = new Map<string, { seconds: number; pages: Set<number>; lastAt: number }>()
  for (const e of events) {
    const m = map.get(e.book_id) ?? { seconds: 0, pages: new Set<number>(), lastAt: 0 }
    m.seconds += e.duration_seconds
    m.pages.add(e.page)
    m.lastAt = Math.max(m.lastAt, Date.parse(e.started_at))
    map.set(e.book_id, m)
  }
  const sess = sessions(events)
  return [...map.entries()].map(([bookId, m]) => ({
    bookId, seconds: m.seconds, pages: m.pages.size, lastAt: m.lastAt,
    sessions: sess.filter(s => s.bookId === bookId).length,
    pagesPerHour: m.seconds >= 600 ? Math.round(m.pages.size / (m.seconds / 3600)) : null,
  })).sort((a, b) => b.seconds - a.seconds)
}

/** Seconds per weekday (0 = Monday) × hour, local time. */
export function hourGrid(events: readonly ReadingEvent[]): number[][] {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0) as number[])
  for (const e of events) {
    const d = new Date(e.started_at)
    grid[(d.getDay() + 6) % 7][d.getHours()] += e.duration_seconds
  }
  return grid
}

/** "1 h 5 min", "12 min", "40 s" — a duration in words. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} h ${rest} min` : `${h} h`
}

/** Library order: currently reading by last read, the queue by order, then the rest by title. */
export function sortForLibrary(books: readonly Book[], sort: LibrarySort): Book[] {
  const by = [...books]
  const title = (a: Book, b: Book) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  if (sort === 'title') return by.sort(title)
  if (sort === 'author') return by.sort((a, b) => (a.author ?? '￿').localeCompare(b.author ?? '￿', undefined, { sensitivity: 'base' }) || title(a, b))
  if (sort === 'progress') return by.sort((a, b) => (b.progress_pct ?? -1) - (a.progress_pct ?? -1) || title(a, b))
  if (sort === 'added') return by.sort((a, b) => b.created_at.localeCompare(a.created_at))
  return by.sort((a, b) => (b.last_read_at ?? '').localeCompare(a.last_read_at ?? '') || title(a, b))
}
export type LibrarySort = 'recent' | 'title' | 'author' | 'progress' | 'added'

/** Lower case without accents; ø/æ/ı/ß (no decomposition) mapped by hand. */
export function fold(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ı/g, 'i').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
}

/** Accent-folded search over title, author and series. */
export function matchesSearch(b: Book, q: string): boolean {
  const needle = fold(q.trim())
  if (!needle) return true
  return fold([b.title, b.author, b.series].filter(Boolean).join(' ')).includes(needle)
}

/** The queue ("Up next"): want-to-read books with an order, then the rest by when they were added. */
export function upNext(books: readonly Book[]): Book[] {
  return books.filter(b => b.read_status === 'want')
    .sort((a, b) => (a.queue_order ?? 1e9) - (b.queue_order ?? 1e9) || a.created_at.localeCompare(b.created_at))
}

/** New queue_order values after moving `id` by `delta` (−1 up, +1 down): every row renumbered 1…n. */
export function moveInQueue(queue: readonly Book[], id: string, delta: number): { id: string; queue_order: number }[] {
  const ids = queue.map(b => b.id)
  const i = ids.indexOf(id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= ids.length) return []
  ;[ids[i], ids[j]] = [ids[j], ids[i]]
  return ids.map((bid, k) => ({ id: bid, queue_order: k + 1 }))
    .filter(r => queue.find(b => b.id === r.id)?.queue_order !== r.queue_order)
}

/**
 * A likely duplicate pair (same normalised title + author), for the merge
 * suggestion. Two rows that are two real files on the Kobo (two different
 * md5s, e.g. an EPUB and a KEPUB) are not offered: the next sync would bring
 * the deleted one back.
 */
export function duplicatePairs(books: readonly Book[]): [Book, Book][] {
  const key = (b: Book) => {
    const norm = (s: string | null) => fold(s)
      .replace(/^(.*), (the|a|an|der|die|das|den|det|en|et)$/, '$2 $1').replace(/[^a-z0-9]+/g, ' ').trim()
    return `${norm(b.title)}|${norm(b.author)}`
  }
  const seen = new Map<string, Book>()
  const out: [Book, Book][] = []
  for (const b of books) {
    const k = key(b)
    const prev = seen.get(k)
    if (prev && prev.koreader_md5 && b.koreader_md5 && prev.koreader_md5 !== b.koreader_md5) continue
    if (prev) out.push([prev, b])
    else seen.set(k, b)
  }
  return out
}

// ── Stats tab (the Reading tab rebuilt as statistics) ────────────────────────

/** Σ seconds over the local days from…to, inclusive. */
export function sumDays(perDay: ReadonlyMap<string, number>, from: string, to: string): number {
  let t = 0
  for (const [d, s] of perDay) if (d >= from && d <= to) t += s
  return t
}

/** The Monday of the week a local day falls in. */
export function weekStart(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const wd = (new Date(y, m - 1, d, 12).getDay() + 6) % 7
  return addDays(day, -wd)
}

/** Distinct pages per book, summed (a page re-read the same window counts once). */
export function distinctPages(events: readonly ReadingEvent[]): number {
  const seen = new Map<string, Set<number>>()
  for (const e of events) {
    const s = seen.get(e.book_id) ?? new Set<number>()
    s.add(e.page)
    seen.set(e.book_id, s)
  }
  let n = 0
  for (const s of seen.values()) n += s.size
  return n
}

/** Events whose local day is from…to, inclusive. */
export function eventsBetween(events: readonly ReadingEvent[], from: string, to: string): ReadingEvent[] {
  return events.filter(e => { const d = localDay(new Date(e.started_at)); return d >= from && d <= to })
}

/**
 * About how long until the end: remaining % × (time spent ÷ % read). Null below
 * 5 % read or 20 minutes spent (too little to extrapolate), and at 100 %.
 */
export function estimateFinishSeconds(progressPct: number | null | undefined, seconds: number): number | null {
  if (progressPct == null || progressPct < 5 || progressPct >= 100 || seconds < 1200) return null
  return Math.round(((100 - progressPct) * seconds) / progressPct)
}

/** Pages per hour, only with ≥ 10 minutes of data. */
export function pagesPerHour(pages: number, seconds: number): number | null {
  return seconds >= 600 && pages > 0 ? Math.round(pages / (seconds / 3600)) : null
}

type StatBook = Pick<Book, 'id' | 'kind' | 'read_status' | 'page_count' | 'progress_pct' | 'read_seconds' | 'read_pages' | 'last_read_at'>

export interface CurrentBook {
  bookId: string
  /** Lifetime time: KOReader's total, or the synced events when that is larger/missing. */
  seconds: number
  sessions: number
  /** Highest page reached in the synced events. */
  page: number | null
  /** The book's page count, only when it is not below `page` (layouts differ). */
  pageTotal: number | null
  progressPct: number | null
  pagesPerHour: number | null
  /** Epoch ms of the last read (events or the device's last_read_at). */
  lastAt: number | null
  etaSeconds: number | null
}

/**
 * Books in hand: status Reading, plus any non-news book read in the last
 * `recentDays` days that is not Finished or Dropped. Most recently read first.
 */
export function currentlyReading(books: readonly StatBook[], events: readonly ReadingEvent[], today: string, recentDays = 14): CurrentBook[] {
  const per = new Map<string, { seconds: number; pages: Set<number>; max: number; lastAt: number; list: ReadingEvent[] }>()
  for (const e of events) {
    const m = per.get(e.book_id) ?? { seconds: 0, pages: new Set<number>(), max: 0, lastAt: 0, list: [] }
    m.seconds += e.duration_seconds
    m.pages.add(e.page)
    m.max = Math.max(m.max, e.page)
    m.lastAt = Math.max(m.lastAt, Date.parse(e.started_at))
    m.list.push(e)
    per.set(e.book_id, m)
  }
  const cutoff = addDays(today, -recentDays)
  const out: CurrentBook[] = []
  for (const b of books) {
    if (b.kind === 'news') continue
    const m = per.get(b.id)
    const deviceAt = b.last_read_at ? Date.parse(b.last_read_at) : NaN
    const lastAt = Math.max(m?.lastAt ?? 0, Number.isFinite(deviceAt) ? deviceAt : 0) || null
    const recent = lastAt != null && localDay(new Date(lastAt)) >= cutoff
    if (b.read_status !== 'reading' && !(recent && b.read_status !== 'finished' && b.read_status !== 'dropped')) continue
    const seconds = Math.max(b.read_seconds ?? 0, m?.seconds ?? 0)
    const speed = b.read_pages && b.read_seconds && b.read_seconds >= 600
      ? pagesPerHour(b.read_pages, b.read_seconds)
      : m ? pagesPerHour(m.pages.size, m.seconds) : null
    const page = m ? m.max : null
    out.push({
      bookId: b.id, seconds, sessions: m ? sessions(m.list).length : 0, page,
      pageTotal: b.page_count && (page == null || b.page_count >= page) ? b.page_count : null,
      progressPct: b.progress_pct, pagesPerHour: speed, lastAt,
      etaSeconds: estimateFinishSeconds(b.progress_pct, seconds),
    })
  }
  return out.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
}

/** Whole days from `day` to `today` (0 = today). */
export function daysBetween(day: string, today: string): number {
  const p = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) }
  return Math.round((p(today) - p(day)) / 86400000)
}

/** "today", "yesterday", "3 days ago". */
export function relativeDay(day: string, today: string): string {
  const n = daysBetween(day, today)
  if (n <= 0) return 'today'
  if (n === 1) return 'yesterday'
  return `${n} days ago`
}

export interface LogDay { day: string; sessions: Session[] }

/** The newest `limit` sessions, grouped by the local day they started, newest first. */
export function sessionLog(list: readonly Session[], limit: number): LogDay[] {
  const newest = [...list].sort((a, b) => b.start - a.start).slice(0, limit)
  const out: LogDay[] = []
  for (const s of newest) {
    const day = localDay(new Date(s.start * 1000))
    const last = out[out.length - 1]
    if (last && last.day === day) last.sessions.push(s)
    else out.push({ day, sessions: [s] })
  }
  return out
}

export interface WindowBook extends BookWindow { firstPage: number; lastPage: number }
export interface WindowNews { issues: number; seconds: number; pages: number; sessions: number }

/** Per book in a window (by time), with news issues summed into one row of their own. */
export function windowBooks(events: readonly ReadingEvent[], isNews: (bookId: string) => boolean): { books: WindowBook[]; news: WindowNews | null } {
  const range = new Map<string, [number, number]>()
  for (const e of events) {
    const r = range.get(e.book_id)
    range.set(e.book_id, r ? [Math.min(r[0], e.page), Math.max(r[1], e.page)] : [e.page, e.page])
  }
  const books: WindowBook[] = []
  let news: WindowNews | null = null
  for (const row of byBook(events)) {
    if (isNews(row.bookId)) {
      news = news ?? { issues: 0, seconds: 0, pages: 0, sessions: 0 }
      news.issues++; news.seconds += row.seconds; news.pages += row.pages; news.sessions += row.sessions
    } else {
      const [firstPage, lastPage] = range.get(row.bookId) ?? [0, 0]
      books.push({ ...row, firstPage, lastPage })
    }
  }
  return { books, news }
}

type FinishBook = Pick<Book, 'id' | 'kind' | 'finished_at' | 'started_at'>

/** Books (never news) finished in a calendar year, newest first. */
export function finishedInYear<T extends FinishBook>(books: readonly T[], year: number): T[] {
  return books.filter(b => b.kind !== 'news' && b.finished_at && new Date(b.finished_at).getFullYear() === year)
    .sort((a, b) => (b.finished_at ?? '').localeCompare(a.finished_at ?? ''))
}

/** Years with a finished book, plus `current`, newest first. */
export function finishedYears(books: readonly FinishBook[], current: number): number[] {
  const ys = new Set<number>([current])
  for (const b of books) if (b.kind !== 'news' && b.finished_at) ys.add(new Date(b.finished_at).getFullYear())
  return [...ys].sort((a, b) => b - a)
}

/** Calendar days from start to finish, both counted (same day = 1). Null without both or when reversed. */
export function daysTaken(startedAt: string | null, finishedAt: string | null): number | null {
  if (!startedAt || !finishedAt) return null
  const n = daysBetween(localDay(new Date(startedAt)), localDay(new Date(finishedAt)))
  return n < 0 ? null : n + 1
}

export interface MonthStat { month: number; seconds: number; finished: number }

/** Per month of `year`: time read and books finished. */
export function yearMonths(events: readonly ReadingEvent[], books: readonly FinishBook[], year: number): MonthStat[] {
  const out = Array.from({ length: 12 }, (_, month) => ({ month, seconds: 0, finished: 0 }))
  for (const e of events) {
    const d = new Date(e.started_at)
    if (d.getFullYear() === year) out[d.getMonth()].seconds += e.duration_seconds
  }
  for (const b of finishedInYear(books, year)) out[new Date(b.finished_at as string).getMonth()].finished++
  return out
}
