#!/usr/bin/env node
/* Verification — Needs a look's data rules (migration 190), on the real modules:
 *   1. Deal days (src/features/shop/dealDays.ts): 190's own seed rows, read from the migration, fall on the days
 *      they should in 2026–2030 (Black Friday 27.11.2026, 26.11.2027, 24.11.2028 …); the n-th and the last
 *      weekday, offsets, a month too short, rules that cross a year (a run from December into January, an offset
 *      into the next year, a negative one into the year before), the next run seen from any day, whole rules only.
 *   2. Signal states (signalStates.ts): SHOP_SIGNALS is 190's CHECK list and SIGNATURE_RE its signature check, the
 *      same text; a built signature is always one the database takes, the same every time; a row stays away while
 *      snoozed (back on the day) or while Got it's signature is the row's; rows read back are checked.
 *   3. Price figures (priceStats.ts): ids asked once, in calls of at most 500; an answer with NaN or infinity is no price.
 * Run: node scripts/verify-shop-signals.cjs */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const D = require('../src/features/shop/dealDays')
const S = require('../src/features/shop/signalStates')
const P = require('../src/features/shop/priceStats')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/190_shop_needs_a_look.sql'), 'utf8')

console.log('1 · Deal days')
// 190's seed rows, as the database holds them.
const seedBlock = sql.match(/insert into public\.shop_deal_days \(slug, name, rule_kind, month, day, weekday, nth, offset_days, length_days, checked_on\) values\n([\s\S]*?)\non conflict \(slug\) do nothing;/)
const seeds = seedBlock ? [...seedBlock[1].matchAll(/\('(\w+)', '((?:[^']|'')+)', '(\w+)', (\d+), (\w+), (\w+), (\w+), (-?\d+), (\d+), '([\d-]+)'\)/g)].map(m => {
  const n = v => (v === 'null' ? null : Number(v))
  return { id: m[1], slug: m[1], name: m[2].replace(/''/g, "'"), rule_kind: m[3], month: Number(m[4]), day: n(m[5]), weekday: n(m[6]), nth: n(m[7]),
    offset_days: Number(m[8]), length_days: Number(m[9]), source_url: null, checked_on: m[10], created_at: '', updated_at: '' }
}) : []
check('190 seeds four deal days, read here as the database has them', seeds.length === 4 && eq(seeds.map(s => s.slug), ['black_friday', 'cyber_monday', 'singles_day', 'mellomdagssalg']), JSON.stringify(seeds.map(s => s.slug)))
const bySlug = Object.fromEntries(seeds.map(s => [s.slug, s]))
const runsOf = slug => [2026, 2027, 2028, 2029, 2030].map(y => D.dealDayIn(D.dealRuleOf(bySlug[slug]), y))
check('Black Friday — the Friday after the fourth Thursday of November: 27.11.2026, 26.11.2027, 24.11.2028, 23.11.2029, 29.11.2030',
  eq(runsOf('black_friday'), ['2026-11-27', '2027-11-26', '2028-11-24', '2029-11-23', '2030-11-29']), JSON.stringify(runsOf('black_friday')))
check('…always a Friday, always the day after the fourth Thursday (2026–2060)', Array.from({ length: 35 }, (_, k) => 2026 + k).every(y => {
  const bf = D.dealDayIn(D.dealRuleOf(bySlug.black_friday), y)
  const d = new Date(`${bf}T00:00:00Z`)
  const thursday = new Date(d.getTime() - 86_400_000)
  return d.getUTCDay() === 5 && thursday.getUTCMonth() === 10 && thursday.getUTCDate() >= 22 && thursday.getUTCDate() <= 28
}))
check('Cyber Monday — the Monday after: 30.11.2026, 29.11.2027, 27.11.2028, 26.11.2029, and 02.12.2030 (into December)',
  eq(runsOf('cyber_monday'), ['2026-11-30', '2027-11-29', '2028-11-27', '2029-11-26', '2030-12-02']), JSON.stringify(runsOf('cyber_monday')))
check('Singles\' Day 11.11 and mellomdagssalg 27.12 every year', eq(runsOf('singles_day'), [2026, 2027, 2028, 2029, 2030].map(y => `${y}-11-11`))
  && eq(runsOf('mellomdagssalg'), [2026, 2027, 2028, 2029, 2030].map(y => `${y}-12-27`)))
const mellom = D.dealRuleOf(bySlug.mellomdagssalg)
check('mellomdagssalg runs five days, 27.12–31.12: seen on 29.12.2026 it is running', eq(D.nextDeal(mellom, '2026-12-29'), { start: '2026-12-27', end: '2026-12-31' }))
check('…seen on 01.01.2027 the next is 27.12.2027', eq(D.nextDeal(mellom, '2027-01-01'), { start: '2027-12-27', end: '2027-12-31' }))
check('the next Black Friday from 10.11.2026 is 27.11.2026; on that day it is today; the day after, 26.11.2027',
  eq(D.nextDeal(D.dealRuleOf(bySlug.black_friday), '2026-11-10'), { start: '2026-11-27', end: '2026-11-27' })
  && eq(D.nextDeal(D.dealRuleOf(bySlug.black_friday), '2026-11-27'), { start: '2026-11-27', end: '2026-11-27' })
  && eq(D.nextDeal(D.dealRuleOf(bySlug.black_friday), '2026-11-28'), { start: '2027-11-26', end: '2027-11-26' }))

// Rules that cross a year.
const yearEnd = { kind: 'fixed', month: 12, day: 27, lengthDays: 10 }
check('a run that crosses New Year (27.12 for 10 days): on 03.01.2027 it is still the run from 27.12.2026, to 05.01.2027',
  eq(D.nextDeal(yearEnd, '2027-01-03'), { start: '2026-12-27', end: '2027-01-05' }))
check('…its last day still counts; the day after, the next is 27.12.2027', eq(D.nextDeal(yearEnd, '2027-01-05'), { start: '2026-12-27', end: '2027-01-05' })
  && eq(D.nextDeal(yearEnd, '2027-01-06'), { start: '2027-12-27', end: '2028-01-05' }))
const afterLastFriday = { kind: 'nth_weekday', month: 12, weekday: 5, nth: -1, offsetDays: 7 }
check('an offset into the next year: the last Friday of December 2026 (25.12) + 7 days is 01.01.2027', D.dealDayIn(afterLastFriday, 2026) === '2027-01-01'
  && eq(D.nextDeal(afterLastFriday, '2026-12-30'), { start: '2027-01-01', end: '2027-01-01' }))
const beforeFirst = { kind: 'fixed', month: 1, day: 5, offsetDays: -10, lengthDays: 2 }
check('a negative offset into the year before: 05.01 − 10 days is 26.12 of the year before; seen on 30.12.2026 the next is 26.12.2027',
  D.dealDayIn(beforeFirst, 2027) === '2026-12-26' && eq(D.nextDeal(beforeFirst, '2026-12-30'), { start: '2027-12-26', end: '2027-12-27' })
  && eq(D.nextDeal(beforeFirst, '2026-12-27'), { start: '2026-12-26', end: '2026-12-27' }))

// The weekday arithmetic.
check('the n-th weekday: the 1st Monday of June 2026 is 01.06 (the month starts on one), the 2nd 08.06',
  D.dealDayIn({ kind: 'nth_weekday', month: 6, weekday: 1, nth: 1 }, 2026) === '2026-06-01' && D.dealDayIn({ kind: 'nth_weekday', month: 6, weekday: 1, nth: 2 }, 2026) === '2026-06-08')
check('the last weekday: the last Sunday of March 2026 is 29.03 (summer time starts), of October 25.10; the last Saturday of February 2028 is 26.02',
  D.dealDayIn({ kind: 'nth_weekday', month: 3, weekday: 7, nth: -1 }, 2026) === '2026-03-29'
  && D.dealDayIn({ kind: 'nth_weekday', month: 10, weekday: 7, nth: -1 }, 2026) === '2026-10-25'
  && D.dealDayIn({ kind: 'nth_weekday', month: 2, weekday: 6, nth: -1 }, 2028) === '2028-02-26')
check('the 4th weekday exists in every month of 2026–2030 and stays in its month', [2026, 2027, 2028, 2029, 2030].every(y => Array.from({ length: 12 }, (_, m) => m + 1)
  .every(m => [1, 2, 3, 4, 5, 6, 7].every(w => { const d = D.dealDayIn({ kind: 'nth_weekday', month: m, weekday: w, nth: 4 }, y); return d && Number(d.slice(5, 7)) === m && Number(d.slice(8)) >= 22 && Number(d.slice(8)) <= 28 }))))
check('the days are calendar days, whatever the machine\'s zone (no clock read): 2026 summer time changes nothing',
  D.dealDayIn({ kind: 'fixed', month: 3, day: 29 }, 2026) === '2026-03-29' && D.dealDayIn({ kind: 'fixed', month: 10, day: 25 }, 2026) === '2026-10-25')

// Whole rules only.
const bad = [
  { kind: 'fixed', month: 2, day: 29 }, { kind: 'fixed', month: 4, day: 31 }, { kind: 'fixed', month: 13, day: 1 }, { kind: 'fixed', month: 0, day: 1 },
  { kind: 'fixed', month: 1, day: 1, lengthDays: 0 }, { kind: 'fixed', month: 1, day: 1, lengthDays: 32 }, { kind: 'fixed', month: 1, day: 1, offsetDays: 32 },
  { kind: 'fixed', month: 1.5, day: 1 }, { kind: 'fixed', month: 1, day: NaN }, { kind: 'nth_weekday', month: 11, weekday: 4, nth: 5 },
  { kind: 'nth_weekday', month: 11, weekday: 0, nth: 1 }, { kind: 'nth_weekday', month: 11, weekday: 8, nth: 1 }, { kind: 'nth_weekday', month: 11, weekday: 4, nth: 0 },
  { kind: 'weekly', month: 1, day: 1 },
]
check('a rule that isn\'t whole has no day and no next run (29.02, 31.04, month 13, length 0 or 32, offset 32, a fraction, NaN, the 5th or 0th weekday, weekday 0 or 8, an unknown kind)',
  bad.every(r => D.dealDayIn(r, 2026) === null && D.nextDeal(r, '2026-11-10') === null), JSON.stringify(bad.filter(r => D.dealDayIn(r, 2026) !== null)))
check('…nor a day that isn\'t one', D.nextDeal(mellom, '2026-02-30') === null && D.nextDeal(mellom, '10.11.2026') === null && D.dealDayIn(mellom, 2026.5) === null)
check('a row is a rule only as 190\'s checks have it: a fixed day with a weekday, or an n-th weekday with a day, is none',
  D.dealRuleOf({ ...bySlug.singles_day, weekday: 3 }) === null && D.dealRuleOf({ ...bySlug.black_friday, day: 27 }) === null && D.dealRuleOf(bySlug.black_friday) !== null)
const parsed = seeds.map(s => D.parseDealDay({ ...s, id: '00000000-0000-4000-8000-000000000001', month: String(s.month) }))
check('a database row is read back checked (numbers as text too); a broken one is left out',
  parsed.every(Boolean) && D.parseDealDay({ ...seeds[0], month: 13 }) === null && D.parseDealDay({ ...seeds[0], name: '  ' }) === null
  && D.parseDealDay({ ...seeds[0], slug: 'Black Friday' }) === null && D.parseDealDay({ ...seeds[0], checked_on: 'today' }) === null
  && D.parseDealDay({ ...seeds[0], source_url: 'http://x.example' })?.source_url === null)
const ahead = D.dealsAhead(seeds, '2026-11-10')
check('seen from 10.11.2026: Singles\' Day tomorrow, Black Friday in 17 days, Cyber Monday in 20, mellomdagssalg in 47',
  eq(ahead.map(a => [a.deal.slug, a.start, a.daysUntil, a.running]), [['singles_day', '2026-11-11', 1, false], ['black_friday', '2026-11-27', 17, false],
    ['cyber_monday', '2026-11-30', 20, false], ['mellomdagssalg', '2026-12-27', 47, false]]), JSON.stringify(ahead.map(a => [a.deal.slug, a.start, a.daysUntil])))
check('…within 18 days: two; on 28.12.2026 mellomdagssalg is running (0 days); on 01.01.2027 Singles\' Day 2027 comes first',
  D.dealsAhead(seeds, '2026-11-10', 18).length === 2 && eq(D.dealsAhead(seeds, '2026-12-28').map(a => [a.deal.slug, a.daysUntil, a.running])[0], ['mellomdagssalg', 0, true])
  && D.dealsAhead(seeds, '2027-01-01')[0].deal.slug === 'singles_day')

console.log('\n2 · Signal states')
const listSql = sql.match(/signal\s+text not null check \(signal in \(([\s\S]*?)\)\)/)?.[1] ?? ''
const sqlSignals = [...listSql.matchAll(/'(\w+)'/g)].map(m => m[1])
check('SHOP_SIGNALS is 190\'s list, in its order (eleven signals)', sqlSignals.length === 11 && eq(S.SHOP_SIGNALS, sqlSignals), `${S.SHOP_SIGNALS} / ${sqlSignals}`)
const sigSql = sql.match(/or \(signature ~ '([^']+)' and octet_length\(signature\) = char_length\(signature\)\)/)?.[1]
check('SIGNATURE_RE is 190\'s signature check, the same text', sigSql === S.SIGNATURE_RE.source, `${sigSql} / ${S.SIGNATURE_RE.source}`)
const subjectSql = sql.match(/subject\s+text check \(subject is null or subject ~ '([^']+)'\)/)?.[1]
const slugSql = sql.match(/slug\s+text not null unique check \(slug ~ '([^']+)'\)/)?.[1]
check('SUBJECT_RE is 190\'s subject check, and a deal day\'s slug fits it (the same text)', subjectSql === S.SUBJECT_RE.source && slugSql === subjectSql, `${subjectSql} / ${slugSql} / ${S.SUBJECT_RE.source}`)
check('a signal is one of them: no capital, no empty, no other', S.isShopSignal('at_target') && !S.isShopSignal('At_target') && !S.isShopSignal('') && !S.isShopSignal('toString') && !S.isShopSignal(null))
check('a signature from facts: "at_target|NOK|6990"; nothing is "-", a number to two decimals, yes/no as 1/0',
  S.signalSignature('at_target', 'NOK', 6990) === 'at_target|NOK|6990' && S.signalSignature('deal_day', null, 12.3456, true) === 'deal_day|-|12.35|1')
check('…spaces, letters outside ASCII and the separator inside a part are left out (Elkjøp → Elkjp, blåbær → blabr)',
  S.signalSignature('Elkjøp Lørenskog', 'a|b') === 'ElkjpLrenskog|ab' && S.signalSignature('blåbær') === 'blabr')
let seed = 1
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const pick = s => s[Math.floor(rnd() * s.length)]
const alphabet = 'aZ09 .|:-+/#@=;,\n\t<>"\'\\øåæßé€😀\u0000'
let allValid = true, allSame = true, differ = 0
for (let k = 0; k < 3000; k++) {
  const parts = Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => (rnd() < 0.2 ? Math.round(rnd() * 1e6) / 7 : rnd() < 0.1 ? null : Array.from({ length: Math.floor(rnd() * 60) }, () => pick(alphabet)).join('')))
  const a = S.signalSignature(...parts)
  if (!(S.SIGNATURE_RE.test(a) && a.length <= 120 && Buffer.byteLength(a) === a.length)) allValid = false
  if (S.signalSignature(...parts) !== a) allSame = false
  if (S.signalSignature(...parts, 'x') !== a) differ++
}
check('3 000 random facts (any text, NaN, emoji, control characters, very long): every signature is one 190 takes, and the same every time',
  allValid && allSame && S.signalSignature(NaN, Infinity) === '-|-')
check('…and another fact makes another signature', differ === 3000, String(differ))
const long = S.signalSignature('tidy_up', ...Array.from({ length: 40 }, (_, k) => `id${k}abcdef`))
check('a list too long for the column folds into a short hash, the same every time and another for another list',
  /^h:[0-9a-f]+$/.test(long) && long === S.signalSignature('tidy_up', ...Array.from({ length: 40 }, (_, k) => `id${k}abcdef`))
  && long !== S.signalSignature('tidy_up', ...Array.from({ length: 41 }, (_, k) => `id${k}abcdef`)))
const state = (p = {}) => ({ id: '00000000-0000-4000-8000-0000000000a1', user_id: '00000000-0000-4000-8000-000000000001', item_id: '00000000-0000-4000-8000-0000000000b1',
  signal: 'at_target', signature: null, snoozed_until: null, dismissed_at: null, created_at: '2026-11-10T09:00:00.123456+00:00', updated_at: '2026-11-10T09:00:00.123456+00:00', ...p })
check('snoozed until 17.11.2026: away on 16.11, back on 17.11', S.isSignalHidden(state({ snoozed_until: '2026-11-17' }), 'x', '2026-11-16')
  && !S.isSignalHidden(state({ snoozed_until: '2026-11-17' }), 'x', '2026-11-17'))
check('Got it: away while the row says the same, back when it says something new; no state, no signature: shown',
  S.isSignalHidden(state({ signature: 'at_target|NOK|6990', dismissed_at: '2026-11-10T10:00:00Z' }), 'at_target|NOK|6990', '2026-11-10')
  && !S.isSignalHidden(state({ signature: 'at_target|NOK|6990', dismissed_at: '2026-11-10T10:00:00Z' }), 'at_target|NOK|6490', '2026-11-10')
  && !S.isSignalHidden(null, 'x', '2026-11-10') && !S.isSignalHidden(state({ signature: 'x', dismissed_at: '2026-11-10T10:00:00Z' }), null, '2026-11-10'))
check('a row\'s key is its signal and thing, "page" for the page', S.signalStateKey('i1', 'at_target') === 'at_target:i1' && S.signalStateKey(null, 'tidy_up') === 'tidy_up:page'
  && S.signalStateMap([state(), state({ item_id: null, signal: 'tidy_up', snoozed_until: '2026-11-12' })]).get('tidy_up:page')?.snoozed_until === '2026-11-12')
check('a row read back is checked: an unknown signal (a newer database), a bad day, a signature without its time or outside the check, a bad id — left out',
  S.parseSignalState(state({ snoozed_until: '2026-11-17' })) !== null && S.parseSignalState(state({ signal: 'price_match', snoozed_until: '2026-11-17' })) === null
  && S.parseSignalState(state({ snoozed_until: '17.11.2026' })) === null && S.parseSignalState(state({ signature: 'x' })) === null
  && S.parseSignalState(state({ signature: 'a b', dismissed_at: '2026-11-10T10:00:00Z' })) === null && S.parseSignalState(state({ id: 'x', snoozed_until: '2026-11-17' })) === null
  && S.parseSignalState(state({ item_id: 7, snoozed_until: '2026-11-17' })) === null && S.parseSignalState('row') === null)
check('a write\'s answer: before and after, null where there is none', eq(S.parseSignalWrite({ before: null, after: state({ snoozed_until: '2026-11-17' }) }).before, null)
  && S.parseSignalWrite({ before: null, after: state({ snoozed_until: '2026-11-17' }) }).after?.snoozed_until === '2026-11-17' && eq(S.parseSignalWrite(null), { before: null, after: null, beforeUnknown: false }))
check('…a before row this app can\'t read back (a malformed day) is "unknown", never "there was none" — so no Undo deletes it',
  S.parseSignalWrite({ before: state({ snoozed_until: 'soon' }), after: state({ snoozed_until: '2026-11-17' }) }).beforeUnknown === true
  && S.parseSignalWrite({ before: state({ snoozed_until: 'soon' }) }).before === null
  && S.parseSignalWrite({ before: null, after: null }).beforeUnknown === false && S.parseSignalWrite({ before: state({ snoozed_until: '2026-11-10' }) }).beforeUnknown === false)
check('a deal day\'s row has its subject (a slug); one in another form is not a row this app uses; the key names it',
  S.parseSignalState(state({ snoozed_until: '2026-11-17', subject: 'black_friday' }))?.subject === 'black_friday'
  && S.parseSignalState(state({ snoozed_until: '2026-11-17', subject: 'Black Friday' })) === null
  && S.signalStateKey(null, 'deal_day', 'black_friday') !== S.signalStateKey(null, 'deal_day', 'cyber_monday') && S.signalStateKey(null, 'tidy_up') === 'tidy_up:page')
check('an Undo writes back the row\'s own fields: its id, first time, snooze and Got it', eq(Object.keys(S.stateFields(state({ snoozed_until: '2026-11-17' }))).sort(),
  ['created_at', 'dismissed_at', 'id', 'signature', 'snoozed_until']))

console.log('\n3 · Price figures')
const ids = Array.from({ length: 1203 }, (_, k) => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`)
const batches = P.priceStatsBatches([...ids, ...ids.slice(0, 50), 'not-an-id', '', ids[0].toUpperCase()])
check('1 203 ids (some twice, one in capitals, two that are none) are asked once each, in calls of 500, 500 and 203',
  eq(batches.map(b => b.length), [500, 500, 203]) && new Set(batches.flat()).size === 1203 && P.PRICE_STATS_MAX_IDS === 500)
check('190 refuses more than PRICE_STATS_MAX_IDS in one call — the same number', new RegExp(`cardinality\\(p_item_ids\\), 0\\) > ${P.PRICE_STATS_MAX_IDS}`).test(sql))
const row = (p = {}) => ({ item_id: '00000000-0000-4000-8000-0000000000c1', currency: 'NOK', points: 7, low_all: 8000, high_all: '12000', points_60d: 5, low_60d: 8000, high_60d: 10000,
  last_price: 8900, last_in_stock: true, last_at: '2026-11-09T05:23:00+00:00', back_in_stock: true, restocked_at: '2026-10-31T05:23:00+00:00',
  spark: [null, null, null, 10000, null, null, null, 8000, null, 8500, null, 8200], ...p })
const ok = P.parsePriceStats(row())
check('an answer is read as numbers (numeric as text too)', ok && ok.high_all === 12000 && ok.spark[11] === 8200 && ok.spark[0] === null && ok.back_in_stock && ok.restocked_at)
check('NaN or infinity is no price: an answer whose lowest, highest or last price is one is left out',
  P.parsePriceStats(row({ low_all: 'NaN' })) === null && P.parsePriceStats(row({ high_all: 'Infinity' })) === null && P.parsePriceStats(row({ last_price: NaN })) === null)
check('…and in the 60 days or the sparkline it is no figure (null)', P.parsePriceStats(row({ high_60d: 'NaN', spark: ['NaN', 'Infinity', ...Array(10).fill(1)] }))?.high_60d === null
  && eq(P.parsePriceStats(row({ spark: ['NaN', '-Infinity', ...Array(10).fill(1)] })).spark.slice(0, 3), [null, null, 1]))
check('an answer without an id, a count or a time is left out; an odd sparkline is blank; a currency is three capitals or none',
  P.parsePriceStats(row({ item_id: 'x' })) === null && P.parsePriceStats(row({ points: 0 })) === null && P.parsePriceStats(row({ last_at: 'soon' })) === null
  && eq(P.parsePriceStats(row({ spark: [1, 2] })).spark, Array(12).fill(null)) && P.parsePriceStats(row({ currency: '<b>' })).currency === null
  && P.parsePriceStats(row({ back_in_stock: false })).restocked_at === null)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
