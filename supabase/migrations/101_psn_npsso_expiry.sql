-- ============================================================
-- 101 — psn_tokens.npsso_expires_at
-- ============================================================
-- Sony's ssocookie endpoint returns the cookie's own lifetime alongside it:
--
--   {"npsso":"…","expires_in":5183980}
--
-- ~60 days. We were throwing that number away and keeping only the ACCESS
-- token's expiry (~1h), which the function refreshes by itself and which
-- therefore tells a user nothing they can act on. The npsso's expiry is the
-- one date that matters to a human here: it is the deadline for the single
-- manual step this integration has, and Sony's login reCAPTCHA means it
-- cannot be automated away (see 091's header and CLAUDE.md's Games note).
--
-- Storing it turns the only unavoidable chore in the feature from a surprise
-- ("something broke here") into a countdown the user can act on early.
--
-- NULLABLE on purpose: a token pasted as a bare value carries no expiry, and
-- every row that predates this column has none either. A null reads as
-- "unknown", never as "expired" -- nothing gates access on it.
--
-- Updates no existing row. This table still carries no `trg_audit` (091's
-- header explains why) and still must never enter ai-proxy's DB_CATALOG.

ALTER TABLE public.psn_tokens
  ADD COLUMN IF NOT EXISTS npsso_expires_at timestamptz;

COMMENT ON COLUMN public.psn_tokens.npsso_expires_at IS
  'When the stored npsso cookie itself expires (~60d), from the ssocookie '
  'response''s expires_in. NULL when the token was pasted as a bare value or '
  'predates this column — treat NULL as unknown, never as expired.';
