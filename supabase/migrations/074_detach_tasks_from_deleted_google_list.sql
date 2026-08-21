-- ═══════════════════════════════════════════════════════════════════════════
-- Fix a real semantic bug in migration 073's stale-list reconcile (found in
-- review): deleting the local google_task_lists row for a list removed on
-- Google's side relied on ON DELETE SET NULL to clear tasks.google_tasklist_id
-- — but left tasks.google_task_id INTACT. That combination (a real
-- google_task_id, but google_tasklist_id = NULL) is actively broken:
-- resolveGoogleListId(null) falls back to '@default', so the next edit would
-- PATCH /lists/@default/tasks/<id> — a task id that only ever existed inside
-- the NOW-DELETED list, never in @default. Google 404s every time.
--
-- Root cause: a Task has no identity independent of its list in this API —
-- every endpoint addresses one via /lists/{tasklist}/tasks/{task} — so when
-- the list is gone, so is every regular task inside it (the discovery
-- document only spells this out for the "assigned tasks" edge case, but the
-- API has no mechanism to leave a task addressable with no list at all).
--
-- Fix: before a stale list's local row is deleted, detach every task that
-- belonged to it — clear google_task_id/google_tasklist_id/google_sync_enabled
-- together, never just one. This is the SAFEST reconcile policy of the three
-- considered (clear linkage / cancel the task / silently re-create
-- elsewhere): the task survives locally exactly as visible as before, simply
-- no longer tracked on Google — no surprise re-creation, no presumptive
-- cancellation of a task the user may still want. A future "Push" action
-- naturally re-syncs it (google_sync_enabled: false → true is already the
-- documented re-create trigger from migration 071).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.detach_tasks_from_deleted_google_list(
  p_google_tasklist_id UUID,
  p_user_id            UUID DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.google_sync_write', 'true', true);
  UPDATE public.tasks SET
    google_task_id       = NULL,
    google_tasklist_id   = NULL,
    google_sync_enabled  = false,
    google_etag          = NULL,
    google_position      = NULL,
    google_web_view_link = NULL,
    google_updated_at    = NULL,
    -- Full reset, not just the identity fields — a detached task is meant
    -- to read as a plain local-only task with no trace of ever having been
    -- on Google, not one carrying stale hidden/deleted/links metadata from
    -- a Google list that no longer exists.
    google_links          = NULL,
    google_hidden         = false,
    google_deleted        = false
  WHERE google_tasklist_id = p_google_tasklist_id
    AND user_id = public.effective_user_id(p_user_id);
END;
$$;
