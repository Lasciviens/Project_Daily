#!/usr/bin/env node
/* Verification — stores, their rules, Norway's law and holidays (migration 191), on the real modules:
 *   1. Holidays (src/features/shop/norwayHolidays.ts): Easter 2026–2030 on the known days (05.04.2026 …) and the
 *      same as Gauss's method for 1600–2400; every holiday of 2026 and 2027; working days; the next working day
 *      past Easter, Christmas and a weekend.
 *   2. The rows (storeRows.ts): 191's own seeds and law, read from the migration, pass the checks a row read back
 *      passes; the allow-lists and the host check are 191's CHECKs, the same text; a broken row (http, another
 *      host's search link, NaN or 401 days, a 29.02 window, a kind's wrong fields, a law not on Lovdata) is none;
 *      what the owner types is checked before it is sent; deal days are 190's with the owner's own over them.
 *   3. The rules (storeRules.ts): which store a link is on (the most specific host, never a look-alike), whether
 *      apps may read it (188's list, by host), its search link; the deadlines — each date explains itself
 *      ("Return by 15.01.2027 — Elkjøp's Christmas returns, typed 10.11.2026"), counts from the purchase day until
 *      Arrived, takes the earlier date when two sources disagree (Power's 90 / 60), names the law's last day past a
 *      weekend or Easter, no right to cancel in a shop or from a private seller, 2 / 5 years to complain; price
 *      match from an offer list ("Elkjøp matches Power: 2 990 there, read 05:23").
 * Run: node scripts/verify-shop-stores.cjs */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const H = require('../src/features/shop/norwayHolidays')
const R = require('../src/features/shop/storeRows')
const S = require('../src/features/shop/storeRules')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const mig = f => fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations', f), 'utf8')
const sql191 = mig('191_shop_stores_rules.sql')
const sql188 = mig('188_shop_site_policies.sql')

// ── 1. Holidays ──────────────────────────────────────────────────────────────
console.log('1 · Norway\'s holidays')
const KNOWN_EASTER = { 2026: '2026-04-05', 2027: '2027-03-28', 2028: '2028-04-16', 2029: '2029-04-01', 2030: '2030-04-21' }
check('Easter Sunday 2026–2030: 05.04.2026, 28.03.2027, 16.04.2028, 01.04.2029, 21.04.2030',
  Object.entries(KNOWN_EASTER).every(([y, d]) => H.easterSunday(Number(y)) === d), JSON.stringify(Object.keys(KNOWN_EASTER).map(y => H.easterSunday(Number(y)))))
// Gauss's Easter algorithm (with its two exceptions), written here on its own: the module's must agree every year.
function gauss(y) {
  const a = y % 19, b = y % 4, c = y % 7, k = Math.floor(y / 100), p = Math.floor((13 + 8 * k) / 25), q = Math.floor(k / 4)
  const M = (15 - p + k - q) % 30, N = (4 + k - q) % 7
  const d = (19 * a + M) % 30, e = (2 * b + 4 * c + 6 * d + N) % 7
  let day = 22 + d + e, month = 3
  if (d === 29 && e === 6) day = 50
  else if (d === 28 && e === 6 && (11 * M + 11) % 30 < 19) day = 49
  if (day > 31) { month = 4; day -= 31 }
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
const disagree = []
for (let y = 1600; y <= 2400; y++) if (H.easterSunday(y) !== gauss(y)) disagree.push(y)
check('…and the same as Gauss\'s method every year from 1600 to 2400', !disagree.length, disagree.slice(0, 5).join(', '))
check('Easter is always a Sunday between 22.03 and 25.04 (1583–3000)', Array.from({ length: 1418 }, (_, i) => 1583 + i).every(y => {
  const d = H.easterSunday(y), t = new Date(`${d}T00:00:00Z`)
  return t.getUTCDay() === 0 && d.slice(5) >= '03-22' && d.slice(5) <= '04-25'
}))
check('no Easter outside the Gregorian years it is defined for', H.easterSunday(1582) === null && H.easterSunday(10000) === null && H.easterSunday(2026.5) === null && H.norwayHolidays(1500).length === 0)
check('2026\'s twelve holidays, in order',
  eq(H.norwayHolidays(2026).map(h => h.day), ['2026-01-01', '2026-04-02', '2026-04-03', '2026-04-05', '2026-04-06', '2026-05-01', '2026-05-14', '2026-05-17', '2026-05-24', '2026-05-25', '2026-12-25', '2026-12-26']),
  JSON.stringify(H.norwayHolidays(2026).map(h => h.day)))
check('…named in English with the Norwegian name after it ("Maundy Thursday (skjærtorsdag)", "Constitution Day (grunnlovsdag)")',
  H.holidayName('2026-04-02') === 'Maundy Thursday (skjærtorsdag)' && H.holidayName('2026-05-17') === 'Constitution Day (grunnlovsdag)' && H.holidayName('2026-05-14') === 'Ascension Day (Kristi himmelfartsdag)')
check('2027: Whit Monday falls on Constitution Day (17.05.2027), Ascension on 06.05.2027',
  H.norwayHolidays(2027).filter(h => h.day === '2027-05-17').length === 2 && H.holidayName('2027-05-06') !== null && H.holidayName('2027-03-25') !== null)
check('Christmas Eve and New Year\'s Eve are no public holidays', H.holidayName('2026-12-24') === null && H.holidayName('2026-12-31') === null)
check('working days: a Wednesday yes; a Saturday, a Sunday, Ascension Day no; no day, no', H.isWorkingDay('2026-11-11') && !H.isWorkingDay('2026-11-14')
  && !H.isWorkingDay('2026-11-15') && !H.isWorkingDay('2026-05-14') && !H.isWorkingDay('2026-02-30') && !H.isWorkingDay('x'))
check('the next working day: Maundy Thursday 02.04.2026 → Tuesday 07.04.2026; Christmas Day 25.12.2026 → Monday 28.12.2026; Saturday → Monday; a working day itself',
  H.nextWorkingDay('2026-04-02') === '2026-04-07' && H.nextWorkingDay('2026-12-25') === '2026-12-28' && H.nextWorkingDay('2026-11-14') === '2026-11-16'
  && H.nextWorkingDay('2026-12-24') === '2026-12-24' && H.nextWorkingDay('2027-03-25') === '2027-03-30',
  [H.nextWorkingDay('2026-04-02'), H.nextWorkingDay('2026-12-25'), H.nextWorkingDay('2027-03-25')].join())
check('…never past five days, for every day of 2026–2030', (() => {
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2031, 0, 1); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10)
    const n = H.nextWorkingDay(d)
    if (!H.isWorkingDay(n) || (Date.parse(n) - t) / 86_400_000 > 5) return false
  }
  return true
})())
let threw = false
try { H.nextWorkingDay('2026-13-01') } catch { threw = true }
check('a day that is no day is refused, not guessed', threw)

// ── 2. The rows ──────────────────────────────────────────────────────────────
console.log('2 · Stores, rules and the law as rows')
const OWNER = '00000000-0000-0000-0000-000000000001'
const seedFn = sql191.slice(sql191.indexOf('create or replace function public.shop_store_seed(p_user uuid)'))
const storeSeeds = [...seedFn.matchAll(/\n {4}\('([a-z_]+)', '(\{"kind"[\s\S]*?\})'::jsonb\)/g)].map(m => ({ key: m[1], facts: JSON.parse(m[2].replace(/''/g, "'")) }))
const ruleSeeds = [...seedFn.matchAll(/\n {4}\('([a-z_]+)', '([a-z_]+)', '(\{[\s\S]*?\})'::jsonb\)/g)].map(m => ({ key: m[1], store: m[2], facts: JSON.parse(m[3].replace(/''/g, "'")) }))
let n = 0
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const T = '2026-11-10T08:00:00Z'
const stores = storeSeeds.map(s => R.parseStore({
  id: uuid(), user_id: OWNER, seed_key: s.key, origin: 'seed', search_url: null, ad_template: null, ad_language: null, read_on: null,
  ...s.facts, member_tier: null, hidden: false, source_facts: s.facts, owner_edited: false, edited_at: null, created_at: T, updated_at: T,
}))
check(`191 seeds twelve stores, each a row the app takes (${storeSeeds.map(s => s.key).join(', ')})`, stores.length === 12 && stores.every(Boolean))
const store = Object.fromEntries(storeSeeds.map((s, i) => [s.key, stores[i]]))
const rules = ruleSeeds.map(r => R.parseStoreRule({
  id: uuid(), user_id: OWNER, store_id: store[r.store].id, seed_key: r.key, origin: 'seed', label: null, member_tier: null, window_from: null,
  window_to: null, return_until: null, exclusions: [], payout: null, against: null, against_stores: null, words: null, ...r.facts,
  off: false, source_facts: r.facts, owner_edited: false, edited_at: null, created_at: T, updated_at: T,
}))
check('…and three rules (Elkjøp 30, Kundeklubb 50, Power 90), each from the store\'s own page on 10.11.2026', rules.length === 3 && rules.every(Boolean)
  && eq(rules.map(r => [r.kind, r.days, r.member_tier, r.read_on]), [['open_purchase', 30, null, '2026-11-10'], ['open_purchase', 50, 'Kundeklubb', '2026-11-10'], ['return', 90, null, '2026-11-10']])
  && rules.every(r => R.linkHost(r.source_url).endsWith(store[ruleSeeds.find(s => s.key === r.seed_key).store].hosts[0])))
const rule = Object.fromEntries(ruleSeeds.map((r, i) => [r.key, rules[i]]))

// The law, from 191's own insert.
function valuesOf(text) {
  const out = []
  let depth = 0, quote = false, cur = '', row = []
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === "'" && text[i + 1] === "'") { cur += "'"; i++ } else if (c === "'") quote = false; else cur += c
      continue
    }
    if (c === "'") { quote = true; continue }
    if (c === '(') { if (depth++ === 0) { row = []; cur = '' } else cur += c; continue }
    if (c === ')') { if (--depth === 0) { row.push(cur.trim()); out.push(row) } else cur += c; continue }
    if (c === ',' && depth === 1) { row.push(cur.trim()); cur = ''; continue }
    if (depth > 0) cur += c
  }
  return out
}
const lawInsert = sql191.match(/insert into public\.shop_law_rules \(([^)]*)\) values\n([\s\S]*?)\non conflict \(slug\) do nothing;/)
const lawCols = lawInsert ? lawInsert[1].split(',').map(c => c.trim()) : []
const lawRows = lawInsert ? valuesOf(lawInsert[2]).map((v, i) => {
  const o = { id: uuid() }
  lawCols.forEach((c, k) => { o[c] = v[k] === 'null' ? null : v[k] === 'true' ? true : v[k] === 'false' ? false : /^\d+$/.test(v[k]) ? Number(v[k]) : v[k] })
  return o
}) : []
const law = lawRows.map(R.parseLawRule)
check('191\'s law: six rules, each one the app takes (Norway, a Lovdata link)', law.length === 6 && law.every(Boolean), JSON.stringify(lawRows.map(r => r.slug)))
check('…angrerett 14 days from receipt at a distance from a business, moved to a working day; none in a shop; none from a private seller',
  eq(law.filter(l => l.kind === 'cancel').map(l => [l.channel, l.seller, l.gives_right, l.days, l.to_workday]),
    [['distance', 'business', true, 14, true], ['in_store', 'business', false, null, false], ['any', 'private', false, null, false]]))
check('…reklamasjon 2 years, 5 for long-lasting things (forbrukerkjøpsloven § 27), 2 between private persons (kjøpsloven § 32)',
  eq(law.filter(l => l.kind === 'complaint').map(l => [l.seller, l.years, l.long_lasting, /§ (27|32)/.exec(l.law)?.[0]]),
    [['business', 2, false, '§ 27'], ['business', 5, true, '§ 27'], ['private', 2, null, '§ 32']]))

// 191's CHECKs and the app's lists: the same.
const checkList = re => (sql191.match(re)?.[1] ?? '').split(',').map(x => x.trim().replace(/'/g, '')).filter(Boolean)
check('the store kinds are 191\'s', eq(R.STORE_KINDS, checkList(/kind\s+text not null check \(kind in \(('shop'[^)]*)\)\)/)))
check('the rule kinds are 191\'s', eq(R.RULE_KINDS, checkList(/kind\s+text not null check \(kind in \(('open_purchase'[^)]*)\)\)/)))
check('the exclusions are 191\'s', eq(R.RULE_EXCLUSIONS, checkList(/exclusions <@ array\[([^\]]*)\]/)))
check('the host check is 191\'s (and 188\'s), the same text', sql191.includes(`p_host ~ '${R.HOST_RE.source}'`) && sql188.includes(R.HOST_RE.source.slice(1, -1)))

const base = rule.power_return
check('a rule read back with a link that isn\'t https, NaN or 401 days, a 29.02 window, a kind\'s wrong fields is none', [
  { source_url: 'http://www.power.no/' }, { source_url: 'https://www.power.no@attacker.example/' }, { source_url: 'javascript:alert(1)' },
  { days: NaN }, { days: 'NaN' }, { days: Infinity }, { days: 401 }, { days: 0 }, { days: 2.5 }, { exclusions: ['sale'] },
  { kind: 'seasonal_return', days: null, window_from: '02-29', window_to: '12-24', return_until: '01-15' },
  { kind: 'price_match', days: null, against: 'listed', against_stores: null }, { kind: 'return', days: 30, against: 'any' },
  { origin: 'robot' }, { store_id: 'x' },
].every(x => R.parseStoreRule({ ...base, source_facts: null, ...x }) === null))
check('…and a good one is (its source kept)', R.parseStoreRule({ ...base, source_facts: base.source })?.source?.days === 90)
check('a store read back with an http source, a search link on another host or with {q} in the host, a bad host is none', [
  { source_url: 'http://www.elkjop.no/' }, { search_url: 'https://attacker.example/?q={q}' }, { search_url: 'https://{q}.elkjop.no/' },
  { search_url: 'https://www.elkjop.no/search' }, { hosts: ['https://elkjop.no'] }, { hosts: [] }, { country: 'no' }, { ad_template: 'x', ad_language: null },
].every(x => R.parseStore({ ...store.elkjop, source_facts: null, ...x }) === null))
check('a law rule not on Lovdata, or for another country, is none', R.parseLawRule({ ...lawRows[0], law_url: 'https://attacker.example/lov' }) === null
  && R.parseLawRule({ ...lawRows[0], country: 'SE' }) === null && R.parseLawRule({ ...lawRows[0], days: 400.5 }) === null)
check('an edit is checked before it is sent (days, a window\'s day, https, a kind\'s fields)',
  R.rulePatchProblem(base, { days: 0 }) === 'Days are a whole number from 1 to 400' && R.rulePatchProblem(base, { days: NaN }) !== null
  && R.rulePatchProblem(base, { source_url: 'http://x.example/' }) === 'The source must be a https link'
  && R.rulePatchProblem(base, { kind: 'seasonal_return' }) === 'That doesn\'t fit this kind of rule'
  && R.rulePatchProblem(base, { kind: 'seasonal_return', days: null, window_from: '11-01', window_to: '12-24', return_until: '02-29' }) !== null
  && R.rulePatchProblem(base, { days: 60, words: 'Typed.' }) === null)

// Deal days: 190's rows with the owner's own versions over them.
const D = require('../src/features/shop/dealDays')
const shared = [
  { id: 'd1', slug: 'black_friday', name: 'Black Friday', rule_kind: 'nth_weekday', month: 11, day: null, weekday: 4, nth: 4, offset_days: 1, length_days: 1, source_url: null, checked_on: '2026-11-10', created_at: T, updated_at: T },
  { id: 'd2', slug: 'singles_day', name: 'Singles\' Day', rule_kind: 'fixed', month: 11, day: 11, weekday: null, nth: null, offset_days: 0, length_days: 1, source_url: null, checked_on: '2026-11-10', created_at: T, updated_at: T },
]
const edit = (o) => R.parseDealDayEdit({ id: uuid(), user_id: OWNER, rule_kind: 'fixed', month: 1, day: 25, weekday: null, nth: null, offset_days: 0, length_days: 1, off: false, source_url: null, created_at: T, updated_at: '2026-11-12T09:00:00Z', ...o })
const week = edit({ slug: 'black_friday', name: 'Black Week', rule_kind: 'nth_weekday', month: 11, day: null, weekday: 4, nth: 4, offset_days: -3, length_days: 8 })
const rows = R.dealDayRows(shared, [week, edit({ slug: 'singles_day', name: 'Singles\' Day', month: 11, day: 11, off: true }), edit({ slug: 'payday_sale', name: 'Payday sale' })])
const eff = R.effectiveDealDays(rows)
check('the owner\'s Black Week replaces 190\'s Black Friday (edited, typed 12.11.2026); Singles\' Day turned off is left out; their own Payday sale counts',
  eq(eff.map(d => [d.slug, d.name, !!d.edited, d.checked_on]), [['black_friday', 'Black Week', true, '2026-11-12'], ['payday_sale', 'Payday sale', true, '2026-11-12']])
  && rows.find(r => r.slug === 'black_friday').source.name === 'Black Friday' && rows.find(r => r.slug === 'payday_sale').source === null)
check('…and Black Week runs 23.11.2026–30.11.2026 (the 4th Thursday − 3, 8 days)', eq(D.nextDeal(D.dealRuleOf(eff[0]), '2026-11-10'), { start: '2026-11-23', end: '2026-11-30' }),
  JSON.stringify(D.nextDeal(D.dealRuleOf(eff[0]), '2026-11-10')))
check('an edit read back that isn\'t a whole rule (29.02, a 5th weekday, NaN) is none', edit({ slug: 'x', name: 'x', month: 2, day: 29 }) === null
  && edit({ slug: 'x', name: 'x', rule_kind: 'nth_weekday', day: null, weekday: 4, nth: 5 }) === null && edit({ slug: 'x', name: 'x', day: NaN }) === null)
check('a slug for the owner\'s own deal day: "Påskesalg på Øya" → paskesalg_pa_oya; none from symbols alone',
  R.dealSlugOf('Påskesalg på Øya') === 'paskesalg_pa_oya' && R.dealSlugOf('Ærlig salg') === 'aerlig_salg' && R.dealSlugOf('!!!') === null && R.dealSlugOf('2026 sale') === 'sale')

// ── 3. The rules ─────────────────────────────────────────────────────────────
console.log('3 · Which store, its deadlines, price match')
check('a link is on its store: Elkjøp\'s product page, m.finn.no on FINN, http too',
  S.storeOfLink('https://www.elkjop.no/product/x/899848', stores) === store.elkjop && S.storeOfLink('https://m.finn.no/recommerce/item/1', stores) === store.finn
  && S.storeOfLink('http://www.power.no/x/p-1/', stores) === store.power)
check('…never on a look-alike: notelkjop.no, elkjop.no.attacker.example, a user@host trick, a non-web link',
  S.storeOfLink('https://notelkjop.no/', stores) === null && S.storeOfLink('https://elkjop.no.attacker.example/', stores) === null
  && S.storeOfLink('https://elkjop.no@attacker.example/', stores) === null && S.storeOfLink('ftp://elkjop.no/', stores) === null && S.storeOfLink('not a link', stores) === null)
const outlet = R.parseStore({ ...store.elkjop, id: uuid(), seed_key: null, origin: 'owner', name: 'Elkjøp Outlet', hosts: ['outlet.elkjop.no'], search_url: null, source_facts: null })
check('the most specific host wins: outlet.elkjop.no is the owner\'s Elkjøp Outlet, www.elkjop.no Elkjøp', S.storeOfLink('https://outlet.elkjop.no/x', [...stores, outlet]) === outlet
  && S.storeOfLink('https://www.elkjop.no/x', [outlet, ...stores]) === store.elkjop)
const policyHosts = [...sql188.matchAll(/^ {2}\('([a-z.]+)', true,/gm)].map(m => m[1])
check('apps may not read FINN and Tise (188\'s list, by host — never a copy on the store); Elkjøp may be read',
  eq(policyHosts, ['finn.no', 'tise.com']) && S.storeSitePolicy(store.finn, policyHosts) === 'finn.no' && S.storeSitePolicy(store.tise, policyHosts) === 'tise.com'
  && S.storeSitePolicy(store.elkjop, policyHosts) === null)
check('Elkjøp\'s search link for "Sony WH-1000XM5": its pattern, the words URL-encoded', S.searchLinkFor(store.elkjop, '  Sony   WH-1000XM5 ') === 'https://www.elkjop.no/search?q=Sony%20WH-1000XM5'
  && S.searchLinkFor(store.elkjop, 'Bose & Co #1') === 'https://www.elkjop.no/search?q=Bose%20%26%20Co%20%231')
check('…none without words or a pattern (Power), nor when a pattern points elsewhere (the last-line guard)', S.searchLinkFor(store.elkjop, ' ') === null && S.searchLinkFor(store.power, 'x') === null
  && S.searchLinkFor({ ...store.elkjop, search_url: 'https://attacker.example/?q={q}' }, 'x') === null && S.searchLinkFor(store.elkjop, 'x'.repeat(201)) === null)
check('a price site\'s shop name finds its store: "Elkjop", "ELKJØP" → Elkjøp; "Power.no" → none', S.storeOfShopName('Elkjop', stores) === store.elkjop
  && S.storeOfShopName('ELKJØP', stores) === store.elkjop && S.storeOfShopName('Power.no', stores) === null && S.storeOfShopName('', stores) === null)

const dl = (p, st, extra = []) => S.purchaseDeadlines(p, { store: st, rules: [...rules, ...extra], law })
let d = dl({ boughtOn: '2026-11-10', channel: 'online', seller: 'business' }, store.elkjop)
check('Elkjøp online, Arrived not tapped: return by 10.12.2026 (30 days from the purchase day), the right to cancel to 24.11.2026 named',
  d.returnBy?.day === '2026-12-10' && d.returnBy.from === 'purchase' && !d.returnBy.unsure
  && d.returnBy.words === 'Return by 10.12.2026 — Elkjøp\'s 30-day open purchase, read 10.11.2026; the right to cancel (angrerett) runs to 24.11.2026; counted from the purchase day until you tap Arrived',
  d.returnBy?.words)
d = dl({ boughtOn: '2026-11-10', arrivedOn: '2026-11-13', channel: 'online', seller: 'business' }, store.elkjop)
check('…Arrived on 13.11: counted from arrival, 13.12.2026', d.returnBy?.day === '2026-12-13' && d.returnBy.from === 'arrival' && !/until you tap Arrived/.test(d.returnBy.words))
d = dl({ boughtOn: '2026-11-10', arrivedOn: '2026-11-03', channel: 'online', seller: 'business' }, store.elkjop)
check('…an arrival before the purchase is no arrival (counted from the purchase)', d.returnBy?.day === '2026-12-10' && d.returnBy.from === 'purchase')
const member = { ...store.elkjop, member_tier: 'kundeklubb' }
d = dl({ boughtOn: '2026-11-10', channel: 'in_store', seller: 'business' }, member)
check('a Kundeklubb member (any case): 50 days, to 30.12.2026; in a shop, no right to cancel (a note)', d.returnBy?.day === '2026-12-30'
  && /Elkjøp's 50-day open purchase for Kundeklubb members, read 10\.11\.2026/.test(d.returnBy.words) && d.notes.some(x => /^No right to cancel in a shop/.test(x)), JSON.stringify(d))
check('…not a member: the club\'s 50 days don\'t count', dl({ boughtOn: '2026-11-10', channel: 'in_store', seller: 'business' }, store.elkjop).returnBy?.day === '2026-12-10')

// Power's pages say 90 days; its help centre says 60, typed by the owner: a conflict — the earlier date, both named.
const typed60 = R.parseStoreRule({ ...rule.power_return, id: uuid(), seed_key: null, origin: 'owner', days: 60, words: 'Typed from the help centre.',
  source_url: 'https://www.power.no/kundeservice/', source_facts: null, owner_edited: true, edited_at: '2026-11-12T10:00:00Z' })
d = dl({ boughtOn: '2026-11-10', channel: 'in_store', seller: 'business' }, store.power, [typed60])
check('Power 90 (its page) and 60 (typed): the earlier date, 09.01.2027, both named — never picked silently', d.returnBy?.day === '2027-01-09' && d.returnBy.unsure
  && d.returnBy.words.startsWith('Return by 09.01.2027 — Power says 60 days (typed 12.11.2026) and 90 days (read 10.11.2026) — the earlier date is shown')
  && eq(d.returnBy.ruleIds.sort(), [typed60.id, rule.power_return.id].sort()), d.returnBy?.words)
check('…without the typed rule, 90 days: 08.02.2027', dl({ boughtOn: '2026-11-10', channel: 'in_store', seller: 'business' }, store.power).returnBy?.day === '2027-02-08')
check('…the 60 turned off: 90 again', dl({ boughtOn: '2026-11-10', channel: 'in_store', seller: 'business' }, store.power, [{ ...typed60, off: true }]).returnBy?.day === '2027-02-08')

// The brief's own example: Elkjøp's Christmas returns, typed 10.11.2026.
const xmas = R.parseStoreRule({ ...rule.elkjop_open_purchase, id: uuid(), seed_key: null, origin: 'owner', kind: 'seasonal_return', label: 'Christmas returns', days: null,
  window_from: '11-01', window_to: '12-24', return_until: '01-15', exclusions: ['campaign'], words: null, source_url: null, read_on: null,
  source_facts: null, owner_edited: true, edited_at: '2026-11-10T12:00:00Z' })
d = dl({ boughtOn: '2026-11-20', channel: 'in_store', seller: 'business', conditions: { campaign: false } }, store.elkjop, [xmas])
check('"Return by 15.01.2027 — Elkjøp\'s Christmas returns, typed 10.11.2026" (bought 20.11, not a campaign price)',
  d.returnBy?.day === '2027-01-15' && d.returnBy.words.startsWith('Return by 15.01.2027 — Elkjøp\'s Christmas returns, typed 10.11.2026'), d.returnBy?.words)
d = dl({ boughtOn: '2026-11-20', channel: 'in_store', seller: 'business' }, store.elkjop, [xmas])
check('…campaign price not known: the earlier 30 days count (20.12.2026), the Christmas date named as "may"', d.returnBy?.day === '2026-12-20'
  && d.notes.some(x => x === 'Elkjøp\'s Christmas returns may give until 15.01.2027 — if it wasn\'t a campaign price (typed 10.11.2026)'), JSON.stringify(d.notes))
check('…a campaign price: the Christmas returns don\'t hold', dl({ boughtOn: '2026-11-20', channel: 'in_store', seller: 'business', conditions: { campaign: true } }, store.elkjop, [xmas]).returnBy?.day === '2026-12-20')
check('…bought before the window (20.10): they don\'t hold', dl({ boughtOn: '2026-10-20', channel: 'in_store', seller: 'business', conditions: { campaign: false } }, store.elkjop, [xmas]).returnBy?.day === '2026-11-19')
const yearEnd = { ...xmas, id: uuid(), store_id: store.jernia.id, window_from: '12-01', window_to: '01-10', return_until: '01-31', exclusions: [] }
check('a window across the year end (Jernia, no other rule): bought 05.01.2027 in 01.12–10.01 → until 31.01.2027; bought 15.12.2026 → 31.01.2027',
  dl({ boughtOn: '2027-01-05', channel: 'in_store', seller: 'business' }, store.jernia, [yearEnd]).returnBy?.day === '2027-01-31'
  && dl({ boughtOn: '2026-12-15', channel: 'in_store', seller: 'business' }, store.jernia, [yearEnd]).returnBy?.day === '2027-01-31')
check('another store\'s rule, or one for a tier the owner hasn\'t, never counts', dl({ boughtOn: '2026-11-10', channel: 'in_store', seller: 'business' }, store.jernia).returnBy === null)

// The law alone.
d = dl({ boughtOn: '2026-11-10', arrivedOn: '2026-11-15', channel: 'online', seller: 'business' }, null)
check('online from a business, arrived Sunday 15.11: cancel by 29.11.2026 (a Sunday) — the law\'s last day, Monday 30.11.2026, named',
  d.returnBy?.day === '2026-11-29' && d.returnBy.legalLastDay === '2026-11-30' && d.returnBy.lawSlug === 'cancel_distance_business'
  && d.returnBy.words === 'Return by 29.11.2026 — the right to cancel (angrerett), 14 days, Angrerettloven (LOV-2014-06-20-27); by law to 30.11.2026 (29.11.2026 is not a working day)', d.returnBy?.words)
d = dl({ boughtOn: '2027-03-08', arrivedOn: '2027-03-11', channel: 'online', seller: 'business' }, null)
check('…arrived 11.03.2027: its 14th day is Maundy Thursday — by law Tuesday 30.03.2027, past Easter', d.returnBy?.day === '2027-03-25' && d.returnBy.legalLastDay === '2027-03-30')
d = dl({ boughtOn: '2026-11-10', channel: 'online', seller: 'business' }, null)
check('…Arrived not tapped: 14 days from the purchase day (the earlier date), no law\'s day guessed', d.returnBy?.day === '2026-11-24' && d.returnBy.legalLastDay === null
  && /counted from the purchase day until you tap Arrived$/.test(d.returnBy.words))
d = dl({ boughtOn: '2026-11-10' }, null)
check('…channel and seller not known: no return date, the right to cancel only as "if"', d.returnBy === null
  && d.notes.some(x => x.startsWith('If it was bought online from a business: the right to cancel (angrerett) to 24.11.2026')), JSON.stringify(d.notes))
d = dl({ boughtOn: '2026-11-10', seller: 'business' }, null)
check('…from a business, channel not known: no return date either (a shop purchase has none), the online right only as "if"', d.returnBy === null
  && d.notes.some(x => x.startsWith('If it was bought online from a business')), JSON.stringify(d))
d = dl({ boughtOn: '2026-11-10', channel: 'online', seller: 'private', longLasting: true }, store.finn)
check('from a private seller on FINN: no right to cancel; complain by 10.11.2028 (kjøpsloven § 32, no 5 years)', d.returnBy === null
  && d.notes.some(x => x.startsWith('No right to cancel from a private seller')) && d.complaintBy?.day === '2028-11-10' && d.complaintBy.lawSlug === 'complaint_private'
  && !/5 years/.test(d.complaintBy.words), JSON.stringify(d))
d = dl({ boughtOn: '2026-11-10', arrivedOn: '2026-11-12', channel: 'online', seller: 'business', longLasting: true }, store.elkjop)
check('a TV from a business, meant to last: complain by 12.11.2031 (5 years from arrival)', d.complaintBy?.day === '2031-11-12' && d.complaintBy.lawSlug === 'complaint_business_long'
  && d.complaintBy.words === 'Complain by 12.11.2031 — the right to complain (reklamasjon), 5 years, Forbrukerkjøpsloven § 27 (LOV-2002-06-21-34)', d.complaintBy?.words)
d = dl({ boughtOn: '2026-11-10', channel: 'online', seller: 'business', longLasting: false }, store.elkjop)
check('…not meant to last: 2 years, 10.11.2028', d.complaintBy?.day === '2028-11-10' && d.complaintBy.lawSlug === 'complaint_business' && !d.complaintBy.unsure)
d = dl({ boughtOn: '2026-11-10', channel: 'online', seller: 'business' }, store.elkjop)
check('…not known: the earlier 2 years, the 5 named', d.complaintBy?.day === '2028-11-10' && d.complaintBy.unsure
  && d.complaintBy.words === 'Complain by 10.11.2028 — the right to complain (reklamasjon), 2 years, Forbrukerkjøpsloven § 27 (LOV-2002-06-21-34); 5 years if it is meant to last much longer; counted from the purchase day until you tap Arrived', d.complaintBy?.words)
d = dl({ boughtOn: '2026-11-10', longLasting: true }, null)
check('…seller not known, meant to last: 2 years (a private seller\'s), 5 from a business named', d.complaintBy?.day === '2028-11-10' && d.complaintBy.unsure && /; 5 years from a business/.test(d.complaintBy.words), d.complaintBy?.words)
check('a leap day plus two years is 28.02 (the earlier)', dl({ boughtOn: '2028-02-29', seller: 'business', longLasting: false }, null).complaintBy?.day === '2030-02-28')
check('no purchase day, no deadlines', eq(dl({ boughtOn: '2026-02-30' }, store.elkjop), { returnBy: null, complaintBy: null, notes: [] }))
check('a rule\'s source in words: read on a day, typed by the owner, from Ask AI — check it',
  S.sourceWords(rule.power_return) === 'read 10.11.2026' && S.sourceWords(typed60) === 'typed 12.11.2026'
  && S.sourceWords({ ...rule.power_return, origin: 'ask_ai', owner_edited: false }) === 'from Ask AI — check it'
  && S.sourceWords({ ...rule.power_return, origin: 'ask_ai', owner_edited: true, edited_at: '2026-11-13T23:30:00Z' }) === 'typed 14.11.2026')
check('an owner\'s edit whose source now says another thing is a conflict to show ("Its source says 45 days (read 10.11.2026)")',
  S.sourceConflict({ ...rule.elkjop_open_purchase, days: 35, owner_edited: true, source: { ...rule.elkjop_open_purchase.source, days: 45 } }) === 'Its source says 45 days (read 10.11.2026)'
  && S.sourceConflict(rule.elkjop_open_purchase) === null)

// Price match from an offer list.
const match = (over = {}) => R.parseStoreRule({ ...rule.elkjop_open_purchase, id: uuid(), seed_key: null, origin: 'owner', kind: 'price_match', days: null,
  against: 'listed', against_stores: [store.power.id], words: null, source_url: null, read_on: null, source_facts: null, owner_edited: true, edited_at: T, ...over })
const offers = [
  { storeId: store.power.id, shop: 'Power', price: 2990, currency: 'NOK', condition: 'new', inStock: true },
  { storeId: store.elkjop.id, shop: 'Elkjøp', price: 3490, currency: 'NOK', condition: 'new', inStock: true },
  { storeId: store.komplett.id, shop: 'Komplett', price: 2790, currency: 'NOK', condition: 'new', inStock: false },
  { storeId: null, shop: 'Netshop', price: 3100, currency: 'NOK', condition: 'new', inStock: null },
  { storeId: store.power.id, shop: 'Power', price: 1500, currency: 'NOK', condition: 'used', inStock: true },
  { storeId: store.power.id, shop: 'Power', price: 2000, currency: 'NOK', condition: 'refurbished', inStock: true },
  { storeId: store.finn.id, shop: 'FINN', price: 900, currency: 'NOK', condition: 'new', inStock: true },
  { storeId: null, shop: 'Abroad', price: 100, currency: 'EUR', condition: 'new', inStock: true },
  { storeId: null, shop: 'Broken', price: NaN, currency: 'NOK', condition: 'new', inStock: true },
  { storeId: null, shop: 'Broken', price: Infinity, currency: 'NOK', condition: 'new', inStock: true },
  { storeId: null, shop: 'Broken', price: -5, currency: 'NOK', condition: 'new', inStock: true },
]
const READ = '2026-11-10T04:23:00Z', NOW = '2026-11-10T12:00:00Z'
let m = S.priceMatches(stores, [...rules, match()], offers, READ, NOW)
check('"Elkjøp matches Power: 2 990 there, read 05:23" — saving 500 on its own 3 490', m.length === 1 && m[0].words === 'Elkjøp matches Power: 2 990 there, read 05:23'
  && m[0].saves === 500 && m[0].ownPrice === 3490 && m[0].store === store.elkjop, JSON.stringify(m.map(x => x.words)))
check('…read on another day: "read 09.11.2026"', S.priceMatches(stores, [...rules, match()], offers, '2026-11-09T20:00:00Z', NOW)[0]?.words.endsWith('read 09.11.2026'))
m = S.priceMatches(stores, [...rules, match({ against: 'any', against_stores: null })], offers, READ, NOW)
check('against any: the cheapest new offer in stock (or stock unknown) in NOK from a shop — never used, refurbished, out of stock, a marketplace, another currency or a broken price',
  m.length === 1 && m[0].matches === 'Power' && m[0].price === 2990)
m = S.priceMatches(stores, [...rules, match({ against: 'any', against_stores: null })], offers.filter(o => o.shop !== 'Power'), READ, NOW)
check('…without Power: Netshop at 3 100 (a shop with no row counts for "any")', m[0]?.matches === 'Netshop' && m[0].price === 3100)
check('against listed Komplett only (out of stock): no match', S.priceMatches(stores, [...rules, match({ against_stores: [store.komplett.id] })], offers, READ, NOW).length === 0)
check('no match when the store\'s own price is as low', S.priceMatches(stores, [...rules, match()], offers.map(o => o.shop === 'Elkjøp' ? { ...o, price: 2990 } : o), READ, NOW).length === 0)
check('…its own price not on the list: the match still shows (saves unknown)', S.priceMatches(stores, [...rules, match()], offers.filter(o => o.shop !== 'Elkjøp'), READ, NOW)[0]?.saves === null)
check('a rule turned off, for a tier the owner hasn\'t, or a hidden store: no match', S.priceMatches(stores, [...rules, match({ off: true })], offers, READ, NOW).length === 0
  && S.priceMatches(stores, [...rules, match({ member_tier: 'Gold' })], offers, READ, NOW).length === 0
  && S.priceMatches(stores.map(s => s === store.elkjop ? { ...s, hidden: true } : s), [...rules, match()], offers, READ, NOW).length === 0)
const seller = [...offers, { storeId: null, shop: 'Marketplace seller', price: 2500, currency: 'NOK', condition: 'new', inStock: true, marketplaceSeller: true }]
check('a marketplace seller\'s offer counts unless the store excludes them', S.priceMatches(stores, [...rules, match({ against: 'any', against_stores: null })], seller, READ, NOW)[0]?.price === 2500
  && S.priceMatches(stores, [...rules, match({ against: 'any', against_stores: null, exclusions: ['marketplace_seller'] })], seller, READ, NOW)[0]?.price === 2990)
m = S.priceMatches(stores, [...rules, match({ exclusions: ['campaign'] })], offers, READ, NOW)
check('what the list can\'t tell is a caveat: "Elkjøp doesn\'t match campaign prices — check Power\'s isn\'t one"', eq(m[0]?.caveats, ['Elkjøp doesn\'t match campaign prices — check Power\'s isn\'t one']))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
