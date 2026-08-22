// ─────────────────────────────────────────────────────────────────────────────
//  Google Tasks outbox — PURE decision logic, deliberately import-free (no
//  supabase client, no React) so it's testable via sucrase without tripping
//  client.ts's env-var guard. Both processCreate implementations — this
//  file's browser drain (googleTasksOutbox.ts) and the google-tasks-sync
//  edge function's self-contained duplicate (Deno can't share this file per
//  the repo's "no _shared/" convention — keep them in lockstep by hand) —
//  apply the exact same two guards, in this exact order.
// ─────────────────────────────────────────────────────────────────────────────

export interface PendingCreateGuardInput {
  google_sync_enabled: boolean
  google_task_id: string | null
}

/** Whether a 'create' outbox row should be skipped (a clean no-op — the
 *  outer drain loop still deletes the row) rather than actually creating a
 *  Google Task.
 *
 *  Guard 1 — opted back OUT since this row was enqueued (e.g. the task
 *  gained a calendar-linked schedule instead, via UnifiedPlanModal's
 *  needsGoogleTaskDedupe). Real bug this closes: a 'create' enqueued before
 *  the opt-out, with google_task_id still NULL, had nothing for the DB
 *  trigger's own opt-out delete-branch to act on (that branch only fires
 *  when OLD.google_task_id IS NOT NULL) — without this check it would fire
 *  anyway and put the task back on Google as an unwanted duplicate.
 *
 *  Guard 2 — already created (re-processed after a partial earlier
 *  failure) — skip, don't duplicate.
 *
 *  `forceRecreate` (migration 078's Reopen fix) bypasses BOTH: an
 *  un-cancel always sets google_sync_enabled TRUE in the same write (so
 *  guard 1 never actually excludes it — kept explicit for clarity and so
 *  the two guards' ordering is never accidentally swapped), and its
 *  google_task_id is a KNOWN-DEAD id (Google Tasks has no undelete) that
 *  guard 2 must not treat as "already created". */
export function shouldSkipPendingCreate(task: PendingCreateGuardInput, forceRecreate: boolean): boolean {
  if (!task.google_sync_enabled && !forceRecreate) return true
  if (task.google_task_id && !forceRecreate) return true
  return false
}
