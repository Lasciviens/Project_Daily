-- 215 · An item's category add-on fields (owner, 27.11.2026: "Category decides how the task's add-on fields would show
-- up … when you choose cinema it should also show some additional fields like which movie, which cinema, with who and
-- how much it costed"; "Cinema is media."; "Cost not toward my spending no."; "Start with games and media.").
--
-- A. tasks.details (jsonb, null = none): the item's category and that category's add-on fields — Media: its type
--    (movie | tv | cinema), with who, and for a cinema trip the cost, seats and booking reference; Games: "On" (what it
--    is played on, the owner's own words) and with who; every other category: only the category itself (an item with
--    no slot keeps the category the item screen shows at its top). The movie, show or game is NOT here: it is the
--    task's real link (210's columns, app_save_item's p_link); the cinema is the slot's place (186).
--    Why a column and not a table: the details are one small value of one task — they are deleted, restored and
--    undone with it (trg_audit on tasks, app_delete_rows, Activity's Undo) with no foreign key, owner lock, grants or
--    restore order of their own, and a read of the task carries them (the item screen's one load).
-- B. task_details_ok(jsonb): the allow-list, for every writer (a CHECK on the column): an object; a category from the
--    slot's list; per category only its keys; per media type only its fields; names ≤ 40 characters and ≤ 10 of them,
--    seats / booking ≤ 60, On ≤ 30 — each with a character that is not a space and no control character; a cost is
--    {amount, currency}: 0 ≤ amount ≤ 1 000 000 with at most two decimals, the currency from the list cinema visits use.
--    The browser's copy of the rule is items/categoryDetails.cleanDetails (verify-item-details compares the lists).
-- C. app_save_item(p_item, p_link, p_details): the one item save (the 2-argument function, unchanged: the save and its
--    link) and the details in the same transaction. The details are checked before anything is written (22023); a
--    repeating item has no task of its own: it saves and answers details: null. A database without 215 has no
--    3-argument function, so the browser's save is refused before anything is written ("migration 215 not applied").
--
-- Security (AGENTS.md → the warning): every value is input — the browser, a stolen session, a direct table write. The
-- CHECK holds for every writer; nothing here is put into SQL, a URL, a header or an iCalendar line (Apple's event is
-- built from the task's title and notes only — icloud_task_changed does not watch this column, and 071's Google Tasks
-- outbox only fields Google shows). The cost is never spending: no money table or function reads this column. A
-- confirmed Ask AI proposal never writes it (its column lists are fixed; verify-ai-confirm). SECURITY INVOKER with
-- search_path '': the caller's rights and row security, every query scoped to the caller's own task.
-- Not in app_undo_links: nothing here names an outside copy. No new table.

-- ── B. The rule (before the column's CHECK names it) ───────────────────────────

create or replace function public.task_details_text_ok(p jsonb, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'string'
     and char_length(p #>> '{}') <= p_max
     and (p #>> '{}') ~ '\S'
     and (p #>> '{}') !~ '[[:cntrl:]]'
$$;
revoke all on function public.task_details_text_ok(jsonb, integer) from public, anon;
grant execute on function public.task_details_text_ok(jsonb, integer) to authenticated, service_role;

create or replace function public.task_details_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null
     and jsonb_typeof(p) = 'object'
     and char_length(p::text) <= 2000
     and coalesce(p ->> 'category', '') in ('daily', 'training', 'media', 'games', 'work', 'projects', 'football', 'other')
     -- Each category's keys, and each media type's fields.
     and not exists (
       select 1 from jsonb_object_keys(p) k
        where k <> 'category'
          and not case p ->> 'category'
                    when 'media' then k in ('type', 'with') or (k in ('cost', 'seats', 'booking') and p ->> 'type' = 'cinema')
                    when 'games' then k in ('on', 'with')
                    else false
                  end)
     and (not p ? 'type' or p -> 'type' in ('"movie"'::jsonb, '"tv"'::jsonb, '"cinema"'::jsonb))
     and (not p ? 'with' or (
           jsonb_typeof(p -> 'with') = 'array'
           and jsonb_array_length(p -> 'with') between 1 and 10
           and not exists (select 1 from jsonb_array_elements(p -> 'with') n where not public.task_details_text_ok(n, 40))))
     and (not p ? 'seats' or public.task_details_text_ok(p -> 'seats', 60))
     and (not p ? 'booking' or public.task_details_text_ok(p -> 'booking', 60))
     and (not p ? 'on' or public.task_details_text_ok(p -> 'on', 30))
     and (not p ? 'cost' or (
           jsonb_typeof(p -> 'cost') = 'object'
           and not exists (select 1 from jsonb_object_keys(p -> 'cost') k where k not in ('amount', 'currency'))
           and jsonb_typeof(p #> '{cost,amount}') = 'number'
           and (p #>> '{cost,amount}')::numeric between 0 and 1000000
           and (p #>> '{cost,amount}')::numeric = round((p #>> '{cost,amount}')::numeric, 2)
           and p #> '{cost,currency}' in ('"NOK"'::jsonb, '"TRY"'::jsonb, '"EUR"'::jsonb, '"USD"'::jsonb)))
$$;
revoke all on function public.task_details_ok(jsonb) from public, anon;
grant execute on function public.task_details_ok(jsonb) to authenticated, service_role;
comment on function public.task_details_ok(jsonb) is
  'An item''s category add-on fields (215): the allow-list every writer meets (tasks_details_ok). Its browser copy is items/categoryDetails.cleanDetails.';

-- ── A. The column ──────────────────────────────────────────────────────────────

alter table public.tasks add column if not exists details jsonb;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_details_ok' and conrelid = 'public.tasks'::regclass) then
    alter table public.tasks add constraint tasks_details_ok check (details is null or public.task_details_ok(details));
  end if;
end
$$;
comment on column public.tasks.details is
  'The item''s category and its add-on fields (215; items/categoryDetails.ts): never spending, never sent to Apple or Google.';

-- ── C. The item save with its details ──────────────────────────────────────────

create or replace function public.app_save_item(p_item jsonb, p_link jsonb, p_details jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_details jsonb := case when p_details is null or jsonb_typeof(p_details) = 'null' then null else p_details end;
  v_answer  jsonb;
  v_task    uuid;
begin
  if v_user is null then
    raise exception 'app_save_item: not signed in' using errcode = '28000';
  end if;
  -- Before anything is written: details the database would refuse are refused here, with the save's own message.
  if v_details is not null and not public.task_details_ok(v_details) then
    raise exception 'app_save_item: those details can''t be saved' using errcode = '22023';
  end if;

  v_answer := public.app_save_item(p_item, p_link);
  v_task := nullif(v_answer ->> 'taskId', '')::uuid;
  -- A repeating item has no task of its own (its days are tasks of the repeat).
  if v_task is null then
    return v_answer || jsonb_build_object('details', null);
  end if;

  update public.tasks set details = v_details
   where id = v_task and user_id = v_user and details is distinct from v_details;
  if not exists (select 1 from public.tasks x where x.id = v_task and x.user_id = v_user) then
    raise exception 'This item is not there any more' using errcode = 'IT004';
  end if;

  return v_answer || jsonb_build_object('details', v_details);
end
$$;
revoke all on function public.app_save_item(jsonb, jsonb, jsonb) from public, anon, service_role;
grant execute on function public.app_save_item(jsonb, jsonb, jsonb) to authenticated;
comment on function public.app_save_item(jsonb, jsonb, jsonb) is
  'The item save with its link and its details (215): app_save_item(p_item, p_link) and the task''s category add-on fields, in one transaction. Edit the save itself in app_save_item(jsonb), the link in app_save_item(jsonb, jsonb).';
