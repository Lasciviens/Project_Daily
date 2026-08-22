-- ═══════════════════════════════════════════════════════════════════════════
-- time_blocks.duration_minutes had no upper (or enforced lower) bound at
-- the DB layer — only `int not null default 60` (migration 004). The
-- custom-duration input (DurationField, fields.tsx) had `min={1}` and no
-- `max` at all, and neither is enforced by the browser on form submit
-- regardless; nothing downstream re-validated the value either. A raw
-- 0/negative/25h+ custom entry could reach the DB untouched.
--
-- This matters because dayAgendaProjection.ts's whole cross-midnight model
-- (added earlier in this same review pass) assumes a block occupies AT
-- MOST its own start day plus a single spillover day after it — every block
-- projects onto exactly one or two calendar days, never three or more. A
-- >1440-minute block would silently need a THIRD day's worth of spillover
-- that nothing in that file (or TrainingCalendar's own dot-per-day rendering,
-- or the Home next-session lookup) was ever built to represent — not a
-- crash, but a block that quietly disappears past its second day.
--
-- Fix, three layers (client clamp already shipped earlier in this pass):
--   1. UnifiedPlanModal's clampDurationMinutes (planModal.config.ts) clamps
--      every save path to [1, 1440] before it ever reaches this table.
--   2. This migration adds the matching DB CHECK — the real enforcement
--      layer; the client clamp alone doesn't cover the AI's generic
--      db_insert/db_update tool (ai-proxy), which writes time_blocks
--      directly and has no knowledge of this app-layer clamp at all.
--   3. Existing out-of-range rows (if any) are clamped in place FIRST —
--      a CHECK constraint validates every existing row at ADD time, so
--      skipping this step would fail the whole migration outright on an
--      environment that happens to already hold one.
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.time_blocks
   SET duration_minutes = LEAST(1440, GREATEST(1, duration_minutes))
 WHERE duration_minutes < 1 OR duration_minutes > 1440;

ALTER TABLE public.time_blocks
  ADD CONSTRAINT time_blocks_duration_minutes_range
  CHECK (duration_minutes BETWEEN 1 AND 1440);
