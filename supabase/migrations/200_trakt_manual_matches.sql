-- 200 · trakt_manual_matches — the owner's pick for a Trakt title that has no TMDB id (23.11.2026, "Trakt matching fix it";
-- docs/features/media.md → Trakt matching). `trakt_unmatched` (116) lists what the sync could not take in; the sync joins
-- everything on `ids.tmdb`, so a pick must live where the sync reads it: this table. `trakt-api` loads it right after it reads
-- Trakt and fills `ids.tmdb` of the items that have none — never one that has its own.
--
-- Attacker notes (the browser and a stolen session can write this table; the assistant cannot — it is not in ai-proxy's DB_CATALOG):
--   · A row maps one Trakt id to one TMDB id of the same account. It names no URL, path or credential: the function builds every
--     outgoing address from the integer, so a forged row can only point the owner's own library at a wrong catalogue title.
--   · Integers only, and positive: the CHECKs below are the last line behind the function's own check.
--   · One catalogue title per Trakt item and one Trakt item per catalogue title (two unique keys), so two Trakt items can never
--     be folded into one library title through a forged row.
--   · The function ignores a row whose TMDB id Trakt itself already gives to another item, and never overrides an id Trakt gave.
--   · A browser may add, change and delete its own rows; every row is the owner's own (policy + owner lock).
--
-- Also: trakt_sync_state.matches_fingerprint (the count and a hash of the picks the last sync used). trakt-api's timed run returns
-- early while Trakt's last_activities is unchanged; a changed fingerprint (a save, a change or a removal) makes it read Trakt anyway, so
-- a pick is linked by the next 30-minute run, not only by Sync now. Written only by the function (the table is service-role only);
-- a sync clock, not content, and the table is not audited, so Undo never sees it.
--
-- Audited (the owner's own choice; Developer → Activity can undo a save). Has an `id` primary key so that Undo and
-- app_delete_rows (144) can name a row. Safe to re-run. No BEGIN/COMMIT: the deploy runs it as one transaction.

create table if not exists public.trakt_manual_matches (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('movie', 'show')),
  trakt_id   integer not null check (trakt_id > 0),
  tmdb_id    integer not null check (tmdb_id > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, trakt_id),
  unique (user_id, kind, tmdb_id)
);
alter table public.trakt_manual_matches enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'trakt_manual_matches' and policyname = 'Users manage own trakt manual matches') then
    create policy "Users manage own trakt manual matches" on public.trakt_manual_matches
      for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;

revoke all on public.trakt_manual_matches from anon, authenticated;
grant select, insert, update, delete on public.trakt_manual_matches to authenticated;
grant select, insert, update, delete on public.trakt_manual_matches to service_role;

drop trigger if exists trg_trakt_manual_matches_updated_at on public.trakt_manual_matches;
create trigger trg_trakt_manual_matches_updated_at before update on public.trakt_manual_matches
  for each row execute function public.update_updated_at();
drop trigger if exists trg_audit on public.trakt_manual_matches;
create trigger trg_audit after insert or update or delete on public.trakt_manual_matches
  for each row execute function public.log_audit();

comment on table public.trakt_manual_matches is
  'The owner''s pick of a TMDB title for a Trakt item that has no TMDB id (kind movie|show, Trakt id → TMDB id). Read by trakt-api after it reads Trakt; fills ids.tmdb of items that have none, never overrides one. Integers only; the sync builds every address from them.';

select public.owner_lock_apply('public.trakt_manual_matches');

alter table public.trakt_sync_state add column if not exists matches_fingerprint text;
comment on column public.trakt_sync_state.matches_fingerprint is 'The count and a hash of trakt_manual_matches as the last pull used them (matchesFingerprint): a different value makes the next run read Trakt although Trakt has nothing new.';
