-- ============================================================
-- 091 — psn_tokens
-- ============================================================
-- PlayStation Network has NO official public API (see the Games Feature
-- Detail research note in CLAUDE.md). The only working approach is the
-- community-reverse-engineered `npsso` cookie flow: the user pastes an
-- `npsso` obtained from a real browser login into the app, the `psn-api`
-- edge function exchanges it for an access/refresh token pair, and stores
-- them here so later calls can refresh the access token (~1h lifetime)
-- without re-touching the npsso (~60d lifetime) every time.
--
-- SINGLETON per user, same PK-is-user_id shape as `athlete_profile`/
-- `day_targets` — one PSN account per app user, no history needed.
--
-- NO `trg_audit` on this table, deliberately, unlike every other
-- user-authored settings table in this app (AGENTS.md rule 9 normally
-- requires it). This table holds live secrets (npsso/access_token/
-- refresh_token) — writing them into `audit_logs`' diff on every token
-- refresh would duplicate a live credential into a second table with its
-- own (weaker) access story. `connected_at`/`updated_at` alone are enough
-- for a human to see "when did I last connect" without an audit trail ever
-- needing to touch the secret columns.
--
-- This table must NEVER be added to ai-proxy's `DB_CATALOG` — it is exactly
-- the class of "token/secret/auth table" that catalog's default-deny
-- allow-list exists to keep unreachable.
--
-- RLS is still enabled (every table gets it, AGENTS.md), but the primary
-- access path is the `psn-api` edge function's service-role client, scoped
-- explicitly to the calling user's id (resolved via `supabase.auth.getUser`
-- on the request's JWT, the same pattern `calendar-oauth` already uses) —
-- never the client querying this table directly. The client only ever sees
-- a derived `{connected, connectedAt, expiresAt}` shape from the edge
-- function's own `status` action, never the raw token columns.

CREATE TABLE IF NOT EXISTS public.psn_tokens (
  user_id                 uuid PRIMARY KEY NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  npsso                   text NOT NULL,
  access_token            text,
  refresh_token           text,
  access_token_expires_at timestamptz,
  connected_at            timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.psn_tokens ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'psn_tokens'
      AND policyname = 'Users manage own psn tokens'
  ) THEN
    CREATE POLICY "Users manage own psn tokens"
      ON public.psn_tokens
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

-- update_updated_at() is defined in 002_media.sql and reused corpus-wide.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_psn_tokens_updated_at') THEN
    CREATE TRIGGER trg_psn_tokens_updated_at
      BEFORE UPDATE ON public.psn_tokens
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
