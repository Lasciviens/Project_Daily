-- ═══════════════════════════════════════════════════════════════════════════
-- Repeating plans on Google Calendar (owner, 13.10.2026): a repeating plan
-- (schedule_blocks) can be ONE repeating event in the owner's Google
-- Calendar, like a one-off slot (time_blocks) already is. Moving or skipping
-- one day changes only that day there too.
--
-- How it maps (src/features/calendar/calendarSeries.ts, the browser writes
-- it through the same Calendar helpers as time blocks):
--   weekly / every N days / every N weeks → one RRULE;
--   monthly / every N months / picked dates → an RDATE list (the monthly
--     kinds up to a horizon a year ahead, pushed again when the app opens and
--     less than 90 days remain);
--   except_dates (142) → EXDATE; the one-off block that replaces that day
--     keeps its own event (time_blocks.google_calendar_event_id).
--
-- Columns (both NULL for every existing row — nothing is pushed in bulk; the
-- owner adds a plan from its editor):
--   google_calendar_event_id text  the series' event id, in 'primary'
--   google_calendar_horizon  date  the last day the event's RDATE list
--                                  covers; NULL when the event carries every
--                                  occurrence (an RRULE, or all picked dates)
--   google_calendar_time_zone text the IANA zone the series is expanded in,
--                                  set when it is created (the device's zone,
--                                  Europe/Oslo when it names none); background
--                                  pushes reuse it, only a save from the
--                                  editor may change it — so opening the app
--                                  abroad never re-zones a plan
--
-- A plan deleted on the server (plain SQL, a cascade from a deleted account
-- aside) has no Google token at hand, so its event is queued in
-- calendar_outbox (135) the way a deleted time block's is: an AFTER DELETE
-- row trigger, SECURITY DEFINER (the browser has no INSERT policy on the
-- queue), 'primary' like every linked event, skipped while the account itself
-- is being deleted. google-tasks-sync drains it and never deletes an event a
-- live time block OR plan still points at (a plan put back by Undo gets a new
-- event id, so the old one is safe to delete). time_block_id stays NULL on
-- these rows (it names a time block); the payload names the plan.
--
-- Additive: three nullable columns, one trigger function, one trigger. No row
-- changes. Re-runnable. No new table, so no owner_lock_apply; ai-proxy's
-- DB_CATALOG has no schedule_blocks entry, so the assistant can't write the
-- link either.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.schedule_blocks
  ADD COLUMN IF NOT EXISTS google_calendar_event_id  text,
  ADD COLUMN IF NOT EXISTS google_calendar_horizon   date,
  ADD COLUMN IF NOT EXISTS google_calendar_time_zone text;

COMMENT ON COLUMN public.schedule_blocks.google_calendar_event_id IS
  'The plan''s ONE repeating Google Calendar event (in primary), migration 147. Mapping: src/features/calendar/calendarSeries.ts. A delete queues it in calendar_outbox.';
COMMENT ON COLUMN public.schedule_blocks.google_calendar_horizon IS
  'The last day the event''s RDATE list covers (monthly / every N months); NULL when the event carries every occurrence. The app pushes it again when fewer than 90 days remain.';
COMMENT ON COLUMN public.schedule_blocks.google_calendar_time_zone IS
  'The IANA zone the plan''s Google Calendar series is expanded in (set when it is created; only a save from the planner changes it).';

CREATE OR REPLACE FUNCTION public.enqueue_calendar_series_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.google_calendar_event_id IS NULL OR btrim(OLD.google_calendar_event_id) = '' THEN
    RETURN NULL;
  END IF;

  -- The owner's account itself is being deleted: its Google token goes with
  -- it, and the queue's own foreign key to that user would abort the deletion.
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.calendar_outbox (user_id, calendar_id, event_id, operation, time_block_id, payload)
  VALUES (
    OLD.user_id, 'primary', OLD.google_calendar_event_id, 'delete', NULL,
    jsonb_build_object('series', true, 'schedule_block_id', OLD.id, 'title', OLD.title,
                       'effective_from', OLD.effective_from, 'start_time', OLD.start_time)
  )
  ON CONFLICT (user_id, calendar_id, event_id) DO NOTHING;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_calendar_series_delete ON public.schedule_blocks;
CREATE TRIGGER trg_enqueue_calendar_series_delete
  AFTER DELETE ON public.schedule_blocks
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_calendar_series_delete();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'schedule_blocks' AND column_name = 'google_calendar_time_zone'
  ) THEN
    RAISE EXCEPTION 'Migration 147 assertion failed: schedule_blocks.google_calendar_time_zone is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_enqueue_calendar_series_delete' AND tgrelid = 'public.schedule_blocks'::regclass
  ) THEN
    RAISE EXCEPTION 'Migration 147 assertion failed: trg_enqueue_calendar_series_delete is missing';
  END IF;
END $$;
