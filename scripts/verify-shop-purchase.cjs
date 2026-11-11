/* Verification — a purchase against its store's rules and Norway's law, and the Stores screen's words (Shop step B's
 * screens, migration 191), on the real modules:
 *   1. purchaseModel.ts: which store a thing was bought at (its link's host, else its store's name), the day counts
 *      start (arrival once tapped, never before the purchase), the complaint years a stored date stands for, the
 *      deadlines of Just bought (counted from the purchase day until Arrived; a marketplace is a private seller, so
 *      no right to cancel), a date the owner set against the rules' one, price protection (from the purchase day,
 *      the tier's, the latest one), money got back, Prisjakt's offers checked where they enter, and the
 *      marketplace searches (never a link off the store's own host, the address shown decoded).
 *   2. storeWords.ts: a rule's facts and origin in words, DD.MM ↔ MM-DD, a deal day's rule and its next run.
 *   3. The harness's 191 rows (scripts/harness/seed.cjs) pass the app's own checks (storeRows), so the screens
 *      the audits and flows see are the ones real rows give.
 * Run: node scripts/verify-shop-purchase.cjs */
require('sucrase/register')
const P = require('../src/features/shop/purchaseModel')
const W = require('../src/features/shop/storeWords')
const R = require('../src/features/shop/storeRows')
const { buildTables } = require('./harness/seed.cjs')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const T = buildTables(new Date('2026-11-10T12:00:00Z'))
const stores = T.shop_stores.map(R.parseStore)
const rules = T.shop_store_rules.map(R.parseStoreRule)
const law = T.shop_law_rules.map(R.parseLawRule)

console.log('3. The harness rows pass the app\'s checks')
check('every store row parses', stores.every(Boolean), String(stores.findIndex(s => !s)))
check('every rule row parses', rules.every(Boolean), String(rules.findIndex(r => !r)))
check('every law row parses', law.every(Boolean), String(law.findIndex(r => !r)))
const ctx = { stores, rules, law }
const elkjop = stores.find(s => s.name === 'Elkjøp'), finn = stores.find(s => s.name === 'FINN'), power = stores.find(s => s.name === 'Power')

console.log('1. purchaseModel')
const item = (o = {}) => ({ id: 'x', title: 'Sony WH-1000XM5 (black)', url: null, platform: null, bought_at: '2026-11-10T11:00:00.000Z', used: false,
  warranty_until: null, bought_channel: null, arrived_on: null, return_by: null, price: 3490, currency: 'NOK', region: 'NO', ...o })
check('a link\'s host names the store', P.storeOfItem(item({ url: 'https://m.elkjop.no/p/1' }), stores)?.id === elkjop.id)
check('else the store\'s name (Elkjop = Elkjøp)', P.storeOfItem(item({ platform: 'Elkjop' }), stores)?.id === elkjop.id)
check('no row: null', P.storeOfItem(item({ platform: 'A corner shop' }), stores) === null)
check('counts start on the purchase day until Arrived', P.startDayOf(item()) === '2026-11-10')
check('… then on arrival', P.startDayOf(item({ arrived_on: '2026-11-13' })) === '2026-11-13')
check('an arrival before the purchase is not one', P.startDayOf(item({ arrived_on: '2026-11-01' })) === '2026-11-10')
check('a stored complaint day 5 years on stands for 5 years', P.complaintYearsOf(item({ warranty_until: '2031-11-10' })) === 5)
check('a typed warranty day stands for no years', P.complaintYearsOf(item({ warranty_until: '2027-03-01' })) === null)
check('a marketplace is a private seller', P.factsOf(item(), finn).seller === 'private' && P.factsOf(item(), elkjop).seller === 'business')

const online = P.deadlinesOf(item({ url: 'https://www.elkjop.no/p/1', bought_channel: 'online' }), ctx, 2).deadlines
check('online at Elkjøp: return by its 45 days (the owner\'s edit), named', online.returnBy.day === '2026-12-25' && /Elkjøp/.test(online.returnBy.words), online.returnBy.words)
check('… counted from the purchase day until Arrived, and the words say so', /until you tap Arrived/.test(online.returnBy.words))
check('… complain by 2 years, citing the law', online.complaintBy.day === '2028-11-10' && /Forbrukerkjøpsloven/.test(online.complaintBy.words))
const two = P.deadlinesOf(item({ platform: 'Power', bought_channel: 'in_store' }), ctx, 2).deadlines
check('Power says 60 and 90: the earlier date, both named', two.returnBy.day === '2027-01-09' && /60 days/.test(two.returnBy.words) && /90 days/.test(two.returnBy.words), two.returnBy.words)
const fromFinn = P.deadlinesOf(item({ url: 'https://www.finn.no/item/1', bought_channel: 'online' }), ctx, 2).deadlines
check('from a private seller on FINN: no return day, the law named', fromFinn.returnBy === null && fromFinn.notes.some(n => /private seller/.test(n)), JSON.stringify(fromFinn.notes))
check('an own date against the rules\' one', P.dateSource('2026-12-01', '2026-12-25') === 'own' && P.dateSource('2026-12-25', '2026-12-25') === 'rules' && P.dateSource(null, 'x') === 'none')

const prot = { id: '5c090000-0000-4000-8000-0000000000aa', user_id: 'u', store_id: power.id, seed_key: null, origin: 'owner', source: null, owner_edited: true,
  edited_at: null, created_at: '2026-11-10T10:00:00Z', updated_at: '2026-11-10T10:00:00Z', kind: 'price_protection', label: null, days: 30, member_tier: null,
  window_from: null, window_to: null, return_until: null, exclusions: ['campaign'], payout: 'money', against: 'own', against_stores: null, words: null,
  source_url: null, read_on: null, off: false }
const p = P.protectionOf(item({ platform: 'Power' }), power, [...rules, prot], '2026-11-20')
check('price protection holds to its last day, from the purchase day', p?.until === '2026-12-10', JSON.stringify(p))
check('… and names what it can\'t check', /campaign price/.test(p?.words ?? ''))
check('… none once it is past', P.protectionOf(item({ platform: 'Power' }), power, [...rules, prot], '2026-12-11') === null)
check('… none for a tier the owner hasn\'t', P.protectionOf(item({ platform: 'Power' }), power, [{ ...prot, member_tier: 'Plus' }], '2026-11-20') === null)
check('money got back: rebates in its currency only', P.gotBackOf([{ amount: -500, currency: 'NOK' }, { amount: 990, currency: 'NOK' }, { amount: -10, currency: 'EUR' }], 'NOK') === 500)
check('a rebate\'s label', P.rebateLabel('protection', 'Power') === 'Price protection · Power' && P.rebateLabel('other', null) === 'Money back')

const watch = o => ({ source: 'prisjakt', status: 'ok', checked_at: '2026-11-10T04:23:00Z', last_ok_at: '2026-11-10T04:23:00Z', ...o })
const offers = P.watchOffers(watch({ new_offers: [
  { shop_id: 1, shop_name: 'Power', price: 2990, currency: 'NOK', in_stock: true },
  { shop_id: 2, shop_name: 'Elkjøp', price: 3490, currency: 'NOK', in_stock: null },
  { shop_id: 3, shop_name: null, price: 100, currency: 'NOK', in_stock: null },
] }), stores)
check('offers: each shop found among the stores by its name, none guessed (no name: Prisjakt\'s number)', offers.length === 3 && offers[0].storeId === power.id
  && offers[1].price === 3490 && offers[2].storeId === null && offers[2].shop === 'Shop 3', JSON.stringify(offers))
check('offers: none from a read that isn\'t an ok Prisjakt one', P.watchOffers(watch({ status: 'blocked', new_offers: [{ shop_id: 1, shop_name: 'Power', price: 1, currency: 'NOK', in_stock: null }] }), stores).length === 0
  && P.watchOffers(watch({ source: 'page', new_offers: [{ shop_id: 1, shop_name: 'Power', price: 1, currency: 'NOK', in_stock: null }] }), stores).length === 0)
check('offers: none before 191 (no list)', P.watchOffers(watch({}), stores).length === 0)

const searches = P.marketSearches(item(), stores)
const onFinn = searches.find(s => s.store.id === finn.id)
check('Look on FINN: the name without brackets, URL-encoded, on FINN\'s own host', onFinn?.url === 'https://www.finn.no/recommerce/forsale/search?q=Sony%20WH-1000XM5', onFinn?.url)
check('Tise without a search link: listed, no link', searches.some(s => s.store.name === 'Tise' && s.url === null))
check('a pattern off the store\'s host gives no link', P.marketSearches(item(), [{ ...finn, search_url: 'https://evil.example.com/?q={q}' }])[0].url === null)
check('the address is shown decoded', P.shownAddress(onFinn.url) === 'finn.no/recommerce/forsale/search?q=Sony WH-1000XM5')
check('a link that isn\'t https shows nothing', P.shownAddress('javascript:alert(1)') === '')

console.log('2. storeWords')
check('MM-DD ↔ DD.MM', W.monthDayWords('01-15') === '15.01' && W.monthDayOf('15.1') === '01-15' && W.monthDayOf('29.02') === null && W.monthDayOf('31.04') === null)
const club = rules.find(r => r.member_tier === 'Kundeklubb')
check('a rule\'s facts', eq(W.ruleFacts(club, stores), ['50 days', 'Kundeklubb members']), JSON.stringify(W.ruleFacts(club, stores)))
check('an edited rule is "You edited it", Ask AI\'s "check it"', W.ruleOrigin(rules[0]).words === 'You edited it' && W.ruleOrigin({ ...club, origin: 'ask_ai' }).tone === 'warn')
const bf = { rule_kind: 'nth_weekday', month: 11, day: null, weekday: 4, nth: 4, offset_days: 1, length_days: 1 }
check('a deal day\'s rule in words', W.dealRuleWords(bf) === '4th Thursday of November, +1 day · 1 day', W.dealRuleWords(bf))
check('its next run', W.dealNextWords({ ...bf, id: 'b', slug: 'black_friday', name: 'Black Friday', source_url: null, checked_on: '2026-11-10', created_at: '', updated_at: '' }, '2026-11-10') === 'Next 27.11.2026')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
