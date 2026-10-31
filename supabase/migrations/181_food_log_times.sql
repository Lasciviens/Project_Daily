-- ═══════════════════════════════════════════════════════════════════════════
-- 181 — A time on every food log (owner, 31.10.2026: "We should have log times
-- for food section so I can see on my diary" — answer: "Now, can change": a
-- log saves the time you log it, the logger and the edit popup show it so it
-- can be changed, a log for another day takes its meal's usual time).
--
--  A. food_log_entries.eaten_time (time of day on the log's own date, minutes;
--     null = not eaten yet — a planned row — or a log from before 181, which
--     keeps no time: the Diary shows it at its meal's usual hour as before).
--  B. trg_food_log_eaten_time fills it for EVERY writer that sends none — the
--     logger, the phone, the assistant, Mark eaten, supplement_take: when the
--     row is eaten and has no time, the moment it was written (an insert's
--     created_at — supplement_take's "Taken at…" sets that — or now for a
--     planned row ticked eaten) if that is on the log's own day in Oslo, else
--     its meal's usual time (food_meal_usual_time, the Diary's own hours:
--     breakfast 07:00, lunch 12:00, snack 15:00, dinner 18:00, supplement
--     21:00 — foodLogUtils.MEAL_USUAL_TIME is the browser's copy, compared by
--     verify-db-food-log-times). A row put back to planned loses its time.
--     A food joining a dish (meal_group_id — added to it, or moved into it)
--     takes the dish's time unless the same write sets its own, so a dish
--     reads as one sitting on Food and in the Diary.
--     A time the writer sends is kept; an eaten row's time cleared on purpose
--     (an Undo putting an older log back) stays clear; a row written before
--     181 ran for a day before it (food_log_times_from — an Undo of a deleted
--     older log puts it back with its old created_at) never gets one, so it
--     comes back exactly as it was. (A dose "Taken at" earlier on the day 181
--     ran still gets its time.)
-- No new table (food_log_entries keeps its row level security, owner lock
-- and audit — a time change is an edit like any other). Re-runnable.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.food_log_entries add column if not exists eaten_time time;

-- The meal's usual time of day — the Diary's hours for a meal (and a log with no clock time).
create or replace function public.food_meal_usual_time(p_slot text)
returns time
language sql
immutable
set search_path = ''
as $$
  select case p_slot
    when 'breakfast'  then time '07:00'
    when 'lunch'      then time '12:00'
    when 'snack'      then time '15:00'
    when 'dinner'     then time '18:00'
    when 'supplement' then time '21:00'
  end
$$;

-- When 181 ran: a log written before it keeps no time (its Undo restore comes back exactly). Made once by the
-- migration (a deploy runs it once; a test's second run only moves it on).
do $mig$
begin
  execute format($f$create or replace function public.food_log_times_from() returns timestamptz
    language sql immutable set search_path = '' as $b$ select %L::timestamptz $b$ $f$, now());
end
$mig$;

create or replace function public.food_log_eaten_time()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_at timestamp;
  v_dish time;
begin
  if new.status is distinct from 'eaten' then
    new.eaten_time := null;
    return new;
  end if;
  -- A food joining a dish takes the dish's time (its earliest), unless this write sets one of its own.
  if new.meal_group_id is not null
     and ((tg_op = 'INSERT' and new.eaten_time is null)
          or (tg_op = 'UPDATE' and new.meal_group_id is distinct from old.meal_group_id
              and new.eaten_time is not distinct from old.eaten_time)) then
    select f.eaten_time into v_dish
      from public.food_log_entries f
     where f.meal_group_id = new.meal_group_id and f.user_id = new.user_id and f.id <> new.id
       and f.status = 'eaten' and f.eaten_time is not null
     order by f.eaten_time
     limit 1;
    if v_dish is not null then
      new.eaten_time := v_dish;
      return new;
    end if;
  end if;
  if new.eaten_time is not null then
    new.eaten_time := date_trunc('minute', date '2000-01-01' + new.eaten_time)::time;
    return new;
  end if;
  -- Only a new log, or a planned row now eaten, gets one: an eaten row's time cleared on purpose stays clear,
  -- and a row from before 181 (an Undo putting a deleted older log back) keeps none.
  if tg_op = 'UPDATE' and old.status = 'eaten' then
    return new;
  end if;
  if tg_op = 'INSERT' and new.created_at < public.food_log_times_from()
     and new.date < (public.food_log_times_from() at time zone 'Europe/Oslo')::date then
    return new;
  end if;
  -- An insert happens at its created_at (supplement_take's chosen time); a planned row ticked eaten now.
  v_at := (case when tg_op = 'INSERT' then coalesce(new.created_at, now()) else now() end) at time zone 'Europe/Oslo';
  new.eaten_time := case when v_at::date = new.date then date_trunc('minute', v_at)::time
                         else public.food_meal_usual_time(new.meal_slot) end;
  return new;
end;
$$;
drop trigger if exists trg_food_log_eaten_time on public.food_log_entries;
create trigger trg_food_log_eaten_time before insert or update of status, eaten_time, meal_group_id on public.food_log_entries
  for each row execute function public.food_log_eaten_time();

revoke all on function public.food_log_times_from() from public, anon;
grant execute on function public.food_log_times_from() to authenticated, service_role;
revoke all on function public.food_meal_usual_time(text) from public, anon;
grant execute on function public.food_meal_usual_time(text) to authenticated, service_role;
revoke all on function public.food_log_eaten_time() from public, anon;
grant execute on function public.food_log_eaten_time() to authenticated, service_role;
