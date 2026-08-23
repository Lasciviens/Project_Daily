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
 *  **ABSOLUTE — never bypassed, not even by `forceRecreate`.** A real
 *  sequence this closes: Reopen enqueues a `force_recreate` 'create', then
 *  (before it drains) the task gains a calendar-linked schedule and opts
 *  out — that 'create' must stay dead; `forceRecreate` only ever means
 *  "this specific id is known-stale", never "ignore the current opt-out".
 *
 *  Guard 2 — already created (re-processed after a partial earlier
 *  failure) — skip, don't duplicate. `forceRecreate` (migration 078's
 *  Reopen fix) bypasses ONLY this one: its google_task_id is a KNOWN-DEAD
 *  id (Google Tasks has no undelete) that must not be treated as "already
 *  created". A normal Reopen also happens to satisfy guard 1 on its own
 *  (un-cancelling sets google_sync_enabled TRUE in the same write) — this
 *  guard's bypass is what actually lets the recreate through. */
export function shouldSkipPendingCreate(task: PendingCreateGuardInput, forceRecreate: boolean): boolean {
  if (!task.google_sync_enabled) return true
  if (task.google_task_id && !forceRecreate) return true
  return false
}
