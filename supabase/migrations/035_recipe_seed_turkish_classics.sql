-- Starter recipes: no Turkish recipe site or nutrition API (Spoonacular,
-- Edamam) has usable public access or a "Turkish" cuisine tag (checked —
-- both only bucket Turkish dishes under generic Mediterranean/Middle
-- Eastern), so this is a hand-curated seed of classic + popular dishes with
-- editorial per-serving macro estimates (macro_mode='manual'). Users can
-- switch any of these to 'from_ingredients' mode later and link precise
-- recipe_ingredient_library entries if they want exact numbers.

do $$
declare
  u   record;
  rid uuid;
begin
  for u in select id from auth.users loop

    -- Mercimek Çorbası (Red Lentil Soup) ------------------------------------
    if not exists (select 1 from recipes where user_id = u.id and title = 'Mercimek Çorbası') then
      insert into recipes (user_id, title, description, servings, instructions, macro_mode, calories, protein_g, carbs_g, fat_g, sugar_g)
      values (u.id, 'Mercimek Çorbası', 'Classic Turkish red lentil soup.', 4,
        'Sauté onion and carrot in butter until soft.
Add red lentils, potato, and stock; simmer 20-25 min until lentils fall apart.
Blend until smooth.
Season with salt, pepper, and a pinch of red pepper flakes.
Serve with a lemon wedge and a drizzle of butter with paprika.',
        'manual', 180, 9, 28, 4, 3)
      returning id into rid;
      insert into recipe_ingredients (user_id, recipe_id, name, quantity, unit, sort_order) values
        (u.id, rid, 'Red lentils', 200, 'g', 0),
        (u.id, rid, 'Onion', 1, 'piece', 1),
        (u.id, rid, 'Carrot', 1, 'piece', 2),
        (u.id, rid, 'Potato', 1, 'piece', 3),
        (u.id, rid, 'Vegetable stock', 1, 'l', 4),
        (u.id, rid, 'Butter', 1, 'tbsp', 5),
        (u.id, rid, 'Lemon', 1, 'piece', 6);
    end if;

    -- Ezogelin Çorbası --------------------------------------------------------
    if not exists (select 1 from recipes where user_id = u.id and title = 'Ezogelin Çorbası') then
      insert into recipes (user_id, title, description, servings, instructions, macro_mode, calories, protein_g, carbs_g, fat_g, sugar_g)
      values (u.id, 'Ezogelin Çorbası', 'Red lentil soup with rice, bulgur, and mint.', 4,
        'Sauté onion in butter with tomato paste.
Add red lentils, rice, bulgur, and stock; simmer 25 min.
Blend lightly, leaving some texture.
Finish with dried mint and red pepper flakes fried in butter, drizzled on top.',
        'manual', 160, 8, 26, 3, 3)
      returning id into rid;
      insert into recipe_ingredients (user_id, recipe_id, name, quantity, unit, sort_order) values
        (u.id, rid, 'Red lentils', 150, 'g', 0),
        (u.id, rid, 'Rice', 2, 'tbsp', 1),
        (u.id, rid, 'Fine bulgur', 2, 'tbsp', 2),
        (u.id, rid, 'Onion', 1, 'piece', 3),
        (u.id, rid, 'Tomato paste', 1, 'tbsp', 4),
        (u.id, rid, 'Dried mint', 1, 'tsp', 5),
        (u.id, rid, 'Vegetable stock', 1, 'l', 6);
    end if;

    -- Karnıyarık ----------------------------------------------------------
    if not exists (select 1 from recipes where user_id = u.id and title = 'Karnıyarık') then
      insert into recipes (user_id, title, description, servings, instructions, macro_mode, calories, protein_g, carbs_g, fat_g, sugar_g)
      values (u.id, 'Karnıyarık', 'Split fried eggplants stuffed with minced meat.', 4,
        'Fry whole eggplants until soft, slit lengthwise.
Cook minced beef with onion, garlic, tomato, and green pepper.
Stuff the eggplants with the filling, top with a tomato slice.
Bake at 180°C for 20 min.
Serve with rice.',
        'manual', 320, 14, 18, 22, 6)
      returning id into rid;
      insert into recipe_ingredients (user_id, recipe_id, name, quantity, unit, sort_order) values
        (u.id, rid, 'Eggplant', 4, 'piece', 0),
        (u.id, rid, 'Minced beef', 300, 'g', 1),
        (u.id, rid, 'Onion', 1, 'piece', 2),
        (u.id, rid, 'Garlic', 2, 'clove', 3),
        (u.id, rid, 'Tomato', 2, 'piece', 4),
        (u.id, rid, 'Green pepper', 2, 'piece', 5),
        (u.id, rid, 'Sunflower oil', 3, 'tbsp', 6);
    end if;

    -- Mantı -----------------------------------------------------------------
    if not exists (select 1 from recipes where user_id = u.id and title = 'Mantı') then
      insert into recipes (user_id, title, description, servings, instructions, macro_mode, calories, protein_g, carbs_g, fat_g, sugar_g)
      values (u.id, 'Mantı', 'Turkish dumplings with garlic yogurt and paprika butter.', 4,
        'Make a firm dough with flour, egg, and water; rest 30 min.
Roll thin, cut into small squares, fill each with a pinch of spiced minced meat, pinch closed.
Boil in salted water 10-12 min until they float.
Serve topped with garlic yogurt and butter sizzled with paprika/red pepper flakes.',
        'manual', 450, 18, 55, 16, 4)
      returning id into rid;
      insert into recipe_ingredients (user_id, recipe_id, name, quantity, unit, sort_order) values
        (u.id, rid, 'Flour', 400, 'g', 0),
        (u.id, rid, 'Egg', 1, 'piece', 1),
        (u.id, rid, 'Minced beef', 200, 'g', 2),
        (u.id, rid, 'Onion', 1, 'piece', 3),
        (u.id, rid, 'Yogurt', 400, 'g', 4),
        (u.id, rid, 'Garlic', 2, 'clove', 5),
        (u.id, rid, 'Butter', 3, 'tbsp', 6),
        (u.id, rid, 'Paprika', 1, 'tsp', 7);
    end if;

    -- Menemen -----------------------------------------------------------------
    if not exists (select 1 from recipes where user_id = u.id and title = 'Menemen') then
      insert into recipes (user_id, title, description, servings, instructions, macro_mode, calories, protein_g, carbs_g, fat_g, sugar_g)
      values (u.id, 'Menemen', 'Eggs scrambled with tomato, green pepper, and onion.', 2,
        'Sauté onion and green pepper in butter/olive oil.
Add chopped tomato, cook until softened.
Crack in eggs, stir gently until just set.
Season with salt, pepper, and red pepper flakes; serve with bread.',
        'manual', 250, 14, 10, 18, 5)
      returning id into rid;
      insert into recipe_ingredients (user_id, recipe_id, name, quantity, unit, sort_order) values
        (u.id, rid, 'Egg', 4, 'piece', 0),
        (u.id, rid, 'Tomato', 3, 'piece', 1),
        (u.id, rid, 'Green pepper', 2, 'piece', 2),
        (u.id, rid, 'Onion', null, 'to taste', 3),
        (u.id, rid, 'Butter', 1, 'tbsp', 4);
    end if;

    -- İskender Kebap ------------------------------------------------------
    if not exists (select 1 from recipes where user_id = u.id and title = 'İskender Kebap') then
      insert into recipes (user_id, title, description, servings, instructions, macro_mode, calories, protein_g, carbs_g, fat_g, sugar_g)
      values (u.id, 'İskender Kebap', 'Sliced döner over pide bread with tomato sauce, butter, and yogurt.', 2,
        'Cube pide bread and layer in a dish.
Top with sliced grilled/döner-style beef.
Pour over hot tomato sauce.
Add a dollop of yogurt on the side, drizzle with sizzling butter.',
        'manual', 650, 38, 45, 34, 6)
      returning id into rid;
      insert into recipe_ingredients (user_id, recipe_id, name, quantity, unit, sort_order) values
        (u.id, rid, 'Beef (thin sliced)', 400, 'g', 0),
        (u.id, rid, 'Pide bread', 2, 'piece', 1),
        (u.id, rid, 'Tomato sauce', 200, 'ml', 2),
        (u.id, rid, 'Yogurt', 150, 'g', 3),
        (u.id, rid, 'Butter', 3, 'tbsp', 4);
    end if;

    -- Kuru Fasulye ------------------------------------------------------------
    if not exists (select 1 from recipes where user_id = u.id and title = 'Kuru Fasulye') then
      insert into recipes (user_id, title, description, servings, instructions, macro_mode, calories, protein_g, carbs_g, fat_g, sugar_g)
      values (u.id, 'Kuru Fasulye', 'White beans stewed with tomato and onion — usually served with rice.', 4,
        'Soak beans overnight, then boil until tender.
Sauté onion, add tomato paste and diced tomato.
Add beans and a little of their cooking water; simmer 30-40 min.
Season with salt, pepper, red pepper flakes; serve over rice.',
        'manual', 280, 15, 38, 8, 4)
      returning id into rid;
      insert into recipe_ingredients (user_id, recipe_id, name, quantity, unit, sort_order) values
        (u.id, rid, 'Dried white beans', 300, 'g', 0),
        (u.id, rid, 'Onion', 1, 'piece', 1),
        (u.id, rid, 'Tomato paste', 2, 'tbsp', 2),
        (u.id, rid, 'Diced tomato', 1, 'cup', 3),
        (u.id, rid, 'Sunflower oil', 3, 'tbsp', 4),
        (u.id, rid, 'Rice (for serving)', 200, 'g', 5);
    end if;

    -- Lahmacun ------------------------------------------------------------
    if not exists (select 1 from recipes where user_id = u.id and title = 'Lahmacun') then
      insert into recipes (user_id, title, description, servings, instructions, macro_mode, calories, protein_g, carbs_g, fat_g, sugar_g)
      values (u.id, 'Lahmacun', 'Thin flatbread topped with spiced minced meat.', 6,
        'Make a soft dough with flour, yeast, water; rest 1 hr, divide into 6 balls.
Blend minced meat, onion, tomato, pepper, and spices into a fine paste.
Roll each dough ball very thin, spread the meat paste to the edges.
Bake at high heat (240°C) on a hot tray/stone for 6-8 min until crisp at the edges.
Serve with lemon, parsley, and onion.',
        'manual', 230, 10, 30, 8, 2)
      returning id into rid;
      insert into recipe_ingredients (user_id, recipe_id, name, quantity, unit, sort_order) values
        (u.id, rid, 'Flour', 400, 'g', 0),
        (u.id, rid, 'Yeast', 1, 'tsp', 1),
        (u.id, rid, 'Minced beef', 250, 'g', 2),
        (u.id, rid, 'Onion', 1, 'piece', 3),
        (u.id, rid, 'Tomato', 1, 'piece', 4),
        (u.id, rid, 'Red pepper paste', 1, 'tbsp', 5),
        (u.id, rid, 'Parsley', null, 'to taste', 6),
        (u.id, rid, 'Lemon', 1, 'piece', 7);
    end if;

    -- Türk Kahvaltısı Tabağı ------------------------------------------------
    if not exists (select 1 from recipes where user_id = u.id and title = 'Türk Kahvaltısı Tabağı') then
      insert into recipes (user_id, title, description, servings, instructions, macro_mode, calories, protein_g, carbs_g, fat_g, sugar_g)
      values (u.id, 'Türk Kahvaltısı Tabağı', 'Classic Turkish breakfast spread — cheese, olives, egg, tomato, cucumber, honey.', 1,
        'Arrange white cheese, kaşar, and olives on a plate.
Add sliced tomato and cucumber.
Fry or boil an egg.
Serve with honey, butter, and fresh bread.',
        'manual', 420, 18, 30, 26, 8)
      returning id into rid;
      insert into recipe_ingredients (user_id, recipe_id, name, quantity, unit, sort_order) values
        (u.id, rid, 'White cheese (beyaz peynir)', 50, 'g', 0),
        (u.id, rid, 'Kaşar cheese', 30, 'g', 1),
        (u.id, rid, 'Olives', 8, 'piece', 2),
        (u.id, rid, 'Egg', 1, 'piece', 3),
        (u.id, rid, 'Tomato', 1, 'piece', 4),
        (u.id, rid, 'Cucumber', 1, 'piece', 5),
        (u.id, rid, 'Honey', 1, 'tbsp', 6),
        (u.id, rid, 'Bread', 2, 'slice', 7);
    end if;

    -- Baklava (per piece) ---------------------------------------------------
    if not exists (select 1 from recipes where user_id = u.id and title = 'Baklava') then
      insert into recipes (user_id, title, description, servings, instructions, macro_mode, calories, protein_g, carbs_g, fat_g, sugar_g)
      values (u.id, 'Baklava', 'Layered phyllo pastry with walnuts/pistachios in syrup.', 12,
        'Layer buttered phyllo sheets in a tray, adding chopped walnuts/pistachios every few layers.
Score into diamonds before baking.
Bake at 170°C until golden, about 35-40 min.
Pour cold sugar syrup over the hot baklava; let it soak for a few hours before serving.',
        'manual', 330, 5, 35, 20, 22)
      returning id into rid;
      insert into recipe_ingredients (user_id, recipe_id, name, quantity, unit, sort_order) values
        (u.id, rid, 'Phyllo sheets', 500, 'g', 0),
        (u.id, rid, 'Walnuts or pistachios', 300, 'g', 1),
        (u.id, rid, 'Butter (melted)', 250, 'g', 2),
        (u.id, rid, 'Sugar', 400, 'g', 3),
        (u.id, rid, 'Water', 300, 'ml', 4),
        (u.id, rid, 'Lemon juice', 1, 'tsp', 5);
    end if;

  end loop;
end $$;
