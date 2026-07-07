-- health_metrics was one row per (metric, day, source) — a day with multiple
-- incoming points (Health Auto Export sends per-second/per-hour samples, not
-- pre-aggregated daily totals, regardless of its "Summarize"/"Time Grouping"
-- settings) meant every new point silently overwrote the previous one, so
-- only the LAST point of the day ever survived. Confirmed against real
-- exports: this made cumulative metrics (steps, energy, distance) show tiny
-- fragments instead of real daily totals.
--
-- Fix: store every incoming point as its own row (point-in-time grain, keyed
-- by its exact timestamp instead of just its day). No data is discarded at
-- ingest; all summing/averaging happens at query time in the app, which also
-- means hourly-resolution charts are now possible. `date` is kept as a plain
-- column (not derived from recorded_at) because the edge function computes it
-- from the export payload's own local-time string before UTC conversion —
-- safe against timezone-shift bugs; deriving it from the timestamptz would not be.
ALTER TABLE public.health_metrics ADD COLUMN IF NOT EXISTS recorded_at timestamptz;

-- Existing rows have no point-in-time — backfill with midnight of their day
-- so the column can be made NOT NULL. (The user is wiping all rows and
-- re-syncing after this migration, but this keeps the migration valid
-- standalone regardless.)
UPDATE public.health_metrics SET recorded_at = date::timestamptz WHERE recorded_at IS NULL;
ALTER TABLE public.health_metrics ALTER COLUMN recorded_at SET NOT NULL;

DROP INDEX IF EXISTS public.health_metrics_user_metric_date_source_idx;
CREATE UNIQUE INDEX IF NOT EXISTS health_metrics_user_metric_recorded_source_idx
  ON public.health_metrics (user_id, metric_name, recorded_at, source);

-- Superseded by the index above (date is no longer part of the identity) —
-- day-range queries now use health_metrics_user_id_metric_date_idx below.
DROP INDEX IF EXISTS public.health_metrics_user_id_metric_date_idx;
CREATE INDEX IF NOT EXISTS health_metrics_user_id_metric_date_idx
  ON public.health_metrics (user_id, metric_name, date DESC, recorded_at);
