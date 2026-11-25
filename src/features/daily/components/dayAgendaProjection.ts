// ─────────────────────────────────────────────────────────────────────────────
//  DayAgenda — PURE day-projection logic: no supabase client, no React (its
//  one import, recurrence.ts, is pure too) so it's testable via sucrase
//  without tripping client.ts's env-var guard.
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

import { addDaysIso, occursOn, type RepeatRule } from '../recurrence'

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

export interface RecurringBlockLike extends RepeatRule {
  id:           string
  title:        string
  /** null: a repeat with no time ("water the plants every Sunday", 155) —
   *  it occurs on its days as an anytime row (-1/-1) and never spills. */
  start_time:   string | null
  /** null with a start: "at 14:00", no length — a moment, never a span. */
  end_time:     string | null
  // days_of_week / repeat_* / effective_from / except_dates: the repeat rule
  // (recurrence.ts). A missing effective_from (before 081) or except_dates
  // (before 142) is no bound and no day left out — the old behaviour.
}

/** Projects recurring schedule_blocks onto ONE calendar day (`dateStr`,
 *  'yyyy-MM-dd'). A template that occurs on `dateStr` (recurrence.occursOn —
 *  its kind, effective_from and except_dates) contributes its normal
 *  occurrence, clipped at 24:00 if its own end_time crosses midnight. A
 *  template that occurs on the PREVIOUS day and crosses midnight contributes
 *  a spillover row for the portion that lands on `dateStr`.
 *
 *  `effective_from` (migration 081) is what stops a template rendering into
 *  the PAST — schedule_blocks had no date bounds at all, so a "weekdays
 *  16:30" template created today back-filled every Mon-Fri in recorded
 *  history. The spillover is asked about the PREVIOUS day (the day that
 *  occurrence actually starts on) — not `dateStr` — so a template effective
 *  from today never leaks a "continued from yesterday" tail onto its own
 *  first day, and a day taken out (except_dates) takes its tail with it. */
export function projectRecurringBlocksForDay(
  dateStr: string,
  scheduleBlocks: readonly RecurringBlockLike[],
): ProjectedBlock[] {
  const out: ProjectedBlock[] = []
  const previousDateStr = addDaysIso(dateStr, -1)

  for (const b of scheduleBlocks) {
    if (!b.start_time) {
      if (occursOn(b, dateStr)) {
        out.push({ id: b.id, canonicalId: b.id, kind: 'recurring', title: b.title, startHour: -1, endHour: -1, taskId: null, spillover: false })
      }
      continue
    }
    const start = timeStrToHour(b.start_time)
    let end = b.end_time ? timeStrToHour(b.end_time) : start
    if (b.end_time && end <= start) end += 24 // crosses midnight

    if (occursOn(b, dateStr)) {
      out.push({
        id: b.id, canonicalId: b.id, kind: 'recurring', title: b.title,
        startHour: start, endHour: Math.min(end, 24), taskId: null, spillover: false,
      })
    }
    if (end > 24 && occursOn(b, previousDateStr)) {
      out.push({
        id: `${b.id}__spillover`, canonicalId: b.id, kind: 'recurring', title: b.title,
        startHour: 0, endHour: Math.min(end - 24, 24), taskId: null, spillover: true,
      })
    }
  }

  return out
}
