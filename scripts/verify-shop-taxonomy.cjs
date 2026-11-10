#!/usr/bin/env node
/* Verification — Shop's suggested categories and default pictures
 * (src/features/shop/shopTaxonomy.ts, components/categoryIcons.ts): the
 * taxonomy's shape and English names, that it holds migration 030's seed so a
 * seeded category is matched and never suggested again, how names match
 * (case, spaces, "&"/"and", other names), what a picker suggests, and which
 * picture a category gets — the taxonomy's, a guess from the owner's own
 * name, else its top category's.
 * Run: node scripts/verify-shop-taxonomy.cjs */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const T = require('../src/features/shop/shopTaxonomy')
const { ICONS, iconFor } = require('../src/features/shop/components/categoryIcons')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const K = T.categoryKey

console.log('the taxonomy')
{
  const tops = T.TAXONOMY
  check('about 8–10 top categories', tops.length >= 8 && tops.length <= 10, `${tops.length}`)
  const bad = tops.filter(t => t.subs.length < 6 || t.subs.length > 12)
  check('6–12 subcategories each', bad.length === 0, bad.map(t => `${t.name}: ${t.subs.length}`).join(', '))
  const names = tops.flatMap(t => [t.name, ...t.subs.map(s => s.name)])
  // Title Case, as migration 030's seed has them (they sit in one list with the owner's own): every word but "&"
  // starts with a capital, each part of a hyphenated one too ("E-Books").
  const notTitle = names.filter(n => n.split(/\s+/).some(w => w !== '&' && w.split('-').some(p => !/^[A-Z]/.test(p))))
  check('English names in Title Case, as the seed\'s', notTitle.length === 0, notTitle.join(', '))
  check('names are plain English (letters, spaces, "&", "-")', names.every(n => /^[A-Za-z][A-Za-z &-]*$/.test(n)), names.filter(n => !/^[A-Za-z][A-Za-z &-]*$/.test(n)).join(', '))
  const topKeys = tops.flatMap(t => [t.name, ...(t.aka || [])].map(K))
  check('a top category\'s names (and other names) belong to one top only', new Set(topKeys).size === topKeys.length)
  const subKeys = tops.flatMap(t => t.subs.flatMap(s => [s.name, ...(s.aka || [])].map(K)))
  const dup = subKeys.filter((k, i) => subKeys.indexOf(k) !== i)
  check('a subcategory\'s names (and other names) belong to one subcategory in the whole list', dup.length === 0, dup.join(', '))
  const pics = new Set(T.PICTURES)
  check('every top has a picture from the list', tops.every(t => pics.has(t.picture)))
  check('every subcategory picture is from the list', tops.every(t => t.subs.every(s => s.picture == null || pics.has(s.picture))))
  check('every keyword picture is from the list', T.PICTURE_WORDS.every(([p]) => pics.has(p)))
  const used = new Set([...tops.flatMap(t => [t.picture, ...t.subs.map(s => s.picture)]), ...T.PICTURE_WORDS.map(([p]) => p)].filter(Boolean))
  check('every picture in the list is used (no icon loaded for nothing)', T.PICTURES.every(p => used.has(p)), T.PICTURES.filter(p => !used.has(p)).join(', '))
  check('every picture is a lucide icon in the lazy map', T.PICTURES.every(p => ICONS[p] && (typeof ICONS[p] === 'object' || typeof ICONS[p] === 'function')),
    T.PICTURES.filter(p => !ICONS[p]).join(', '))
  check('the map holds nothing else', Object.keys(ICONS).length === T.PICTURES.length)
  const nb = T.PICTURE_WORDS.flatMap(([, w]) => w).filter(w => /[^\x00-\x7f]/.test(w))
  check('Norwegian keywords keep æ, ø and å (never ae/oe/aa)', nb.length > 10 && nb.every(w => /[æøå]/.test(w)) && ['kjøkken', 'høyttaler', 'klær', 'bøker'].every(w => nb.includes(w)), nb.join(', '))
}

console.log('migration 030\'s seed is in it')
{
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/030_shop_seed_categories.sql'), 'utf8')
  const json = /taxonomy jsonb := '(\[[\s\S]*?\])'::jsonb/.exec(sql)
  const seed = json ? JSON.parse(json[1]) : []
  check('the seed is read from the migration (8 tops)', seed.length === 8, `${seed.length}`)
  const missing = []
  for (const s of seed) {
    const top = T.taxonomyTopOf(s.top)
    if (!top) { missing.push(s.top); continue }
    for (const sub of s.subs) if (!top.subs.some(x => [x.name, ...(x.aka || [])].map(K).includes(K(sub)))) missing.push(`${s.top} › ${sub}`)
  }
  check('every seeded top and subcategory is a taxonomy entry, under the same top', missing.length === 0, missing.join(', '))
  let n = 0
  const cats = []
  for (const s of seed) {
    const top = { id: `t${++n}`, name: s.top, parent_id: null }
    cats.push(top, ...s.subs.map(sub => ({ id: `s${++n}`, name: sub, parent_id: top.id })))
  }
  const sugTops = T.suggestedTops(cats)
  check('with the seed: only the new tops are suggested', eq(sugTops, ['Garden & DIY', 'Car']), sugTops.join(', '))
  const again = cats.filter(c => c.parent_id).filter(c => T.suggestedSubs(cats, c.parent_id).map(K).includes(K(c.name)))
  check('…and no seeded subcategory is suggested again under its top', again.length === 0, again.map(c => c.name).join(', '))
  const elec = cats.find(c => c.name === 'Electronics')
  const subs = T.suggestedSubs(cats, elec.id)
  check('under the seed\'s Electronics: Headphones, Tablets, Monitors … (not Phones, TV & Audio)',
    ['Headphones', 'Tablets', 'Monitors', 'Cameras', 'Smartwatches', 'Smart Home'].every(x => subs.includes(x)) && !subs.includes('Phones') && !subs.includes('TV & Audio'), subs.join(', '))
}

console.log('matching names')
{
  check('case, spaces and "&"/"and" don\'t matter', K('TV & Audio') === K('tv and audio') && K('TV&audio') === K('TV & audio') && K(' Smart  home ') === K('Smarthome'))
  check('"og" is "and" too, "+" is "&"', K('Lyd og bilde') === K('lyd & bilde') && K('Cables + chargers') === K('Cables & chargers'))
  check('a name is not another just because it contains it', K('Home') !== K('Home & Living'))
  check('the seed\'s Title Case matches', T.taxonomyTopOf('Home & Living')?.name === 'Home & Living' && T.taxonomySubOf('Computers & Laptops')?.name === 'Computers & Laptops')
  check('other names: "Home" is Home & Living, "Sports" Sports & Outdoor, "Clothes" Clothing',
    T.taxonomyTopOf('Home')?.name === 'Home & Living' && T.taxonomyTopOf('sports')?.name === 'Sports & Outdoor' && T.taxonomyTopOf('Clothes')?.name === 'Clothing')
  check('"Klær" (with æ) is Clothing', T.taxonomyTopOf('Klær')?.name === 'Clothing')
  check('a name nothing is: null', T.taxonomyTopOf('Stuff') === null && T.taxonomySubOf('Things') === null)
  check('a subcategory is looked for under its top first, then anywhere', T.taxonomySubOf('Consoles', T.taxonomyTopOf('Hobby & Games'))?.name === 'Game Consoles')
}

console.log('what a picker suggests')
{
  const cats = [
    { id: 'h', name: 'Home', parent_id: null }, { id: 'k', name: 'kitchen', parent_id: 'h' }, { id: 'e', name: 'Electronics', parent_id: null },
    { id: 'hp', name: 'Earbuds', parent_id: 'e' }, { id: 'g', name: 'Gaming', parent_id: null }, { id: 'c', name: 'Consoles', parent_id: 'g' },
  ]
  const tops = T.suggestedTops(cats)
  check('the owner\'s own names win: with "Home", Home & living is not suggested', !tops.includes('Home & Living') && tops.includes('Clothing'))
  check('"Gaming" is Hobby & Games by another name: that top isn\'t suggested, its subcategories are, under the owner\'s "Gaming"', !tops.includes('Hobby & Games')
    && T.suggestedSubs(cats, 'g').includes('Video Games') && T.suggestedSubs(cats, 'g').includes('Board Games'), T.suggestedSubs(cats, 'g').join(', '))
  check('an owner top that is no taxonomy top ("Retro stuff") gets no suggestions', eq(T.suggestedSubs([...cats, { id: 'r', name: 'Retro stuff', parent_id: null }], 'r'), []))
  check('a suggested top picked but not made yet offers its own subcategories ("suggest:Garden & DIY")', T.suggestedSubs(cats, 'suggest:Garden & DIY').includes('Tools'))
  const home = T.suggestedSubs(cats, 'h')
  check('under the owner\'s "Home": Home & living\'s subcategories, less "kitchen" (any case)', home.includes('Furniture') && home.includes('Lighting') && !home.includes('Kitchen'), home.join(', '))
  const elec = T.suggestedSubs(cats, 'e')
  check('"Earbuds" is Headphones (another name): not suggested; "Consoles" anywhere hides Game consoles', !elec.includes('Headphones') && !elec.includes('Game Consoles') && elec.includes('Tablets'), elec.join(', '))
  check('a subcategory id, or none, suggests nothing', eq(T.suggestedSubs(cats, 'k'), []) && eq(T.suggestedSubs(cats, null), []))
  check('a new account: every top, in the taxonomy\'s order', eq(T.suggestedTops([]), T.TAXONOMY.map(t => t.name)))
  const subNamed = T.suggestedTops([{ id: 'x', name: 'Pets', parent_id: null }, { id: 'y', name: 'Groceries', parent_id: 'x' }])
  check('a top whose own name the owner uses for a subcategory is not suggested', !subNamed.includes('Groceries'))
}

console.log('default pictures')
{
  const P = T.pictureKeyOf
  check('a taxonomy subcategory: its own picture', P('Electronics', 'Headphones') === 'headphones' && P('Home & Living', 'Kitchen') === 'cooking-pot')
  check('…one without a picture: its top\'s (Clothing › Tops → shirt)', P('Clothing', 'Tops') === 'shirt')
  check('a top alone: its picture', P('Electronics', null) === 'monitor-smartphone' && P('Car', null) === 'car-front')
  check('the owner\'s own names, guessed: "phone", "headphone", "jacket", "kitchen"',
    P('Stuff', 'My phones') === 'smartphone' && P('Stuff', 'Over-ear headphones') === 'headphones'
    && P('Stuff', 'Winter jackets') === 'snowflake' && P('Stuff', 'Jackets for town') === 'shirt' && P('Stuff', 'Kitchen gadgets') === 'cooking-pot')
  check('"headphone" is never read as "phone"', T.guessPicture('Headphones') === 'headphones' && T.guessPicture('Hodetelefoner') === 'headphones')
  check('short words only as words: "Skis" skiing, "Skin" skin care, "Party" not art', T.guessPicture('Skis') === 'mountain-snow' && T.guessPicture('Skin') === 'droplet' && T.guessPicture('Party') === null)
  check('Norwegian words: kjøkken, sko, sykkel, hytte, bøker', T.guessPicture('Kjøkkenutstyr') === 'cooking-pot' && T.guessPicture('Sko') === 'sport-shoe'
    && T.guessPicture('Sykkel') === 'bike' && T.guessPicture('Hytta') === null && T.guessPicture('Hytte') === 'trees' && T.guessPicture('Bøker') === 'book')
  check('the telling word wins over a general one: "Pet food", "Car care", "Audiobooks", "Vegetables"',
    T.guessPicture('Pet food') === 'paw-print' && T.guessPicture('Car Care') === 'droplets' && T.guessPicture('Audiobooks') === 'book-headphones' && T.guessPicture('Vegetables') === 'apple')
  check('an owner subcategory nothing guesses: its top\'s picture', P('Electronics', 'Odds and ends') === 'monitor-smartphone')
  check('an owner top nothing guesses, alone: null (the initials show)', P('Stuff', null) === null && P('Stuff', 'Odds and ends') === null && P(null, null) === null)
  check('an owner top guessed from its name: "Gaming" → a controller', P('Gaming', null) === 'gamepad-2' && P('Gaming', 'Handhelds') === 'gamepad-2')
  check('iconFor gives the icon of pictureKeyOf', iconFor('Electronics', 'Headphones') === ICONS.headphones && iconFor('Stuff', null) === null)
  const misses = T.TAXONOMY.flatMap(t => t.subs.map(s => [t.name, s.name])).filter(([t, s]) => P(t, s) == null)
  check('every taxonomy entry has a picture', misses.length === 0, misses.join('; '))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
