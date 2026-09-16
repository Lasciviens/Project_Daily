-- ============================================================
-- 097 — a durable record of every scrape decision
-- ============================================================
-- Two problems that look unrelated are the same missing table.
--
-- 1. PROGRESS DIES ON RELOAD. The review flow kept "already dealt with" in a
--    React useState Set. At six games a batch and ~1150 games that is roughly
--    190 sittings; nobody does that in one, and a reload silently re-offered
--    every match already rejected. "ScreenScraper has no entry for this ROM"
--    is a durable fact about the library, not session UI state.
--
-- 2. THERE WAS NO UNDO. A batch that went wrong had no route back. The first
--    real run wrote four wrong rows and the only recovery was hand-written SQL.
--
-- Undo is unusually cheap here and this table is why. A scrape write is
-- STRICTLY gap-filling — `fillOnlyMissing` only ever writes into a field that
-- was null/''/[] — so the exact inverse of an apply is "set these fields back
-- to NULL". No prior values need storing, and nothing the user typed can be
-- destroyed by an undo, because a scrape could never have touched it. What has
-- to be recorded is only WHICH fields were written, and which Storage objects
-- were created.
--
-- Not `audit_logs` (migration 037): it is swept probabilistically at 30 days,
-- it cannot tell a scrape write from a hand edit without parsing, and it has
-- no concept of a REJECTION — nothing was written, so nothing was logged, and
-- the rejection is the record that stops a game being offered forever.

CREATE TABLE IF NOT EXISTS public.scrape_decisions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id        uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,

  -- One id per "Save" press, so a whole batch can be taken back together.
  run_id         uuid NOT NULL,

  -- applied   — fields were written
  -- rejected  — a match was offered and refused
  -- no_match  — their database has no entry for this ROM filename
  -- unmatchable — nothing to match ON (no filename, or no system id)
  -- undone    — a previous `applied` row was reverted
  decision       text NOT NULL CHECK (decision IN ('applied', 'rejected', 'no_match', 'unmatchable', 'undone')),

  provider       text NOT NULL DEFAULT 'screenscraper',
  jeu_id         text,
  matched_title  text,
  system_used    text,

  -- What an undo has to clear. Empty for every non-applied decision.
  fields_written text[] NOT NULL DEFAULT '{}',
  storage_paths  text[] NOT NULL DEFAULT '{}',
  -- `needs_review` is restored, not guessed: apply_match sets it false, so an
  -- undo of a hand-picked match must not leave the row looking reviewed.
  prior_needs_review boolean,

  created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.scrape_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scrape_decisions owner" ON public.scrape_decisions;
CREATE POLICY "scrape_decisions owner" ON public.scrape_decisions
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS scrape_decisions_user_game_idx ON public.scrape_decisions (user_id, game_id);
CREATE INDEX IF NOT EXISTS scrape_decisions_run_idx       ON public.scrape_decisions (user_id, run_id);
CREATE INDEX IF NOT EXISTS scrape_decisions_recent_idx    ON public.scrape_decisions (user_id, created_at DESC);

-- User-authored intent, not bulk sync, so it carries the audit trigger like
-- every other table of its kind (089's own convention).
DROP TRIGGER IF EXISTS trg_audit ON public.scrape_decisions;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.scrape_decisions
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

COMMENT ON TABLE public.scrape_decisions IS
  'One row per scrape decision. Undo works off fields_written because a scrape only ever fills empty fields, so reverting is setting exactly those back to NULL.';
