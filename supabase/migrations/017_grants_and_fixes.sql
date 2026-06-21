-- ─── Migration 017: Missing GRANTs + constraint fixes ────────────────────────

-- train_program_workouts and train_program_exercises were created in 015 without GRANTs
GRANT SELECT, INSERT, UPDATE, DELETE ON train_program_workouts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON train_program_exercises TO authenticated;

-- user_transit_stops and user_transit_routes were created in 014 without GRANTs
GRANT SELECT, INSERT, UPDATE, DELETE ON user_transit_stops TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_transit_routes TO authenticated;

-- time_blocks source_type constraint was missing 'calendar' and 'manual'
ALTER TABLE time_blocks DROP CONSTRAINT IF EXISTS time_blocks_source_type_check;
ALTER TABLE time_blocks ADD CONSTRAINT time_blocks_source_type_check
  CHECK (source_type IN (
    'task', 'training_session', 'movie', 'tv_episode', 'project_item',
    'calendar', 'manual'
  ));

-- updated_at trigger for train_program_workouts (missed in 015)
CREATE TRIGGER trg_train_program_workouts_updated_at
  BEFORE UPDATE ON train_program_workouts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
