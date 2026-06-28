-- Migration 027: Drop old training tables replaced by Hevy integration
-- train_sessions data was migrated to strava_activities in migration 025
-- workout_programs/program_workouts/program_exercises were web-only planning tables
-- exercises was a local exercise library replaced by hevy_exercise_templates

DROP TABLE IF EXISTS public.program_exercises CASCADE;
DROP TABLE IF EXISTS public.program_workouts CASCADE;
DROP TABLE IF EXISTS public.workout_programs CASCADE;
DROP TABLE IF EXISTS public.exercises CASCADE;
DROP TABLE IF EXISTS public.train_sessions CASCADE;
