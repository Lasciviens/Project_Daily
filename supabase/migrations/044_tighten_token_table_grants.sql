-- ═══════════════════════════════════════════════════════════════════════════
-- Tighten client access to the two OAuth-token tables so a compromised browser
-- session (XSS, malicious dependency) can't read long-lived refresh tokens.
--
-- Both tables already have owner-scoped RLS, but RLS only limits WHICH ROWS
-- the authenticated role sees — not WHICH COLUMNS. Migration 009 granted the
-- authenticated role table-wide SELECT on both, so the browser could read its
-- own `refresh_token` (contradicting 003/005's own "server-side only, never
-- returned to client" comments). All legitimate token USE happens in edge
-- functions via the service-role key, which bypasses these grants entirely, so
-- narrowing the authenticated grants changes no real app flow.
--
-- Verified against the client code before writing this (so we tighten Supabase
-- without breaking the app):
--   • user_calendar_tokens — NO client-side read anywhere in src/. Only edge
--     functions (calendar-oauth/-token/-disconnect, ai-proxy) touch it, all
--     service-role. → revoke ALL authenticated grants.
--   • strava_tokens — the client reads exactly three NON-secret display columns
--     (athlete_id, athlete_name, athlete_avatar) in
--     src/features/training/api/trainingApi.ts::fetchStravaStatus for the
--     "Strava connected" indicator; it never selects the secret columns and
--     never writes. → downgrade table-wide SELECT to a column-scoped SELECT on
--     just those three; revoke write grants (writes are edge-function-only).
-- ═══════════════════════════════════════════════════════════════════════════

-- user_calendar_tokens: fully close authenticated access (RLS policy left in
-- place is harmless — with no grant there's nothing to gate).
REVOKE ALL ON public.user_calendar_tokens FROM authenticated;

-- strava_tokens: reads limited to the non-secret display columns only.
REVOKE ALL ON public.strava_tokens FROM authenticated;
GRANT SELECT (athlete_id, athlete_name, athlete_avatar)
  ON public.strava_tokens TO authenticated;
