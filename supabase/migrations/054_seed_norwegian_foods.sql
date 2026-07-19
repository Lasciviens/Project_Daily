-- Seed the ingredient library with common Norwegian everyday foods so a user
-- can log "1 egg" / "1 scoop whey" without knowing the macros (an empty library
-- is the #1 reason food trackers get abandoned in week one — dietitian review).
--
-- Source: Matvaretabellen 2025 (official Norwegian Food Composition Table,
-- Mattilsynet/Helsedirektoratet/UiO, matvaretabellen.no open data). Brand items
-- (skyr, whey, Kvikk Lunsj) use the manufacturer's declared label — flagged.
--
-- All macros are PER 100g (the library's canonical basis). Each row carries a
-- portion preset (serving_label + serving_grams) so a countable food is one tap.
--
-- Conventions (from the research + dietitian):
--  * carbs = AVAILABLE carbohydrate (fiber already excluded) → carbs + fiber are
--    additive, matching the app's per-100g columns.
--  * Matvaretabellen lists sugar 0.0 for dairy/fruit ("not analysed separately"),
--    which is misleading — those carbs are essentially all lactose/fructose. We
--    store the real sugar (≈ carbs − fiber) for milk/skyr/brunost/fruit so the
--    (optional, display-only) sugar figure isn't a false zero. Meat/fish/oil are
--    genuinely ~0 sugar.
--  * Cooked vs raw/dry differ ~3× (water) — both forms are seeded and named
--    explicitly so they can't be confused; default to the form people weigh
--    (dry for rice/pasta/oats, cooked for potato).
--  * Fried egg: the plain egg + oil-as-its-own-ingredient is the accurate path;
--    "Egg, fried in fat" is kept as the convenience row (Matvaretabellen's ~2g
--    absorbed-fat assumption).
--
-- Idempotent: cross-joins every existing user with the food list and relies on
-- the unique (user_id, name) index — ON CONFLICT DO NOTHING, safe to re-run and
-- never overwrites a value the user has edited.

insert into recipe_ingredient_library
  (user_id, name, calories, protein_g, carbs_g, fat_g, sugar_g, fiber_g, serving_label, serving_grams)
select u.id, f.name, f.calories, f.protein_g, f.carbs_g, f.fat_g, f.sugar_g, f.fiber_g, f.serving_label, f.serving_grams
from auth.users u
cross join (values
  -- ── Eggs ──
  ('Egg, whole, boiled (kokt egg)',            148, 12.9,  0.3, 10.5,  0.0,  0.0, '1 egg', 56),
  ('Egg, whole, raw (rått egg)',               149, 13.0,  0.3, 10.7,  0.0,  0.0, '1 egg', 56),
  ('Egg, fried in fat (stekt egg)',            207, 13.9,  0.3, 16.7,  0.0,  0.0, '1 fried egg', 60),
  ('Egg white (eggehvite)',                     42, 10.2,  0.4,  0.0,  0.0,  0.0, '1 egg white', 33),
  ('Egg yolk (eggeplomme)',                    321, 16.0,  0.2, 28.5,  0.0,  0.0, '1 yolk', 17),
  -- ── Dairy (sugar = lactose, corrected from Matvaretabellen's 0) ──
  ('Whole milk 3.5% (helmelk)',                 63,  3.4,  4.5,  3.5,  4.5,  0.0, '1 glass', 200),
  ('Semi-skimmed milk 0.5% (lettmelk)',         37,  3.5,  4.5,  0.5,  4.5,  0.0, '1 glass', 200),
  ('Skimmed milk 0.1% (skummet melk)',          33,  3.5,  4.5,  0.1,  4.5,  0.0, '1 glass', 200),
  ('Skyr, plain (skyr naturell)',               63, 11.0,  4.0,  0.2,  4.0,  0.0, '1 tub', 150),      -- brand-declared (TINE/Q)
  ('Greek yogurt 2% (gresk yoghurt)',           69,  9.2,  3.4,  2.1,  3.4,  0.0, '1 portion', 150),
  ('Yogurt, plain (yoghurt naturell)',          69,  4.0,  5.6,  3.4,  5.6,  0.0, '1 portion', 150),
  ('Cottage cheese (kesam)',                    97, 13.0,  1.5,  4.3,  1.5,  0.0, '1 dl', 100),
  ('Brown cheese (brunost)',                   410, 11.3, 30.3, 27.0, 30.0,  0.0, '1 slice', 15),
  ('Yellow cheese (Norvegia)',                 351, 27.0,  0.0, 27.0,  0.0,  0.0, '1 slice', 20),
  ('Jarlsberg cheese',                         351, 27.0,  0.0, 27.0,  0.0,  0.0, '1 slice', 20),
  ('Butter (smør)',                            753,  1.0,  0.5, 83.0,  0.0,  0.0, '1 pat', 10),
  -- ── Protein staples ──
  ('Chicken breast, raw (kyllingfilet, rå)',   111, 23.0,  0.0,  2.1,  0.0,  0.0, '1 fillet', 150),
  ('Chicken breast, cooked (kyllingfilet)',    135, 30.0,  0.0,  1.6,  0.0,  0.0, '1 fillet', 130),
  ('Salmon, raw (laks, rå)',                   223, 19.9,  0.0, 15.9,  0.0,  0.0, '1 fillet', 150),
  ('Salmon, baked (laks, ovnsstekt)',          207, 20.6,  0.0, 13.8,  0.0,  0.0, '1 fillet', 150),
  ('Cod, cooked (torsk, kokt)',                100, 21.8,  0.0,  1.5,  0.0,  0.0, '1 fillet', 150),
  ('Beef mince 14%, raw (kjøttdeig, rå)',      197, 19.4,  0.0, 13.2,  0.0,  0.0, '1 portion', 125),
  ('Beef mince, cooked (kjøttdeig, stekt)',    238, 25.1,  0.0, 15.3,  0.0,  0.0, '1 portion', 100),
  ('Beef tenderloin (indrefilet)',             134, 21.8,  0.0,  5.2,  0.0,  0.0, '1 steak', 150),
  ('Roast beef, sliced (roastbiff)',           125, 25.1,  0.0,  2.7,  0.0,  0.0, '1 slice', 15),
  ('Tuna, canned in water (tunfisk)',          105, 24.1,  0.0,  1.0,  0.0,  0.0, '1 tin', 112),
  ('Whey protein powder (myseprotein)',        400, 80.0,  8.0,  6.0,  4.0,  0.0, '1 scoop', 30),      -- brand-dependent; override with your tub
  -- ── Carbs / grains (cooked vs dry named explicitly) ──
  ('Oats, dry (havregryn)',                    369, 14.1, 57.2,  6.7,  0.0, 12.0, '1 dl', 40),
  ('White rice, dry (ris, tørr)',              343,  7.8, 75.9,  0.7,  0.3,  1.0, '1 dl', 85),
  ('White rice, boiled (ris, kokt)',           111,  2.5, 24.5,  0.2,  0.0,  0.3, '1 portion', 185),
  ('Basmati rice, boiled (basmati, kokt)',     115,  3.0, 25.0,  0.3,  0.0,  0.2, '1 portion', 185),
  ('Pasta, dry (pasta, tørr)',                 347, 11.9, 69.8,  1.3,  2.0,  4.0, '1 portion', 85),
  ('Pasta, boiled (pasta, kokt)',              133,  4.2, 23.6,  2.1,  0.5,  1.0, '1 portion', 180),
  ('Wholegrain pasta, boiled (fullkorn, kokt)',139,  4.5, 23.1,  2.5,  0.5,  3.0, '1 portion', 180),
  ('Potato, boiled (potet, kokt)',              94,  2.3, 19.9,  0.1,  0.9,  2.0, '1 potato', 90),
  ('Crispbread, rye (knekkebrød)',             319,  7.8, 62.3,  1.1,  1.0, 14.0, '1 slice', 12),
  ('Wholemeal bread (grovbrød)',               239,  9.3, 40.6,  3.1,  1.5,  6.0, '1 slice', 40),
  ('White bread (loff)',                       255,  8.5, 45.7,  3.4,  1.5,  4.0, '1 slice', 40),
  ('Kvikk Lunsj (Freia)',                      536,  8.1, 58.0, 30.0, 46.0,  2.0, '1 bar', 47),        -- Freia label
  -- ── Fruit / veg (sugar = natural sugars, corrected from 0) ──
  ('Banana (banan)',                            88,  1.1, 19.7,  0.2, 17.7,  2.0, '1 banana', 120),
  ('Apple (eple)',                              49,  0.3, 11.0,  0.1,  9.0,  2.0, '1 apple', 125),
  ('Blueberries (blåbær)',                      51,  1.0,  7.5,  0.9,  6.5,  3.5, '1 dl', 65),
  ('Broccoli (brokkoli)',                       26,  2.9,  2.2,  0.0,  1.2,  3.0, '1 portion', 100),
  -- ── Fats / nuts / other ──
  ('Olive oil (olivenolje)',                   892,  0.2,  0.0, 99.0,  0.0,  0.0, '1 tbsp', 14),
  ('Peanut butter (peanøttsmør)',              621, 22.8, 13.1, 51.8,  3.4,  5.0, '1 tbsp', 16),
  ('Almonds (mandler)',                        601, 21.2,  6.6, 52.1,  4.0, 11.0, '1 handful', 30),
  ('Avocado (avokado)',                        191,  1.8,  0.4, 19.6,  0.4,  3.0, '½ avocado', 75),
  ('Coffee, black (kaffe)',                      1,  0.1,  0.0,  0.0,  0.0,  0.0, '1 cup', 200)
) as f(name, calories, protein_g, carbs_g, fat_g, sugar_g, fiber_g, serving_label, serving_grams)
on conflict (user_id, name) do nothing;
