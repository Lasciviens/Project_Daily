-- ═══════════════════════════════════════════════════════════════════════════
-- More ways to repeat a plan (owner, 13.10.2026): besides every day /
-- weekdays / weekly, a recurring plan (schedule_blocks) can repeat
--   • monthly — every month on the chosen weekday NEAREST the start date's
--     day of the month (started Tue 13.10 with Saturday chosen → each month
--     the Saturday closest to the 13th), or on that same date when no
--     weekday is chosen (clamped to the month's last day);
--   • every N days / weeks / months (weeks: on the chosen weekdays);
--   • on hand-picked dates.
--
-- Additive. Every existing row becomes repeat_kind 'weekly' and keeps
-- meaning exactly what it means now (days_of_week every week, from
-- effective_from, minus except_dates). The start of a series (and the anchor
-- of the monthly / every-N kinds) is effective_from (081); except_dates (142)
-- still leaves single days out of every kind.
--
-- The one reader of these columns is src/features/daily/recurrence.ts
-- (occursOn). They map onto Google Calendar later as: weekly and every N
-- days / weeks → an RRULE; monthly, every N months and picked dates → an
-- RDATE list; except_dates → EXDATEs.
--
-- Columns:
--   repeat_kind     text NOT NULL DEFAULT 'weekly'  weekly | monthly | interval | dates
--   repeat_interval integer                          interval only: N, 1–99
--   repeat_unit     text                             interval only: day | week | month
--   repeat_dates    date[]                           dates only: 1–366 picked days
-- days_of_week keeps its numbering (0 = Sunday … 6 = Saturday) and means:
--   weekly ≥ 0 days (unchanged — no new rule for old rows) · monthly 0 or 1
--   day (the weekday) · interval: day → none, week → at least one, month →
--   0 or 1 · dates → none.
-- ai-proxy's DB_CATALOG has no schedule_blocks entry: the assistant cannot
-- write these rows, so it needs no new text.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.schedule_blocks
  ADD COLUMN IF NOT EXISTS repeat_kind     text NOT NULL DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS repeat_interval integer,
  ADD COLUMN IF NOT EXISTS repeat_unit     text,
  ADD COLUMN IF NOT EXISTS repeat_dates    date[];

ALTER TABLE public.schedule_blocks DROP CONSTRAINT IF EXISTS schedule_blocks_repeat_check;
-- coalesce(…, false): a NULL anywhere (a missing N, no dates) fails the check
-- instead of slipping through as "unknown".
ALTER TABLE public.schedule_blocks ADD CONSTRAINT schedule_blocks_repeat_check CHECK (coalesce(
  CASE repeat_kind
    WHEN 'weekly' THEN
      repeat_interval IS NULL AND repeat_unit IS NULL AND repeat_dates IS NULL
    WHEN 'monthly' THEN
      repeat_interval IS NULL AND repeat_unit IS NULL AND repeat_dates IS NULL
      AND cardinality(days_of_week) <= 1 AND days_of_week <@ ARRAY[0,1,2,3,4,5,6]
    WHEN 'interval' THEN
      repeat_interval BETWEEN 1 AND 99 AND repeat_dates IS NULL
      AND days_of_week <@ ARRAY[0,1,2,3,4,5,6]
      AND CASE repeat_unit
            WHEN 'day'   THEN cardinality(days_of_week) = 0
            WHEN 'week'  THEN cardinality(days_of_week) >= 1
            WHEN 'month' THEN cardinality(days_of_week) <= 1
            ELSE false
          END
    WHEN 'dates' THEN
      repeat_interval IS NULL AND repeat_unit IS NULL
      AND cardinality(repeat_dates) BETWEEN 1 AND 366
      AND array_position(repeat_dates, NULL) IS NULL
      AND cardinality(days_of_week) = 0
    ELSE false
  END, false)
);

COMMENT ON COLUMN public.schedule_blocks.repeat_kind IS
  'How the plan repeats: weekly (days_of_week every week — also every day / weekdays), monthly (the days_of_week[1] weekday nearest the effective_from day of the month, or that date clamped to the month''s end when no weekday), interval (every repeat_interval repeat_unit from effective_from), dates (exactly repeat_dates). Read only through src/features/daily/recurrence.ts.';
COMMENT ON COLUMN public.schedule_blocks.repeat_interval IS
  'interval only: every N (1–99) repeat_unit.';
COMMENT ON COLUMN public.schedule_blocks.repeat_unit IS
  'interval only: day (no weekdays), week (Monday-first weeks counted from effective_from''s week, on days_of_week), month (the monthly rule every N months).';
COMMENT ON COLUMN public.schedule_blocks.repeat_dates IS
  'dates only: the hand-picked days it occurs on (still never before effective_from, never on except_dates).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'schedule_blocks' AND column_name = 'repeat_dates'
  ) THEN
    RAISE EXCEPTION 'Migration 146 assertion failed: schedule_blocks.repeat_dates is missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'schedule_blocks_repeat_check' AND conrelid = 'public.schedule_blocks'::regclass
  ) THEN
    RAISE EXCEPTION 'Migration 146 assertion failed: schedule_blocks_repeat_check is missing';
  END IF;
END $$;
