-- ═══════════════════════════════════════════════════════════════════════════
-- 168 — Favourite teams (owner, 26.10.2026: "A new football widget for
-- favourite team(s), with the favourite selected on the Football page: how
-- they're doing and the next match").
--
-- football_follows (163) gets `favourite`: a followed team starred on the
-- Football page. The Personal page's Football card shows each favourite's
-- place in its table, its form and its next match
-- (football/hooks/useFavouriteTeamsGlance). Several teams may be favourites;
-- a tournament can't be one (as it can't be subscribed). Unfollowing deletes
-- the row, so its star goes with it; Undo (144's app_restore_rows) puts the
-- whole row back, star included.
--
-- Nothing else is needed for a new column: 163's grants, row level security,
-- owner lock and trg_audit cover the whole row (log_audit records the change,
-- so a star is undoable from Developer → Activity like any edit). It is the
-- owner's choice, not bookkeeping: app_undo_bookkeeping stays as it is.
-- Re-runnable: ADD COLUMN IF NOT EXISTS; DROP CONSTRAINT IF EXISTS before the ADD.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.football_follows add column if not exists favourite boolean not null default false;

alter table public.football_follows drop constraint if exists football_follows_favourite_team;
alter table public.football_follows add constraint football_follows_favourite_team check (not favourite or kind = 'team');
