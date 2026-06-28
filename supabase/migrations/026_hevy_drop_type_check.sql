-- Migration 026: Drop type CHECK constraint on hevy_exercise_templates
-- Hevy can return exercise types not in our original list (e.g. 'reps_only').
-- Store whatever the API returns — no DB-level validation needed.
ALTER TABLE public.hevy_exercise_templates
  DROP CONSTRAINT IF EXISTS hevy_exercise_templates_type_check;
