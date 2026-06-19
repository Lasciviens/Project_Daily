-- ─── Cross-entity link columns ───────────────────────────────────────────────
-- Moves Google Task ID from browser localStorage into Supabase so it works
-- across devices and survives browser storage clears.
-- Also adds a Google Calendar event ID column and session→task link.

-- tasks: store Google sync IDs durably
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS google_task_id           text,
  ADD COLUMN IF NOT EXISTS google_calendar_event_id text;

-- train_sessions: link to the companion to-do task created on log
ALTER TABLE train_sessions
  ADD COLUMN IF NOT EXISTS linked_task_id uuid
    REFERENCES tasks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS train_sessions_linked_task
  ON train_sessions (linked_task_id)
  WHERE linked_task_id IS NOT NULL;
