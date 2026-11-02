-- Migration 183, E: a food log's time on the phone's clock. Built by scripts/verify-db-time-zones.mjs on
-- verify-db-food-log-times' database (food-dishes/base.sql, the real 106 and 181), then 183's zone functions and
-- its food rule, twice. Writes run as `authenticated`, the phone's zone as PostgREST hands it over.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
create or replace function public.t_phone(p_zone text) returns void language sql as $$
  select set_config('request.headers', case when p_zone is null then '' else jsonb_build_object('x-time-zone', p_zone)::text end, false)
$$;
grant execute on function public.t_phone(text) to authenticated;
-- The day and minute now on a zone's clock, as the trigger reads them.
create or replace function public.t_day_in(z text) returns date language sql stable as $$ select (now() at time zone z)::date $$;
create or replace function public.t_now_in(z text, t time) returns boolean language sql stable as $$
  select abs(extract(epoch from (date_trunc('minute', now() at time zone z)::time - t))) <= 60
$$;
grant execute on function public.t_day_in(text) to authenticated;
grant execute on function public.t_now_in(text, time) to authenticated;
create or replace function public.t_eaten(p_title text) returns time language sql security definer set search_path = '' as $$
  select eaten_time from public.food_log_entries where custom_title = p_title order by created_at desc limit 1
$$;
grant execute on function public.t_eaten(text) to authenticated;

set role authenticated;
do $$
declare z text;
begin
  -- F1. A phone in Kiritimati (UTC+14, a day ahead of Oslo for half of it): the log of its own today gets its minute.
  z := 'Pacific/Kiritimati';
  perform public.t_phone(z);
  insert into public.food_log_entries (date, meal_slot, custom_title, status, calories) values (public.t_day_in(z), 'snack', 'tz-kiritimati', 'eaten', 100);
  perform t_ok(public.t_now_in(z, public.t_eaten('tz-kiritimati')), 'F1 a log from a phone abroad gets that phone''s minute, not Oslo''s');
  -- F2. The same phone logging its yesterday: that meal's usual time (the rule of 181, on the phone's day).
  insert into public.food_log_entries (date, meal_slot, custom_title, status, calories) values (public.t_day_in(z) - 1, 'lunch', 'tz-yesterday', 'eaten', 100);
  perform t_ok(public.t_eaten('tz-yesterday') = public.food_meal_usual_time('lunch'), 'F2 …and its yesterday gets the meal''s usual time');
  -- F3. A planned row ticked eaten from that phone: the phone's minute too.
  insert into public.food_log_entries (date, meal_slot, custom_title, status, calories) values (public.t_day_in(z), 'dinner', 'tz-planned', 'planned', 100);
  update public.food_log_entries set status = 'eaten' where custom_title = 'tz-planned';
  perform t_ok(public.t_now_in(z, public.t_eaten('tz-planned')), 'F3 a planned meal ticked eaten from a phone abroad gets its minute');
  -- F4. A zone the database doesn't know, and no zone at all (a server writer): Oslo's clock, as before.
  perform public.t_phone('Mars/Olympus_Mons');
  insert into public.food_log_entries (date, meal_slot, custom_title, status, calories) values (public.t_day_in('Europe/Oslo'), 'snack', 'tz-unknown', 'eaten', 100);
  perform t_ok(public.t_now_in('Europe/Oslo', public.t_eaten('tz-unknown')), 'F4 an unknown zone falls back to Oslo''s clock');
  perform public.t_phone(null);
  insert into public.food_log_entries (date, meal_slot, custom_title, status, calories) values (public.t_day_in('Europe/Oslo'), 'snack', 'tz-server', 'eaten', 100);
  perform t_ok(public.t_now_in('Europe/Oslo', public.t_eaten('tz-server')), 'F4 a writer that names no zone (the phone gateway, Scriptable) keeps Oslo''s clock');
  -- F5. A time the writer sends is kept whatever the phone's zone.
  perform public.t_phone(z);
  insert into public.food_log_entries (date, meal_slot, custom_title, status, calories, eaten_time) values (public.t_day_in(z), 'snack', 'tz-sent', 'eaten', 100, '06:15');
  perform t_ok(public.t_eaten('tz-sent') = '06:15', 'F5 a time the owner picked is kept');
  perform public.t_phone(null);
end $$;
reset role;
