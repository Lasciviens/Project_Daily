-- Training sessions: manual logs + Strava synced activities
create table if not exists training_sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  planned_date        date,
  completed_at        timestamptz,
  type                text not null default 'strength'
                        check (type in ('strength','run','cycling','walk','yoga','swim','other')),
  title               text not null,
  notes               text,
  source              text not null default 'manual'
                        check (source in ('manual','strava')),
  strava_activity_id  bigint unique,
  distance_meters     integer,
  duration_seconds    integer,
  elevation_gain_m    integer,
  avg_heart_rate      integer,
  avg_pace_sec_per_km integer,
  exercises           jsonb,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

alter table training_sessions enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'training_sessions' and policyname = 'user owns training sessions'
  ) then
    create policy "user owns training sessions" on training_sessions
      for all using (auth.uid() = user_id);
  end if;
end $$;

-- Strava OAuth tokens — stored server-side only, never returned to client
create table if not exists strava_tokens (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null unique references auth.users(id) on delete cascade,
  access_token   text not null,
  refresh_token  text not null,
  expires_at     bigint not null,
  athlete_id     bigint,
  athlete_name   text,
  athlete_avatar text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

alter table strava_tokens enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'strava_tokens' and policyname = 'user owns strava tokens'
  ) then
    create policy "user owns strava tokens" on strava_tokens
      for all using (auth.uid() = user_id);
  end if;
end $$;

-- Training programs: named workout routines
create table if not exists training_programs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  description text,
  is_active   boolean default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

alter table training_programs enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'training_programs' and policyname = 'user owns training programs'
  ) then
    create policy "user owns training programs" on training_programs
      for all using (auth.uid() = user_id);
  end if;
end $$;
