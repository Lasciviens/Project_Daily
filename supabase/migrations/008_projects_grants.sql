-- Grant access to the authenticated role for all three project tables.
-- 007_projects.sql omitted these grants, causing PostgREST 403s.
GRANT SELECT, INSERT, UPDATE, DELETE ON projects       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_phases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_items  TO authenticated;

-- Set user_id defaults so clients don't need to pass it explicitly.
-- Without this, inserts arrive with user_id = null, violating the RLS policy.
ALTER TABLE projects       ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE project_phases ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE project_items  ALTER COLUMN user_id SET DEFAULT auth.uid();
