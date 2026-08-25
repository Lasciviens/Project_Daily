-- ═══════════════════════════════════════════════════════════════════════════
-- Recurring schedule templates rendered into the PAST — real bug, reported
-- from the app ("Schedule ekleyince weekly falan secince gecmise yonelik de
-- kayit atiyor. Sadece gelecege yonelik olmali!").
--
-- Root cause: schedule_blocks (migration 004) has days_of_week + start_time +
-- end_time and NO date bounds of any kind. DayAgenda's
-- projectRecurringBlocksForDay() therefore matches a template on EVERY
-- calendar day whose weekday is in days_of_week — in both directions, forever.
-- Creating a "every weekday 16:30" template on a Wednesday instantly
-- back-filled every Mon-Fri in recorded history with a block that never
-- happened.
--
-- Fix: one lower bound. `effective_from` is the first date a template is
-- allowed to render on; the projection skips any day before it (and skips a
-- cross-midnight spillover whose OWN originating day is before it).
--
-- Deliberately NOT added: `effective_until`. The report is one-directional
-- ("only forward-looking") and an end date is a real feature with its own UI
-- and its own "did this routine end?" semantics — adding the column now with
-- no writer and no reader would be exactly the speculative schema this repo's
-- rules forbid. Nothing here precludes adding it later.
--
-- Backfill: existing rows get created_at::date — the honest answer to "when
-- did this routine start?" for a row that never recorded one. This keeps
-- every day between a template's creation and today rendering exactly as it
-- does now (those days it genuinely WAS an active routine) and only stops the
-- fabricated pre-creation history.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.schedule_blocks
  ADD COLUMN effective_from DATE;

UPDATE public.schedule_blocks
   SET effective_from = created_at::date
 WHERE effective_from IS NULL;

-- NOT NULL only AFTER the backfill (an ADD COLUMN ... NOT NULL DEFAULT
-- CURRENT_DATE would have stamped today onto every existing row instead,
-- silently erasing the real start date each one already implies).
ALTER TABLE public.schedule_blocks
  ALTER COLUMN effective_from SET NOT NULL,
  ALTER COLUMN effective_from SET DEFAULT CURRENT_DATE;

COMMENT ON COLUMN public.schedule_blocks.effective_from IS
  'First date this recurring template may render on. DayAgenda''s projection skips any earlier day, so a template can never fabricate occurrences before it existed. The client sends its own LOCAL today on create (CURRENT_DATE here is the server''s UTC day, which is the previous day for Oslo between 00:00 and 02:00) — the DEFAULT is the fallback for any writer that does not, e.g. ai-proxy''s generic db_insert.';

DO $$
DECLARE
  v_null INT;
BEGIN
  SELECT count(*) INTO v_null FROM public.schedule_blocks WHERE effective_from IS NULL;
  IF v_null > 0 THEN
    RAISE EXCEPTION 'Migration 081 assertion failed: % schedule_blocks rows still have a NULL effective_from', v_null;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'schedule_blocks' AND column_name = 'effective_from'
  ) THEN
    RAISE EXCEPTION 'Migration 081 assertion failed: schedule_blocks.effective_from is missing';
  END IF;
  RAISE NOTICE 'Migration 081: effective_from added and backfilled from created_at for every row.';
END $$;
