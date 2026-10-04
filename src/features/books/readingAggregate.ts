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

export interface Session { bookId: string; start: number; end: number; seconds: number; pages: number }

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
    if (seconds >= MIN_SESSION_SECONDS) out.push({ bookId: cur.bookId, start: cur.start, end: cur.end, seconds, pages: cur.pageSet.size })
  }
  for (const e of sorted) {
    const t = Date.parse(e.started_at) / 1000
    if (!cur || cur.bookId !== e.book_id || t - cur.end > SESSION_GAP_SECONDS) {
      close()
      cur = { bookId: e.book_id, start: t, end: t + e.duration_seconds, seconds: 0, pages: 0, sum: 0, pageSet: new Set() }
    }
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
