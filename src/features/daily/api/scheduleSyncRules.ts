// ─────────────────────────────────────────────────────────────────────────────
//  scheduleApi.ts's updateTimeBlock — PURE decision logic. Imports only
//  calendarApi.ts's typed error (itself import-free at runtime — its one
//  Supabase import is `import type`, erased by the compiler), so this stays
//  testable via sucrase without tripping client.ts's env-var guard.
// ─────────────────────────────────────────────────────────────────────────────

import { isCalendarNotFound } from '../../calendar/api/calendarApi'

// Whether a time_block is CONFIRMED to still have a live Google Calendar
// event, at a specific point in its lifecycle:
//   'linked'     — the remote event was verified/created/updated
//                   SUCCESSFULLY during this exact operation (or nothing
//                   needed pushing this call, so there's no new reason to
//                   doubt the existing record).
//   'not_linked' — no event exists, WITH CERTAINTY: never linked, an
//                   explicit unlink's remote delete + local clear both
//                   confirmed complete, or a remote push came back a real
//                   HTTP 404 AND the resulting stale-local-id cleanup write
//                   itself succeeded.
//   'unknown'    — the remote state is NOT confirmed either way: no
//                   Calendar token to check with, a network error, 401/403,
//                   429, 5xx, the local stale-id cleanup write itself
//                   failed, or a remote create succeeded but persisting its
//                   id locally (or compensating for a failed persistence)
//                   left the outcome ambiguous. A caller deciding whether
//                   it's safe to drop a task's OTHER Google representation
//                   (see needsGoogleTaskDedupe) or mint a fallback one (see
//                   needsGoogleTasksFallback) must NEVER act on 'unknown' as
//                   if it were a confirmed answer in either direction.
export type TimeBlockCalendarStatus = 'linked' | 'not_linked' | 'unknown'

/** Classifies a failed remote calendar-event push into 'not_linked' (a
 *  CONFIRMED 404 — the real HTTP status, never a string match against the
 *  error message) or 'unknown' (anything else: network, 401/403, 429,
 *  5xx, …). The caller is still responsible for actually clearing the
 *  stale local id on 'not_linked', and for downgrading to 'unknown' if
 *  THAT write itself fails — this function only classifies the remote
 *  outcome, not the local persistence step. */
export function classifyCalendarPushFailure(error: unknown): TimeBlockCalendarStatus {
  return isCalendarNotFound(error) ? 'not_linked' : 'unknown'
}
