import { formatDate } from '../../shared/utils/dateFormat'
import { addDays, daysBetween, estimateFinishSeconds, localDay } from './readingAggregate'
import type { Book, ReadingEvent } from './types'

// "Finish around DD.MM.YYYY" for the book in hand. Plain arithmetic, no guess:
// the time left (the book's own pace per percent, `estimateFinishSeconds`)
// divided by the time actually read per calendar day over the last 14 days.
// With too little reading to tell, it says so instead of showing a date.
// Pure — scripts/verify-finish-by.cjs.

export const PACE_WINDOW_DAYS = 14
/** Days with reading in the window before a pace means anything. */
export const MIN_PACE_DAYS = 3
/** Further than this the date is not worth printing. */
export const FAR_DAYS = 365

type BookFacts = Pick<Book, 'progress_pct' | 'read_seconds'>

export type FinishBy =
  | { kind: 'date'; day: string; days: number; minutesPerDay: number }
  | { kind: 'far'; minutesPerDay: number }
  | { kind: 'none'; why: 'no-progress' | 'no-pace' }

/**
 * `events`: this book's page events (any span — the window is cut here).
 * `none` / `no-progress`: under 5 % read or 20 minutes spent, so the time left
 * can't be told yet; `no-pace`: fewer than 3 reading days in the last 14.
 */
export function finishBy(book: BookFacts, events: readonly ReadingEvent[], today: string): FinishBy {
  const total = events.reduce((t, e) => t + e.duration_seconds, 0)
  const left = estimateFinishSeconds(book.progress_pct, Math.max(book.read_seconds ?? 0, total))
  if (left == null) return { kind: 'none', why: 'no-progress' }

  const from = addDays(today, -(PACE_WINDOW_DAYS - 1))
  const perDay = new Map<string, number>()
  for (const e of events) {
    const d = localDay(new Date(e.started_at))
    if (d >= from && d <= today) perDay.set(d, (perDay.get(d) ?? 0) + e.duration_seconds)
  }
  if (perDay.size < MIN_PACE_DAYS) return { kind: 'none', why: 'no-pace' }
  const first = [...perDay.keys()].sort()[0]
  const span = Math.min(PACE_WINDOW_DAYS, daysBetween(first, today) + 1)
  const seconds = [...perDay.values()].reduce((t, s) => t + s, 0)
  const rate = seconds / span
  if (rate <= 0) return { kind: 'none', why: 'no-pace' }
  const days = Math.max(1, Math.ceil(left / rate))
  const minutesPerDay = Math.max(1, Math.round(rate / 60))
  return days > FAR_DAYS ? { kind: 'far', minutesPerDay } : { kind: 'date', day: addDays(today, days), days, minutesPerDay }
}

/** The words for a result: "Finish around 03.12.2026 · about 25 min a day", or why there is no date. */
export function finishByText(f: FinishBy): string {
  switch (f.kind) {
    case 'date': return `Finish around ${formatDate(f.day)} · about ${f.minutesPerDay} min a day`
    case 'far':  return `Over a year at this pace (about ${f.minutesPerDay} min a day)`
    default:     return f.why === 'no-pace'
      ? `No pace yet — read on ${MIN_PACE_DAYS} days in two weeks for a finish date`
      : 'No finish date yet — too little read to tell'
  }
}
