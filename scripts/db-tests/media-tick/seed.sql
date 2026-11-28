-- Migration 216's "before" (scripts/verify-db-media-tick.mjs loads it after the linked-plans chain — the live item chain,
-- 210, linked-plans/seed.sql and 211): the media stand-ins grown into what 149 reads, so the REAL 149 (watches, their
-- cache, the Trakt outbox), 161 and 184 run on top — the catalogue (movies, tv_series), the library columns 116–136
-- added, the Trakt outbox and its helper, and 149's own media_watches in place of the small stand-in (211 runs again
-- after 149, so its plan-closing trigger is on the real table). Made-up titles only.
create table public.movies (
  id uuid primary key default gen_random_uuid(), tmdb_id integer unique not null, title text not null,
  trakt_id integer, metadata_json jsonb default '{}'::jsonb
);
create table public.tv_series (
  id uuid primary key default gen_random_uuid(), tmdb_id integer unique not null, title text not null,
  trakt_id integer, metadata_json jsonb default '{}'::jsonb
);
alter table public.user_movie_entries
  add column if not exists movie_id uuid references public.movies(id) on delete cascade,
  add column if not exists status text not null default 'wishlist' check (status in ('watching', 'wishlist', 'completed', 'dropped', 'upcoming', 'paused')),
  add column if not exists rating integer,
  add column if not exists personal_note text,
  add column if not exists repeat_count integer not null default 0,
  add column if not exists watched_at timestamptz,
  add column if not exists is_favorite boolean not null default false,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();
insert into public.movies (id, tmdb_id, title) values
  ('a0000000-0000-0000-0000-000000000001', 9001, 'Movie One'),
  ('a0000000-0000-0000-0000-000000000002', 9002, 'Movie Two'),
  ('a0000000-0000-0000-0000-000000000009', 9009, 'Movie of user 2');
update public.user_movie_entries set movie_id = ('a0000000-0000-0000-0000-00000000000' || right(id::text, 1))::uuid;
drop trigger if exists trg_audit on public.user_movie_entries;
create trigger trg_audit after insert or update or delete on public.user_movie_entries for each row execute function public.log_audit();
drop trigger if exists trg_user_movie_entries_updated_at on public.user_movie_entries;
create trigger trg_user_movie_entries_updated_at before update on public.user_movie_entries for each row execute function public.update_updated_at();

alter table public.user_tv_entries
  add column if not exists tv_series_id uuid references public.tv_series(id) on delete cascade,
  add column if not exists status text not null default 'watching',
  add column if not exists rating integer,
  add column if not exists current_season integer not null default 1,
  add column if not exists current_episode integer not null default 0,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz;
alter table public.user_tv_episodes
  add column if not exists tv_series_id uuid references public.tv_series(id) on delete cascade,
  add column if not exists repeat_count integer not null default 0,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

-- 116/117/140: the Trakt outbox and its helper (service role only).
create table public.trakt_tokens (user_id uuid primary key references auth.users(id) on delete cascade, access_token text);
create table public.trakt_sync_state (user_id uuid primary key references auth.users(id) on delete cascade, last_activities jsonb);
create table public.trakt_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  op text not null, item_key text not null, payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0, next_retry_at timestamptz not null default now(), last_error text,
  created_at timestamptz not null default now(), seq bigserial
);
alter table public.trakt_tokens enable row level security;
alter table public.trakt_sync_state enable row level security;
alter table public.trakt_outbox enable row level security;
create or replace function public.trakt_enqueue(p_user uuid, p_op text, p_key text, p_payload jsonb)
returns void language sql security definer set search_path to 'public' as $$
  insert into public.trakt_outbox (user_id, op, item_key, payload)
  select p_user, p_op, p_key, p_payload where exists (select 1 from auth.users where id = p_user)
$$;

-- 149 creates its own media_watches; the stand-in (one-item/base.sql + linked-plans/seed.sql) goes first.
drop table public.media_watches cascade;

do $$
declare t text;
begin
  foreach t in array array['movies', 'tv_series'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy read on public.%I for select to authenticated using (true)', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
grant all on all tables in schema public to service_role;
grant usage on all sequences in schema public to service_role;

-- Trakt is connected for the owner (the outbox triggers queue only then), its whole history read (no placeholder lock).
insert into public.trakt_tokens values ('00000000-0000-0000-0000-000000000001', 't');
insert into public.trakt_sync_state (user_id) values ('00000000-0000-0000-0000-000000000001');

-- 043's trigger (an episode's first watch: its planned slots go — 155's function, 216's exception) and 050's show
-- progress cache (the next-episode pointer follows the watched episodes), as the live database has them.
drop trigger if exists trg_cleanup_block_on_episode_watched on public.user_tv_episodes;
create trigger trg_cleanup_block_on_episode_watched after insert on public.user_tv_episodes
  for each row execute function public.cleanup_block_on_episode_watched();
create or replace function public.sync_tv_entry_progress() returns trigger language plpgsql security definer set search_path = public as $$
declare v_entry uuid := coalesce(new.tv_entry_id, old.tv_entry_id); v_s int; v_e int;
begin
  select season_number, episode_number into v_s, v_e from public.user_tv_episodes
   where tv_entry_id = v_entry and watched_at is not null order by season_number desc, episode_number desc limit 1;
  update public.user_tv_entries set current_season = coalesce(v_s, 1), current_episode = coalesce(v_e, 0) where id = v_entry;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_sync_tv_entry_progress on public.user_tv_episodes;
create trigger trg_sync_tv_entry_progress after insert or update or delete on public.user_tv_episodes
  for each row execute function public.sync_tv_entry_progress();
