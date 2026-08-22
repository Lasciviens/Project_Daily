-- ═══════════════════════════════════════════════════════════════════════════
-- Reopen (uncancel) never actually re-created the task on Google — real bug.
--
-- migration 071's "Un-cancelled" branch of enqueue_google_tasks_outbox()
-- correctly enqueues a fresh 'create' outbox row when a cancelled task is
-- reopened (Google Tasks has no undelete, so a full recreate is the only
-- honest option) — but it left the STALE google_task_id sitting on the row.
-- Both drain implementations (the browser's googleTasksOutbox.ts and the
-- google-tasks-sync cron edge function) guard processCreate() with
-- `if (task.google_task_id) return` — a genuinely correct guard for its
-- ORIGINAL purpose (skip re-creating a task whose create already succeeded,
-- e.g. after a partial earlier failure) — but that guard can't tell "already
-- created, retry-safe to skip" apart from "reopened, this id is dead and
-- MUST be replaced", so it silently swallowed every reopen. Confirmed live:
-- a task cancelled after its Google Task was deleted server-side, then
-- reopened via the ↺ action, enqueued a real 'create' row that the drain
-- then did nothing with — the task never came back on Google.
--
-- Fix: the un-cancelled branch now stamps the outbox payload with
-- `force_recreate: true`. Both drain implementations check this flag and
-- proceed even when a (now-known-stale) google_task_id is present, instead
-- of bailing out. Every other 'create' row (no force_recreate key) keeps the
-- exact same idempotency guard as before — this does not touch normal retry
-- behavior at all.
--
-- Second real bug, found reviewing this migration again before it ever went
-- live: the SAME `force_recreate` mechanism is also what the opt-IN branch
-- (further down) needed and didn't have. See that branch's own comment —
-- opting back in while an earlier opt-out's 'delete' row is still
-- outstanding used to enqueue nothing at all.
-- ═══════════════════════════════════════════════════════════════════════════

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
      VALUES (OLD.user_id, OLD.id, 'delete', jsonb_build_object(
        'google_task_id', OLD.google_task_id, 'google_tasklist_id', OLD.google_tasklist_id
      ));
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

  -- UPDATE, newly opted in (the "Push" catch-up action turning sync on for a
  -- task created before Google was connected): needs a fresh create
  -- regardless of google_local_edit_at — flipping google_sync_enabled isn't
  -- itself a content edit, so the BEFORE trigger never bumped that clock.
  --
  -- Real race fixed (found reviewing this migration a second time): this
  -- branch used to require NEW.google_task_id IS NULL. But a row that was
  -- JUST opted out (the branch below this one enqueues a 'delete' for its
  -- current google_task_id — WITHOUT clearing that column locally; only
  -- the drain's own clear_google_task_id_if_matches does that, once the
  -- delete actually runs) still HAS a non-null google_task_id until that
  -- delete drains. Opting back in before it drains hit this branch's
  -- `IS NULL` guard and enqueued NOTHING — the task ended up
  -- google_sync_enabled=true with a google_task_id that's either about to
  -- be cleared (delete lands) or already stale, and no create was ever
  -- queued to replace it. Fixed: enqueue a create on EVERY opt-in
  -- transition, not just when google_task_id happens to be NULL, stamping
  -- `force_recreate: true` whenever a task_id is still present (migration
  -- 079's per-task FIFO claim guarantees any earlier pending 'delete' for
  -- this SAME task drains first — force_recreate is what then lets THIS
  -- create proceed once that delete has cleared the id, or immediately if
  -- it hadn't been set to begin with).
  IF NEW.google_sync_enabled IS TRUE AND OLD.google_sync_enabled IS NOT TRUE THEN
    INSERT INTO public.google_tasks_outbox (user_id, task_id, operation, payload)
    VALUES (NEW.user_id, NEW.id, 'create', jsonb_build_object(
      'title', NEW.title, 'notes', NEW.description, 'due_date', NEW.due_date,
      'parent_task_id', NEW.parent_task_id, 'google_tasklist_id', NEW.google_tasklist_id,
      'force_recreate', NEW.google_task_id IS NOT NULL
    ));
    RETURN NEW;
  END IF;

  -- UPDATE, newly opted OUT (e.g. a task that gains a linked Google Calendar
  -- event and must drop its now-redundant Google Task copy — "one task = ONE
  -- Google entry"): remove it from Google. Independent of google_local_edit_at
  -- for the same reason as the opt-in branch above.
  IF NEW.google_sync_enabled IS NOT TRUE AND OLD.google_sync_enabled IS TRUE AND OLD.google_task_id IS NOT NULL THEN
    INSERT INTO public.google_tasks_outbox (user_id, task_id, operation, payload)
    VALUES (NEW.user_id, NEW.id, 'delete', jsonb_build_object(
      'google_task_id', OLD.google_task_id, 'google_tasklist_id', OLD.google_tasklist_id
    ));
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
      VALUES (NEW.user_id, NEW.id, 'delete', jsonb_build_object(
        'google_task_id', NEW.google_task_id, 'google_tasklist_id', NEW.google_tasklist_id
      ));

    ELSIF public.google_task_status_bucket(OLD.status) = 'none'
          AND public.google_task_status_bucket(NEW.status) <> 'none' THEN
      -- Un-cancelled: whatever Google task existed before is gone for good
      -- (Tasks API has no undelete) — recreate fresh rather than try to
      -- resurrect a dead id. force_recreate=true is what actually makes the
      -- drain overwrite a stale google_task_id instead of skipping (see this
      -- migration's header comment — this is the real fix, migration 071's
      -- own comment claiming "drain must overwrite" was never implemented).
      INSERT INTO public.google_tasks_outbox (user_id, task_id, operation, payload)
      VALUES (NEW.user_id, NEW.id, 'create', jsonb_build_object(
        'title', NEW.title, 'notes', NEW.description, 'due_date', NEW.due_date,
        'parent_task_id', NEW.parent_task_id, 'google_tasklist_id', NEW.google_tasklist_id,
        'force_recreate', true
      ));

    ELSIF NEW.google_task_id IS NOT NULL THEN
      INSERT INTO public.google_tasks_outbox (user_id, task_id, operation, payload)
      VALUES (NEW.user_id, NEW.id, 'update', jsonb_build_object(
        'title', NEW.title, 'notes', NEW.description, 'due_date', NEW.due_date,
        'status', NEW.status, 'parent_task_id', NEW.parent_task_id,
        'google_tasklist_id', NEW.google_tasklist_id,
        'prev_google_tasklist_id', OLD.google_tasklist_id,
        'prev_parent_task_id', OLD.parent_task_id
      ));
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
