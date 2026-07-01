-- Shop feature: wishlist items organised into a strict 2-level category tree
-- (top category -> subcategory). Subcategories are the only valid place to
-- attach an item; top categories exist purely to group subcategories.

create table if not exists shop_categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  parent_id  uuid references shop_categories(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists shop_items (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  category_id   uuid not null references shop_categories(id) on delete cascade,
  title         text not null,
  notes         text,
  price         numeric,
  price_source  text check (price_source in ('manual', 'ai_estimate')),
  platform      text,
  url           text,
  priority      text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  region        text check (region in ('TR', 'NO')),
  planned_date  date,
  status        text not null default 'wishlist' check (status in ('wishlist', 'bought', 'dropped')),
  source_type   text not null default 'manual' check (source_type in ('manual', 'ai')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_shop_categories_user   on shop_categories(user_id);
create index if not exists idx_shop_categories_parent on shop_categories(parent_id);
create index if not exists idx_shop_items_user        on shop_items(user_id);
create index if not exists idx_shop_items_category    on shop_items(category_id);

alter table shop_categories enable row level security;
alter table shop_items      enable row level security;

create policy "own shop_categories" on shop_categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own shop_items" on shop_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create trigger trg_shop_items_updated_at
  before update on shop_items
  for each row execute function update_updated_at();
