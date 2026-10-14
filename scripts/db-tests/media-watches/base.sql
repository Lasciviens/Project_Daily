-- The media schema as it is before migration 149, as small as it can be
-- (scripts/verify-db-media-watches.mjs builds a throwaway database from this,
-- the real migrations 144, 149 — twice — and 150, and scenarios.sql): the
-- catalogue, the three library tables with the columns 116–136 added, the
-- Trakt outbox with its 117/132/140 functions and triggers, 050's progress
-- cache, 043's planned-block rule, 037's audit log (150's "Undo this save"
-- reads it), the owner lock, and row level security like the app's.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table auth.users (id uuid primary key);
-- The caller: user 1 unless a scenario sets test.uid.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('test.uid', true), ''), '00000000-0000-0000-0000-000000000001')::uuid
$$;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
grant usage on schema public to authenticated;
grant usage on schema auth to authenticated;

-- 139's owner lock: both test users are allowed.
create table public.app_allowed_users (user_id uuid primary key);
insert into public.app_allowed_users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
create or replace function public.is_app_user() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_allowed_users a where a.user_id = (select auth.uid()))
$$;
grant execute on function public.is_app_user() to authenticated;
create or replace function public.owner_lock_apply(p_table regclass) returns void language plpgsql set search_path = '' as $$
begin
  execute format('drop policy if exists app_owner_lock on %s', p_table);
  execute format('create policy app_owner_lock on %s as restrictive for all to public using ((select public.is_app_user())) with check ((select public.is_app_user()))', p_table);
end $$;

create or replace function update_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- 037's audit log and 140's trigger function (as 150's scenarios have them):
-- "Undo this save" (150) reads it.
create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  table_name  text not null,
  operation   text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  row_id      text,
  old_data    jsonb,
  new_data    jsonb,
  actor       text not null,
  tx_id       bigint not null,
  created_at  timestamptz not null default now()
);
alter table public.audit_logs enable row level security;
create policy "Users read own audit logs" on public.audit_logs for select using (auth.uid() = user_id);
create policy "Users delete own audit logs" on public.audit_logs for delete using (auth.uid() = user_id);
grant select, delete on public.audit_logs to authenticated;
create or replace function public.log_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  old_j    jsonb := case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end;
  new_j    jsonb := case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end;
  row_j    jsonb := coalesce(new_j, old_j);
  diff_old jsonb;
  diff_new jsonb;
  v_user   uuid;
begin
  if TG_OP = 'UPDATE' then
    select coalesce(jsonb_object_agg(o.key, o.value), '{}'::jsonb) into diff_old
      from jsonb_each(old_j) o where o.key not in ('updated_at', 'synced_at') and new_j -> o.key is distinct from o.value;
    select coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb) into diff_new
      from jsonb_each(new_j) n where n.key not in ('updated_at', 'synced_at') and old_j -> n.key is distinct from n.value;
    if diff_new = '{}'::jsonb and diff_old = '{}'::jsonb then return null; end if;
  else
    diff_old := old_j;
    diff_new := new_j;
  end if;
  v_user := coalesce((row_j ->> 'user_id')::uuid, auth.uid());
  if v_user is not null and not exists (select 1 from auth.users where id = v_user) then return null; end if;
  insert into public.audit_logs (user_id, table_name, operation, row_id, old_data, new_data, actor, tx_id)
  values (v_user, TG_TABLE_NAME, TG_OP, row_j ->> 'id', diff_old, diff_new,
          case when auth.uid() is not null then 'web' else 'service' end, txid_current());
  return null;
end;
$$;

create table public.movies (
  id uuid primary key default gen_random_uuid(), tmdb_id integer unique not null, title text not null,
  trakt_id integer, metadata_json jsonb default '{}'::jsonb
);
create table public.tv_series (
  id uuid primary key default gen_random_uuid(), tmdb_id integer unique not null, title text not null,
  trakt_id integer, metadata_json jsonb default '{}'::jsonb
);
create table public.user_movie_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  movie_id uuid not null references public.movies(id) on delete cascade,
  status text not null check (status in ('watching','wishlist','completed','dropped','upcoming')),
  rating integer, personal_note text, repeat_count integer not null default 0, watched_at timestamptz,
  is_favorite boolean not null default false, watchlist_rank integer, trakt_note_id bigint, trakt_note_text text,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (user_id, movie_id)
);
create table public.user_tv_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tv_series_id uuid not null references public.tv_series(id) on delete cascade,
  status text not null check (status in ('watching','wishlist','completed','dropped','paused')),
  rating integer, personal_note text, current_season integer not null default 1, current_episode integer not null default 0,
  started_at timestamptz, finished_at timestamptz, is_favorite boolean not null default false,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (user_id, tv_series_id)
);
create table public.user_tv_episodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tv_entry_id uuid not null references public.user_tv_entries(id) on delete cascade,
  tv_series_id uuid not null references public.tv_series(id) on delete cascade,
  season_number integer not null check (season_number >= 0),
  episode_number integer not null check (episode_number >= 0),
  watched_at timestamptz, personal_note text, rating integer,
  repeat_count integer not null default 0, trakt_note_id bigint,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (user_id, tv_series_id, season_number, episode_number)
);

-- 116/117/120/140: the Trakt outbox and its helpers.
create table public.trakt_tokens (user_id uuid primary key references auth.users(id) on delete cascade, access_token text);
create table public.trakt_sync_state (user_id uuid primary key references auth.users(id) on delete cascade, last_activities jsonb);
create table public.trakt_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  op text not null, item_key text not null, payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0, next_retry_at timestamptz not null default now(), last_error text,
  created_at timestamptz not null default now(), seq bigserial
);
create or replace function public.trakt_sync_writing() returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-trakt-sync', '') = '1'
      or coalesce(current_setting('app.trakt_sync', true), '') = 'on'
$$;
create or replace function public.trakt_enqueue(p_user uuid, p_op text, p_key text, p_payload jsonb)
returns void language sql security definer set search_path to 'public' as $$
  insert into public.trakt_outbox (user_id, op, item_key, payload)
  select p_user, p_op, p_key, p_payload where exists (select 1 from auth.users where id = p_user)
$$;

-- 132's movie and episode triggers (what 149 replaces), 117's show trigger.
create or replace function public.trakt_outbox_movie() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := case when TG_OP = 'DELETE' then OLD.user_id else NEW.user_id end;
  v_tmdb integer; v_key text; v_base jsonb;
  o_status text := case when TG_OP = 'INSERT' then null else OLD.status end;
  n_status text := case when TG_OP = 'DELETE' then null else NEW.status end;
  o_rep integer := case when TG_OP = 'INSERT' then 0 else coalesce(OLD.repeat_count, 0) end;
  n_rep integer := case when TG_OP = 'DELETE' then 0 else coalesce(NEW.repeat_count, 0) end;
  v_date_changed boolean := TG_OP = 'UPDATE' and NEW.watched_at is distinct from OLD.watched_at;
begin
  if public.trakt_sync_writing() then return null; end if;
  if not exists (select 1 from public.trakt_tokens where user_id = v_user) then return null; end if;
  select tmdb_id into v_tmdb from public.movies where id = case when TG_OP = 'DELETE' then OLD.movie_id else NEW.movie_id end;
  v_key := 'movie:' || v_tmdb; v_base := jsonb_build_object('type', 'movie', 'tmdb', v_tmdb);
  if n_status = 'completed' and o_status is distinct from 'completed' then
    for i in 1 .. (n_rep + 1) loop perform public.trakt_enqueue(v_user, 'history_add', v_key, v_base); end loop;
  elsif n_status = 'completed' and o_status = 'completed' and (n_rep <> o_rep or v_date_changed) then
    perform public.trakt_enqueue(v_user, 'history_remove', v_key, v_base);
  elsif TG_OP = 'DELETE' or (n_status in ('wishlist', 'upcoming') and o_status not in ('wishlist', 'upcoming')) then
    perform public.trakt_enqueue(v_user, 'history_remove', v_key, v_base);
  end if;
  return null;
end $$;
create trigger trg_trakt_outbox_movie after insert or update of status, rating, repeat_count, watched_at or delete
  on public.user_movie_entries for each row execute function public.trakt_outbox_movie();

create or replace function public.trakt_outbox_episode() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := case when TG_OP = 'DELETE' then OLD.user_id else NEW.user_id end;
  v_tmdb integer;
  o_at timestamptz := case when TG_OP = 'INSERT' then null else OLD.watched_at end;
  n_at timestamptz := case when TG_OP = 'DELETE' then null else NEW.watched_at end;
begin
  if public.trakt_sync_writing() then return null; end if;
  if not exists (select 1 from public.trakt_tokens where user_id = v_user) then return null; end if;
  select tmdb_id into v_tmdb from public.tv_series where id = case when TG_OP = 'DELETE' then OLD.tv_series_id else NEW.tv_series_id end;
  -- 120/132: a date change removed EVERY play of the episode and re-added them (the bug).
  if o_at is not null and (n_at is null or n_at is distinct from o_at) then
    perform public.trakt_enqueue(v_user, 'history_remove', 'ep:' || v_tmdb, '{}'::jsonb);
  end if;
  return null;
end $$;
create trigger trg_trakt_outbox_episode after insert or update of watched_at, repeat_count or delete
  on public.user_tv_episodes for each row execute function public.trakt_outbox_episode();

create or replace function public.trakt_outbox_show() returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := case when TG_OP = 'DELETE' then OLD.user_id else NEW.user_id end;
  v_tmdb integer;
  o_status text := case when TG_OP = 'INSERT' then null else OLD.status end;
  n_status text := case when TG_OP = 'DELETE' then null else NEW.status end;
begin
  if public.trakt_sync_writing() then return null; end if;
  if not exists (select 1 from public.trakt_tokens where user_id = v_user) then return null; end if;
  select tmdb_id into v_tmdb from public.tv_series where id = case when TG_OP = 'DELETE' then OLD.tv_series_id else NEW.tv_series_id end;
  if n_status = 'wishlist' and o_status is distinct from 'wishlist' then
    perform public.trakt_enqueue(v_user, 'watchlist_add', 'show:' || v_tmdb, jsonb_build_object('type', 'show', 'tmdb', v_tmdb));
  end if;
  return null;
end $$;
create trigger trg_trakt_outbox_show after insert or update of status, rating or delete
  on public.user_tv_entries for each row execute function public.trakt_outbox_show();

-- 050: the show's progress cache follows its episodes.
create or replace function public.sync_tv_entry_progress() returns trigger language plpgsql security definer as $$
declare v_entry uuid := coalesce(NEW.tv_entry_id, OLD.tv_entry_id); v_s int; v_e int;
begin
  select season_number, episode_number into v_s, v_e from public.user_tv_episodes
   where tv_entry_id = v_entry and watched_at is not null order by season_number desc, episode_number desc limit 1;
  update public.user_tv_entries set current_season = coalesce(v_s, 1), current_episode = coalesce(v_e, 0) where id = v_entry;
  return coalesce(NEW, OLD);
end $$;
create trigger trg_sync_tv_entry_progress after insert or update or delete on public.user_tv_episodes
  for each row execute function public.sync_tv_entry_progress();

-- 043: an episode's first watch removes its planned block (149 adds the same for every watch).
create table public.time_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  date date not null default current_date, title text,
  source_type text, source_id uuid, season_number integer, episode_number integer
);
alter table public.time_blocks enable row level security;
create policy own on public.time_blocks for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.time_blocks to authenticated;
create table public.link_rules (rule_name text primary key, enabled boolean not null default true);
insert into public.link_rules values ('episode_watched_cleans_block', true);
create or replace function public.link_rule_enabled(p_rule_name text) returns boolean language sql stable as $$
  select coalesce((select enabled from public.link_rules where rule_name = p_rule_name), false)
$$;
create or replace function public.cleanup_block_on_episode_watched() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.link_rule_enabled('episode_watched_cleans_block') then
    delete from public.time_blocks where source_type = 'tv_episode' and source_id = NEW.tv_entry_id
       and season_number = NEW.season_number and episode_number = NEW.episode_number;
  end if;
  return NEW;
end $$;
create trigger trg_cleanup_block_on_episode_watched after insert on public.user_tv_episodes
  for each row execute function public.cleanup_block_on_episode_watched();

-- 037: audited tables.
create trigger trg_audit after insert or update or delete on public.user_movie_entries for each row execute function public.log_audit();
create trigger trg_audit after insert or update or delete on public.user_tv_entries for each row execute function public.log_audit();
create trigger trg_audit after insert or update or delete on public.user_tv_episodes for each row execute function public.log_audit();

-- Row level security as the app has it: own rows only; the catalogue is readable.
do $$
declare t text;
begin
  foreach t in array array['user_movie_entries','user_tv_entries','user_tv_episodes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy own on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
  foreach t in array array['movies','tv_series'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy read on public.%I for select to authenticated using (true)', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
alter table public.trakt_outbox enable row level security;
alter table public.trakt_tokens enable row level security;
alter table public.trakt_sync_state enable row level security;

-- The library before 149: one date per episode/movie + a play count.
insert into public.movies (id, tmdb_id, title) values
  ('10000000-0000-0000-0000-000000000001', 101, 'Twice, unknown date'),
  ('10000000-0000-0000-0000-000000000002', 102, 'Wishlist film'),
  ('10000000-0000-0000-0000-000000000003', 103, 'Dropped, dated'),
  ('10000000-0000-0000-0000-000000000004', 104, 'Watched once'),
  ('10000000-0000-0000-0000-000000000005', 105, 'To complete later');
insert into public.user_movie_entries (id, user_id, movie_id, status, repeat_count, watched_at) values
  ('11000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'completed', 1, null),
  ('11000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'wishlist', 0, null),
  ('11000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', 'dropped', 0, '2025-03-01 20:00:00.250+00'),
  ('11000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000004', 'completed', 0, '2024-05-05 20:00:00+00'),
  ('11000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000005', 'wishlist', 0, null);

insert into public.tv_series (id, tmdb_id, title) values
  ('20000000-0000-0000-0000-000000000001', 1399, 'Game of Thrones'),
  ('20000000-0000-0000-0000-000000000002', 1400, 'Other show');
insert into public.user_tv_entries (id, user_id, tv_series_id, status) values
  ('21000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'completed'),
  ('21000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'watching'),
  ('21000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'watching');
-- GoT S1: E1 watched 3 times (kept date 2026-01-08), E2 once, E3 twice, E4 on an unknown date.
insert into public.user_tv_episodes (id, user_id, tv_entry_id, tv_series_id, season_number, episode_number, watched_at, repeat_count) values
  ('22000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1, 1, '2026-01-08 20:00:00.123+00', 2),
  ('22000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1, 2, '2026-01-09 20:00:00+00', 0),
  ('22000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1, 3, '2026-01-10 20:00:00+00', 1),
  ('22000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 1, 4, '1970-01-01 00:00:00+00', 0),
  ('22000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000001', 1, 1, '2026-02-01 20:00:00+00', 0);
-- Trakt is connected for user 1 (the outbox triggers only queue then).
insert into public.trakt_tokens values ('00000000-0000-0000-0000-000000000001', 't');
insert into public.trakt_sync_state (user_id) values ('00000000-0000-0000-0000-000000000001');
