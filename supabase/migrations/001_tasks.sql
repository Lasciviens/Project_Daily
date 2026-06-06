CREATE TABLE IF NOT EXISTS tasks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title        text NOT NULL,
  description  text,
  domain       text NOT NULL DEFAULT 'personal'
               CHECK (domain IN ('personal', 'work', 'media')),
  section      text NOT NULL DEFAULT 'inbox'
               CHECK (section IN ('inbox', 'today', 'tomorrow', 'this_week', 'backlog')),
  status       text NOT NULL DEFAULT 'open'
               CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  priority     text NOT NULL DEFAULT 'medium'
               CHECK (priority IN ('low', 'medium', 'high')),
  due_date     date,
  due_time     time,
  source_type  text NOT NULL DEFAULT 'manual'
               CHECK (source_type IN ('manual', 'media', 'calendar', 'ai')),
  source_id    uuid,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tasks' AND policyname = 'tasks_owner') THEN
    CREATE POLICY tasks_owner ON tasks
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tasks_user_section  ON tasks (user_id, section);
CREATE INDEX IF NOT EXISTS tasks_user_due_date ON tasks (user_id, due_date);
CREATE INDEX IF NOT EXISTS tasks_user_status   ON tasks (user_id, status);
