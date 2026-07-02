-- Recipes feature: personal recipe collection with scalable ingredient lists
-- and per-serving macros. Meal planning + pantry/shopping-list integration
-- come in later phases (this is phase 1: CRUD + scaling + macros).

create table if not exists recipes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  title        text not null,
  description  text,
  servings     integer not null default 1 check (servings > 0),
  instructions text,
  -- macros are stored PER SERVING; ingredient quantities are for `servings`.
  calories     numeric,
  protein_g    numeric,
  carbs_g      numeric,
  fat_g        numeric,
  image_url    text,
  source_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists recipe_ingredients (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  recipe_id  uuid not null references recipes(id) on delete cascade,
  name       text not null,
  quantity   numeric,            -- null = "to taste" / unmeasured
  unit       text,
  note       text,
  sort_order integer not null default 0
);

create index if not exists idx_recipes_user             on recipes(user_id);
create index if not exists idx_recipe_ingredients_recipe on recipe_ingredients(recipe_id);
create index if not exists idx_recipe_ingredients_user   on recipe_ingredients(user_id);

alter table recipes            enable row level security;
alter table recipe_ingredients enable row level security;

create policy "own recipes" on recipes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own recipe_ingredients" on recipe_ingredients
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create trigger trg_recipes_updated_at
  before update on recipes
  for each row execute function update_updated_at();
