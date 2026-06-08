-- Grant access to the authenticated role for all three project tables.
-- 007_projects.sql created the tables and RLS policies but omitted these grants,
-- causing PostgREST to return 403 for all authenticated requests.
GRANT SELECT, INSERT, UPDATE, DELETE ON projects       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_phases TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_items  TO authenticated;
