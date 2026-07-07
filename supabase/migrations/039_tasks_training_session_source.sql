-- Allow tasks.source_type = 'training_session' so a task created when planning
-- a Hevy routine session (RoutinesTab "Plan routine") can be traced back to
-- the routine it was planned from (source_id = hevy_routines.id). This is what
-- lets the Hevy sync path auto-close the task once the real workout is logged.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_source_type_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_source_type_check
  CHECK (source_type IN ('manual', 'movie', 'tv_series', 'media', 'calendar', 'ai', 'training_session'));
