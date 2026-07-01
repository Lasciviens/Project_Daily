-- Prevent duplicate categories, then seed a starter taxonomy so the AI has
-- something sensible to match against from day one instead of an empty tree.

-- Partial unique indexes (a plain UNIQUE(user_id, parent_id, name) wouldn't
-- catch top-category dupes since NULL parent_id values never compare equal).
create unique index if not exists shop_categories_top_unique
  on shop_categories (user_id, name) where parent_id is null;
create unique index if not exists shop_categories_sub_unique
  on shop_categories (user_id, parent_id, name) where parent_id is not null;

do $$
declare
  u record;
  top_id uuid;
  taxonomy jsonb := '[
    {"top": "Electronics",      "subs": ["Phones", "Computers & Laptops", "Game Consoles", "Accessories", "TV & Audio"]},
    {"top": "Clothing",         "subs": ["Tops", "Bottoms", "Underwear", "Shoes", "Outerwear"]},
    {"top": "Home & Living",    "subs": ["Kitchen", "Bathroom", "Decor", "Cleaning"]},
    {"top": "Personal Care & Health", "subs": ["Skincare", "Vitamins & Supplements", "Hygiene"]},
    {"top": "Hobby & Games",    "subs": ["Video Games", "Board Games", "Collectibles"]},
    {"top": "Sports & Outdoor", "subs": ["Fitness Equipment", "Camping", "Cycling"]},
    {"top": "Groceries",        "subs": ["Snacks", "Drinks", "Pantry Staples"]},
    {"top": "Books & Stationery", "subs": ["Books", "Stationery"]}
  ]'::jsonb;
  cat jsonb;
  sub text;
begin
  for u in select id from auth.users loop
    for cat in select * from jsonb_array_elements(taxonomy) loop
      insert into shop_categories (user_id, name, parent_id)
      values (u.id, cat->>'top', null)
      on conflict (user_id, name) where parent_id is null do nothing
      returning id into top_id;

      if top_id is null then
        select id into top_id from shop_categories
          where user_id = u.id and name = cat->>'top' and parent_id is null;
      end if;

      for sub in select jsonb_array_elements_text(cat->'subs') loop
        insert into shop_categories (user_id, name, parent_id)
        values (u.id, sub, top_id)
        on conflict (user_id, parent_id, name) where parent_id is not null do nothing;
      end loop;
    end loop;
  end loop;
end $$;
