// ─────────────────────────────────────────────────────────────────────────────
//  scheduleApi.ts's updateTimeBlock — PURE decision logic, deliberately
//  import-free (no supabase client, no React) so it's testable via sucrase
//  without tripping client.ts's env-var guard.
// ─────────────────────────────────────────────────────────────────────────────

// Whether a time_block is CONFIRMED to still have a live Google Calendar
// event after a remote push attempt:
//   'linked'     — confirmed still there (push succeeded, or nothing was
//                  pushed this call so there's no new reason to doubt it).
//   'not_linked' — no event at all (never linked, explicitly unlinked, OR
//                  just confirmed gone — a 404 clears the stale local id).
//   'unknown'    — the push failed WITHOUT a 404. The remote event is
//                  presumably still there — we simply couldn't confirm it
//                  — so the local id is deliberately left untouched. A
//                  caller deciding whether it's safe to drop a task's
//                  OTHER Google representation (see needsGoogleTaskDedupe)
//                  must treat this the same as "not confirmed linked" and
//                  never act on it as if it were a confirmed answer either way.
export type TimeBlockCalendarStatus = 'linked' | 'not_linked' | 'unknown'

/** Classifies a failed remote calendar-event push into the three-way
 *  status updateTimeBlock reports.
 *
 *  A confirmed 404 (the remote event was deleted directly in Google
 *  Calendar, outside this app) means genuinely gone — safe to clear the
 *  stale local id and report 'not_linked', so a future save creates a
 *  fresh event instead of repeatedly failing against a dead one.
 *
 *  Any OTHER failure (network, rate limit, an expired token, …) means we
 *  simply couldn't confirm anything — the event is presumably still fine.
 *  This must NEVER be treated the same as a confirmed 404: doing so is
 *  what let editing a calendar-linked task delete its Google Task
 *  (needsGoogleTaskDedupe) on a mere network hiccup, leaving NEITHER
 *  Google representation. */
export function classifyCalendarPushFailure(errorMessage: string): TimeBlockCalendarStatus {
  return errorMessage.includes('404') ? 'not_linked' : 'unknown'
}
