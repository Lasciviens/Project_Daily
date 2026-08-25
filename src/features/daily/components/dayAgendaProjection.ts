// ─────────────────────────────────────────────────────────────────────────────
//  DayAgenda — PURE day-projection logic, deliberately import-free (no
//  supabase client, no React) so it's testable via sucrase without tripping
//  client.ts's env-var guard.
//
//  A block that crosses midnight (a one-off time_block whose start_time +
//  duration_minutes pushes past 24:00, or a recurring schedule_blocks
//  template whose end_time clock-reads before its start_time) used to be
//  attributed ENTIRELY to the day it starts on — the portion after midnight
//  never appeared on the NEXT day's agenda at all, and today's own booked-
//  minutes/overlap math counted the full cross-midnight duration as if it
//  all happened today. Both are real bugs this file fixes: every block is
//  now projected onto EVERY calendar day it actually occupies, with each
//  day showing only ITS OWN portion (clipped to [0, 24) hours) — so the
//  same minute is never double-counted across two days' pages, and nothing
//  that actually happens after midnight goes missing from the agenda.
// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectedBlock {
  /** Unique WITHIN one day's projection — a spillover row gets its own id
   *  (suffixed) so it never collides with same-day rows, INCLUDING the
   *  canonical row for the same underlying block if it also appears today
   *  (a same-day recurring template's normal occurrence is a separate
   *  ProjectedBlock from its own spillover, when both fall on the same day
   *  — which can't happen for one-off blocks but IS possible in principle
   *  for a daily recurring template, hence keeping them distinct here). */
  id:          string
  /** The REAL time_blocks/schedule_blocks id — edit/delete/postpone must
   *  always route through this, never the (possibly synthetic) `id` above. */
  canonicalId: string
  kind:        'block' | 'recurring'
  title:       string
  /** Hours, clipped to [0, 24) — never negative, never >= 24. */
  startHour:   number
  /** Hours, clipped to (startHour, 24] — the portion of this block/template
   *  that actually falls on the day being projected. */
  endHour:     number
  taskId?:     string | null
  /** True for the tail of a block/template that actually STARTED on the
   *  previous day and crossed midnight into this one. */
  spillover:   boolean
}

function timeStrToHour(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h + m / 60
}

export interface OneOffBlockLike {
  id:                string
  title:             string
  start_time:        string | null
  duration_minutes:  number
  task_id?:          string | null
}

/** Projects one-off time_blocks onto ONE calendar day: `dayBlocks` (rows
 *  whose OWN `date` is this day) contribute their normal occurrence,
 *  clipped at 24:00 if they run past it (the overflow is that SAME block's
 *  problem on TOMORROW's projection call, not this one — this function only
 *  ever looks at the day before, never the day after). `previousDayBlocks`
 *  (rows whose `date` is the day before) contribute a spillover row for
 *  whatever portion of THEIR duration falls after midnight, i.e. into this
 *  day. An unscheduled row (`start_time` null) never spills (nothing to
 *  cross midnight with) and is passed through as an all-day-style -1/-1
 *  entry, same as before this file existed. */
export function projectOneOffBlocksForDay(
  dayBlocks: OneOffBlockLike[],
  previousDayBlocks: OneOffBlockLike[],
): ProjectedBlock[] {
  const out: ProjectedBlock[] = []

  for (const b of dayBlocks) {
    if (!b.start_time) {
      out.push({ id: b.id, canonicalId: b.id, kind: 'block', title: b.title, startHour: -1, endHour: -1, taskId: b.task_id, spillover: false })
      continue
    }
    const start = timeStrToHour(b.start_time)
    const end   = start + b.duration_minutes / 60
    out.push({
      id: b.id, canonicalId: b.id, kind: 'block', title: b.title,
      startHour: start, endHour: Math.min(end, 24), taskId: b.task_id, spillover: false,
    })
  }

  for (const b of previousDayBlocks) {
    if (!b.start_time) continue
    const start = timeStrToHour(b.start_time)
    const end   = start + b.duration_minutes / 60
    if (end <= 24) continue // didn't cross midnight — nothing spills into today
    out.push({
      id: `${b.id}__spillover`, canonicalId: b.id, kind: 'block', title: b.title,
      startHour: 0, endHour: Math.min(end - 24, 24), taskId: b.task_id, spillover: true,
    })
  }

  return out
}

export interface CalendarEventLike {
  start: { dateTime?: string; date?: string }
  end:   { dateTime?: string; date?: string }
}

export interface ProjectedCalendarEvent {
  /** Hours, clipped to [0, 24) for THIS day. */
  startHour: number
  /** Hours, clipped to (startHour, 24] for THIS day. */
  endHour:   number
  /** True when the event actually STARTED on a previous day and this is
   *  the portion spilling into the projected day. */
  spillover: boolean
}

/** Clips one Calendar event onto ONE calendar day (`dateStr`, local
 *  'yyyy-MM-dd'). Returns null for an all-day event (no `dateTime`, handled
 *  separately by the caller) or for an event that doesn't actually overlap
 *  this day at all (shouldn't happen given how these events are normally
 *  fetched — Google's events.list only ever returns events that overlap
 *  the QUERIED day's window in the first place — but a defensive result
 *  here is cheap and avoids ever rendering a nonsensical negative-duration
 *  row if a caller's day and its event list ever get out of sync).
 *
 *  Real bug this fixes: a cross-midnight Calendar event (e.g. 23:00
 *  yesterday → 01:00 today) used to be converted straight from
 *  `Date.getHours()` on each of its raw start/end instants — the RIGHT
 *  hour value for each instant individually, but assembled into a single
 *  startHour=23/endHour=1 pair for TODAY's render, which is not a valid
 *  [start, end) interval on a 0–24 scale at all: every downstream duration
 *  (`endHour - startHour` = -22h) and overlap check
 *  (`start < otherEnd && end > otherStart`) built on real one-off/recurring
 *  blocks silently broke the moment a Calendar event was mixed into the
 *  same list. This mirrors projectOneOffBlocksForDay's own clipping
 *  exactly, just from absolute instants instead of a same-day
 *  start_time+duration pair. */
export function projectCalendarEventForDay(dateStr: string, event: CalendarEventLike): ProjectedCalendarEvent | null {
  if (!event.start.dateTime) return null // all-day — no hour-of-day concept
  const dayStart = new Date(`${dateStr}T00:00:00`)
  const nextDayStart = new Date(dayStart)
  nextDayStart.setDate(nextDayStart.getDate() + 1)

  const start = new Date(event.start.dateTime)
  const end   = new Date(event.end.dateTime ?? event.start.dateTime)
  if (end.getTime() <= dayStart.getTime() || start.getTime() >= nextDayStart.getTime()) return null

  const clippedStartMs = Math.max(start.getTime(), dayStart.getTime())
  const clippedEndMs   = Math.min(end.getTime(), nextDayStart.getTime())
  return {
    startHour: (clippedStartMs - dayStart.getTime()) / 3_600_000,
    endHour:   (clippedEndMs   - dayStart.getTime()) / 3_600_000,
    spillover: start.getTime() < dayStart.getTime(),
  }
}

export interface RecurringBlockLike {
  id:           string
  title:        string
  start_time:   string
  end_time:     string
  days_of_week: number[]
  /** First date this template may render on (migration 081, 'yyyy-MM-dd').
   *  `undefined` = the column isn't there yet (pre-migration) — treated as
   *  "no lower bound", i.e. exactly the old behaviour, so the UI degrades
   *  to today's rendering instead of hiding every recurring block. */
  effective_from?: string | null
}

/** Local-time day shift on a 'yyyy-MM-dd' string. Deliberately NOT
 *  `toISOString().slice(0,10)` — that converts to UTC first, which lands on
 *  the wrong day for any timezone east of UTC during the evening. */
function shiftDayStr(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + delta)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Whether a template is allowed to produce an occurrence that STARTS on
 *  `dayStr`. 'yyyy-MM-dd' strings compare correctly lexicographically, so no
 *  Date parsing or timezone handling is involved. */
function isEffectiveOn(b: RecurringBlockLike, dayStr: string): boolean {
  return !b.effective_from || dayStr >= b.effective_from
}

/** Projects recurring schedule_blocks onto ONE calendar day (`dateStr`, whose
 *  weekday is `dayOfWeek`, 0=Sun…6=Sat). A template active on `dayOfWeek`
 *  contributes its normal occurrence, clipped at 24:00 if its own end_time
 *  crosses midnight (the overflow is projected again below, from the PREVIOUS
 *  weekday's own active-day check). A template active on the PREVIOUS weekday
 *  whose end_time crosses midnight contributes a spillover row for the portion
 *  that lands on `dateStr`.
 *
 *  `effective_from` (migration 081) is what stops a template rendering into
 *  the PAST — the real bug this parameter exists for: schedule_blocks had no
 *  date bounds at all, so a "weekdays 16:30" template created today
 *  back-filled every Mon-Fri in recorded history with a block that never
 *  happened. Both branches are gated, and the spillover branch is gated on
 *  the PREVIOUS day (the day that occurrence actually starts on) — not on
 *  `dateStr` — so a template effective from today never leaks a
 *  "continued from yesterday" tail onto its own first day. */
export function projectRecurringBlocksForDay(
  dateStr: string,
  dayOfWeek: number,
  scheduleBlocks: RecurringBlockLike[],
): ProjectedBlock[] {
  const out: ProjectedBlock[] = []
  const previousDayOfWeek = (dayOfWeek + 6) % 7
  const previousDateStr   = shiftDayStr(dateStr, -1)

  for (const b of scheduleBlocks) {
    const start = timeStrToHour(b.start_time)
    let end = timeStrToHour(b.end_time)
    if (end <= start) end += 24 // crosses midnight

    if (b.days_of_week.includes(dayOfWeek) && isEffectiveOn(b, dateStr)) {
      out.push({
        id: b.id, canonicalId: b.id, kind: 'recurring', title: b.title,
        startHour: start, endHour: Math.min(end, 24), taskId: null, spillover: false,
      })
    }
    if (end > 24 && b.days_of_week.includes(previousDayOfWeek) && isEffectiveOn(b, previousDateStr)) {
      out.push({
        id: `${b.id}__spillover`, canonicalId: b.id, kind: 'recurring', title: b.title,
        startHour: 0, endHour: Math.min(end - 24, 24), taskId: null, spillover: true,
      })
    }
  }

  return out
}
