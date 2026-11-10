#!/usr/bin/env node
/* Verification — the Shop add sheet's autofill (src/features/shop/autofillModel.ts): the facts a link's read, a
 * scanned barcode and a typed title give, each with its source and confidence word (exact · likely · check); how
 * a new read replaces the last one, how ticking and editing change the form's fields, what is saved (and that a
 * form fact typed over keeps no source); "You may already have this" (EAN, Prisjakt product, title); and "Find it"
 * (the words, the 150-character cap, a pattern that is data and refused when it builds anything but an https
 * address). The reads are the saved pages of the autofill test (scripts/fixtures/product-pages/) run through the
 * real reader (priceRead.ts), as shop-price's `read` answers them.
 * Run: node scripts/verify-shop-autofill.cjs */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const A = require('../src/features/shop/autofillModel')
const { readPrice } = require('../src/features/shop/priceRead')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const sp = s => String(s).replace(/\s/g, ' ')
const AT = '2026-11-10T12:00:00.000Z'
const STORES = [
  { id: 's1', name: 'Prisjakt', kind: 'price_site', hosts: ['prisjakt.no'], searchPattern: 'https://www.prisjakt.no/search?query={q}' },
  { id: 's2', name: 'Elkjøp', kind: 'shop', hosts: ['elkjop.no'], searchPattern: 'https://www.elkjop.no/search?q={q}' },
  { id: 's3', name: 'Power', kind: 'shop', hosts: ['power.no'], searchPattern: null },
  { id: 's4', name: 'Finn', kind: 'marketplace', hosts: ['finn.no'], searchPattern: 'https://www.finn.no/recommerce/forsale/search?q={q}' },
]
/** What shop-price's `read` answers for a saved page. */
const answer = (file, url, extra = {}) => ({ ...readPrice(fs.readFileSync(path.join(__dirname, 'fixtures/product-pages', file), 'utf8'), url), at: AT, finalUrl: url, ...extra })
const ELKJOP = 'https://www.elkjop.no/product/mobil-nettbrett-og-smartklokker/mobiltelefon/iphone-16-5g-smarttelefon-128gb-sort/825094'
const PJ_SONY = 'https://www.prisjakt.no/product.php?p=6219512'
const blank = { title: '', price: null, currency: 'NOK', image: null, platform: '', topId: '', subId: '' }
const byKey = facts => Object.fromEntries(facts.map(f => [f.key, f]))
/** The add sheet's step: merge what an input gave and put the facts' values into the form's empty fields. */
function step(d, origin, incoming) {
  const facts = A.mergeFacts(d.facts, origin, incoming)
  return { ...d, ...A.fieldsAfter(d, d.facts, facts), facts }
}
let n = 0
function item(p) {
  n++
  return { id: p.id ?? `i${n}`, user_id: 'u', category_id: null, title: `Thing ${n}`, notes: null, price: null, price_source: null, platform: null, url: null,
    priority: 'medium', region: null, planned_date: null, status: 'wishlist', source_type: 'manual', created_at: `2026-01-${String(n).padStart(2, '0')}T10:00:00Z`,
    updated_at: '2026-01-01T10:00:00Z', list: 'wishlist', kind: 'item', currency: 'NOK', ...p }
}

console.log('\n1 · A link: every fact of the page\'s data block, with its source and how sure')
{
  const facts = A.factsFromRead(answer('elkjop-iphone-16.html', ELKJOP), STORES, [], AT)
  const f = byKey(facts)
  check('a store page fills name, price, picture, store, brand, model, EAN, condition and return days — in the sheet\'s order',
    facts.map(x => x.key).join() === 'title,price,image,store,brand,model,ean,condition,returnDays', facts.map(x => x.key).join())
  check('…each from elkjop.no (the link\'s site, without www.), every one exact', facts.every(x => x.source.label === 'elkjop.no' && x.source.origin === 'link' && x.confidence === 'exact'))
  check('…the store is the store row\'s name for its host (Elkjøp), the price 10 990 NOK, the model the mpn, the EAN 13 digits',
    f.store.value === 'Elkjøp' && f.price.value.amount === 10990 && f.price.value.currency === 'NOK' && f.model.value === 'MYE73QN/A' && f.ean.value === '0195949821905')
  check('…in words: "10 990 NOK", "New", "30 days"', sp(A.factText(f.price)) === '10 990 NOK' && A.factText(f.condition) === 'New' && A.factText(f.returnDays) === '30 days')
  const pj = byKey(A.factsFromRead(answer('prisjakt-sony-wh-1000xm5.html', PJ_SONY), STORES, [], AT))
  check('Prisjakt: no store (a price site, not where it is bought), its product number exact', !pj.store && pj.prisjaktId.value === '6219512' && pj.prisjaktId.confidence === 'exact')
  check('…the model guessed from the name is "check"; its spec rows "likely" (a flattened list joined back)', pj.model.value === 'WH-1000XM5' && pj.model.confidence === 'check'
    && pj.specs.confidence === 'likely' && A.factText(pj.specs) === '5 rows')
  check('…a price that mixes in used offers is "check" (its schema.org figures), never exact', pj.price.confidence === 'check')
  const pjNew = byKey(A.factsFromRead({ ...answer('prisjakt-sony-wh-1000xm5.html', PJ_SONY), condition: 'new' }, STORES, [], AT))
  check('…a Prisjakt price of new offers only is exact', pjNew.price.confidence === 'exact')
  const jernia = byKey(A.factsFromRead(answer('jernia-moccamaster.html', 'https://www.jernia.no/produkter/12305912/kaffetrakter-automatic-black'), [], ['Jernia', 'Elkjøp'], AT))
  check('a shop with no store row: the owner\'s own store name that is its site\'s name, "likely"', jernia.store.value === 'Jernia' && jernia.store.confidence === 'likely')
  check('…and no model at all when the page has none (Jernia\'s sku is its own number)', !jernia.model)
  check('a refused link gives no facts', A.factsFromRead({ ...answer('elkjop-iphone-16.html', ELKJOP), status: 'not_allowed' }, STORES, [], AT).length === 0)
  const odd = byKey(A.factsFromRead({ ...answer('elkjop-iphone-16.html', ELKJOP), currency: 'GBP' }, STORES, [], AT))
  check('a price in a currency the Shop doesn\'t keep is left out (never converted)', !odd.price)
}

console.log('\n2 · A new read replaces the last one; the form\'s fields follow, never over what the owner typed')
{
  let d = { ...blank, facts: [] }
  d = step(d, 'link', A.factsFromRead(answer('elkjop-iphone-16.html', ELKJOP), STORES, [], AT))
  check('the facts fill the empty fields: name, price, picture, store', d.title === 'iPhone 16 – 5G smarttelefon 128GB (sort)' && d.price === 10990 && d.platform === 'Elkjøp' && /825094/.test(d.image))
  const typed = step({ ...blank, title: 'My phone', price: 9000, facts: [] }, 'link', A.factsFromRead(answer('elkjop-iphone-16.html', ELKJOP), STORES, [], AT))
  check('…a field the owner typed keeps the owner\'s value, and its fact row shows it isn\'t used ("you changed it")', typed.title === 'My phone' && typed.price === 9000
    && !A.factKept(byKey(typed.facts).title, typed) && byKey(typed.facts).title.on)
  const second = step(d, 'link', A.factsFromRead(answer('prisjakt-sony-wh-1000xm5.html', PJ_SONY), STORES, [], AT))
  check('a second link replaces the first link\'s facts: its own name and price in the fields, no store, no EAN left behind', second.title.startsWith('Sony WH-1000XM5')
    && second.platform === '' && !byKey(second.facts).ean && !byKey(second.facts).store && byKey(second.facts).prisjaktId.value === '6219512', JSON.stringify([second.title, second.platform]))
  const refused = step(d, 'link', [])
  check('…a refused second link takes the first one\'s facts away, and the fields they had filled', refused.facts.length === 0 && refused.title === '' && refused.price === null)
  const edited = { ...d, facts: A.editFact(d.facts, 'brand', 'Apple Inc', AT) }
  const again = step(edited, 'link', A.factsFromRead(answer('power-iphone-16.html', 'https://www.power.no/mobil-og-foto/mobiltelefon/apple-iphone-16-128-gb-blaagroenn/p-3614197/'), STORES, [], AT))
  check('an edit the owner made stays through a new read (its source "you")', byKey(again.facts).brand.value === 'Apple Inc' && byKey(again.facts).brand.source.label === 'you'
    && byKey(again.facts).ean.value === '0195949822629')
  const titleFacts = [{ key: 'brand', value: 'Appel', source: { origin: 'title', label: 'the title' }, confidence: 'check', on: true, at: AT }]
  const withTitle = step(d, 'title', titleFacts)
  check('a surer fact stays: the title\'s "check" brand never replaces the page\'s exact one', byKey(withTitle.facts).brand.value === 'Apple' && byKey(withTitle.facts).brand.source.origin === 'link')
}

console.log('\n3 · Untick, tick again, edit')
{
  const d0 = step({ ...blank, facts: [] }, 'link', A.factsFromRead(answer('elkjop-iphone-16.html', ELKJOP), STORES, [], AT))
  const t = A.toggleFact(d0.facts, 'price', d0)
  const d1 = { ...d0, ...t.fields, facts: t.facts }
  check('unticking a form fact empties the field it had filled', d1.price === null && !A.factKept(byKey(d1.facts).price, d1))
  const t2 = A.toggleFact(d1.facts, 'price', d1)
  const d2 = { ...d1, ...t2.fields, facts: t2.facts }
  check('…ticking it again puts the value back', d2.price === 10990 && A.factKept(byKey(d2.facts).price, d2))
  const typed = { ...d0, price: 8000 }
  const t3 = A.toggleFact(typed.facts, 'price', typed)
  check('…ticking a fact the owner typed over puts the fact\'s value in (the owner asked for it)', t3.fields.price === 10990)
  const t4 = A.toggleFact(d0.facts, 'ean', d0)
  check('unticking a fact without a field leaves the fields alone', Object.keys(t4.fields).length === 0 && byKey(t4.facts).ean.on === false)
  const ed = A.editFact(d0.facts, 'ean', '0195 9498 2190 5', AT)
  check('editing: an EAN typed with spaces is kept as 13 digits, its source "you"', byKey(ed).ean.value === '0195949821905' && byKey(ed).ean.edited && byKey(ed).ean.source.label === 'you')
  check('…an EAN whose check digit fails unticks the fact (never saved as typed)', byKey(A.editFact(d0.facts, 'ean', '0195949821906', AT)).ean.on === false)
  check('…return days and condition in words', byKey(A.editFact(d0.facts, 'returnDays', '60', AT)).returnDays.value === 60 && byKey(A.editFact(d0.facts, 'condition', 'used', AT)).condition.value === 'used')
  const pj = A.factsFromRead(answer('prisjakt-sony-wh-1000xm5.html', PJ_SONY), STORES, [], AT)
  const rows = byKey(A.editFact(pj, 'specs', 'Type: Over-ear\nTrådløs: Ja\nSammenleggbar', AT)).specs.value
  check('…spec rows one "Name: value" a line (a line without ":" a name alone), and back to text', JSON.stringify(rows) === JSON.stringify([{ name: 'Type', value: 'Over-ear' }, { name: 'Trådløs', value: 'Ja' }, { name: 'Sammenleggbar', value: '' }])
    && A.specsText(rows) === 'Type: Over-ear\nTrådløs: Ja\nSammenleggbar')
}

console.log('\n4 · What is saved: the kept facts with their sources, the EAN in its own column')
{
  const d0 = step({ ...blank, facts: [] }, 'link', A.factsFromRead(answer('elkjop-iphone-16.html', ELKJOP), STORES, [], AT))
  const t = A.toggleFact(d0.facts, 'condition', d0)
  const d1 = { ...d0, ...t.fields, facts: t.facts, title: 'iPhone 16 black' }
  const s = A.factsToSave(d1.facts, d1)
  check('the EAN goes to its column', s.ean === '0195949821905')
  check('every kept fact keeps its source, origin, confidence and day', s.facts.brand.source === 'elkjop.no' && s.facts.brand.origin === 'link' && s.facts.brand.confidence === 'exact' && s.facts.brand.at === AT)
  check('…an unticked one is not saved, nor a form fact the owner typed over (the name)', !s.facts.condition && !s.facts.title && s.facts.price.value.amount === 10990)
  const none = A.factsToSave([], blank)
  check('nothing filled in: nothing to save (no facts column named at all)', none.ean === null && none.facts === null)
  const noEan = A.toggleFact(d0.facts, 'ean', d0)
  check('an unticked EAN stays out of its column too', A.factsToSave(noEan.facts, d0).ean === null)
}

console.log('\n5 · A barcode: the owner\'s own things first, then groceries — no outside source for anything else')
{
  const mine = item({ id: 'mine', title: 'Freia Melkesjokolade', ean: '7040110569908', status: 'bought' })
  const gone = item({ id: 'gone', title: 'Old one', ean: '7040110569908', status: 'bought', disposal: 'sold' })
  const quick = item({ id: 'quick', title: 'Sjokolade', ean: '7040110569908', list: 'quick' })
  const wish = item({ id: 'wish', title: 'A wish', ean: '195949822629' })
  check('the owner\'s things with that EAN (a shorter stored code padded too): owned and wished — not gone, not quick-list errands',
    A.ownWithEan('7040110569908', [mine, gone, quick, item({ title: 'x', ean: '7040110569908', status: 'dropped' })]).map(i => i.id).join() === 'mine'
    && A.ownWithEan('0195949822629', [wish]).map(i => i.id).join() === 'wish')
  check('"You already have this" for a thing owned, "Already on your wishlist" for one to buy', A.ownedWords(mine) === 'You already have this' && A.ownedWords(wish) === 'Already on your wishlist')
  const alone = A.factsFromScan('0195949821905', null, AT)
  check('a durable good: only the barcode\'s EAN, exact, from "the barcode"', alone.length === 1 && alone[0].key === 'ean' && alone[0].source.label === 'the barcode' && alone[0].confidence === 'exact')
  const grocery = A.factsFromScan('7040110569908', { ean: '7040110569908', name: 'Freia Melkesjokolade 200 g', brand: 'Freia', image: 'https://bilder.example/freia.png', price: 45, store: 'Meny' }, AT)
  check('a grocery: its name, brand and picture from Kassalapp — never its price (a chain\'s, not this thing\'s)', grocery.map(f => f.key).join() === 'ean,title,brand,image'
    && grocery.slice(1).every(f => f.source.label === 'Kassalapp'))
  check('…a picture that is not an https link is left out', A.factsFromScan('7040110569908', { ean: '7040110569908', name: 'x', brand: null, image: 'javascript:alert(1)', price: null, store: null }, AT).every(f => f.key !== 'image'))
}

console.log('\n6 · A title: the owner\'s own history and its words — no outside lookups')
{
  const cats = [{ id: 'top', user_id: 'u', name: 'Electronics', parent_id: null, created_at: AT }, { id: 'sub', user_id: 'u', name: 'Headphones', parent_id: 'top', created_at: AT }]
  const items = [
    item({ title: 'Sony WH-1000XM4 headphones', category_id: 'sub', platform: 'Elkjøp', status: 'bought', price: 3490, currency: 'NOK', bought_at: '2025-03-12T11:00:00Z' }),
    item({ title: 'Garden hose', category_id: 'top', platform: 'Jula' }),
    item({ title: 'Sony WH-1000XM4 headphones', list: 'quick', platform: 'Rema' }),
  ]
  const f = byKey(A.factsFromTitle('Sony WH-1000XM4 headphones', items, cats, AT))
  check('the same title: its category (both levels), its store and what was paid, from "your “…”", likely', f.category.value.topId === 'top' && f.category.value.subId === 'sub'
    && f.category.value.name === 'Electronics · Headphones' && f.store.value === 'Elkjøp' && f.price.value.amount === 3490 && f.category.confidence === 'likely'
    && f.category.source.label === 'your “Sony WH-1000XM4 headphones”' && f.category.source.origin === 'title', JSON.stringify(f.category))
  check('…what was paid names its day', f.price.source.label === 'your “Sony WH-1000XM4 headphones”, paid 12.03.2025', f.price.source.label)
  check('…a quick-list errand is never history for a wish (Rema)', f.store.value !== 'Rema')
  const alike = byKey(A.factsFromTitle('Sony WH-1000XM5 headphones', items, cats, AT))
  check('a title half alike: the same facts, but "check"', alike.category?.confidence === 'check' && alike.store?.confidence === 'check', JSON.stringify(Object.keys(alike)))
  check('…and its words: the model code in it (check), its first word as a brand (check)', alike.model.value === 'WH-1000XM5' && alike.model.confidence === 'check'
    && alike.brand.value === 'Sony' && alike.brand.confidence === 'check' && alike.brand.source.label === 'the title')
  check('a title like nothing: no history facts', !byKey(A.factsFromTitle('Kayak paddle', items, cats, AT)).category && !byKey(A.factsFromTitle('Kayak paddle', items, cats, AT)).store)
  const known = [item({ title: 'x', facts: { brand: { value: 'Bang & Olufsen', source: 'elkjop.no', origin: 'link', confidence: 'exact', at: AT } } })]
  check('a brand the owner saved before, at the start of the title, is "likely" (any case)', JSON.stringify(A.brandInTitle('bang & olufsen Beoplay H95', known)) === JSON.stringify({ name: 'Bang & Olufsen', confidence: 'likely' }))
  check('…a one-word title or a small first word is no brand', A.brandInTitle('Headphones', []) === null && A.brandInTitle('iPhone 16', []) === null)
  check('a gift is never "what you paid"', !byKey(A.factsFromTitle('Sony WH-1000XM4 headphones', [{ ...items[0], got_as_gift: true }], cats, AT)).price)
  check('an empty title gives nothing', A.factsFromTitle('  ', items, cats, AT).length === 0)
}

console.log('\n7 · "You may already have this" — by EAN, Prisjakt product or title; never a block')
{
  const items = [
    item({ id: 'a', title: 'Apple iPhone 16 128GB', ean: '195949821905' }),
    item({ id: 'b', title: 'Sony headphones', url: 'https://www.prisjakt.no/product.php?p=6219512&a-116257=Black' }),
    item({ id: 'c', title: 'Garmin Forerunner 265', status: 'bought' }),
    item({ id: 'd', title: 'Garmin  forerunner-265', status: 'bought', disposal: 'sold' }),
    item({ id: 'e', title: 'Moccamaster', facts: { prisjaktId: { value: '5214475', source: 'prisjakt.no', origin: 'link', confidence: 'exact', at: AT } } }),
  ]
  const by = p => A.duplicatesOf({ title: '', ean: null, prisjaktId: null, url: '', ...p }, items).map(x => `${x.item.id}:${x.by}`).join()
  check('the same EAN (a stored 12-digit code padded)', by({ ean: '0195949821905' }) === 'a:ean')
  check('the same Prisjakt product: a link\'s p= (another colour too), or a kept fact', by({ url: 'https://www.prisjakt.no/product.php?p=6219512' }) === 'b:prisjakt' && by({ prisjaktId: '5214475' }) === 'e:prisjakt')
  check('the same title once folded (case, spaces, dashes) — a thing sold or given away isn\'t "yours"', by({ title: 'garmin forerunner 265' }) === 'c:title')
  check('nothing alike: nothing; a two-letter title matches nothing', by({ title: 'Kayak' }) === '' && by({ title: 'TV' }) === '')
  check('one thing found two ways is named once, EAN first', A.duplicatesOf({ title: 'Apple iPhone 16 128GB', ean: '0195949821905', prisjaktId: null, url: '' }, items).length === 1)
}

console.log('\n8 · "Find it": search links from each store\'s pattern (data), the address shown before it opens')
{
  const d0 = step({ ...blank, facts: [] }, 'link', A.factsFromRead(answer('elkjop-iphone-16.html', ELKJOP), STORES, [], AT))
  check('with a brand and a model code: those two', A.searchWords(d0.facts, d0, null) === 'Apple MYE73QN/A')
  const noModel = A.toggleFact(d0.facts, 'model', d0).facts
  check('…the model unticked: the title', A.searchWords(noModel, d0, null) === d0.title)
  check('after a scan that found nothing: the barcode\'s digits', A.searchWords([], { ...blank, title: 'something' }, '0195949821905') === '0195949821905')
  const long = A.searchWords([], { ...blank, title: 'word '.repeat(60) }, null)
  check('at most 150 characters, cut at a word', long.length <= A.SEARCH_MAX && !long.endsWith(' ') && long.endsWith('word'), String(long.length))
  const links = A.findItLinks(STORES, 'Apple MYE73QN/A')
  check('Prisjakt\'s and Elkjøp\'s search, and Finn\'s (a link only) — a store without a pattern has none', links.map(l => l.store.name).join() === 'Prisjakt,Elkjøp,Finn')
  check('…the words encoded into the pattern: https://www.prisjakt.no/search?query=Apple%20MYE73QN%2FA', links[0].url === 'https://www.prisjakt.no/search?query=Apple%20MYE73QN%2FA', links[0].url)
  check('a pattern that builds anything but an https web address is refused (javascript:, http:, a user name, no {q}, two {q})',
    A.searchLink('javascript:alert({q})', 'x') === null && A.searchLink('http://shop.example/?q={q}', 'x') === null && A.searchLink('https://me@shop.example/?q={q}', 'x') === null
    && A.searchLink('https://shop.example/', 'x') === null && A.searchLink('https://shop.example/{q}?q={q}', 'x') === null && A.searchLink('https://shop.example/?q={q}', '  ') === null)
  check('…words can\'t break out of the query: "&", "#" and "/" are encoded', A.searchLink('https://shop.example/s?q={q}', 'a&b=c#d/e') === 'https://shop.example/s?q=a%26b%3Dc%23d%2Fe')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
