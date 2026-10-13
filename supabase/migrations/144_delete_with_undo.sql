-- 144: one delete with Undo for every table.
--
-- Owner, 12.10.2026 + 13.10.2026: every delete asks first, says what happened
-- and offers Undo — and the app should trust a write's own answer ("like
-- sy-subrc") instead of reading the database again. Before this each feature
-- deleted its own way: some asked, some offered Undo, most did neither, and
-- an Undo that existed put back only the row you tapped, never what the
-- database removed with it (a task's schedule slot, a project's phases and
-- items, the links that pointed at it).
--
-- app_delete_rows(table, ids) deletes the rows and, in the same transaction,
-- returns everything the delete takes with it:
--   groups  — the rows themselves and every row a foreign key deletes with
--             them (ON DELETE CASCADE, followed all the way down), parents
--             first, so they can be inserted back in this order;
--   links   — rows whose foreign key is set to NULL (ON DELETE SET NULL) —
--             their values before, to put back where the link is still empty;
--   touched — rows a rule changes without a foreign key (below), their values
--             before.
-- It returns NULL when nothing was deleted (gone already, or not yours): the
-- caller says "Already deleted" without a second read. Over 10,000 rows (a
-- long-read book's page events) it still deletes but returns `too_big` and no
-- rows: the caller says it can't be undone instead of refusing the delete.
--
-- app_restore_rows(snapshot, overrides) puts it all back with the same ids in
-- one transaction (all or nothing), skipping a row that exists again
-- (ON CONFLICT DO NOTHING). `overrides` replaces columns per table — e.g. a
-- deleted task's old Google ids, which point at things deleted on Google.
--
-- Two rules delete or change rows without a foreign key; they are named here:
--   043: deleting a project item deletes its schedule blocks
--        (time_blocks.source_type = 'project_item');
--   123: deleting a food from the library switches the recipes built from it
--        to typed macros.
--
-- Both run as the caller (SECURITY INVOKER): row level security and the owner
-- lock decide what can be read, deleted and put back, exactly as for any other
-- request. Only identifiers read from the catalogue reach dynamic SQL (%I /
-- regclass); ids and rows travel as parameters.

create or replace function public.app_pk_column(p_table regclass)
returns text
language sql
stable
set search_path = ''
as $$
  select a.attname::text
  from pg_catalog.pg_index i
  join pg_catalog.pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
  where i.indrelid = p_table and i.indisprimary and i.indnatts = 1
$$;

create or replace function public.app_column_type(p_table regclass, p_column text)
returns text
language sql
stable
set search_path = ''
as $$
  select pg_catalog.format_type(a.atttypid, a.atttypmod)
  from pg_catalog.pg_attribute a
  where a.attrelid = p_table and a.attname = p_column and a.attnum > 0 and not a.attisdropped
$$;

-- The columns a row can be written back to (not generated, not GENERATED ALWAYS AS IDENTITY).
create or replace function public.app_writable_columns(p_table regclass, p_except text default null)
returns text
language sql
stable
set search_path = ''
as $$
  select string_agg(pg_catalog.quote_ident(a.attname), ', ' order by a.attnum)
  from pg_catalog.pg_attribute a
  where a.attrelid = p_table and a.attnum > 0 and not a.attisdropped
    and a.attgenerated = '' and a.attidentity <> 'a'
    and a.attname is distinct from p_except
$$;

create or replace function public.app_delete_rows(p_table text, p_ids text[])
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_root    regclass := to_regclass(format('public.%I', p_table));
  v_pk      text;
  v_groups  jsonb := '[]'::jsonb;
  v_links   jsonb := '[]'::jsonb;
  v_touched jsonb := '[]'::jsonb;
  v_hidden  jsonb := '[]'::jsonb;
  v_seen    text[] := '{}';
  v_todo    jsonb;
  v_item    jsonb;
  v_tbl     regclass;
  v_name    text;
  v_tpk     text;
  v_ids     text[];
  v_rows    jsonb;
  v_vals    text[];
  v_cpk     text;
  v_cids    jsonb;
  v_crows   jsonb;
  v_count   integer := 0;
  v_cap     constant integer := 10000;
  v_too_big boolean := false;
  v_deleted integer;
  r         record;
begin
  if v_root is null then
    raise exception 'app_delete_rows: unknown table %', p_table using errcode = '42P01';
  end if;
  v_pk := public.app_pk_column(v_root);
  if v_pk is null then
    raise exception 'app_delete_rows: % has no single-column key', p_table;
  end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then
    return null;
  end if;

  v_todo := jsonb_build_array(jsonb_build_object('t', v_root::oid, 'ids', to_jsonb(p_ids)));
  while jsonb_array_length(v_todo) > 0 loop
    v_item := v_todo -> 0;
    v_todo := v_todo - 0;
    v_tbl  := (v_item ->> 't')::oid::regclass;
    v_name := (select c.relname::text from pg_class c where c.oid = v_tbl);
    v_tpk  := public.app_pk_column(v_tbl);
    select array_agg(x) into v_ids
    from jsonb_array_elements_text(v_item -> 'ids') x
    where not ((v_name || ':' || x) = any (v_seen));
    continue when v_ids is null;
    v_seen := v_seen || array(select v_name || ':' || x from unnest(v_ids) x);

    begin
      execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from %s x where x.%I = any ($1::%s[])',
                     v_tbl, v_tpk, public.app_column_type(v_tbl, v_tpk))
        into v_rows using v_ids;
    exception when insufficient_privilege then
      -- deleted with its parent all the same; it can't be put back
      v_hidden := v_hidden || to_jsonb(v_name);
      continue;
    end;
    continue when jsonb_array_length(v_rows) = 0;
    v_count := v_count + jsonb_array_length(v_rows);
    if v_count > v_cap then
      v_too_big := true;
      exit;
    end if;
    v_groups := v_groups || jsonb_build_object('table', v_name, 'pk', v_tpk, 'rows', v_rows);

    -- Rows that point here by a single-column foreign key in this schema.
    for r in
      select c.conrelid::regclass as child, cc.relname::text as child_name,
             ca.attname::text as col, pa.attname::text as refcol, c.confdeltype as action
      from pg_constraint c
      join pg_class cc on cc.oid = c.conrelid
      join pg_namespace n on n.oid = cc.relnamespace and n.nspname = 'public'
      join pg_attribute ca on ca.attrelid = c.conrelid and ca.attnum = c.conkey[1]
      join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = c.confkey[1]
      where c.contype = 'f' and c.confrelid = v_tbl and array_length(c.conkey, 1) = 1
        and c.confdeltype in ('c', 'n', 'd')
    loop
      select array_agg(e ->> r.refcol) into v_vals
      from jsonb_array_elements(v_rows) e
      where e ->> r.refcol is not null;
      continue when v_vals is null;
      v_cpk := public.app_pk_column(r.child);
      begin
        if r.action = 'c' and v_cpk is not null then
          execute format('select coalesce(jsonb_agg(x.%I::text), ''[]'') from %s x where x.%I = any ($1::%s[])',
                         v_cpk, r.child, r.col, public.app_column_type(r.child, r.col))
            into v_cids using v_vals;
          if jsonb_array_length(v_cids) > 0 then
            v_todo := v_todo || jsonb_build_object('t', r.child::oid, 'ids', v_cids);
          end if;
        else
          execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from %s x where x.%I = any ($1::%s[])',
                         r.child, r.col, public.app_column_type(r.child, r.col))
            into v_crows using v_vals;
          continue when jsonb_array_length(v_crows) = 0;
          v_count := v_count + jsonb_array_length(v_crows);
          continue when v_count > v_cap;
          if r.action = 'c' then
            -- a child with no single key: its rows go back, its own children are not followed
            v_groups := v_groups || jsonb_build_object('table', r.child_name, 'pk', null, 'rows', v_crows);
          elsif v_cpk is not null then
            v_links := v_links || jsonb_build_object('table', r.child_name, 'pk', v_cpk, 'col', r.col, 'rows', v_crows);
          end if;
        end if;
      exception when insufficient_privilege then
        v_hidden := v_hidden || to_jsonb(r.child_name);
      end;
    end loop;

    if v_count > v_cap then
      v_too_big := true;
      exit;
    end if;

    -- 043: a project item's schedule blocks go with it (by source, not a foreign key).
    if v_name = 'project_items' and to_regclass('public.time_blocks') is not null then
      execute 'select coalesce(jsonb_agg(b.id::text), ''[]'') from public.time_blocks b
               where b.source_type = ''project_item'' and b.source_id::text = any ($1)'
        into v_cids using v_ids;
      if jsonb_array_length(v_cids) > 0 then
        v_todo := v_todo || jsonb_build_object('t', 'public.time_blocks'::regclass::oid, 'ids', v_cids);
      end if;
    end if;

    -- 123: recipes built from a deleted food switch to typed macros.
    if v_name = 'recipe_ingredient_library' and to_regclass('public.recipes') is not null then
      execute 'select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.recipes x
               where x.macro_mode = ''from_ingredients''
                 and x.id in (select ri.recipe_id from public.recipe_ingredients ri
                              where ri.library_ingredient_id::text = any ($1))'
        into v_crows using v_ids;
      if jsonb_array_length(v_crows) > 0 then
        v_touched := v_touched || jsonb_build_object('table', 'recipes', 'pk', 'id', 'rows', v_crows);
      end if;
    end if;
  end loop;

  -- A row deleted itself is put back from its group, never as a link.
  select coalesce(jsonb_agg(l || jsonb_build_object('rows', kept)) filter (where jsonb_array_length(kept) > 0), '[]')
    into v_links
  from (
    select l, (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(l -> 'rows') x
               where not (((l ->> 'table') || ':' || (x ->> (l ->> 'pk'))) = any (v_seen))) as kept
    from jsonb_array_elements(v_links) l
  ) s;
  select coalesce(jsonb_agg(l || jsonb_build_object('rows', kept)) filter (where jsonb_array_length(kept) > 0), '[]')
    into v_touched
  from (
    select l, (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements(l -> 'rows') x
               where not (((l ->> 'table') || ':' || (x ->> (l ->> 'pk'))) = any (v_seen))) as kept
    from jsonb_array_elements(v_touched) l
  ) s;

  execute format('delete from %s x where x.%I = any ($1::%s[])', v_root, v_pk, public.app_column_type(v_root, v_pk))
    using p_ids;
  get diagnostics v_deleted = row_count;
  if v_deleted = 0 then
    return null;
  end if;
  if v_too_big then
    -- Deleted all the same; there is just too much to hold for Undo.
    return jsonb_build_object('v', 1, 'root', p_table, 'deleted', v_deleted, 'too_big', true,
                              'groups', '[]'::jsonb, 'links', '[]'::jsonb, 'touched', '[]'::jsonb, 'hidden', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'v', 1, 'root', p_table, 'deleted', v_deleted,
    'groups', v_groups, 'links', v_links, 'touched', v_touched, 'hidden', v_hidden);
end;
$$;

create or replace function public.app_restore_rows(p_snapshot jsonb, p_overrides jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  g        jsonb;
  x        jsonb;
  v_tbl    regclass;
  v_cols   text;
  v_rows   jsonb;
  v_n      integer;
  v_total  integer := 0;
  v_relink integer := 0;
  v_skip   jsonb := '[]'::jsonb;
  v_pktype text;
  v_kind   text;
  v_todo   jsonb;
  v_next   jsonb;
  v_progress boolean;
  v_error  text;
begin
  if p_snapshot is null or p_snapshot ->> 'v' is distinct from '1' then
    raise exception 'app_restore_rows: not a delete snapshot' using errcode = '22023';
  end if;

  -- The deleted rows. They come parents first along each path, but two
  -- paths can meet (an item belongs to a project AND to one of its phases),
  -- so a group whose parent is not back yet waits for the next round.
  v_todo := coalesce(p_snapshot -> 'groups', '[]'::jsonb);
  loop
    v_next := '[]'::jsonb;
    v_progress := false;
    for g in select value from jsonb_array_elements(v_todo) loop
      v_tbl := to_regclass(format('public.%I', g ->> 'table'));
      if v_tbl is null then
        v_skip := v_skip || to_jsonb(g ->> 'table');
        continue;
      end if;
      v_cols := public.app_writable_columns(v_tbl);
      select jsonb_agg(e || coalesce(p_overrides -> (g ->> 'table'), '{}'::jsonb)) into v_rows
      from jsonb_array_elements(g -> 'rows') e;
      begin
        execute format('insert into %s (%s) select %s from jsonb_populate_recordset(null::%s, $1) on conflict do nothing',
                       v_tbl, v_cols, v_cols, v_tbl)
          using v_rows;
        get diagnostics v_n = row_count;
        v_total := v_total + v_n;
        v_progress := true;
      exception
        when foreign_key_violation then
          v_next := v_next || g;
          v_error := sqlerrm;
        when insufficient_privilege then
          v_skip := v_skip || to_jsonb(g ->> 'table');
          v_progress := true;
      end;
    end loop;
    exit when jsonb_array_length(v_next) = 0;
    if not v_progress then
      -- what it pointed at is gone for good (deleted since, or never put back)
      raise exception '%', v_error using errcode = '23503';
    end if;
    v_todo := v_next;
  end loop;

  -- Links the delete emptied (only where still empty) and rows a rule changed.
  foreach v_kind in array array['links', 'touched'] loop
    for g in select value from jsonb_array_elements(coalesce(p_snapshot -> v_kind, '[]'::jsonb)) loop
      v_tbl := to_regclass(format('public.%I', g ->> 'table'));
      continue when v_tbl is null or g ->> 'pk' is null;
      v_cols := public.app_writable_columns(v_tbl, g ->> 'pk');
      v_pktype := public.app_column_type(v_tbl, g ->> 'pk');
      for x in select value from jsonb_array_elements(g -> 'rows') loop
        begin
          if v_kind = 'links' then
            execute format('update %s t set (%s) = (select %s from jsonb_populate_record(null::%s, $1)) '
                           'where t.%I = ($1 ->> %L)::%s and t.%I is null',
                           v_tbl, v_cols, v_cols, v_tbl, g ->> 'pk', g ->> 'pk', v_pktype, g ->> 'col')
              using x;
          else
            execute format('update %s t set (%s) = (select %s from jsonb_populate_record(null::%s, $1)) '
                           'where t.%I = ($1 ->> %L)::%s',
                           v_tbl, v_cols, v_cols, v_tbl, g ->> 'pk', g ->> 'pk', v_pktype)
              using x;
          end if;
          get diagnostics v_n = row_count;
          v_relink := v_relink + v_n;
        exception when insufficient_privilege then
          v_skip := v_skip || to_jsonb(g ->> 'table');
        end;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object('restored', v_total, 'relinked', v_relink,
                            'skipped', (select coalesce(jsonb_agg(distinct s), '[]') from jsonb_array_elements_text(v_skip) s));
end;
$$;

-- Undo of a deleted book puts its reading history back and re-links the
-- questions asked about it: both tables were written only by the Kobo's
-- function, so the owner had no insert (events, questions) or update
-- (questions) of their own. Own rows only, like every other table here.
do $$
begin
  if to_regclass('public.reading_page_events') is not null then
    drop policy if exists reading_page_events_insert on public.reading_page_events;
    create policy reading_page_events_insert on public.reading_page_events
      for insert with check (auth.uid() = user_id);
  end if;
  if to_regclass('public.book_ai_notes') is not null then
    drop policy if exists book_ai_notes_insert on public.book_ai_notes;
    create policy book_ai_notes_insert on public.book_ai_notes
      for insert with check (auth.uid() = user_id);
    drop policy if exists book_ai_notes_update on public.book_ai_notes;
    create policy book_ai_notes_update on public.book_ai_notes
      for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;

revoke all on function public.app_pk_column(regclass) from public, anon;
revoke all on function public.app_column_type(regclass, text) from public, anon;
revoke all on function public.app_writable_columns(regclass, text) from public, anon;
revoke all on function public.app_delete_rows(text, text[]) from public, anon;
revoke all on function public.app_restore_rows(jsonb, jsonb) from public, anon;
grant execute on function public.app_pk_column(regclass) to authenticated;
grant execute on function public.app_column_type(regclass, text) to authenticated;
grant execute on function public.app_writable_columns(regclass, text) to authenticated;
grant execute on function public.app_delete_rows(text, text[]) to authenticated;
grant execute on function public.app_restore_rows(jsonb, jsonb) to authenticated;

comment on function public.app_delete_rows(text, text[]) is
  'Deletes rows by id and returns what went with them (cascaded rows, emptied links, rows a rule changed) for app_restore_rows; NULL when nothing was deleted. Runs as the caller.';
comment on function public.app_restore_rows(jsonb, jsonb) is
  'Puts back an app_delete_rows snapshot with the same ids, all or nothing; overrides replace columns per table.';
