-- Task manual sort ordering
alter table tasks add column if not exists sort_order integer not null default 0;

-- Preserve current created_at DESC visual order (newest = lowest sort_order number)
with ranked as (
  select id,
    (row_number() over (partition by user_id, section order by created_at desc) * 10) as rn
  from tasks
)
update tasks set sort_order = ranked.rn
from ranked where tasks.id = ranked.id;

-- Recurring schedule blocks (e.g. Work Mon–Fri 08:00–16:00)
create table if not exists schedule_blocks (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  title        text not null,
  days_of_week int[] not null,   -- 0=Sun … 6=Sat
  start_time   time not null,
  end_time     time not null,
  color        text not null default 'blue',
  created_at   timestamptz default now()
);
alter table schedule_blocks enable row level security;
create policy "user owns schedule_blocks"
  on schedule_blocks for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- One-off time blocks for a specific date
create table if not exists time_blocks (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  date             date not null,
  title            text not null,
  start_time       time,                    -- null = unscheduled
  duration_minutes int not null default 60,
  color            text not null default 'accent',
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
alter table time_blocks enable row level security;
create policy "user owns time_blocks"
  on time_blocks for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
