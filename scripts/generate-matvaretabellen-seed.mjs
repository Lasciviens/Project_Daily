// Generates supabase/migrations/056_seed_matvaretabellen.sql from the official
// Norwegian Food Composition Table (Matvaretabellen) open JSON API.
//
//   node scripts/generate-matvaretabellen-seed.mjs
//
// Data: https://www.matvaretabellen.no/api/en/foods.json (+ /nb/ for Norwegian
// names). License: NLOD (Norsk lisens for offentlige data) — free to use and
// redistribute WITH attribution. Every seeded row carries source='matvaretabellen'
// + source_ref=<foodId> so the yearly refresh is idempotent and the provenance
// (required by NLOD) travels with the data. Run this whenever the table has its
// annual autumn update; commit the regenerated migration.
//
// Requires network (the CI/dev proxy is fine). Not part of the app bundle.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../supabase/migrations/056_seed_matvaretabellen.sql')
const OUT_CAT = resolve(HERE, '../supabase/migrations/058_seed_matvaretabellen_categories_portions.sql')
const UA = { 'User-Agent': 'LascisBoard/1.0 (personal food tracker)' }

// nutrientId → app column (per-100g). Mono+Di = TOTAL sugar (not 'Sukker' =
// added sugar). Karbo = available carbohydrate. Verified against nutrients.json.
const MAP = { protein_g: 'Protein', carbs_g: 'Karbo', sugar_g: 'Mono+Di', fat_g: 'Fett', fiber_g: 'Fiber' }

const round1 = n => (n == null ? null : Math.round(n * 10) / 10)
const sql = v => (v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)

async function main() {
  const [en, nb, groupsRes] = await Promise.all([
    fetch('https://www.matvaretabellen.no/api/en/foods.json', { headers: UA }).then(r => r.json()),
    fetch('https://www.matvaretabellen.no/api/nb/foods.json', { headers: UA }).then(r => r.json()),
    fetch('https://www.matvaretabellen.no/api/en/food-groups.json', { headers: UA }).then(r => r.json()),
  ])
  const nbById = new Map(nb.foods.map(f => [f.foodId, f.foodName]))

  // food-group taxonomy → resolve any groupId to its TOP-LEVEL English name by
  // walking parentId to the root (the 16 top-level groups drive the UI filter).
  const gById = new Map(groupsRes.foodGroups.map(g => [g.foodGroupId, g]))
  const topName = (groupId) => {
    let g = gById.get(groupId)
    if (!g) return null
    while (g.parentId && gById.get(g.parentId)) g = gById.get(g.parentId)
    return g.name
  }

  const seen = new Set()
  const rows = []
  const catRows = []      // { ref, gid, top }
  const portionRows = []  // { ref, label, grams, so }
  for (const f of en.foods) {
    const c = new Map((f.constituents ?? []).map(x => [x.nutrientId, x.quantity]))
    const enName = (f.foodName ?? '').trim()
    const nbName = (nbById.get(f.foodId) ?? '').trim()
    let name = enName || nbName
    if (nbName && nbName.toLowerCase() !== enName.toLowerCase()) name = `${enName} (${nbName})`
    if (!name) continue
    if (name.length > 120) name = name.slice(0, 120)
    // recipe_ingredient_library has UNIQUE(user_id, name) — dedupe within the
    // seed too (a few en/nb collapses can collide) keeping the first.
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)

    const portion = (f.portions ?? [])[0]
    rows.push({
      name,
      calories: round1(f.calories?.quantity ?? null),
      protein_g: round1(c.get(MAP.protein_g) ?? null),
      carbs_g: round1(c.get(MAP.carbs_g) ?? null),
      fat_g: round1(c.get(MAP.fat_g) ?? null),
      sugar_g: round1(c.get(MAP.sugar_g) ?? null),
      fiber_g: round1(c.get(MAP.fiber_g) ?? null),
      serving_label: portion ? String(portion.portionName).slice(0, 40) : null,
      serving_grams: portion && portion.unit === 'g' ? round1(portion.quantity) : null,
      source_ref: f.foodId,
    })

    // Category (top-level group) — resolved from foodGroupId, NOT the source_ref prefix.
    const top = f.foodGroupId ? topName(f.foodGroupId) : null
    if (f.foodGroupId && top) catRows.push({ ref: f.foodId, gid: f.foodGroupId, top })

    // All grams-equivalent portions (deduped by label) → one-tap presets.
    const seenLabels = new Set()
    for (let i = 0; i < (f.portions ?? []).length; i++) {
      const p = f.portions[i]
      if (p.unit !== 'g' || !(p.quantity > 0)) continue
      const label = String(p.portionName).slice(0, 40)
      const lc = label.toLowerCase()
      if (seenLabels.has(lc)) continue
      seenLabels.add(lc)
      portionRows.push({ ref: f.foodId, label, grams: round1(p.quantity), so: i })
    }
  }

  const values = rows.map(r =>
    `  (${[r.name, r.calories, r.protein_g, r.carbs_g, r.fat_g, r.sugar_g, r.fiber_g, r.serving_label, r.serving_grams, r.source_ref].map(sql).join(', ')})`
  ).join(',\n')

  const header = `-- Seed recipe_ingredient_library with the OFFICIAL Norwegian Food Composition
-- Table (Matvaretabellen) — ${rows.length} generic foods, macros PER 100g.
-- GENERATED by scripts/generate-matvaretabellen-seed.mjs — do not hand-edit;
-- re-run the script after Matvaretabellen's annual (autumn) update.
--
-- Source: Norwegian Food Composition Table 2026. The Norwegian Food Safety
-- Authority. www.matvaretabellen.no — License: NLOD (free use + redistribution
-- with attribution). Provenance is stored on every row (source='matvaretabellen',
-- source_ref=<foodId>) so this satisfies NLOD and the refresh stays idempotent.
--
-- Mapping (verified against nutrients.json): calories=Energy(kcal), Protein,
-- Karbo=available carbohydrate, Mono+Di=TOTAL sugar, Fett=fat, Fiber=fibre.
-- Values are per 100g of the EDIBLE portion. serving_* from the food's first
-- listed portion (NULL when none — ~14% of foods have no portion).
--
-- Idempotent: ON CONFLICT (user_id, name) DO NOTHING — never overwrites a value
-- the user edited, and the user's own hand-made ingredients (which win by name)
-- are left untouched. Requires migration 055 (source/source_ref columns).

insert into recipe_ingredient_library
  (user_id, name, calories, protein_g, carbs_g, fat_g, sugar_g, fiber_g, serving_label, serving_grams, source, source_ref)
select u.id, f.name, f.calories, f.protein_g, f.carbs_g, f.fat_g, f.sugar_g, f.fiber_g, f.serving_label, f.serving_grams, 'matvaretabellen', f.source_ref
from auth.users u
cross join (values
${values}
) as f(name, calories, protein_g, carbs_g, fat_g, sugar_g, fiber_g, serving_label, serving_grams, source_ref)
on conflict (user_id, name) do nothing;
`
  writeFileSync(OUT, header)
  console.log(`Wrote ${OUT} — ${rows.length} foods`)

  // ── 058: categories + portions backfill (joins by source_ref, per user) ──
  const catValues = catRows.map(c => `  (${[c.ref, c.gid, c.top].map(sql).join(', ')})`).join(',\n')
  const portionValues = portionRows.map(p => `  (${[p.ref, p.label, p.grams, p.so].map(sql).join(', ')})`).join(',\n')

  const catSql = `-- Backfill Matvaretabellen food CATEGORIES + PORTIONS onto the library rows
-- seeded by migration 056. GENERATED by scripts/generate-matvaretabellen-seed.mjs.
--
-- Category is resolved from each food's foodGroupId → its TOP-LEVEL group name
-- (NOT the source_ref numeric prefix — 35% of foodIds disagree with their real
-- group). Requires migration 057 (food_group_id/food_group columns + the
-- recipe_ingredient_portions table). Idempotent: the UPDATE is naturally
-- re-runnable; portions dedupe on (library_ingredient_id, label).

-- (1) categories — one UPDATE ... FROM (values) for all ${catRows.length} rows.
update public.recipe_ingredient_library lib
set food_group_id = v.gid, food_group = v.top
from (values
${catValues}
) as v(ref, gid, top)
where lib.source = 'matvaretabellen' and lib.source_ref = v.ref;

-- (2) portions — join the ${portionRows.length} grams-equivalent presets to each
-- user's library rows by source_ref; skip any that already exist.
insert into public.recipe_ingredient_portions (user_id, library_ingredient_id, label, grams, sort_order)
select lib.user_id, lib.id, p.label, p.grams, p.so
from public.recipe_ingredient_library lib
join (values
${portionValues}
) as p(ref, label, grams, so)
  on lib.source = 'matvaretabellen' and lib.source_ref = p.ref
on conflict (library_ingredient_id, label) do nothing;
`
  writeFileSync(OUT_CAT, catSql)
  console.log(`Wrote ${OUT_CAT} — ${catRows.length} categories, ${portionRows.length} portions`)
}

main().catch(e => { console.error(e); process.exit(1) })
