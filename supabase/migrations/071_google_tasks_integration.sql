-- ═══════════════════════════════════════════════════════════════════════════
-- Google Tasks full-surface integration — Phase 1A (schema + sync plumbing).
-- Verified against the live Tasks API v1 discovery document (not secondhand
-- summaries): parent/position are output-only (set only via tasks.move),
-- there is no push/webhook mechanism (polling only), showCompleted defaults
-- true, hidden means "was completed when the list was cleared" (NOT a
-- deletion), deleted is the real tombstone.
--
-- Three pieces:
--   A. google_task_lists — one row per Google Task list (multiple-list
--      support is data-model-only in this phase; list-picker UI is Phase 2).
--   B. tasks — new columns for the fields Google's Task resource has that we
--      had no home for (parent/subtask, position, etag, completed_at,
--      webViewLink, links, hidden/deleted tombstones) + google_local_edit_at,
--      a dedicated "did a Google-synced field change locally" clock that is
--      NOT tasks.updated_at (that one is bumped by local-only fields too —
--      sort_order, is_focused, section, priority, domain, waiting_for — none
--      of which Google Tasks has any concept of).
--   C. google_tasks_outbox — a durable queue of pending Google-side writes,
--      enqueued by a trigger in the SAME transaction as the tasks mutation
--      (atomic by construction, not by app-code discipline). A write that
--      originates FROM a Google pull (not a local edit) must never re-enqueue
--      itself — that's what the app.google_sync_write session flag prevents;
--      any code path applying Google's own data to a task must go through
--      apply_google_task_snapshot() below, never a bare UPDATE, or this
--      guarantee breaks silently.
--   D. google_task_status_bucket() collapses our 5-value status enum to what
--      Google actually distinguishes (needsAction/completed/none), so a
--      local-only transition (open↔in_progress↔waiting) never bumps the
--      sync clock, while done↔open and cancelled↔anything (delete/recreate,
--      since Google has no "cancelled") correctly do.
--   E/F. Two triggers do the real work: a BEFORE trigger stamps
--      google_local_edit_at only on a Google-visible change, an AFTER
--      trigger reads that stamp and enqueues the right outbox operation —
--      gated throughout on google_sync_enabled, the single canonical flag
--      for "should this task sync to Google" (replaces the old inline
--      skipGoogleTasks check; see its column comment for why one flag beats
--      two opposite-sense ones).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. google_task_lists ──────────────────────────────────────────────────
-- Google's own TaskList resource carries no "is this the default list" flag;
-- is_default is resolved and stamped by app code (GET .../lists/@default,
-- match its real id against this table) — never inferred from google_id
-- looking like the literal string "@default".
CREATE TABLE public.google_task_lists (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  google_id         TEXT        NOT NULL,
  title             TEXT        NOT NULL,
  is_default        BOOLEAN     NOT NULL DEFAULT false,
  google_etag       TEXT,
  google_updated_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, google_id)
);

ALTER TABLE public.google_task_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY google_task_lists_owner ON public.google_task_lists
  FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE TRIGGER trg_google_task_lists_updated_at
  BEFORE UPDATE ON public.google_task_lists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- No trg_audit here — synced external metadata (Google's own list titles),
-- same bulk-sync exemption as hevy_*/health_* tables, not user-authored
-- content worth an audit trail entry per edit.

-- ── B. tasks — new columns ──────────────────────────────────────────────────
ALTER TABLE public.tasks
  ADD COLUMN google_tasklist_id   UUID REFERENCES public.google_task_lists(id) ON DELETE SET NULL,
  ADD COLUMN parent_task_id       UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  ADD COLUMN completed_at         TIMESTAMPTZ,
  ADD COLUMN google_position      TEXT,
  ADD COLUMN google_etag          TEXT,
  ADD COLUMN google_updated_at    TIMESTAMPTZ,
  ADD COLUMN google_web_view_link TEXT,
  ADD COLUMN google_links         JSONB,
  ADD COLUMN google_hidden        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN google_deleted       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN google_local_edit_at TIMESTAMPTZ,
  ADD COLUMN google_sync_enabled  BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tasks.google_sync_enabled IS
  'ONE canonical flag for "is this task under Google Tasks sync" — deliberately not two opposite-sense booleans (a skip flag AND an enabled flag would drift apart). false covers both a plain local-only task (Google never connected, or connected but this task hasn''t been offered to Google yet) and a task deliberately excluded because it is represented as a linked Google Calendar EVENT instead (useCreateTask''s skipGoogleTasks param — via its time block, never both, or it duplicates in Google). true means this task is meant to be (or already is) synced as a real Google Task. Set once by app code at INSERT time from the same decision skipGoogleTasks made before (token present AND not calendar-linked); never flipped afterward by a pull — a bulk import setting this row from a real Google task should also set it true, since by definition that row IS synced.';

-- Existing rows that already carry a google_task_id (created before this
-- migration, back when app code called Google directly on every mutation)
-- are, by definition, already under sync — backfill them to true so the new
-- trigger-driven enqueue logic doesn't silently stop syncing tasks that were
-- working fine a moment ago.
UPDATE public.tasks SET google_sync_enabled = true WHERE google_task_id IS NOT NULL;

COMMENT ON COLUMN public.tasks.google_local_edit_at IS
  'Bumped only when a Google-synced field (title/description/due_date/status/parent_task_id/google_tasklist_id) changes via a real local edit — never by tasks.updated_at''s broader trigger, which also fires for local-only fields Google Tasks has no concept of (sort_order, is_focused, section, priority, domain, waiting_for). This is the clock conflict resolution compares against Google''s own "updated" timestamp (google_updated_at).';

COMMENT ON COLUMN public.tasks.google_hidden IS
  'True only means "was completed when the Google Tasks list was last cleared" (tasks.clear). Never cascades into local status — a hidden task is still done, just no longer returned by default from Google''s list. Only google_deleted triggers a local status change.';

CREATE INDEX tasks_user_parent         ON public.tasks (user_id, parent_task_id);
CREATE INDEX tasks_user_google_tasklist ON public.tasks (user_id, google_tasklist_id);

-- ── C. google_tasks_outbox ──────────────────────────────────────────────────
-- A row's mere existence means "pending" — success deletes the row, so no
-- separate status column is needed. attempts/next_retry_at/last_error exist
-- for the Phase 3 cron drainer's backoff; Phase 1's manual Push button drains
-- unconditionally (ignores next_retry_at) since a human just asked for it.
CREATE TABLE public.google_tasks_outbox (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  task_id       UUID        NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  operation     TEXT        NOT NULL CHECK (operation IN ('create', 'update', 'delete')),
  payload       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  attempts      INTEGER     NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.google_tasks_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY google_tasks_outbox_owner ON public.google_tasks_outbox
  FOR ALL
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE INDEX google_tasks_outbox_pending ON public.google_tasks_outbox (user_id, next_retry_at);
CREATE INDEX google_tasks_outbox_task    ON public.google_tasks_outbox (task_id);

CREATE TRIGGER trg_google_tasks_outbox_updated_at
  BEFORE UPDATE ON public.google_tasks_outbox
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- No trg_audit — a transient work queue, not user-authored content; the
-- underlying tasks row already carries its own audit trail.

-- ── D. google_task_status_bucket — collapse our 5-value status enum down to
-- what Google Tasks actually distinguishes. Google only knows
-- needsAction/completed; local transitions that don't cross a bucket
-- boundary (open ↔ in_progress ↔ waiting) are invisible to Google and must
-- NOT be treated as a sync-worthy edit. 'cancelled' has no Google analogue
-- at all — the closest honest mapping is "shouldn't exist there", which is
-- what drives the delete-on-cancel / recreate-on-uncancel logic below.
CREATE OR REPLACE FUNCTION public.google_task_status_bucket(p_status TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_status = 'done'      THEN 'completed'
    WHEN p_status = 'cancelled' THEN 'none'
    ELSE 'needsAction'
  END
$$;

-- ── E. Trigger 1 (BEFORE): stamp google_local_edit_at on real local edits ──
-- Runs before the AFTER outbox trigger so the latter can just check whether
-- this stamp moved, instead of re-deriving the same "did a synced field
-- change" condition a second time (single source of truth for that check).
CREATE OR REPLACE FUNCTION public.stamp_google_local_edit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- A write applying Google's own pulled/reconciled data is not a local
  -- edit — never stamp it, or every pull would look like a fresh local
  -- change and re-queue itself back to Google.
  IF current_setting('app.google_sync_write', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.google_local_edit_at := now();
    RETURN NEW;
  END IF;

  IF NEW.title              IS DISTINCT FROM OLD.title
     OR NEW.description     IS DISTINCT FROM OLD.description
     OR NEW.due_date         IS DISTINCT FROM OLD.due_date
     OR NEW.parent_task_id   IS DISTINCT FROM OLD.parent_task_id
     OR NEW.google_tasklist_id IS DISTINCT FROM OLD.google_tasklist_id
     -- Only a status change that crosses a Google-visible bucket boundary
     -- counts — open→in_progress or in_progress→waiting are both
     -- 'needsAction' on both sides and must NOT bump this clock.
     OR public.google_task_status_bucket(NEW.status) IS DISTINCT FROM public.google_task_status_bucket(OLD.status) THEN
    NEW.google_local_edit_at := now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_stamp_google_local_edit
  BEFORE INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.stamp_google_local_edit();

-- ── F. Trigger 2 (AFTER): enqueue the outbox row, atomically ───────────────
-- Payload is populated for readability/debugging on every op, but is only
-- authoritative for 'delete' (the row is gone by the time drain code runs,
-- so google_task_id MUST be snapshotted here). For 'create'/'update' the
-- drain step re-reads the live tasks row instead of trusting this payload —
-- that avoids staleness if the task is edited again before the outbox item
-- is processed (no need to keep every pending row's payload in sync).
CREATE OR REPLACE FUNCTION public.enqueue_google_tasks_outbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.google_sync_write', true) = 'true' THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.google_task_id IS NOT NULL AND OLD.google_sync_enabled IS TRUE THEN
      INSERT INTO public.google_tasks_outbox (user_id, task_id, operation, payload)
      VALUES (OLD.user_id, OLD.id, 'delete', jsonb_build_object('google_task_id', OLD.google_task_id));
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A fresh local task needs creating on the Google side only when the
    -- app opted it in (google_sync_enabled — see its column comment). A row
    -- that originates FROM Google already returned above via the session
    -- flag guard, before ever reaching this branch.
    IF NEW.google_sync_enabled IS TRUE THEN
      INSERT INTO public.google_tasks_outbox (user_id, task_id, operation, payload)
      VALUES (NEW.user_id, NEW.id, 'create', jsonb_build_object(
        'title', NEW.title, 'notes', NEW.description, 'due_date', NEW.due_date,
        'parent_task_id', NEW.parent_task_id, 'google_tasklist_id', NEW.google_tasklist_id
      ));
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: trg_stamp_google_local_edit already decided whether a
  -- Google-visible field changed (bucket-aware for status) — reuse that
  -- instead of re-checking the same condition here.
  IF NEW.google_local_edit_at IS DISTINCT FROM OLD.google_local_edit_at
     AND NEW.google_sync_enabled IS TRUE THEN

    IF public.google_task_status_bucket(NEW.status) = 'none'
       AND public.google_task_status_bucket(OLD.status) <> 'none'
       AND NEW.google_task_id IS NOT NULL THEN
      -- Cancelled: Google has no "cancelled" state, so the honest mapping is
      -- to remove it there (mirrors 047's local soft-cancel philosophy —
      -- the LOCAL row stays, reversible; only the Google-side copy goes).
      INSERT INTO public.google_tasks_outbox (user_id, task_id, operation, payload)
      VALUES (NEW.user_id, NEW.id, 'delete', jsonb_build_object('google_task_id', NEW.google_task_id));

    ELSIF public.google_task_status_bucket(OLD.status) = 'none'
          AND public.google_task_status_bucket(NEW.status) <> 'none' THEN
      -- Un-cancelled: whatever Google task existed before is gone for good
      -- (Tasks API has no undelete) — recreate fresh rather than try to
      -- resurrect a dead id. Drain must overwrite google_task_id, not merge.
      INSERT INTO public.google_tasks_outbox (user_id, task_id, operation, payload)
      VALUES (NEW.user_id, NEW.id, 'create', jsonb_build_object(
        'title', NEW.title, 'notes', NEW.description, 'due_date', NEW.due_date,
        'parent_task_id', NEW.parent_task_id, 'google_tasklist_id', NEW.google_tasklist_id
      ));

    ELSIF NEW.google_task_id IS NOT NULL THEN
      INSERT INTO public.google_tasks_outbox (user_id, task_id, operation, payload)
      VALUES (NEW.user_id, NEW.id, 'update', jsonb_build_object(
        'title', NEW.title, 'notes', NEW.description, 'due_date', NEW.due_date,
        'status', NEW.status, 'parent_task_id', NEW.parent_task_id,
        'google_tasklist_id', NEW.google_tasklist_id,
        -- prev_* values exist ONLY here — unlike title/notes/due (re-read live
        -- by drain code), "what it moved FROM" is a delta this row is the
        -- sole record of, so it must be captured now, not re-derived later.
        'prev_google_tasklist_id', OLD.google_tasklist_id,
        'prev_parent_task_id', OLD.parent_task_id
      ));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enqueue_google_tasks_outbox
  AFTER INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_google_tasks_outbox();

-- ── G. apply_google_task_snapshot — the ONLY sanctioned way to write ───────
-- Google-origin data into tasks. Sets the session flag so triggers E/F don't
-- treat this as a local edit, then applies Google's fields. Content fields
-- (title/notes/due_date/status/parent_task_id) are skipped whenever an
-- outbox row for this task is still pending — a local edit hasn't reached
-- Google yet, so pulling Google's (stale, pre-edit) copy back over it would
-- silently revert the user's own change. Metadata Google exclusively owns
-- (etag/position/webViewLink/hidden/deleted/updated) is always applied —
-- none of it is user-editable locally, so there is nothing to clobber.
--
-- p_content is NULL when the caller only has metadata to apply (e.g. a
-- tombstone-only reconciliation pass) — content fields are left untouched.
CREATE OR REPLACE FUNCTION public.apply_google_task_snapshot(
  p_task_id            UUID,
  p_google_task_id     TEXT,
  p_google_updated_at  TIMESTAMPTZ,
  p_google_etag        TEXT        DEFAULT NULL,
  p_google_position    TEXT        DEFAULT NULL,
  p_google_web_view_link TEXT      DEFAULT NULL,
  p_google_links       JSONB       DEFAULT NULL,
  p_google_hidden      BOOLEAN     DEFAULT NULL,
  p_google_deleted     BOOLEAN     DEFAULT NULL,
  p_content            JSONB       DEFAULT NULL  -- {title, notes, due_date, status, completed_at, parent_task_id}
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_pending BOOLEAN;
BEGIN
  PERFORM set_config('app.google_sync_write', 'true', true);

  SELECT EXISTS (
    SELECT 1 FROM public.google_tasks_outbox
     WHERE task_id = p_task_id AND user_id = (SELECT auth.uid())
  ) INTO v_has_pending;

  UPDATE public.tasks SET
    google_task_id       = COALESCE(p_google_task_id, google_task_id),
    google_updated_at    = p_google_updated_at,
    google_etag          = COALESCE(p_google_etag, google_etag),
    google_position      = COALESCE(p_google_position, google_position),
    google_web_view_link = COALESCE(p_google_web_view_link, google_web_view_link),
    google_links         = COALESCE(p_google_links, google_links),
    google_hidden        = COALESCE(p_google_hidden, google_hidden),
    -- deleted=true always soft-cancels regardless of pending edits — a
    -- task removed on the Google side is gone from that surface no matter
    -- what the local text said; the row survives locally (soft, reversible).
    status = CASE
      WHEN p_google_deleted IS TRUE AND status <> 'cancelled' THEN 'cancelled'
      WHEN NOT v_has_pending AND p_content IS NOT NULL AND p_content ? 'status'
        THEN p_content ->> 'status'
      ELSE status
    END,
    google_deleted = COALESCE(p_google_deleted, google_deleted),
    title       = CASE WHEN NOT v_has_pending AND p_content IS NOT NULL AND p_content ? 'title'
                        THEN p_content ->> 'title' ELSE title END,
    description = CASE WHEN NOT v_has_pending AND p_content IS NOT NULL AND p_content ? 'notes'
                        THEN p_content ->> 'notes' ELSE description END,
    due_date    = CASE WHEN NOT v_has_pending AND p_content IS NOT NULL AND p_content ? 'due_date'
                        THEN (p_content ->> 'due_date')::date ELSE due_date END,
    completed_at = CASE WHEN NOT v_has_pending AND p_content IS NOT NULL AND p_content ? 'completed_at'
                        THEN (p_content ->> 'completed_at')::timestamptz ELSE completed_at END,
    -- parent_task_id is resolved by the CALLER (two-pass google_id→local uuid
    -- mapping happens in application code, not SQL) and passed pre-resolved.
    parent_task_id = CASE WHEN NOT v_has_pending AND p_content IS NOT NULL AND p_content ? 'parent_task_id'
                        THEN (p_content ->> 'parent_task_id')::uuid ELSE parent_task_id END
  WHERE id = p_task_id AND user_id = (SELECT auth.uid());
END;
$$;
