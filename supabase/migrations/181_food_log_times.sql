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
--     A time the writer sends is kept; an eaten row's time cleared on purpose
--     (an Undo putting an older log back) stays clear.
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

create or replace function public.food_log_eaten_time()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_at timestamp;
begin
  if new.status is distinct from 'eaten' then
    new.eaten_time := null;
    return new;
  end if;
  if new.eaten_time is not null then
    new.eaten_time := date_trunc('minute', date '2000-01-01' + new.eaten_time)::time;
    return new;
  end if;
  -- Only a new log, or a planned row now eaten, gets one: an eaten row's time cleared on purpose stays clear.
  if tg_op = 'UPDATE' and old.status = 'eaten' then
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
create trigger trg_food_log_eaten_time before insert or update of status, eaten_time on public.food_log_entries
  for each row execute function public.food_log_eaten_time();

revoke all on function public.food_meal_usual_time(text) from public, anon;
grant execute on function public.food_meal_usual_time(text) to authenticated, service_role;
revoke all on function public.food_log_eaten_time() from public, anon;
grant execute on function public.food_log_eaten_time() to authenticated, service_role;
