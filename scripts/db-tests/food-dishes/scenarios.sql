-- Migrations 157 (recipe portions and batches) and 158 (a dish's name)
-- scenarios, after 106, then 157 and 158 twice each. Setup and the catalogue
-- checks run as the superuser; every write runs as `authenticated`, under row
-- level security, like the app. Each `ok` raises on a mismatch.
create or replace function public.t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  if not coalesce(c, false) then raise exception 'FAIL  %', msg; end if;
  raise notice 'ok  %', msg;
end $$;
grant execute on function public.t_ok(boolean, text) to authenticated;
-- A write that must be refused: runs `sql`, passes when it raises check_violation.
create or replace function public.t_refused(sql text, msg text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when check_violation then
    raise notice 'ok  %', msg;
    return;
  end;
  raise exception 'FAIL  % (the write went through)', msg;
end $$;
grant execute on function public.t_refused(text, text) to authenticated;

-- ── 1. 157's columns and guards ─────────────────────────────────────────────
select t_ok((select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by column_name)
               from information_schema.columns where table_name = 'recipes'
                and column_name in ('serving_label', 'batch_started_at', 'batch_servings', 'batch_cooked_g'))
              = 'batch_cooked_g:numeric:YES,batch_servings:numeric:YES,batch_started_at:timestamp with time zone:YES,serving_label:text:YES',
            'P1 recipes gains serving_label, batch_started_at, batch_servings, batch_cooked_g, all nullable');
select t_ok((select count(*) from pg_constraint where conrelid = 'public.recipes'::regclass
              and conname in ('recipes_serving_label_len', 'recipes_batch_servings_range', 'recipes_batch_cooked_g_range', 'recipes_batch_has_start')) = 4,
            'P1 the four guards, once each (157 ran twice)');
select t_ok((select count(*) from pg_trigger where tgrelid = 'public.recipes'::regclass and not tgisinternal) = 3,
            'P1 no new trigger on recipes (106''s two, trg_audit and nothing else)');

-- ── 2. A batch beside 106's derived totals ──────────────────────────────────
set role authenticated;
insert into public.recipe_ingredient_library (id, name, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g)
values ('10000000-0000-0000-0000-000000000001', 'Kjøttdeig', 200, 20, 0, 13, 0, 0),
       ('10000000-0000-0000-0000-000000000002', 'Ris', 130, 2.7, 28, 0.3, 0.4, 0.1);
insert into public.recipes (id, title, servings, macro_mode) values ('20000000-0000-0000-0000-000000000001', 'Køfte', 20, 'from_ingredients');
insert into public.recipe_ingredients (recipe_id, name, quantity, unit, library_ingredient_id)
values ('20000000-0000-0000-0000-000000000001', 'Kjøttdeig', 1000, 'g', '10000000-0000-0000-0000-000000000001');
select t_ok((select calories from public.recipes where id = '20000000-0000-0000-0000-000000000001') = 100,
            'P2 106 still works out the per-serving macros (2000 kcal ÷ 20)');
insert into public.food_log_entries (id, date, meal_slot, recipe_id, quantity, unit)
values ('30000000-0000-0000-0000-000000000001', '2026-10-16', 'dinner', '20000000-0000-0000-0000-000000000001', 3, 'serving');
select t_ok((select calories from public.food_log_entries where id = '30000000-0000-0000-0000-000000000001') = 300,
            'P2 three pieces eaten = 300 kcal (106''s diary trigger)');
update public.recipes set serving_label = 'piece', batch_started_at = '2026-10-16 17:00+02', batch_servings = 20, batch_cooked_g = 1800
where id = '20000000-0000-0000-0000-000000000001';
select t_ok((select serving_label || ' · ' || batch_servings || ' · ' || batch_cooked_g from public.recipes where id = '20000000-0000-0000-0000-000000000001')
              = 'piece · 20 · 1800', 'P2 a portion name, a batch of 20 and a weighed pot are stored');
select t_ok((select calories from public.recipes where id = '20000000-0000-0000-0000-000000000001') = 100
              and (select calories from public.food_log_entries where id = '30000000-0000-0000-0000-000000000001') = 300,
            'P2 starting a batch touches no macros, on the recipe or the diary');
reset role;
select t_ok(exists (select 1 from audit_logs where table_name = 'recipes' and operation = 'UPDATE'
                      and new_data ? 'batch_servings' and new_data ? 'serving_label'),
            'P2 the batch is in the activity log (recipes keeps trg_audit)');
set role authenticated;
update public.recipes set batch_started_at = '2026-10-17 12:00+02', batch_servings = 12, batch_cooked_g = null
where id = '20000000-0000-0000-0000-000000000001';
select t_ok((select batch_servings = 12 and batch_cooked_g is null from public.recipes where id = '20000000-0000-0000-0000-000000000001'),
            'P2 "New batch" replaces the batch and forgets the old pot weight');

-- ── 3. The guards refuse typos ──────────────────────────────────────────────
select t_refused($q$update public.recipes set serving_label = '' where title = 'Køfte'$q$, 'P3 an empty portion name is refused (NULL means "portion")');
select t_refused($q$update public.recipes set serving_label = '   ' where title = 'Køfte'$q$, 'P3 a blank portion name is refused');
select t_refused($q$update public.recipes set serving_label = repeat('x', 31) where title = 'Køfte'$q$, 'P3 a portion name over 30 characters is refused');
select t_refused($q$update public.recipes set batch_servings = 0 where title = 'Køfte'$q$, 'P3 a batch of 0 servings is refused');
select t_refused($q$update public.recipes set batch_servings = 1001 where title = 'Køfte'$q$, 'P3 a batch over 1000 servings is refused');
select t_refused($q$update public.recipes set batch_cooked_g = 0 where title = 'Køfte'$q$, 'P3 a pot of 0 g is refused');
select t_refused($q$update public.recipes set batch_started_at = null where title = 'Køfte'$q$, 'P3 a batch size without a start is refused');
select t_refused($q$insert into public.recipes (title, servings, batch_servings) values ('Soup', 4, 4)$q$, 'P3 a new recipe with a batch but no start is refused');
insert into public.recipes (title, servings) values ('Plain', 2);
select t_ok((select serving_label is null and batch_started_at is null and batch_servings is null and batch_cooked_g is null
               from public.recipes where title = 'Plain'), 'P3 a recipe without a batch reads NULL everywhere ("portion", no leftovers)');

-- ── 4. 158's column, guard and trigger ──────────────────────────────────────
reset role;
select t_ok((select data_type || ':' || is_nullable from information_schema.columns
               where table_name = 'food_log_entries' and column_name = 'meal_group_title') = 'text:YES',
            'G1 food_log_entries.meal_group_title, nullable text');
select t_ok((select count(*) from pg_constraint where conname = 'food_log_entries_group_title_check') = 1, 'G1 the guard, once (158 ran twice)');
select t_ok((select count(*) from pg_trigger where tgrelid = 'public.food_log_entries'::regclass
              and tgname = 'trg_food_log_entries_group_title') = 1, 'G1 the name trigger, once');

-- ── 5. A dish's name on every row ───────────────────────────────────────────
set role authenticated;
insert into public.food_log_entries (date, meal_slot, custom_title, calories, meal_group_id, meal_group_title) values
  ('2026-10-16', 'dinner', 'Tortilla', 340, '40000000-0000-0000-0000-00000000000a', 'Taco plate'),
  ('2026-10-16', 'dinner', 'Beef', 200, '40000000-0000-0000-0000-00000000000a', 'Taco plate'),
  ('2026-10-16', 'dinner', 'Salsa', 30, '40000000-0000-0000-0000-00000000000a', null);
select t_ok((select count(*) from public.food_log_entries where meal_group_id = '40000000-0000-0000-0000-00000000000a' and meal_group_title = 'Taco plate') = 3,
            'G2 a new dish logged in one go has its name on every row (a row sent without it takes it)');
insert into public.food_log_entries (date, meal_slot, custom_title, calories, meal_group_id, meal_group_title)
values ('2026-10-16', 'dinner', 'Cheese', 110, '40000000-0000-0000-0000-00000000000a', 'Something else');
select t_ok((select meal_group_title from public.food_log_entries where custom_title = 'Cheese') = 'Taco plate',
            'G3 a row that joins a dish takes the dish''s name, whatever it sent');
update public.food_log_entries set meal_group_title = 'Tacos' where meal_group_id = '40000000-0000-0000-0000-00000000000a';
select t_ok((select count(*) from public.food_log_entries where meal_group_title = 'Tacos') = 4, 'G4 a rename reaches every row');
reset role;
select t_ok((select count(*) from audit_logs where table_name = 'food_log_entries' and operation = 'UPDATE'
              and old_data ->> 'meal_group_title' = 'Taco plate' and new_data ->> 'meal_group_title' = 'Tacos') = 4,
            'G4 the rename is in the activity log, one change per row');
set role authenticated;
update public.food_log_entries set meal_group_id = null where custom_title = 'Cheese';
select t_ok((select meal_group_title is null from public.food_log_entries where custom_title = 'Cheese')
              and (select count(*) from public.food_log_entries where meal_group_title = 'Tacos') = 3,
            'G5 "Move out of meal" drops the name from that row only');
insert into public.food_log_entries (date, meal_slot, custom_title, calories, meal_group_title)
values ('2026-10-16', 'snack', 'Apple', 80, 'Fruit plate');
select t_ok((select meal_group_title is null from public.food_log_entries where custom_title = 'Apple'), 'G6 a name on a row in no dish is dropped');
update public.food_log_entries set date = '2026-10-15', meal_slot = 'lunch' where meal_group_id = '40000000-0000-0000-0000-00000000000a';
select t_ok((select count(*) from public.food_log_entries where meal_group_id = '40000000-0000-0000-0000-00000000000a'
              and date = '2026-10-15' and meal_slot = 'lunch' and meal_group_title = 'Tacos') = 3,
            'G7 moving a dish to another day and meal keeps its name');
update public.food_log_entries set meal_group_id = null where meal_group_id = '40000000-0000-0000-0000-00000000000a';
select t_ok((select count(*) from public.food_log_entries where custom_title in ('Tortilla', 'Beef', 'Salsa') and meal_group_title is null) = 3,
            'G8 ungrouping drops the name from every row');
update public.food_log_entries set meal_group_id = '40000000-0000-0000-0000-00000000000a', meal_group_title = 'Tacos'
where custom_title in ('Tortilla', 'Beef', 'Salsa');
select t_ok((select count(*) from public.food_log_entries where meal_group_id = '40000000-0000-0000-0000-00000000000a' and meal_group_title = 'Tacos') = 3,
            'G8 Undo of the ungroup puts the dish and its name back on every row');
insert into public.food_log_entries (date, meal_slot, custom_title, calories, meal_group_id) values
  ('2026-10-15', 'lunch', 'Rice', 260, '40000000-0000-0000-0000-00000000000b'),
  ('2026-10-15', 'lunch', 'Chicken', 160, '40000000-0000-0000-0000-00000000000b');
update public.food_log_entries set meal_group_id = '40000000-0000-0000-0000-00000000000a' where custom_title = 'Chicken';
select t_ok((select meal_group_title from public.food_log_entries where custom_title = 'Chicken') = 'Tacos',
            'G9 a row moved from an unnamed dish into a named one takes its name');
insert into public.food_log_entries (date, meal_slot, custom_title, calories, meal_group_id, meal_group_title)
select '2026-10-17', 'dinner', custom_title, calories, '40000000-0000-0000-0000-00000000000c', meal_group_title
from public.food_log_entries where meal_group_id = '40000000-0000-0000-0000-00000000000a';
select t_ok((select count(*) from public.food_log_entries where meal_group_id = '40000000-0000-0000-0000-00000000000c' and meal_group_title = 'Tacos') = 4,
            'G10 "Copy to" a day: the copy is a dish of its own with the same name');
select t_refused($q$update public.food_log_entries set meal_group_title = repeat('x', 81) where custom_title = 'Rice'$q$, 'G11 a dish name over 80 characters is refused');
select t_refused($q$update public.food_log_entries set meal_group_title = '  ' where custom_title = 'Rice'$q$, 'G11 a blank dish name is refused (NULL is the automatic name)');

-- ── 6. Beside 106, and per account ──────────────────────────────────────────
insert into public.food_log_entries (id, date, meal_slot, library_ingredient_id, quantity, unit, meal_group_id)
values ('30000000-0000-0000-0000-000000000002', '2026-10-15', 'lunch', '10000000-0000-0000-0000-000000000002', 150, 'g', '40000000-0000-0000-0000-00000000000a');
select t_ok((select calories = 195 and meal_group_title = 'Tacos' from public.food_log_entries where id = '30000000-0000-0000-0000-000000000002'),
            'G12 a library row joining a dish: 106 still works out its 195 kcal, 158 gives it the name');
update public.food_log_entries set quantity = 200 where id = '30000000-0000-0000-0000-000000000002';
select t_ok((select calories = 260 and meal_group_title = 'Tacos' from public.food_log_entries where id = '30000000-0000-0000-0000-000000000002'),
            'G12 an amount edit recomputes the totals and keeps the name');
set test.uid = '00000000-0000-0000-0000-000000000002';
select t_ok((select count(*) from public.food_log_entries) = 0, 'G13 another account sees none of the dish');
update public.food_log_entries set meal_group_title = 'Mine' where meal_group_id = '40000000-0000-0000-0000-00000000000a';
insert into public.food_log_entries (date, meal_slot, custom_title, calories, meal_group_id, meal_group_title)
values ('2026-10-15', 'lunch', 'Bread', 90, '40000000-0000-0000-0000-00000000000a', 'Mine');
select t_ok((select meal_group_title from public.food_log_entries where custom_title = 'Bread') = 'Mine',
            'G13 the same group id in another account never borrows the first account''s name');
reset test.uid;
select t_ok((select count(*) from public.food_log_entries where meal_group_id = '40000000-0000-0000-0000-00000000000a' and meal_group_title = 'Tacos') = 5,
            'G13 and its rename touched nothing of the first account');
reset role;
