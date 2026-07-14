-- ═══════════════════════════════════════════════════════════════════════════
-- Drop six tables that have been dead since the Hevy migration but never
-- actually got removed. Migration 027 ("drop_old_training_tables") INTENDED to
-- clear the old training schema but DROP'd a different, earlier table generation
-- by literal name (exercises / program_workouts / program_exercises /
-- train_sessions) — by then those had already been renamed, so 027 mostly hit
-- names that no longer existed and these six survived untouched. No application
-- code references any of them (verified), and their data is superseded:
--   • train_programs / train_program_workouts / train_program_exercises /
--     train_exercises / train_session_exercises — the pre-Hevy workout-logging
--     schema, fully replaced by the hevy_* tables.
--   • health_daily_stats — the pre-point-grain daily health summary, replaced by
--     health_metrics (migration 041). CLAUDE.md already describes it as dropped;
--     this makes that true.
--
-- CASCADE is safe here: nothing in the live schema references these tables (only
-- each other). Ordered child→parent for readability; CASCADE covers the rest.
--
-- NOTE: the undocumented `health-ingest` edge function wrote to
-- health_daily_stats — its source is removed in the same change; it must also be
-- UNDEPLOYED manually from the Supabase dashboard (edge functions don't undeploy
-- on merge).
-- ═══════════════════════════════════════════════════════════════════════════

DROP TABLE IF EXISTS public.train_session_exercises  CASCADE;
DROP TABLE IF EXISTS public.train_program_exercises  CASCADE;
DROP TABLE IF EXISTS public.train_program_workouts   CASCADE;
DROP TABLE IF EXISTS public.train_programs           CASCADE;
DROP TABLE IF EXISTS public.train_exercises          CASCADE;
DROP TABLE IF EXISTS public.health_daily_stats       CASCADE;
