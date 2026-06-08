-- ─── projects ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  status      text NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'on_hold', 'completed', 'archived')),
  color       text NOT NULL DEFAULT 'slate'
              CHECK (color IN ('slate', 'blue', 'violet', 'emerald', 'amber', 'rose')),
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'projects' AND policyname = 'projects_owner'
  ) THEN
    CREATE POLICY projects_owner ON projects
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS projects_user_sort ON projects (user_id, sort_order);

-- ─── project_phases ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_phases (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  status      text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'in_progress', 'done')),
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE project_phases ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'project_phases' AND policyname = 'project_phases_owner'
  ) THEN
    CREATE POLICY project_phases_owner ON project_phases
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS project_phases_project ON project_phases (project_id, sort_order);

-- ─── project_items ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id    uuid NOT NULL REFERENCES project_phases(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  notes       text,
  type        text NOT NULL DEFAULT 'improvement'
              CHECK (type IN ('update', 'improvement', 'ui_request', 'bug', 'wishlist')),
  status      text NOT NULL DEFAULT 'open'
              CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  priority    text NOT NULL DEFAULT 'medium'
              CHECK (priority IN ('low', 'medium', 'high')),
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE project_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'project_items' AND policyname = 'project_items_owner'
  ) THEN
    CREATE POLICY project_items_owner ON project_items
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS project_items_phase   ON project_items (phase_id, sort_order);
CREATE INDEX IF NOT EXISTS project_items_project ON project_items (project_id);
