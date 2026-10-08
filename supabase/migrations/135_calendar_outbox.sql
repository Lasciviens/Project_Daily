-- ═══════════════════════════════════════════════════════════════════════════
-- Calendar outbox — a deleted time block's Google Calendar event is removed
-- even when the block was deleted on the server.
--
-- The gap: time_blocks.google_calendar_event_id (migration 038) is the ONLY
-- pointer to a block's Google Calendar event. The browser removes the event
-- before it deletes a block (scheduleApi.deleteTimeBlock, tasksApi.deleteTask
-- → calendarTokenSync.ensureLinkedCalendarEventRemoved), but every delete made
-- on the server runs with no Google token at all: ai-proxy's db_delete on
-- tasks or time_blocks, the four Hevy functions closing a planned-session
-- task, the tasks → time_blocks ON DELETE CASCADE (migration 077), migration
-- 043's cleanup triggers (an episode marked watched, a project item deleted)
-- and a plain SQL delete. The row and its pointer vanished, and the event
-- stayed on the calendar forever.
--
-- The fix, in the Google Tasks outbox's shape (migration 071):
--   A. calendar_outbox — one row per event still to remove. It keeps the
--      calendar and the event id itself, because the block that knew them is
--      gone by the time anything reads the row.
--   B. An AFTER DELETE row trigger on time_blocks queues the block's event.
--      Row-level triggers also fire for rows removed by a foreign-key cascade,
--      so every door above is covered without touching any of them (the
--      migration-043 principle: a rule that must hold for every writer lives
--      in the database). The trigger only QUEUES — it has no Google token,
--      which is why Calendar calls never ran in triggers before either. It
--      also queues the browser's own deletes (the database can't tell that the
--      browser already removed the event); the drain reads Google's 404/410
--      for those as "already gone".
--   C. google-tasks-sync (pg_cron every 20 minutes, migration 072) holds the
--      same unified Google refresh token (calendar-oauth's consent includes
--      calendar.events) and, using the service role (RLS bypassed, every query
--      scoped to the user explicitly), deletes each queued event: 2xx/404/410
--      remove the row, 401/403/429 stop that run, anything else backs the row
--      off on the Tasks outbox's curve. It never deletes an event a live time
--      block still points at (a block put back after its delete, an id two
--      blocks share). Rules: src/features/calendar/calendarOutboxRules.ts.
--
-- Calendar id: every path that links an event creates it in the user's
-- PRIMARY calendar (UnifiedPlanModal.linkCalendarEvent; updateTimeBlock and
-- ensureLinkedCalendarEventRemoved address the same 'primary'), and
-- time_blocks has no calendar column — so the trigger queues 'primary'. A
-- future path that links an event in another calendar must store that
-- calendar on time_blocks and have the trigger read it;
-- scripts/verify-calendar-outbox.cjs fails while the two disagree.
--
-- One row per (user, calendar, event): queuing an event that is already
-- waiting is a no-op. No claim column and no per-item ordering (unlike 073 /
-- 079 for the Tasks outbox): the unique key allows one row per event and the
-- only operation is a delete, which is idempotent — two drains that overlap at
-- worst both ask Google to delete the same event, and the second reads
-- 404/410 as done. A duplicated CREATE, the case 073 exists for, can't happen.
--
-- RLS: the owner may read; nothing writes from the browser. Only the SECURITY
-- DEFINER trigger and the service-role drain write this table — a row the
-- browser could insert would make the server delete whatever event it names
-- (scrape_decisions follows the same rule, migration 104). No trg_audit: a
-- transient work queue, like google_tasks_outbox — the deleted block's own
-- audit_logs row already records the delete. Not in ai-proxy's DB_CATALOG:
-- the AI must never write the queue, and there is nothing in it to ask about.
-- No browser fallback is needed: no client code reads it, and the drain skips
-- quietly while this migration is not applied.
--
-- Additive: one table, one trigger function, one trigger. Updates no existing
-- row and queues nothing for blocks deleted before it was applied. Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. calendar_outbox ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.calendar_outbox (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  calendar_id   TEXT        NOT NULL DEFAULT 'primary',
  event_id      TEXT        NOT NULL,
  operation     TEXT        NOT NULL DEFAULT 'delete' CHECK (operation IN ('delete')),
  -- The block whose delete queued this row, for tracing only — no FK: the
  -- row is already gone when the trigger writes this (the same reason
  -- google_tasks_outbox.task_id has none).
  time_block_id UUID,
  -- What the block said (title, date, start time), so a stuck row is
  -- recognisable without the block.
  payload       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  attempts      INTEGER     NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT calendar_outbox_event_key UNIQUE (user_id, calendar_id, event_id)
);

ALTER TABLE public.calendar_outbox ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'calendar_outbox'
      AND policyname = 'Users read own calendar_outbox'
  ) THEN
    CREATE POLICY "Users read own calendar_outbox"
      ON public.calendar_outbox
      FOR SELECT
      USING ((select auth.uid()) = user_id);
  END IF;
END $$;

-- The drain: this user's rows whose retry time has come, oldest first.
CREATE INDEX IF NOT EXISTS calendar_outbox_pending ON public.calendar_outbox (user_id, next_retry_at);

DROP TRIGGER IF EXISTS trg_calendar_outbox_updated_at ON public.calendar_outbox;
CREATE TRIGGER trg_calendar_outbox_updated_at
  BEFORE UPDATE ON public.calendar_outbox
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.calendar_outbox IS
  'Google Calendar events still to delete because their time block was deleted (migration 135). Written only by trg_enqueue_calendar_event_delete; drained by the google-tasks-sync edge function, which removes a row once Google answers 2xx/404/410.';

-- ── B. The trigger ──────────────────────────────────────────────────────────
-- SECURITY DEFINER: the browser deletes its blocks as `authenticated`, which
-- has no INSERT policy on calendar_outbox; the function runs as the table's
-- owner instead. A trigger function can't be called directly, so it needs no
-- GRANT EXECUTE (AGENTS.md rule 10 is about RPC functions).
CREATE OR REPLACE FUNCTION public.enqueue_calendar_event_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.google_calendar_event_id IS NULL OR btrim(OLD.google_calendar_event_id) = '' THEN
    RETURN NULL;
  END IF;

  -- The owner's account itself is being deleted (auth.users → time_blocks
  -- cascade). Its Google token goes with it, so nothing could ever drain the
  -- row — and inserting it would break this table's own foreign key to the
  -- user being deleted, aborting the account deletion.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.calendar_outbox (user_id, calendar_id, event_id, operation, time_block_id, payload)
  VALUES (
    OLD.user_id, 'primary', OLD.google_calendar_event_id, 'delete', OLD.id,
    jsonb_build_object('title', OLD.title, 'date', OLD.date, 'start_time', OLD.start_time)
  )
  ON CONFLICT (user_id, calendar_id, event_id) DO NOTHING;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_calendar_event_delete ON public.time_blocks;
CREATE TRIGGER trg_enqueue_calendar_event_delete
  AFTER DELETE ON public.time_blocks
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_calendar_event_delete();
