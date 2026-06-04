-- Phase 3: Separate movies and tv_series tables
-- Run this in Supabase SQL Editor

-- ─── MOVIES ─────────────────────────────────────────────────────────────────

create table movies (
  id            uuid primary key default gen_random_uuid(),
  tmdb_id       integer unique not null,
  title         text not null,
  original_title text,
  overview      text,
  release_date  date,                    -- NULL = TBA/unknown
  runtime       integer,                 -- minutes
  status        text,                    -- TMDB: 'Released' | 'Post Production' | 'Planned' | etc.
  poster_path   text,
  backdrop_path text,
  genres        jsonb default '[]'::jsonb,
  tmdb_rating   numeric(3,1),
  tmdb_vote_count integer,
  metadata_json jsonb default '{}'::jsonb,
  created_at    timestamptz default now()
);

alter table movies enable row level security;

create policy "movies_select" on movies
  for select to authenticated using (true);

create policy "movies_insert" on movies
  for insert to authenticated with check (true);

create index movies_tmdb_id_idx on movies (tmdb_id);

-- ─── TV SERIES ───────────────────────────────────────────────────────────────

create table tv_series (
  id                   uuid primary key default gen_random_uuid(),
  tmdb_id              integer unique not null,
  title                text not null,
  original_title       text,
  overview             text,
  first_air_date       date,
  last_air_date        date,
  status               text,            -- 'Returning Series' | 'Ended' | 'Canceled' | 'In Production'
  episode_run_time     integer,         -- typical episode minutes
  number_of_seasons    integer,
  number_of_episodes   integer,
  poster_path          text,
  backdrop_path        text,
  genres               jsonb default '[]'::jsonb,
  tmdb_rating          numeric(3,1),
  tmdb_vote_count      integer,
  metadata_json        jsonb default '{}'::jsonb,
  created_at           timestamptz default now()
);

alter table tv_series enable row level security;

create policy "tv_series_select" on tv_series
  for select to authenticated using (true);

create policy "tv_series_insert" on tv_series
  for insert to authenticated with check (true);

create index tv_series_tmdb_id_idx on tv_series (tmdb_id);

-- ─── USER MOVIE ENTRIES ───────────────────────────────────────────────────────

create table user_movie_entries (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  movie_id           uuid not null references movies(id) on delete cascade,
  status             text not null check (status in ('watching','wishlist','completed','dropped')),
  priority           text not null default 'medium' check (priority in ('low','medium','high')),
  personal_note      text,
  rating             integer check (rating between 1 and 10),
  planned_date       date,
  notify_before_days integer,           -- calendar integration hook
  repeat_count       integer not null default 0,
  watched_at         timestamptz,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  unique (user_id, movie_id)
);

alter table user_movie_entries enable row level security;

create policy "user_movie_entries_select" on user_movie_entries
  for select to authenticated using (auth.uid() = user_id);

create policy "user_movie_entries_insert" on user_movie_entries
  for insert to authenticated with check (auth.uid() = user_id);

create policy "user_movie_entries_update" on user_movie_entries
  for update to authenticated using (auth.uid() = user_id);

create policy "user_movie_entries_delete" on user_movie_entries
  for delete to authenticated using (auth.uid() = user_id);

create index user_movie_entries_user_idx on user_movie_entries (user_id);

-- ─── USER TV ENTRIES ──────────────────────────────────────────────────────────

create table user_tv_entries (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  tv_series_id       uuid not null references tv_series(id) on delete cascade,
  status             text not null check (status in ('watching','wishlist','completed','dropped','paused')),
  priority           text not null default 'medium' check (priority in ('low','medium','high')),
  personal_note      text,
  rating             integer check (rating between 1 and 10),
  current_season     integer not null default 1,
  current_episode    integer not null default 0,
  planned_date       date,
  notify_before_days integer,           -- calendar integration hook
  repeat_count       integer not null default 0,
  started_at         timestamptz,
  finished_at        timestamptz,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  unique (user_id, tv_series_id)
);

alter table user_tv_entries enable row level security;

create policy "user_tv_entries_select" on user_tv_entries
  for select to authenticated using (auth.uid() = user_id);

create policy "user_tv_entries_insert" on user_tv_entries
  for insert to authenticated with check (auth.uid() = user_id);

create policy "user_tv_entries_update" on user_tv_entries
  for update to authenticated using (auth.uid() = user_id);

create policy "user_tv_entries_delete" on user_tv_entries
  for delete to authenticated using (auth.uid() = user_id);

create index user_tv_entries_user_idx on user_tv_entries (user_id);

-- ─── UPDATED_AT TRIGGERS ──────────────────────────────────────────────────────

create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger user_movie_entries_updated_at
  before update on user_movie_entries
  for each row execute function update_updated_at();

create trigger user_tv_entries_updated_at
  before update on user_tv_entries
  for each row execute function update_updated_at();
