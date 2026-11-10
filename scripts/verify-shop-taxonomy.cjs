#!/usr/bin/env node
/* Verification — Shop's suggested categories and default pictures
 * (src/features/shop/shopTaxonomy.ts, components/categoryIcons.ts): the
 * taxonomy's shape and English names, that it holds migration 030's seed so a
 * seeded category is matched and never suggested again, how names match
 * (case, spaces, "&"/"and", other names), what a picker suggests, what
 * "Add the suggested categories" makes (`suggestedPlan`: each suggestion once,
 * never a name the owner has, nothing suggested after) and how an open pick
 * follows it (`pickWithMade`), and which
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

console.log('"Add the suggested categories" (owner, 10.11.2026: added once, on the owner\'s tap)')
{
  // The rows a plan makes, as the API writes them: tops, then the subcategories under them and under the owner's tops.
  let n = 0
  const apply = (cats, plan) => {
    const out = cats.map(c => ({ ...c }))
    for (const t of plan.tops) {
      const top = { id: `m${++n}`, name: t.name, parent_id: null }
      out.push(top, ...t.subs.map(s => ({ id: `m${++n}`, name: s, parent_id: top.id })))
    }
    for (const u of plan.under) out.push(...u.subs.map(s => ({ id: `m${++n}`, name: s, parent_id: u.parentId })))
    return out
  }
  const names = plan => [...plan.tops.flatMap(t => [t.name, ...t.subs]), ...plan.under.flatMap(u => u.subs)]
  const suggestsNothing = cats => T.suggestedTops(cats).length === 0 && cats.filter(c => !c.parent_id).every(c => T.suggestedSubs(cats, c.id).length === 0)
  const sameLevelTwice = cats => {
    const seen = new Set()
    for (const c of cats) { const k = `${c.parent_id ?? '-'}|${K(c.name)}`; if (seen.has(k)) return k; seen.add(k) }
    return null
  }
  const total = T.TAXONOMY.reduce((s, t) => s + 1 + t.subs.length, 0)

  const empty = T.suggestedPlan([])
  check('a new account: the whole taxonomy, tops with their subcategories', empty.count === total && empty.tops.length === T.TAXONOMY.length && empty.under.length === 0, `${empty.count}/${total}`)

  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/030_shop_seed_categories.sql'), 'utf8')
  const seed = JSON.parse(/taxonomy jsonb := '(\[[\s\S]*?\])'::jsonb/.exec(sql)[1])
  const cats = []
  for (const s of seed) {
    const top = { id: `t${++n}`, name: s.top, parent_id: null }
    cats.push(top, ...s.subs.map(sub => ({ id: `s${++n}`, name: sub, parent_id: top.id })))
  }
  const plan = T.suggestedPlan(cats)
  check('with 030\'s seed: everything else, once — the taxonomy less the seeded rows', plan.count === total - cats.length && names(plan).length === plan.count, `${plan.count} = ${total} − ${cats.length}?`)
  check('…the two new tops with their subcategories, and the rest under the seed\'s own tops', eq(plan.tops.map(t => t.name), ['Garden & DIY', 'Car'])
    && plan.under.every(u => cats.some(c => c.id === u.parentId && !c.parent_id)) && plan.under.find(u => u.parentId === cats.find(c => c.name === 'Electronics').id)?.subs.includes('Headphones'))
  check('…never a seeded one again (Phones, TV & Audio, Kitchen …)', !names(plan).some(x => cats.some(c => K(c.name) === K(x))))
  const after = apply(cats, plan)
  check('once made: nothing is suggested any more (the action and the Suggested group go)', suggestsNothing(after) && T.suggestedPlan(after).count === 0)
  check('…and nothing in the list twice at one level', sameLevelTwice(after) === null, sameLevelTwice(after))
  check('a second tap makes nothing', eq(T.suggestedPlan(after), { tops: [], under: [], count: 0 }))

  // The owner's own names win: their name for a thing stays, and the taxonomy's isn't added beside it.
  const own = [
    { id: 'h', name: 'Home', parent_id: null }, { id: 'k', name: 'kitchen', parent_id: 'h' },
    { id: 'e', name: 'Electronics', parent_id: null }, { id: 'te', name: 'Tech', parent_id: null }, { id: 'hp', name: 'Earbuds', parent_id: 'te' },
    { id: 'g', name: 'Gaming', parent_id: null }, { id: 'c', name: 'consoles', parent_id: 'g' }, { id: 'tv', name: 'tv and audio', parent_id: 'e' },
    { id: 'r', name: 'Retro stuff', parent_id: null }, { id: 'x', name: 'Car', parent_id: 'r' },
  ]
  const p2 = T.suggestedPlan(own)
  const made2 = names(p2)
  check('"Home" stays the owner\'s: no Home & Living beside it — its subcategories go under "Home", less "kitchen"', !p2.tops.some(t => t.name === 'Home & Living')
    && p2.under.find(u => u.parentId === 'h')?.subs.includes('Furniture') && !made2.includes('Kitchen'), JSON.stringify(p2.under.find(u => u.parentId === 'h')))
  check('other names count: "Earbuds" is Headphones, "consoles" Game Consoles, "tv and audio" TV & Audio — none added', !made2.includes('Headphones') && !made2.includes('Game Consoles') && !made2.includes('TV & Audio'))
  check('"Gaming" is Hobby & Games: no second top, its subcategories under "Gaming"', !p2.tops.some(t => t.name === 'Hobby & Games') && p2.under.find(u => u.parentId === 'g')?.subs.includes('Board Games'))
  check('Electronics and Tech are one taxonomy top: its subcategories once, under the one with its own name', !p2.under.some(u => u.parentId === 'te')
    && p2.under.filter(u => u.parentId === 'e').length === 1 && p2.under.find(u => u.parentId === 'e').subs.includes('Tablets'))
  check('a top whose name the owner uses for a subcategory ("Car" under Retro stuff) is not made', !p2.tops.some(t => t.name === 'Car'))
  check('an owner top that is no taxonomy top ("Retro stuff") gets nothing', !p2.under.some(u => u.parentId === 'r'))
  const after2 = apply(own, p2)
  check('the owner\'s rows are all still there, as they were', own.every(o => after2.some(c => c.id === o.id && c.name === o.name && c.parent_id === o.parent_id)))
  check('once made: nothing is suggested, nothing twice', suggestsNothing(after2) && T.suggestedPlan(after2).count === 0 && sameLevelTwice(after2) === null, sameLevelTwice(after2))

  // Many accounts: the taxonomy's names and other names in any case and "&"/"and", at either level, with names of their own.
  let seedN = 11
  const rand = () => (seedN = (seedN * 1103515245 + 12345) % 2147483648) / 2147483648
  const pick = a => a[Math.floor(rand() * a.length)]
  const spell = s => pick([s, s.toLowerCase(), s.toUpperCase(), s.replace(/ & /g, ' and '), ` ${s} `])
  const pool = [...T.TAXONOMY.flatMap(t => [t.name, ...(t.aka ?? []), ...t.subs.flatMap(s => [s.name, ...(s.aka ?? [])])]), 'Stuff', 'Odds and ends', 'Pets', 'Gifts']
  const bad = []
  for (let a = 0; a < 400 && bad.length < 3; a++) {
    const acct = []
    const tops = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => ({ id: `a${++n}`, name: spell(pick(pool)), parent_id: null }))
    for (const t of tops) if (!acct.some(c => !c.parent_id && K(c.name) === K(t.name))) acct.push(t)
    for (let i = Math.floor(rand() * 12); i > 0; i--) {
      const sub = { id: `a${++n}`, name: spell(pick(pool)), parent_id: pick(acct).id }
      if (!acct.some(c => c.parent_id === sub.parent_id && K(c.name) === K(sub.name))) acct.push(sub)
    }
    const pl = T.suggestedPlan(acct)
    const had = new Set(acct.map(c => K(c.name)))
    const subKeys = pl.tops.flatMap(t => t.subs).concat(pl.under.flatMap(u => u.subs)).map(s => T.taxonomySubOf(s))
      .flatMap(s => [s.name, ...(s.aka ?? [])].map(K))
    const res = apply(acct, pl)
    const why = pl.count !== names(pl).length ? 'count'
      : pl.tops.some(t => had.has(K(t.name))) ? 'a top the owner has'
      : subKeys.some(k => had.has(k)) ? 'a subcategory the owner has under one of its names'
      : new Set(subKeys).size !== subKeys.length ? 'a subcategory twice'
      : !T.suggestedTops(acct).every(x => pl.tops.some(t => t.name === x)) ? 'a suggested top left out'
      : !acct.filter(c => !c.parent_id).every(c => T.suggestedSubs(acct, c.id).every(s => names(pl).includes(s))) ? 'a suggested subcategory left out'
      : !suggestsNothing(res) ? 'still suggests something after'
      : sameLevelTwice(res) ? `twice: ${sameLevelTwice(res)}`
      : null
    if (why) bad.push(`${why}: ${acct.map(c => `${c.parent_id ? '  ' : ''}${c.name}`).join(' / ')}`)
  }
  check('400 made-up accounts: exactly what the pickers suggest, each once — never a name the owner has, nothing suggested after', bad.length === 0, bad.join(' | '))

  // The pick in an open picker follows: a suggestion made since is that row; one still suggested stays.
  const pickNow = { topId: 'suggest:Car', subId: 'suggest:EV Charging' }
  const carRow = after.find(c => c.name === 'Car' && !c.parent_id)
  const evRow = after.find(c => c.name === 'EV Charging' && c.parent_id === carRow.id)
  check('a picked suggestion made since is the made row (top and subcategory)', eq(T.pickWithMade(pickNow, after), { topId: carRow.id, subId: evRow.id }))
  check('…one not made yet stays the same pick (the same object: nothing to change)', T.pickWithMade(pickNow, cats) === pickNow)
  const elec = cats.find(c => c.name === 'Electronics').id
  const mine = { topId: elec, subId: cats.find(c => c.name === 'Phones').id }
  check('…the owner\'s own ids are left alone', T.pickWithMade(mine, after) === mine && T.pickWithMade({ topId: '', subId: '' }, after).topId === '')
  const elecHp = after.find(c => c.name === 'Headphones' && c.parent_id === elec).id
  check('…a suggested subcategory under the owner\'s top becomes the row made there', T.pickWithMade({ topId: elec, subId: 'suggest:Headphones' }, after).subId === elecHp)
  check('…one made under the owner\'s other top of the same kind is no pick — never a second row on Save', T.pickWithMade({ topId: 'te', subId: 'suggest:Tablets' }, after2).subId === '')
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
