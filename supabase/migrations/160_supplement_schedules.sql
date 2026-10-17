-- ═══════════════════════════════════════════════════════════════════════════
-- 160 — Supplement schedules and reminders (Food point 9; owner go
-- 16.10.2026: "all ok").
--
-- Before this a supplement was only a diary line in the `supplement` slot: a
-- library food, a recipe or a custom line ("Kreatin 5 g" from the NFC
-- Shortcut through phone-gateway's log_supplement). Nothing repeated and
-- nothing reminded. Now:
--
--  A. The repeat rule exists once in SQL: repeat_rule_occurs_on(kind, days,
--     interval, unit, dates, start, except, day). 156's repeat_occurs_on (a
--     plan, schedule_blocks) calls it, and so do the supplement schedules, so
--     the server has ONE copy of daily/recurrence.ts's occursOn
--     (verify-db-repeat-days still compares it with the app day by day).
--  B. supplement_schedules — what (a library food, a recipe or a name with
--     its own macros), the dose (amount + unit), the times of day (time[]),
--     the SAME repeat columns as schedule_blocks (146: days_of_week,
--     repeat_kind, repeat_interval, repeat_unit, repeat_dates, effective_from,
--     except_dates — so the app's occursOn / repeatSummary / RecurrenceField
--     work unchanged), an end day (ends_on: never, a date, or "after N days",
--     which the app turns into a date — a loading phase is a second schedule),
--     how it reminds (off | once | until_taken; every N minutes until a time
--     of day; decision 10: every 60 minutes until 22:00), a pause
--     (paused_from .. paused_until, open-ended = until resumed), notes, and a
--     stock (stock_amount in the dose's unit, counted from stock_set_at; what
--     is left is derived, never stored) with a refill warning (refill_days).
--     Doses are NOT tasks (decision 12): nothing here touches tasks or Google.
--  C. supplement_dose_state — one row per dose that has a state of its own:
--     skipped (skipped_at), snoozed (snoozed_until) and the reminder
--     bookkeeping (last_reminded_at, reminders_sent). No trg_audit: the
--     reminder job writes it every 15 minutes while a dose is due, and the
--     card undoes its own skip / snooze in place.
--  D. food_log_entries.supplement_schedule_id + dose_time: a taken dose IS
--     its diary line (decision 11: taken always writes one). A dose counts
--     taken while that eaten row exists — delete the line and the dose is
--     open again. One line per dose (a unique index); deleting a schedule
--     keeps its lines in the diary (ON DELETE SET NULL).
--  E. supplement_doses(user, from, to, now) — every dose with its status
--     (taken / skipped / due / upcoming / missed) in Europe/Oslo time;
--     supplement_take(…) — the one write of "taken" (web, phone-gateway);
--     supplement_doses_due(now) — the doses whose reminder is due now;
--     supplement_reminders_claim(user, now) — push-send's read that stamps
--     what it reminds of; supplement_dose_for_log(…) — the dose a phone
--     "log_supplement" takes.
--  F. pg_cron 'lascis-supplement-reminders' every 15 minutes calls push-send
--     ({ trigger: 'supplements' }) only when a reminder is due; the
--     x-cron-secret is PUSH_CRON_SECRET read from Vault inside the job (068's
--     pattern). pg_cron and pg_net exist since 068.
--
-- The app's copy of the dose rules is src/features/supplements/
-- supplementDoses.ts; scripts/verify-db-supplement-schedules.mjs compares the
-- two (statuses and due reminders) on the same rows.
-- Re-runnable: IF NOT EXISTS, the pg_policies guard, DROP … IF EXISTS before
-- every trigger, cron.unschedule before cron.schedule.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── A. The repeat rule, once ────────────────────────────────────────────────
-- <repeat-rule>
-- recurrence.occursOn on the repeat columns themselves (146): does the rule
-- have a day that STARTS on p_day? Never before p_start, never on an except
-- day. 156's body, unchanged, over plain arguments.
create or replace function public.repeat_rule_occurs_on(
  p_kind text, p_days integer[], p_interval integer, p_unit text, p_dates date[],
  p_start date, p_except date[], p_day date)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_kind  text := case when p_kind in ('weekly', 'monthly', 'interval', 'dates') then p_kind else 'weekly' end;
  v_days  integer[] := array(select distinct d from unnest(coalesce(p_days, '{}'::integer[])) d where d between 0 and 6 order by d);
  v_every integer := case when p_interval is not null and p_interval >= 1 then p_interval else 1 end;
  v_dow   integer;
begin
  if p_day is null then return false; end if;
  if p_start is not null and p_day < p_start then return false; end if;
  if p_day = any (coalesce(p_except, '{}'::date[])) then return false; end if;
  v_dow := extract(dow from p_day)::integer;
  if v_kind = 'weekly' then return v_dow = any (v_days); end if;
  if v_kind = 'dates' then return p_day = any (coalesce(p_dates, '{}'::date[])); end if;
  if v_kind = 'monthly' then return public.repeat_monthly_hits(p_start, v_days[1], p_day, 1); end if;
  -- interval
  if p_unit = 'month' then return public.repeat_monthly_hits(p_start, v_days[1], p_day, v_every); end if;
  if p_start is null then return false; end if;
  if p_unit = 'day' then return (p_day - p_start) % v_every = 0; end if;
  if p_unit = 'week' then
    return v_dow = any (v_days)
       and (((p_day - ((v_dow + 6) % 7)) - (p_start - ((extract(dow from p_start)::integer + 6) % 7))) / 7) % v_every = 0;
  end if;
  return false;
end;
$$;

-- A plan (schedule_blocks) asks the one rule (same signature as 156's).
create or replace function public.repeat_occurs_on(p public.schedule_blocks, p_day date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.repeat_rule_occurs_on(p.repeat_kind, p.days_of_week, p.repeat_interval, p.repeat_unit, p.repeat_dates,
                                      p.effective_from, p.except_dates, p_day)
$$;

revoke all on function public.repeat_rule_occurs_on(text, integer[], integer, text, date[], date, date[], date) from public, anon;
grant execute on function public.repeat_rule_occurs_on(text, integer[], integer, text, date[], date, date[], date) to authenticated, service_role;
-- </repeat-rule>

-- ── B. supplement_schedules ─────────────────────────────────────────────────
create table if not exists public.supplement_schedules (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- The diary line's name (a custom line) and the card's; a linked food or
  -- recipe keeps it in step on save.
  title                 text not null check (char_length(btrim(title)) between 1 and 80),
  library_ingredient_id uuid references public.recipe_ingredient_library(id) on delete set null,
  recipe_id             uuid references public.recipes(id) on delete set null,
  -- The dose: grams / ml of a food, portions ('serving') of a recipe, or any
  -- unit of a custom line ("2 capsules").
  dose_amount           numeric not null default 1 check (dose_amount > 0 and dose_amount <= 10000),
  dose_unit             text not null default 'g' check (char_length(btrim(dose_unit)) between 1 and 20),
  -- A custom line's own values per dose (a food or a recipe brings its own, 106).
  calories              numeric not null default 0 check (calories >= 0 and calories <= 5000),
  protein_g             numeric not null default 0 check (protein_g >= 0 and protein_g <= 500),
  carbs_g               numeric not null default 0 check (carbs_g >= 0 and carbs_g <= 1000),
  fat_g                 numeric not null default 0 check (fat_g >= 0 and fat_g <= 500),
  -- Times of day (Europe/Oslo), sorted and whole minutes (the trigger below).
  times                 time[] not null default '{08:00}',
  -- 146's repeat columns, meaning what they mean on schedule_blocks.
  days_of_week          integer[] not null default '{0,1,2,3,4,5,6}',
  repeat_kind           text not null default 'weekly',
  repeat_interval       integer,
  repeat_unit           text,
  repeat_dates          date[],
  effective_from        date not null default ((now() at time zone 'Europe/Oslo')::date),
  except_dates          date[] not null default '{}',
  ends_on               date,
  remind                text not null default 'until_taken' check (remind in ('off', 'once', 'until_taken')),
  remind_every_min      integer not null default 60 check (remind_every_min between 15 and 720),
  remind_until          time not null default '22:00',
  paused_from           date,
  paused_until          date,
  notes                 text check (notes is null or char_length(notes) <= 2000),
  stock_amount          numeric check (stock_amount is null or (stock_amount >= 0 and stock_amount <= 1000000)),
  stock_set_at          timestamptz,
  refill_days           integer not null default 7 check (refill_days between 0 and 90),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint supplement_schedules_one_source check (library_ingredient_id is null or recipe_id is null),
  constraint supplement_schedules_times_check check (cardinality(times) between 1 and 12 and array_position(times, null) is null),
  constraint supplement_schedules_ends_check check (ends_on is null or ends_on >= effective_from),
  constraint supplement_schedules_pause_check check (
    paused_until is null or (paused_from is not null and paused_until >= paused_from)),
  -- 146's rule, a little stricter for a table with no old rows: every day
  -- is a weekday number and Weekly has at least one.
  constraint supplement_schedules_repeat_check check (coalesce(
    days_of_week <@ array[0,1,2,3,4,5,6] and
    case repeat_kind
      when 'weekly' then
        repeat_interval is null and repeat_unit is null and repeat_dates is null and cardinality(days_of_week) >= 1
      when 'monthly' then
        repeat_interval is null and repeat_unit is null and repeat_dates is null and cardinality(days_of_week) <= 1
      when 'interval' then
        repeat_interval between 1 and 99 and repeat_dates is null
        and case repeat_unit
              when 'day'   then cardinality(days_of_week) = 0
              when 'week'  then cardinality(days_of_week) >= 1
              when 'month' then cardinality(days_of_week) <= 1
              else false
            end
      when 'dates' then
        repeat_interval is null and repeat_unit is null
        and cardinality(repeat_dates) between 1 and 366
        and array_position(repeat_dates, null) is null
        and cardinality(days_of_week) = 0
      else false
    end, false))
);
alter table public.supplement_schedules enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'supplement_schedules'
                  and policyname = 'Users manage own supplement schedules') then
    create policy "Users manage own supplement schedules" on public.supplement_schedules for all
      using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
grant select, insert, update, delete on public.supplement_schedules to authenticated;
create index if not exists supplement_schedules_user_idx on public.supplement_schedules (user_id, created_at);

comment on table public.supplement_schedules is
  'A supplement taken on a schedule (Food · Today''s Supplement card): what, the dose, the times of day, 146''s repeat columns, an end, reminders, a pause and a stock. A taken dose is its food_log_entries line (supplement_schedule_id + dose_time); a skip / snooze is a supplement_dose_state row.';
comment on column public.supplement_schedules.times is
  'Times of day the doses are due (Europe/Oslo), sorted, whole minutes, 1–12.';
comment on column public.supplement_schedules.ends_on is
  'The last day it has doses (null = never). "After N days" is saved as effective_from + N − 1.';
comment on column public.supplement_schedules.remind is
  'off | once (one push at the dose''s time) | until_taken (every remind_every_min minutes until remind_until, the dose''s day only).';
comment on column public.supplement_schedules.paused_from is
  'Paused from this day (no doses, no reminders) until paused_until, or until resumed when that is null.';
comment on column public.supplement_schedules.stock_amount is
  'How much was in stock (in dose_unit) at stock_set_at; what is left = stock_amount − dose_amount × doses taken since. Never stored.';

-- Tidy a save: a trimmed name, sorted whole-minute times, sorted days, and
-- the stock count's clock (stock_set_at follows stock_amount).
create or replace function public.supplement_schedules_tidy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.title := btrim(new.title);
  new.dose_unit := btrim(new.dose_unit);
  new.times := array(select distinct date_trunc('minute', t::interval)::time from unnest(new.times) t where t is not null order by 1);
  new.remind_until := date_trunc('minute', new.remind_until::interval)::time;
  new.days_of_week := array(select distinct d from unnest(coalesce(new.days_of_week, '{}'::integer[])) d where d is not null order by d);
  if new.repeat_dates is not null then
    new.repeat_dates := array(select distinct d from unnest(new.repeat_dates) d where d is not null order by d);
  end if;
  new.except_dates := array(select distinct d from unnest(coalesce(new.except_dates, '{}'::date[])) d where d is not null order by d);
  if tg_op = 'INSERT' or new.stock_amount is distinct from old.stock_amount then
    new.stock_set_at := case when new.stock_amount is null then null else now() end;
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end;
$$;
drop trigger if exists trg_supplement_schedules_tidy on public.supplement_schedules;
create trigger trg_supplement_schedules_tidy
  before insert or update on public.supplement_schedules
  for each row execute function public.supplement_schedules_tidy();

drop trigger if exists trg_audit on public.supplement_schedules;
create trigger trg_audit
  after insert or update or delete on public.supplement_schedules
  for each row execute function public.log_audit();

-- Undo this save (150/151): stock_set_at is the stock count's clock, set by
-- the tidy trigger — like updated_at, never put back nor compared. 155's list
-- plus this one (change both lists together).
create or replace function public.app_undo_bookkeeping(p_table text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['updated_at', 'synced_at', 'google_local_edit_at']::text[]
         || case p_table
              when 'media_watches' then array['trakt_history_id', 'source']::text[]
              when 'tasks' then array['google_etag', 'google_position', 'google_updated_at', 'google_web_view_link',
                                      'google_links', 'google_hidden', 'google_deleted']::text[]
              when 'schedule_blocks' then array['google_calendar_horizon', 'google_calendar_from', 'google_calendar_time_zone']::text[]
              when 'user_movie_entries' then array['trakt_note_text']::text[]
              when 'user_tv_entries' then array['trakt_note_text']::text[]
              when 'supplement_schedules' then array['stock_set_at']::text[]
              else '{}'::text[]
            end
$$;

select public.owner_lock_apply('public.supplement_schedules');

-- ── C. supplement_dose_state ────────────────────────────────────────────────
create table if not exists public.supplement_dose_state (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  schedule_id      uuid not null references public.supplement_schedules(id) on delete cascade,
  dose_date        date not null,
  dose_time        time not null,
  skipped_at       timestamptz,
  snoozed_until    timestamptz,
  last_reminded_at timestamptz,
  reminders_sent   integer not null default 0 check (reminders_sent >= 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint supplement_dose_state_one unique (schedule_id, dose_date, dose_time)
);
alter table public.supplement_dose_state enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'supplement_dose_state'
                  and policyname = 'Users manage own supplement dose state') then
    create policy "Users manage own supplement dose state" on public.supplement_dose_state for all
      using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
grant select, insert, update, delete on public.supplement_dose_state to authenticated;
create index if not exists supplement_dose_state_user_day_idx on public.supplement_dose_state (user_id, dose_date);

comment on table public.supplement_dose_state is
  'A dose''s own state: skipped (skipped_at), snoozed (snoozed_until) and the reminder job''s bookkeeping. Taken is not here: a dose is taken while its food_log_entries line exists.';

-- A state row belongs to its schedule's account (a key alone would let a row
-- name another account's schedule), at whole minutes like the schedule.
create or replace function public.supplement_dose_state_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.supplement_schedules s where s.id = new.schedule_id and s.user_id = new.user_id) then
    raise exception 'supplement_dose_state: that schedule is not this account''s' using errcode = '42501';
  end if;
  new.dose_time := date_trunc('minute', new.dose_time::interval)::time;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end;
$$;
drop trigger if exists trg_supplement_dose_state_check on public.supplement_dose_state;
create trigger trg_supplement_dose_state_check
  before insert or update on public.supplement_dose_state
  for each row execute function public.supplement_dose_state_check();

select public.owner_lock_apply('public.supplement_dose_state');

-- ── D. A taken dose is its diary line ───────────────────────────────────────
alter table public.food_log_entries
  add column if not exists supplement_schedule_id uuid references public.supplement_schedules(id) on delete set null,
  add column if not exists dose_time time;
comment on column public.food_log_entries.supplement_schedule_id is
  'The supplement schedule whose dose this line is (migration 160); with dose_time it marks that dose taken. Null for every other line.';
comment on column public.food_log_entries.dose_time is
  'The dose''s time of day (the schedule''s times) — set together with supplement_schedule_id.';
-- One line per dose: a second "Take" finds the first.
create unique index if not exists food_log_entries_supplement_dose_uidx
  on public.food_log_entries (supplement_schedule_id, date, dose_time)
  where supplement_schedule_id is not null and dose_time is not null and status = 'eaten';

create or replace function public.food_log_supplement_dose_check()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.supplement_schedule_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.supplement_schedule_id is not distinct from old.supplement_schedule_id
     and new.user_id = old.user_id and new.dose_time is not distinct from old.dose_time then
    return new;
  end if;
  if new.dose_time is null then
    raise exception 'food_log_entries: a supplement dose needs its dose_time' using errcode = '23514';
  end if;
  if not exists (select 1 from public.supplement_schedules s where s.id = new.supplement_schedule_id and s.user_id = new.user_id) then
    raise exception 'food_log_entries: that supplement schedule is not this account''s' using errcode = '42501';
  end if;
  new.dose_time := date_trunc('minute', new.dose_time::interval)::time;
  return new;
end;
$$;
drop trigger if exists trg_food_log_supplement_dose_check on public.food_log_entries;
create trigger trg_food_log_supplement_dose_check
  before insert or update of supplement_schedule_id, dose_time, user_id on public.food_log_entries
  for each row execute function public.food_log_supplement_dose_check();

-- ── E. The doses ────────────────────────────────────────────────────────────

-- The diary's plural (foodAmount.plural): one or less stays one ("½ portion"),
-- "glass" → "glasses", "berry" → "berries", else + s.
create or replace function public.supplement_plural(p_word text, p_n numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_n > 0 and p_n <= 1 then p_word
              when p_word ~* '(s|x|z|ch|sh)$' then p_word || 'es'
              when p_word ~* '[^aeiou]y$' then left(p_word, -1) || 'ies'
              else p_word || 's' end
$$;

-- "5 g", "2 capsules", "0.5 capsule", "3 pieces" (supplementDoses.doseLabel):
-- a recipe's dose counts its portion word (157's serving_label, else
-- "portion"); a count unit (supplementDoses.COUNT_UNITS) and a portion word
-- are plural above one.
create or replace function public.supplement_dose_label(p_amount numeric, p_unit text, p_portion text default null)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim_scale(round(p_amount, 2))::text || ' ' ||
         case when p_unit = 'serving' then public.supplement_plural(coalesce(nullif(btrim(p_portion), ''), 'portion'), p_amount)
              when p_unit in ('capsule', 'tablet', 'softgel', 'scoop', 'drop', 'piece', 'sachet') then public.supplement_plural(p_unit, p_amount)
              else p_unit end
$$;

-- Does the schedule have doses on p_day? Its repeat rule, not after ends_on,
-- not while paused (supplementDoses.scheduleOn).
create or replace function public.supplement_schedule_on(s public.supplement_schedules, p_day date)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_day is not null
     and (s.ends_on is null or p_day <= s.ends_on)
     and not (s.paused_from is not null and p_day >= s.paused_from and (s.paused_until is null or p_day <= s.paused_until))
     and public.repeat_rule_occurs_on(s.repeat_kind, s.days_of_week, s.repeat_interval, s.repeat_unit, s.repeat_dates,
                                      s.effective_from, s.except_dates, p_day)
$$;

-- Every dose of an account's schedules from p_from to p_to (at most 400
-- days) and its status at p_now, in Europe/Oslo time:
--   taken    its eaten diary line exists
--   skipped  skipped (and not taken)
--   missed   a past day, neither
--   upcoming later today, or a later day
--   due      today, its time has come (snoozed or not)
-- A line or a skip at a dose's own time is that dose's. One at a time the
-- schedule no longer has (its times were changed after it was taken or
-- skipped) goes to the day's doses that have neither, in time order — so
-- moving 08:00 to 07:30 after taking it keeps the day taken (no reminders)
-- and the history whole; one left over belongs to no dose and stays an
-- ordinary diary line (supplementDoses.resolveDay). A snooze and the
-- reminder bookkeeping belong to the exact time only.
-- Security invoker: a signed-in caller sees only its own rows.
create or replace function public.supplement_doses(p_user uuid, p_from date, p_to date, p_now timestamptz default now())
returns table (schedule_id uuid, title text, dose_label text, dose_date date, dose_time time, status text,
               entry_id uuid, taken_at timestamptz, snoozed_until timestamptz, last_reminded_at timestamptz, reminders_sent integer)
language sql
stable
set search_path = ''
as $$
  with clock as (select (p_now at time zone 'Europe/Oslo') as local),
  days as (
    select d::date as day
      from generate_series(p_from::timestamp, least(p_to, p_from + 400)::timestamp, interval '1 day') d
  ),
  doses as (
    select s.id, s.title, public.supplement_dose_label(s.dose_amount, s.dose_unit, r.serving_label) as label, d.day, t.t as at
      from public.supplement_schedules s
      left join public.recipes r on r.id = s.recipe_id
      cross join days d
      cross join lateral unnest(s.times) as t(t)
     where s.user_id = p_user and public.supplement_schedule_on(s, d.day)
  ),
  -- What was recorded: each time's first eaten line, and each time's skip.
  lines as (
    select distinct on (f.supplement_schedule_id, f.date, f.dose_time)
           f.supplement_schedule_id as sid, f.date as day, f.dose_time as at, f.id, f.created_at
      from public.food_log_entries f
     where f.user_id = p_user and f.supplement_schedule_id is not null and f.dose_time is not null and f.status = 'eaten'
       and f.date between p_from and least(p_to, p_from + 400)
     order by f.supplement_schedule_id, f.date, f.dose_time, f.created_at, f.id
  ),
  skips as (
    select k.schedule_id as sid, k.dose_date as day, k.dose_time as at, k.skipped_at
      from public.supplement_dose_state k
     where k.user_id = p_user and k.skipped_at is not null and k.dose_date between p_from and least(p_to, p_from + 400)
  ),
  recorded as (
    select coalesce(l.sid, k.sid) as sid, coalesce(l.day, k.day) as day, coalesce(l.at, k.at) as at,
           l.id as line_id, l.created_at as line_at, case when l.id is null then k.skipped_at end as skipped_at
      from lines l
      full join skips k on k.sid = l.sid and k.day = l.day and k.at = l.at
  ),
  own as (
    select x.id, x.title, x.label, x.day, x.at, r.line_id, r.line_at, r.skipped_at
      from doses x
      left join recorded r on r.sid = x.id and r.day = x.day and r.at = x.at
  ),
  free as (
    select o.id, o.day, o.at, row_number() over (partition by o.id, o.day order by o.at) as n
      from own o
     where o.line_id is null and o.skipped_at is null
  ),
  orphans as (
    select r.sid, r.day, r.line_id, r.line_at, r.skipped_at, row_number() over (partition by r.sid, r.day order by r.at) as n
      from recorded r
     where not exists (select 1 from doses x where x.id = r.sid and x.day = r.day and x.at = r.at)
  ),
  resolved as (
    select o.id, o.title, o.label, o.day, o.at,
           coalesce(o.line_id, p.line_id) as line_id, coalesce(o.line_at, p.line_at) as line_at,
           coalesce(o.skipped_at, p.skipped_at) as skipped_at
      from own o
      left join free f on f.id = o.id and f.day = o.day and f.at = o.at
      left join orphans p on p.sid = o.id and p.day = o.day and p.n = f.n
  )
  select z.id, z.title, z.label, z.day, z.at,
         case when z.line_id is not null then 'taken'
              when z.skipped_at is not null then 'skipped'
              when z.day < c.local::date then 'missed'
              when z.day > c.local::date or z.at > c.local::time then 'upcoming'
              else 'due' end,
         z.line_id, z.line_at, st.snoozed_until, st.last_reminded_at, coalesce(st.reminders_sent, 0)
    from resolved z
    cross join clock c
    left join public.supplement_dose_state st on st.schedule_id = z.id and st.dose_date = z.day and st.dose_time = z.at
   order by z.day, z.at, z.title, z.id
$$;

-- The doses whose push is due at p_now, for every account the owner lock
-- lets in (supplementDoses.remindersDue): due today, the schedule reminds,
-- inside its window (from the dose's time until remind_until — at least the
-- quarter hour after the dose's own time, so a late dose still gets one), not
-- snoozed, and not reminded too recently: never for 'once' after the first,
-- every remind_every_min (5 minutes' grace: the job runs every 15) for
-- 'until_taken', and once more as soon as a snooze ends. The job's caller
-- (pg_cron as postgres, push-send as the service role) sees every row.
create or replace function public.supplement_doses_due(p_now timestamptz default now())
returns table (user_id uuid, schedule_id uuid, title text, dose_label text, dose_date date, dose_time time)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_local timestamp := p_now at time zone 'Europe/Oslo';
  v_today date := (p_now at time zone 'Europe/Oslo')::date;
  v_min   integer := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
begin
  return query
  select u.user_id, d.schedule_id, d.title, d.dose_label, d.dose_date, d.dose_time
    from (select distinct x.user_id from public.supplement_schedules x
           where exists (select 1 from auth.users a where a.id = x.user_id)
             and exists (select 1 from public.app_allowed_users w where w.user_id = x.user_id)) u
    cross join lateral public.supplement_doses(u.user_id, v_today, v_today, p_now) d
    join public.supplement_schedules s on s.id = d.schedule_id
   where d.status = 'due'
     and s.remind <> 'off'
     and v_min < greatest(extract(hour from s.remind_until)::integer * 60 + extract(minute from s.remind_until)::integer,
                          extract(hour from d.dose_time)::integer * 60 + extract(minute from d.dose_time)::integer + 15)
     and (d.snoozed_until is null or d.snoozed_until <= p_now)
     and (d.last_reminded_at is null
          or (d.snoozed_until is not null and d.last_reminded_at < d.snoozed_until)
          or (s.remind = 'until_taken' and p_now >= d.last_reminded_at + make_interval(mins => s.remind_every_min - 5)))
   order by u.user_id, d.dose_time, d.title, d.schedule_id;
end;
$$;

-- push-send's read (cron path, one account): the due doses, each stamped as
-- reminded now. One run at a time (an advisory lock), so two overlapping runs
-- never send the same reminder twice.
create or replace function public.supplement_reminders_claim(p_user uuid, p_now timestamptz default now())
returns table (schedule_id uuid, title text, dose_label text, dose_date date, dose_time time)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('supplement_reminders_claim'));
  return query
  with due as (
    select d.schedule_id, d.title, d.dose_label, d.dose_date, d.dose_time
      from public.supplement_doses_due(p_now) d
     where d.user_id = p_user
  ), stamped as (
    insert into public.supplement_dose_state as st (user_id, schedule_id, dose_date, dose_time, last_reminded_at, reminders_sent)
    select p_user, due.schedule_id, due.dose_date, due.dose_time, p_now, 1 from due
    -- by the constraint's name: the column names would clash with the OUT columns
    on conflict on constraint supplement_dose_state_one do update
      set last_reminded_at = excluded.last_reminded_at, reminders_sent = st.reminders_sent + 1
    returning st.id
  )
  select due.schedule_id, due.title, due.dose_label, due.dose_date, due.dose_time
    from due
   order by due.dose_time, due.title, due.schedule_id;
end;
$$;

-- "Taken": the dose's diary line (decision 11) — the schedule's food, recipe
-- or custom line in the supplement slot, eaten, at p_taken_at (default now),
-- linked to the dose. Taking a dose that is already taken returns its line.
-- A taken dose is no longer skipped or snoozed. The web calls it signed in
-- (row level security); phone-gateway as the service role with p_user_id.
create or replace function public.supplement_take(p_schedule uuid, p_date date, p_time time,
                                                  p_taken_at timestamptz default null, p_user_id uuid default null)
returns jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  v_user  uuid := public.effective_user_id(p_user_id);
  v_today date := (now() at time zone 'Europe/Oslo')::date;
  v_time  time := date_trunc('minute', p_time::interval)::time;
  s       public.supplement_schedules;
  v_id    uuid;
  v_lib   boolean;
  v_rec   boolean;
begin
  if v_user is null then
    raise exception 'supplement_take: not signed in' using errcode = '28000';
  end if;
  select * into s from public.supplement_schedules where id = p_schedule and user_id = v_user;
  if not found then
    raise exception 'supplement_take: the schedule is not there (deleted?)' using errcode = 'P0002';
  end if;
  if p_date is null or p_date > v_today then
    raise exception 'supplement_take: a dose is taken on its day or later, not ahead' using errcode = '22023';
  end if;
  if v_time is null or not (v_time = any (s.times)) or not public.supplement_schedule_on(s, p_date) then
    raise exception 'supplement_take: the schedule has no dose then' using errcode = '22023';
  end if;

  select f.id into v_id from public.food_log_entries f
   where f.supplement_schedule_id = s.id and f.date = p_date and f.dose_time = v_time and f.status = 'eaten'
   order by f.created_at, f.id limit 1;
  if found then
    return jsonb_build_object('entry_id', v_id, 'already', true);
  end if;

  v_lib := s.library_ingredient_id is not null;
  v_rec := s.recipe_id is not null;
  begin
    insert into public.food_log_entries (user_id, date, meal_slot, status, library_ingredient_id, recipe_id, custom_title,
                                         quantity, unit, calories, protein_g, carbs_g, fat_g,
                                         supplement_schedule_id, dose_time, created_at)
    values (v_user, p_date, 'supplement', 'eaten', s.library_ingredient_id, s.recipe_id,
            case when v_lib or v_rec then null else s.title end,
            s.dose_amount, case when v_rec then 'serving' else s.dose_unit end,
            -- a food or a recipe: its totals come from the source (106)
            case when v_lib or v_rec then null else s.calories end,
            case when v_lib or v_rec then null else s.protein_g end,
            case when v_lib or v_rec then null else s.carbs_g end,
            case when v_lib or v_rec then null else s.fat_g end,
            s.id, v_time, coalesce(p_taken_at, now()))
    returning id into v_id;
  exception when unique_violation then
    -- taken at the same moment from another door (the phone, a second tap)
    select f.id into v_id from public.food_log_entries f
     where f.supplement_schedule_id = s.id and f.date = p_date and f.dose_time = v_time and f.status = 'eaten'
     order by f.created_at, f.id limit 1;
    return jsonb_build_object('entry_id', v_id, 'already', true);
  end;

  update public.supplement_dose_state st
     set skipped_at = null, snoozed_until = null
   where st.schedule_id = s.id and st.dose_date = p_date and st.dose_time = v_time
     and (st.skipped_at is not null or st.snoozed_until is not null);
  return jsonb_build_object('entry_id', v_id, 'already', false);
end;
$$;

-- How well a logged title names a supplement (phone-gateway's log_supplement;
-- 0 = not at all). Both are read as words (lower case, letters and digits).
-- 1000 + n: the title starts with the whole name ("Kreatin 5 g" ↔
-- "Kreatin"). n: the title's name part — its words before the first one that
-- starts with a digit (the amount; the first word always counts) — begins the
-- name ("Kreatin 5 g" ↔ "Kreatin monohydrat, Bodylab"; "Omega-3 2 capsules"
-- shares 2 words with "Omega-3 fish oil", 1 with "Omega-6"). "Vitamin D3" is
-- not "Vitamin D", "Protein shake" not "Protein bar".
create or replace function public.supplement_log_rank(p_given text, p_name text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  g     text[] := regexp_split_to_array(btrim(regexp_replace(lower(coalesce(p_given, '')), '[^[:alnum:]]+', ' ', 'g')), ' ');
  n     text[] := regexp_split_to_array(btrim(regexp_replace(lower(coalesce(p_name, '')), '[^[:alnum:]]+', ' ', 'g')), ' ');
  k     integer := 0;
  named integer;
begin
  if g[1] = '' or n[1] = '' then return 0; end if;
  while k < least(cardinality(g), cardinality(n)) and g[k + 1] = n[k + 1] loop
    k := k + 1;
  end loop;
  if k = 0 then return 0; end if;
  if k = cardinality(n) then return 1000 + k; end if;
  named := cardinality(g);
  for i in 2 .. cardinality(g) loop
    if g[i] ~ '^[0-9]' then named := i - 1; exit; end if;
  end loop;
  return case when k >= named then k else 0 end;
end;
$$;

-- Which dose a phone "log_supplement" takes: among the schedules with a dose
-- still open today, the one named p_schedule, or the one the logged title
-- names best (supplement_log_rank over its own name, its linked food's and
-- its linked recipe's — so a schedule named after a long product name still
-- answers to "Kreatin 5 g"); two named equally well = none. Then its earliest
-- open dose that is due, else its next one today. Nothing (the gateway then
-- logs a plain line as before) when no schedule matches or no dose is open.
create or replace function public.supplement_dose_for_log(p_user uuid, p_title text, p_schedule uuid default null,
                                                          p_now timestamptz default now())
returns table (schedule_id uuid, title text, dose_label text, dose_date date, dose_time time)
language sql
stable
set search_path = ''
as $$
  with todo as (
    select d.* from public.supplement_doses(p_user, (p_now at time zone 'Europe/Oslo')::date, (p_now at time zone 'Europe/Oslo')::date, p_now) d
     where d.status in ('due', 'upcoming')
  ), ranked as (
    select s.id,
           case when p_schedule is not null then case when s.id = p_schedule then 1 else 0 end
                else greatest(public.supplement_log_rank(p_title, s.title), public.supplement_log_rank(p_title, l.name),
                              public.supplement_log_rank(p_title, r.title)) end as rank
      from public.supplement_schedules s
      left join public.recipe_ingredient_library l on l.id = s.library_ingredient_id
      left join public.recipes r on r.id = s.recipe_id
     where s.user_id = p_user and s.id in (select t.schedule_id from todo t)
  ), best as (
    select r.id from ranked r where r.rank > 0 and r.rank = (select max(x.rank) from ranked x)
  )
  select t.schedule_id, t.title, t.dose_label, t.dose_date, t.dose_time
    from todo t
   where (select count(*) from best) = 1 and t.schedule_id = (select b.id from best b)
   order by (t.status <> 'due'), t.dose_time, t.title, t.schedule_id
   limit 1
$$;

revoke all on function public.supplement_plural(text, numeric) from public, anon;
revoke all on function public.supplement_dose_label(numeric, text, text) from public, anon;
revoke all on function public.supplement_log_rank(text, text) from public, anon;
revoke all on function public.supplement_schedule_on(public.supplement_schedules, date) from public, anon;
revoke all on function public.supplement_doses(uuid, date, date, timestamptz) from public, anon;
revoke all on function public.supplement_doses_due(timestamptz) from public, anon, authenticated;
revoke all on function public.supplement_reminders_claim(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.supplement_take(uuid, date, time, timestamptz, uuid) from public, anon;
revoke all on function public.supplement_dose_for_log(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.supplement_schedules_tidy() from public, anon;
revoke all on function public.supplement_dose_state_check() from public, anon;
revoke all on function public.food_log_supplement_dose_check() from public, anon;
grant execute on function public.supplement_plural(text, numeric) to authenticated, service_role;
grant execute on function public.supplement_dose_label(numeric, text, text) to authenticated, service_role;
grant execute on function public.supplement_log_rank(text, text) to authenticated, service_role;
grant execute on function public.supplement_schedule_on(public.supplement_schedules, date) to authenticated, service_role;
grant execute on function public.supplement_doses(uuid, date, date, timestamptz) to authenticated, service_role;
grant execute on function public.supplement_doses_due(timestamptz) to service_role;
grant execute on function public.supplement_reminders_claim(uuid, timestamptz) to service_role;
grant execute on function public.supplement_take(uuid, date, time, timestamptz, uuid) to authenticated, service_role;
grant execute on function public.supplement_dose_for_log(uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.supplement_schedules_tidy() to authenticated, service_role;
grant execute on function public.supplement_dose_state_check() to authenticated, service_role;
grant execute on function public.food_log_supplement_dose_check() to authenticated, service_role;

-- ── F. The reminder job ─────────────────────────────────────────────────────
-- Every 15 minutes; push-send is called only when a reminder is due, so a
-- quiet day makes no request at all. The secret is read from Vault at call
-- time (068); a missing one makes push-send refuse (no push, no harm).
select cron.unschedule('lascis-supplement-reminders')
 where exists (select 1 from cron.job where jobname = 'lascis-supplement-reminders');
select cron.schedule('lascis-supplement-reminders', '*/15 * * * *', $cron$
  select net.http_post(
    url := 'https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'PUSH_CRON_SECRET'), '')
    ),
    body := jsonb_build_object('trigger', 'supplements')
  )
  where exists (select 1 from public.supplement_doses_due(now()));
$cron$);

do $$
begin
  if to_regclass('public.supplement_schedules') is null or to_regclass('public.supplement_dose_state') is null then
    raise exception 'Migration 160 assertion failed: a supplement table is missing';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'food_log_entries'
                  and column_name = 'supplement_schedule_id') then
    raise exception 'Migration 160 assertion failed: food_log_entries.supplement_schedule_id is missing';
  end if;
end $$;
