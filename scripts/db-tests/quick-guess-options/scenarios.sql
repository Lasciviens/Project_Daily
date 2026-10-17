-- Migration 159's scenarios (quick_guess_items.options), after 159 ran twice.
-- Setup and the catalogue checks run as the superuser; every read and write
-- of the presets runs as `authenticated`, under row level security and the
-- owner lock, like the app. Each `ok` raises on a mismatch.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
grant select on public.t_before to authenticated;

-- An options value the table must take (stored as sent) or refuse (check_violation).
create or replace function public.t_takes(p jsonb, msg text) returns void language plpgsql as $$
begin
  update public.quick_guess_items set options = p where name = 'Pizza';
  perform t_ok((select options = p from public.quick_guess_items where name = 'Pizza'), msg);
end $$;
create or replace function public.t_refuses(p jsonb, msg text) returns void language plpgsql as $$
begin
  begin
    update public.quick_guess_items set options = p where name = 'Pizza';
    perform t_ok(false, msg);
  exception when check_violation then perform t_ok(true, msg);
  end;
end $$;
grant execute on function public.t_takes(jsonb, text) to authenticated;
grant execute on function public.t_refuses(jsonb, text) to authenticated;

-- ── 1. The column, its check and the function ───────────────────────────────
select t_ok((select data_type = 'jsonb' and is_nullable = 'NO' and column_default like '''[]''::jsonb%'
               from information_schema.columns where table_name = 'quick_guess_items' and column_name = 'options'),
            'O1 options is jsonb, not null, default []');
select t_ok((select count(*) from pg_constraint where conrelid = 'public.quick_guess_items'::regclass and conname = 'quick_guess_items_options_shape') = 1,
            'O1 one shape check (a second run added none)');
select t_ok((select provolatile = 'i' from pg_proc where proname = 'quick_guess_options_ok'), 'O1 the check function is immutable');
select t_ok(has_function_privilege('authenticated', 'public.quick_guess_options_ok(jsonb)', 'execute'), 'O1 authenticated may run the check function');
select t_ok(col_description('public.quick_guess_items'::regclass,
              (select attnum from pg_attribute where attrelid = 'public.quick_guess_items'::regclass and attname = 'options')) like 'Up to 3 option groups%',
            'O1 the column is described');
select t_ok((select count(*) from pg_trigger where tgrelid = 'public.quick_guess_items'::regclass and not tgisinternal) = 2,
            'O1 152''s two triggers, nothing new');

-- ── 2. Rows that existed before 159 ─────────────────────────────────────────
select t_ok((select bool_and(options = '[]'::jsonb) from quick_guess_items), 'O2 every existing preset has no options');
select t_ok((select count(*) from quick_guess_items where name = 'Pizza') = 1, 'O2 the preset added before 159 is still there');
select t_ok((select count(*) from audit_logs where table_name = 'quick_guess_items') = (select v from t_before where k = 'audit'),
            'O2 159 wrote nothing to the activity log');

-- ── 3. Options as the app writes them ──────────────────────────────────────
set role authenticated;
select t_takes('[
  {"name": "On it", "pick": "one", "choices": [
    {"name": "Margherita", "calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0, "sugar_g": 0},
    {"name": "Chicken", "calories": 90, "protein_g": 9, "carbs_g": 0, "fat_g": 3, "sugar_g": 0},
    {"name": "Pepperoni", "calories": 120, "protein_g": 5, "carbs_g": 1, "fat_g": 10, "sugar_g": 0}]},
  {"name": "Extra", "pick": "any", "choices": [
    {"name": "Cheese", "calories": 80, "protein_g": 5, "carbs_g": 0, "fat_g": 6, "sugar_g": 0},
    {"name": "Garlic dressing", "calories": 110, "protein_g": 0, "carbs_g": 2, "fat_g": 11, "sugar_g": 1}]},
  {"name": "Size", "pick": "size", "choices": [{"name": "Small", "factor": 0.75}, {"name": "Large", "factor": 1.5}]}
]'::jsonb, 'O3 three groups (one, any, size) are stored as sent');
select t_takes('[]'::jsonb, 'O3 options can be cleared to []');
select t_takes('[{"name": "Size", "pick": "size", "choices": [{"name": "Huge", "factor": 10}]}]'::jsonb, 'O3 a factor of exactly 10');
select t_takes('[{"name": "Extra", "pick": "any", "choices": [{"name": "Plain"}]}]'::jsonb, 'O3 an adding choice without macros (they are 0)');
select t_takes(jsonb_build_array(jsonb_build_object('name', repeat('g', 30), 'pick', 'one', 'choices',
                 jsonb_build_array(jsonb_build_object('name', repeat('c', 30), 'calories', 5000, 'protein_g', 500, 'carbs_g', 1000, 'fat_g', 500, 'sugar_g', 1000)))),
               'O3 30-character names and every macro at its limit');
select t_takes((select jsonb_agg(jsonb_build_object('name', 'G' || g, 'pick', 'any', 'choices',
                  (select jsonb_agg(jsonb_build_object('name', 'C' || c, 'calories', c)) from generate_series(1, 6) c)))
                from generate_series(1, 3) g), 'O3 three groups of six choices');
select t_takes('[{"name": "Æble", "pick": "one", "choices": [{"name": "Rømme", "calories": 60}, {"name": "Smør på brød", "calories": 70}]}]'::jsonb,
               'O3 names keep æ, ø and å');
reset role;
select t_ok(exists (select 1 from audit_logs where table_name = 'quick_guess_items' and operation = 'UPDATE'
                     and new_data -> 'options' -> 0 ->> 'name' = 'On it' and old_data -> 'options' = '[]'::jsonb),
            'O3 an options change is in the activity log with the old value');

-- ── 4. What the check refuses ──────────────────────────────────────────────
set role authenticated;
select t_refuses('{}'::jsonb, 'O4 an object instead of an array');
select t_refuses('"pizza"'::jsonb, 'O4 a string instead of an array');
select t_refuses((select jsonb_agg(jsonb_build_object('name', 'G' || g, 'pick', 'one', 'choices', '[{"name": "x"}]'::jsonb)) from generate_series(1, 4) g),
                 'O4 four groups');
select t_refuses(jsonb_build_array(jsonb_build_object('name', 'G', 'pick', 'any', 'choices',
                   (select jsonb_agg(jsonb_build_object('name', 'C' || c)) from generate_series(1, 7) c))), 'O4 seven choices in a group');
select t_refuses('[{"name": "Extra", "pick": "any", "choices": []}]'::jsonb, 'O4 a group without choices');
select t_refuses('[{"name": "Extra", "pick": "any"}]'::jsonb, 'O4 a group with no choices list');
select t_refuses('[{"name": "  ", "pick": "any", "choices": [{"name": "x"}]}]'::jsonb, 'O4 a blank group name');
select t_refuses(jsonb_build_array(jsonb_build_object('name', repeat('g', 31), 'pick', 'one', 'choices', '[{"name": "x"}]'::jsonb)), 'O4 a 31-character group name');
select t_refuses('[{"pick": "any", "choices": [{"name": "x"}]}]'::jsonb, 'O4 a group without a name');
select t_refuses('[{"name": "Extra", "pick": "many", "choices": [{"name": "x"}]}]'::jsonb, 'O4 an unknown pick');
select t_refuses('[{"name": "Extra", "choices": [{"name": "x"}]}]'::jsonb, 'O4 a group without a pick');
select t_refuses('["Extra"]'::jsonb, 'O4 a group that is not an object');
select t_refuses('[{"name": "Extra", "pick": "any", "choices": ["Cheese"]}]'::jsonb, 'O4 a choice that is not an object');
select t_refuses('[{"name": "Extra", "pick": "any", "choices": [{"name": ""}]}]'::jsonb, 'O4 a choice without a name');
select t_refuses(jsonb_build_array(jsonb_build_object('name', 'Extra', 'pick', 'any', 'choices', jsonb_build_array(jsonb_build_object('name', repeat('c', 31))))),
                 'O4 a 31-character choice name');
select t_refuses('[{"name": "Extra", "pick": "any", "choices": [{"name": "Diet", "calories": -50}]}]'::jsonb, 'O4 a choice that adds below 0 kcal');
select t_refuses('[{"name": "Extra", "pick": "any", "choices": [{"name": "Shake", "protein_g": 501}]}]'::jsonb, 'O4 a choice over the protein limit');
select t_refuses('[{"name": "Extra", "pick": "any", "choices": [{"name": "Cake", "calories": 5001}]}]'::jsonb, 'O4 a choice over 5000 kcal');
select t_refuses('[{"name": "Extra", "pick": "any", "choices": [{"name": "Cheese", "calories": "80"}]}]'::jsonb, 'O4 kcal written as text');
select t_refuses('[{"name": "Size", "pick": "size", "choices": [{"name": "Large"}]}]'::jsonb, 'O4 a size without a factor');
select t_refuses('[{"name": "Size", "pick": "size", "choices": [{"name": "None", "factor": 0}]}]'::jsonb, 'O4 a factor of 0');
select t_refuses('[{"name": "Size", "pick": "size", "choices": [{"name": "Giant", "factor": 10.5}]}]'::jsonb, 'O4 a factor over 10');
select t_refuses('[{"name": "Size", "pick": "size", "choices": [{"name": "Large", "factor": "1.5"}]}]'::jsonb, 'O4 a factor written as text');
do $$
begin
  update public.quick_guess_items set options = null where name = 'Pizza';
  perform t_ok(false, 'O4 options can''t be null');
exception when not_null_violation then perform t_ok(true, 'O4 options can''t be null');
end $$;
-- an insert that leaves options out gets []
insert into public.quick_guess_items (name, calories) values ('Plain', 100);
select t_ok((select options = '[]'::jsonb from public.quick_guess_items where name = 'Plain'), 'O4 an insert without options gets []');
reset role;
select t_ok(not public.quick_guess_options_ok(null) and public.quick_guess_options_ok('[]'), 'O4 the function: null is not options, [] is');

-- ── 5. Delete with Undo (144) keeps the options ────────────────────────────
set role authenticated;
select t_takes('[{"name": "Size", "pick": "size", "choices": [{"name": "Large", "factor": 1.5}]}]'::jsonb, 'O5 a preset with options');
do $$
declare s jsonb; r jsonb; v_id uuid := (select id from public.quick_guess_items where name = 'Pizza');
begin
  s := public.app_delete_rows('quick_guess_items', array[v_id::text]);
  perform t_ok((s ->> 'deleted')::int = 1, 'O5 the delete reports one row');
  r := public.app_restore_rows(s, '{}'::jsonb);
  perform t_ok((r ->> 'restored')::int = 1, 'O5 Undo puts it back');
  perform t_ok((select options -> 0 -> 'choices' -> 0 ->> 'factor' from public.quick_guess_items where id = v_id) = '1.5', 'O5 with its options');
end $$;
reset role;
