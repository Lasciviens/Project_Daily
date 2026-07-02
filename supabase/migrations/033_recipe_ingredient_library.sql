-- Naming standard fix: every table for this feature must be prefixed
-- `recipe_` (matches the shop_*/hevy_* convention elsewhere) — meal_plan_entries
-- was the odd one out, renamed here. `recipes` itself is left as-is: like
-- `tasks`/`movies`/`projects` it IS the feature's root entity, not a satellite
-- table, so it already reads unambiguously.

alter table meal_plan_entries rename to recipe_meal_plans;
alter index idx_meal_plan_user_date   rename to idx_recipe_meal_plans_user_date;
alter index idx_meal_plan_slot_unique rename to idx_recipe_meal_plans_slot_unique;
alter policy "own meal_plan_entries" on recipe_meal_plans rename to "own recipe_meal_plans";

-- ─── Ingredient library ────────────────────────────────────────────────────────
-- A reusable ingredient catalog with its own macros, so a recipe's macros can
-- be computed from linked ingredients instead of (or alongside) a manual
-- per-serving estimate. Macros are always "per 100g" — the universal
-- nutrition-label convention — regardless of the ingredient's display unit.

create table if not exists recipe_ingredient_library (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  unit       text not null default 'g',   -- default display unit when adding to a recipe/day
  calories   numeric,   -- per 100g
  protein_g  numeric,   -- per 100g
  carbs_g    numeric,   -- per 100g
  fat_g      numeric,   -- per 100g
  sugar_g    numeric,   -- per 100g
  created_at timestamptz not null default now()
);

create unique index if not exists idx_recipe_ingredient_library_name
  on recipe_ingredient_library (user_id, name);

alter table recipe_ingredient_library enable row level security;

create policy "own recipe_ingredient_library" on recipe_ingredient_library
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─── Link recipe ingredients to the library (enables macro computation) ───────

alter table recipe_ingredients
  add column if not exists library_ingredient_id uuid references recipe_ingredient_library(id) on delete set null;

-- ─── Recipes: macro mode + sugar ───────────────────────────────────────────────
-- macro_mode='manual'          → calories/protein_g/carbs_g/fat_g/sugar_g are
--                                 typed in directly.
-- macro_mode='from_ingredients' → the same columns are computed client-side
--                                 (sum of linked ingredients' per-100g macros
--                                 × quantity/100, divided by servings) and
--                                 written on save — no separate storage needed.

alter table recipes add column if not exists sugar_g numeric;
alter table recipes add column if not exists macro_mode text not null default 'manual'
  check (macro_mode in ('manual', 'from_ingredients'));

-- ─── Meal plan: allow logging a raw ingredient for a day/slot (no recipe) ─────

alter table recipe_meal_plans
  add column if not exists library_ingredient_id uuid references recipe_ingredient_library(id) on delete set null,
  add column if not exists ingredient_quantity numeric,
  add column if not exists ingredient_unit text;

alter table recipe_meal_plans drop constraint if exists meal_plan_entry_has_content;
alter table recipe_meal_plans add constraint recipe_meal_plan_has_content
  check (recipe_id is not null or custom_title is not null or library_ingredient_id is not null);
