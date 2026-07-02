-- Recipes phase 2: a lightweight weekly meal plan, independent of the Daily
-- schedule (per product decision — its own calendar inside Recipes).
-- An entry can point at a saved recipe OR just a free-text title (e.g.
-- "eating out", "leftovers") when there's no recipe to attach.

create table if not exists meal_plan_entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  date         date not null,
  meal_slot    text not null check (meal_slot in ('breakfast', 'lunch', 'dinner', 'snack')),
  recipe_id    uuid references recipes(id) on delete set null,
  custom_title text,
  servings     numeric not null default 1 check (servings > 0),
  notes        text,
  created_at   timestamptz not null default now(),
  constraint meal_plan_entry_has_content check (recipe_id is not null or custom_title is not null)
);

create index if not exists idx_meal_plan_user_date on meal_plan_entries(user_id, date);
create unique index if not exists idx_meal_plan_slot_unique on meal_plan_entries(user_id, date, meal_slot);

alter table meal_plan_entries enable row level security;

create policy "own meal_plan_entries" on meal_plan_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
