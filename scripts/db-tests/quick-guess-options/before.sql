-- Runs after migration 152 and before 159 (scripts/verify-db-quick-guess-options.mjs):
-- a preset the app added the day before 159, so the scenarios can see what 159
-- does to a row that already exists, and how many activity rows there were.
set role authenticated;
insert into public.quick_guess_items (name, icon, portion, calories, protein_g, carbs_g, fat_g, sugar_g, sort_order)
values ('Pizza', '🍕', '2 slices, medium', 540, 22, 64, 20, 6, 9);
reset role;
create table public.t_before (k text primary key, v bigint);
insert into public.t_before values ('audit', (select count(*) from public.audit_logs where table_name = 'quick_guess_items'));
