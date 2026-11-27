-- 215 · An item's category add-on fields (owner, 27.11.2026: "Category decides how the task's add-on fields would show
-- up … when you choose cinema it should also show some additional fields like which movie, which cinema, with who and
-- how much it costed"; "Cinema is media."; "Cost not toward my spending no."; "Start with games and media.").
--
-- A. tasks.details (jsonb, null = none): the category's add-on fields — Media: its type (movie | tv | cinema), with
--    who, and for a cinema trip the cost, seats and booking reference; Games: "On" (what it is played on, the owner's
--    own words) and with who. One source for each fact: the category and a cinema trip's cinema are kept here ONLY for
--    an item with no slot and no repeat (one with either has them on its slot or repeat: its category, its place) —
--    the save takes them out otherwise. The movie, show or game is NOT here: it is the task's real link (210's columns,
--    app_save_item's p_link).
--    Why a column and not a table: the details are one small value of one task — they are deleted, restored and
--    undone with it (trg_audit on tasks, app_delete_rows, Activity's Undo) with no foreign key, owner lock, grants or
--    restore order of their own, and a read of the task carries them (the item screen's one load).
-- B. task_details_ok(jsonb): the allow-list, for every writer (a CHECK on the column): an object, not empty; a category (when
--    there) from the slot's list and only its keys — without one, the add-on keys of Media or of Games, never both; per
--    media type only its fields (cost, seats, booking, cinema: a cinema trip's); names ≤ 40 characters and ≤ 10 of
--    them, seats / booking / cinema ≤ 60, On ≤ 30 — each with a character that is not a space, no control character
--    and no invisible format character (Unicode's Cf, every one — U+00AD, U+200B–U+200F, the direction overrides, the
--    word joiners, U+FEFF, the tag characters …: a name that reads one way and is stored another); a cost is {amount, currency}: 0 ≤ amount ≤ 1 000 000 with at most two decimals, the
--    currency from the list cinema visits use.
--    The browser's copy of the rule is items/categoryDetails.cleanDetails (verify-item-details compares the lists).
-- C. app_save_item(p_item, p_link, p_details): the one item save (the 2-argument function, unchanged: the save and its
--    link) and the details in the same transaction. The details are checked before anything is written (22023); a
--    repeating item has no task of its own: it saves and answers details: null. p_link {"kind":"none"} takes the
--    movie, show or game the task plans off it (an edit; 210's p_link null keeps it) — the label (source_type) stays
--    as it was, so no later save links it again. A database without 215 has no 3-argument function, so the browser's
--    save is refused before anything is written ("migration 215 not applied").
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
     -- Unicode's format characters (Cf), every one (the browser's /\p{Cf}/u; verify-db-item-details compares the lists).
     and (p #>> '{}') !~ '[\u00AD\u0600-\u0605\u061C\u06DD\u070F\u0890-\u0891\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB\U000110BD\U000110CD\U00013430-\U0001343F\U0001BCA0-\U0001BCA3\U0001D173-\U0001D17A\U000E0001\U000E0020-\U000E007F]'
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
     and p <> '{}'::jsonb
     and char_length(p::text) <= 2000
     and (not p ? 'category' or (jsonb_typeof(p -> 'category') = 'string'
          and p ->> 'category' in ('daily', 'training', 'media', 'games', 'work', 'projects', 'football', 'other')))
     -- Each category's keys (without one: Media's or Games', never both), and each media type's fields.
     and not (p ? 'on' and p ? 'type')
     and not exists (
       select 1 from jsonb_object_keys(p) k
        where k <> 'category'
          -- coalesce: a key the rule can't decide on (no type: NULL) is refused, never let through.
          and not coalesce(case coalesce(p ->> 'category', '')
                    when 'media' then k in ('type', 'with') or (k in ('cost', 'seats', 'booking', 'cinema') and coalesce(p ->> 'type', '') = 'cinema')
                    when 'games' then k in ('on', 'with')
                    when '' then k in ('type', 'with', 'on') or (k in ('cost', 'seats', 'booking', 'cinema') and coalesce(p ->> 'type', '') = 'cinema')
                    else false
                  end, false))
     and (not p ? 'type' or p -> 'type' in ('"movie"'::jsonb, '"tv"'::jsonb, '"cinema"'::jsonb))
     and (not p ? 'with' or (
           jsonb_typeof(p -> 'with') = 'array'
           and jsonb_array_length(p -> 'with') between 1 and 10
           and not exists (select 1 from jsonb_array_elements(p -> 'with') n where not public.task_details_text_ok(n, 40))))
     and (not p ? 'seats' or public.task_details_text_ok(p -> 'seats', 60))
     and (not p ? 'booking' or public.task_details_text_ok(p -> 'booking', 60))
     and (not p ? 'cinema' or public.task_details_text_ok(p -> 'cinema', 60))
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
  -- {"kind":"none"}: take the movie, show or game off the task (an edit's ×, or a category that can't hold it).
  v_remove  boolean := p_link is not null and jsonb_typeof(p_link) = 'object' and p_link = '{"kind": "none"}'::jsonb;
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

  v_answer := public.app_save_item(p_item, case when v_remove then null else p_link end);
  v_task := nullif(v_answer ->> 'taskId', '')::uuid;
  -- A repeating item has no task of its own (its days are tasks of the repeat).
  if v_task is null then
    return v_answer || jsonb_build_object('details', null);
  end if;
  if not exists (select 1 from public.tasks x where x.id = v_task and x.user_id = v_user) then
    raise exception 'This item is not there any more' using errcode = 'IT004';
  end if;

  if v_remove then
    update public.tasks set movie_entry_id = null, tv_entry_id = null, link_season = null, link_episode = null, game_id = null
     where id = v_task and user_id = v_user
       and num_nonnulls(movie_entry_id, tv_entry_id, game_id) > 0;
    v_answer := v_answer || jsonb_build_object('link', null);
  end if;

  -- One source: an item with a slot or a repeat keeps its category and its place there, never here too.
  if v_details is not null and (
       exists (select 1 from public.time_blocks b where b.task_id = v_task and b.user_id = v_user)
       or exists (select 1 from public.tasks x where x.id = v_task and x.user_id = v_user and x.schedule_block_id is not null)) then
    v_details := v_details - 'category' - 'cinema';
  end if;
  if v_details = '{}'::jsonb then
    v_details := null;
  end if;

  update public.tasks set details = v_details
   where id = v_task and user_id = v_user and details is distinct from v_details;

  return v_answer || jsonb_build_object('details', v_details);
end
$$;
revoke all on function public.app_save_item(jsonb, jsonb, jsonb) from public, anon, service_role;
grant execute on function public.app_save_item(jsonb, jsonb, jsonb) to authenticated;
comment on function public.app_save_item(jsonb, jsonb, jsonb) is
  'The item save with its link and its details (215): app_save_item(p_item, p_link) and the task''s category add-on fields, in one transaction. Edit the save itself in app_save_item(jsonb), the link in app_save_item(jsonb, jsonb).';
