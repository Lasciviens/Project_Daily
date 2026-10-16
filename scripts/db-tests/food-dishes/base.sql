-- What migrations 157 (recipe portions and batches) and 158 (a dish's name)
-- need, as small as it can be (scripts/verify-db-food-dishes.mjs builds a
-- throwaway database from this, the real migration 106 — the diary's derived
-- totals, whose triggers must keep working beside the new ones —, 157 and 158
-- twice each, and scenarios.sql): auth with two accounts, 037's audit log with
-- 140's trigger function, and the food tables with the columns 031–087 gave
-- them (053's food_log_entries, 061's status, 087's meal_group_id).
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table auth.users (id uuid primary key);
-- The caller: account 1 unless a scenario sets test.uid.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('test.uid', true), ''), '00000000-0000-0000-0000-000000000001')::uuid
$$;
insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
grant usage on schema public to authenticated;
grant usage on schema auth to authenticated;

-- 037's audit log and 140's trigger function.
create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  table_name  text not null,
  operation   text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  row_id      text,
  old_data    jsonb,
  new_data    jsonb,
  actor       text not null,
  tx_id       bigint not null,
  created_at  timestamptz not null default now()
);
alter table public.audit_logs enable row level security;
create policy "Users read own audit logs" on public.audit_logs for select using (auth.uid() = user_id);
grant select on public.audit_logs to authenticated;
create or replace function public.log_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  old_j    jsonb := case when TG_OP = 'INSERT' then null else to_jsonb(OLD) end;
  new_j    jsonb := case when TG_OP = 'DELETE' then null else to_jsonb(NEW) end;
  row_j    jsonb := coalesce(new_j, old_j);
  diff_old jsonb;
  diff_new jsonb;
  v_user   uuid;
begin
  if TG_OP = 'UPDATE' then
    select coalesce(jsonb_object_agg(o.key, o.value), '{}'::jsonb) into diff_old
      from jsonb_each(old_j) o where o.key not in ('updated_at', 'synced_at') and new_j -> o.key is distinct from o.value;
    select coalesce(jsonb_object_agg(n.key, n.value), '{}'::jsonb) into diff_new
      from jsonb_each(new_j) n where n.key not in ('updated_at', 'synced_at') and old_j -> n.key is distinct from n.value;
    if diff_new = '{}'::jsonb and diff_old = '{}'::jsonb then return null; end if;
  else
    diff_old := old_j;
    diff_new := new_j;
  end if;
  v_user := coalesce((row_j ->> 'user_id')::uuid, auth.uid());
  if v_user is not null and not exists (select 1 from auth.users where id = v_user) then return null; end if;
  insert into public.audit_logs (user_id, table_name, operation, row_id, old_data, new_data, actor, tx_id)
  values (v_user, TG_TABLE_NAME, TG_OP, row_j ->> 'id', diff_old, diff_new,
          case when auth.uid() is not null then 'web' else 'service' end, txid_current());
  return null;
end;
$$;

-- The food tables (031, 033, 053, 060, 061, 066, 087).
create table public.recipe_ingredient_library (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null, unit text not null default 'g',
  calories numeric, protein_g numeric, carbs_g numeric, fat_g numeric, fiber_g numeric, sugar_g numeric,
  serving_label text, serving_grams numeric
);
create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null, description text,
  servings integer not null default 1 check (servings > 0),
  instructions text,
  macro_mode text not null default 'manual' check (macro_mode in ('manual', 'from_ingredients')),
  calories numeric, protein_g numeric, carbs_g numeric, fat_g numeric, fiber_g numeric, sugar_g numeric,
  image_url text, source_url text, times_cooked integer not null default 0,
  category text, is_temp boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  recipe_id uuid not null references public.recipes(id) on delete cascade,
  name text not null, quantity numeric, unit text, note text, sort_order integer not null default 0,
  library_ingredient_id uuid references public.recipe_ingredient_library(id) on delete set null
);
create table public.food_log_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  meal_slot text not null check (meal_slot in ('breakfast', 'lunch', 'dinner', 'snack', 'supplement')),
  status text not null default 'eaten' check (status in ('planned', 'eaten')),
  library_ingredient_id uuid references public.recipe_ingredient_library(id) on delete set null,
  recipe_id uuid references public.recipes(id) on delete set null,
  custom_title text, quantity numeric, unit text,
  calories numeric, protein_g numeric, carbs_g numeric, fat_g numeric, fiber_g numeric, sugar_g numeric,
  meal_group_id uuid,
  created_at timestamptz not null default now(),
  check (library_ingredient_id is not null or recipe_id is not null or custom_title is not null)
);
do $$
declare t text;
begin
  foreach t in array array['recipe_ingredient_library', 'recipes', 'recipe_ingredients', 'food_log_entries'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy own on public.%I for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create trigger trg_audit after insert or update or delete on public.%I for each row execute function public.log_audit()', t);
  end loop;
end $$;
