#!/usr/bin/env node
/* Verification — owning (Shop step C): "Something's wrong" (its days are the Purchase section's; complaintModel.ts:
 * the Norwegian letter, the store's page, what money back is for), the insurance list (insuranceList.ts: rows, value, the
 * CSV file and its guard against formulas) and Stats' step C definitions (statsModel.ts: bought in the period,
 * was it a wish first, need or fun, saved by watching, this year vs last, wish to purchase and impulse buys,
 * value kept by category, the store scorecard) — each following the picked period.
 * Run: node scripts/verify-shop-owning.cjs */
require('sucrase/register')
const fs = require('fs')
const K = require('../src/features/shop/complaintModel')
const I = require('../src/features/shop/insuranceList')
const O = require('../src/features/shop/ownModel')
const S = require('../src/features/shop/statsModel')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const TODAY = '2026-11-10'
let n = 0
function item(p) {
  n++
  return {
    id: p.id ?? `i${n}`, user_id: 'u', category_id: null, title: p.title ?? `Item ${n}`, notes: null, price: null, price_source: null,
    platform: null, url: null, priority: 'medium', region: 'NO', planned_date: null, status: 'bought', source_type: 'manual',
    created_at: '2026-01-01T10:00:00.000Z', updated_at: '2026-09-30T10:00:00.000Z',
    list: 'wishlist', currency: 'NOK', bought_at: null, task_id: null, kind: 'item', kept: true, fx_nok: 1, ...p,
  }
}
const at = (day, time = '12:00:00.000') => `${day}T${time}Z`
let c = 0
const cost = (item_id, amount, label, spent_on, currency = 'NOK', fx_nok = 1) => ({ id: `c${++c}`, user_id: 'u', item_id, label, amount, currency, spent_on, fx_nok, fx_source: 'fixed', created_at: '', updated_at: '' })
const rates = { NOK: 10, TRY: 40, EUR: 0.9 }
const ctx = (costs = []) => O.moneyCtx(costs, rates)

console.log('\n1 · The complaint right and the return window: the Purchase section\'s')
{
  const sheet = fs.readFileSync(`${__dirname}/../src/features/shop/components/owned/ComplaintSheet.tsx`, 'utf8')
  check('Something\'s wrong counts its days as the Purchase section does (deadlinesOf, DeadlineWords) — no law in code of its own',
    /deadlinesOf\(item, ctx\)/.test(sheet) && /DeadlineWords/.test(sheet) && !/complaintRight|returnWindow|addMonths/.test(sheet))
  check('…and sends a missing purchase day to Just bought, never to Facts', /shop-just-bought/.test(sheet) && !/in Facts/.test(sheet))
}

console.log('\n2 · The letter (Norwegian, æ ø å kept)')
{
  const it = item({ title: 'Støydempende hodetelefoner', platform: 'Elkjøp', bought_at: at('2026-04-24'), serial: 'SN-123' })
  const L = K.complaintLetter({ ...K.letterFacts(it), problem: 'Venstre øreplugg lader ikke.' })
  check('subject, greeting, the thing, the store and the day', L.startsWith('Emne: Reklamasjon – Støydempende hodetelefoner\n\nHei Elkjøp,')
    && L.includes('Jeg kjøpte Støydempende hodetelefoner hos dere 24.04.2026.'))
  check('the serial when noted', L.includes('Serienummeret er SN-123.'))
  check('what is wrong, as typed', L.includes('Feilen: Venstre øreplugg lader ikke.'))
  check('cites forbrukerkjøpsloven § 27 with the 2 and 5 years', L.includes('jf. forbrukerkjøpsloven § 27') && L.includes('to år') && L.includes('fem år'))
  check('asks for repair or a new one, at no cost', L.includes('retter feilen eller leverer en ny vare, uten kostnad for meg'))
  const bare = K.complaintLetter({ title: 'Kaffekvern', store: null, bought: null, approx: false, serial: null, problem: '  ' })
  check('no store: "Hei,"; no day: none made up; no serial line', bare.includes('\nHei,\n') && bare.includes('Jeg kjøpte Kaffekvern hos dere.') && !bare.includes('Serienummer'))
  check('nothing typed yet: a placeholder to fill in', bare.includes(`Feilen: ${K.PROBLEM_PLACEHOLDER}`))
  const approx = K.complaintLetter({ title: 'Sykkel', store: 'Sport', bought: '2025-06-01', approx: true, serial: null, problem: 'x' })
  check('a day from memory reads "rundt"', approx.includes('hos dere rundt 01.06.2025.'))
  const evil = K.complaintLetter({ title: 'A\nB\u0007C', store: 'S\r\nT', bought: null, approx: false, serial: null, problem: 'x' })
  check('a title or store with line breaks or control characters stays on its line', evil.includes('Reklamasjon – A B C') && evil.includes('Hei S T,'))
  // Security review, 11.11.2026: the store's page is offered only when it is https and not a price site's.
  check('the store\'s page: the record\'s https link; never plain http, a price site\'s page (by its host or the watch) or no link',
    K.storePageOf('https://www.power.no/tv/p-1/', 'store') === 'https://www.power.no/tv/p-1/' && K.storePageOf('http://www.power.no/tv/p-1/', null) === null
    && K.storePageOf('https://www.prisjakt.no/c/tv', null) === null && K.storePageOf('https://www.prisjakt.no/product.php?p=1', null) === null
    && K.storePageOf('https://shop.example/x', 'prisjakt') === null && K.storePageOf('javascript:alert(1)', null) === null && K.storePageOf(null, null) === null)
  check('…the sheet uses it (no webUrl of its own, which lets plain http through)', /storePageOf\(item\.url, watch\?\.source\)/.test(fs.readFileSync(`${__dirname}/../src/features/shop/components/owned/ComplaintSheet.tsx`, 'utf8'))
    && !/webUrl/.test(fs.readFileSync(`${__dirname}/../src/features/shop/components/owned/ComplaintSheet.tsx`, 'utf8')))
  // Security review, 11.11.2026: a bidi control would make the pasted letter read otherwise than what was shown.
  const bidi = K.complaintLetter({ title: 'Lamp\u202Egnp.exe\u202C', store: 'S\u2066\u200Ftore\u2069\u0085x', bought: null, approx: false, serial: 'A\u200EB', problem: 'x' })
  check('…and without bidi controls (U+202A–U+202E, U+2066–U+2069, U+200E/U+200F) — the shared oneLine, as in the ad',
    bidi.includes('Reklamasjon – Lampgnp.exe') && bidi.includes('Hei Store x,') && bidi.includes('AB') && !/[\u202A-\u202E\u2066-\u2069\u200E\u200F\u0085]/.test(bidi), JSON.stringify(bidi.slice(0, 120)))
}

console.log('\n3 · What money back is for')
check('the app\'s own labels', K.rebateKind(K.REBATE_LABEL.claim) === 'claim' && K.rebateKind(K.REBATE_LABEL.match) === 'match' && K.rebateKind(K.REBATE_LABEL.other) === 'other')
check('the owner\'s own words: price protection, prisgaranti, reklamasjon', K.rebateKind('Price protection Elkjøp') === 'match' && K.rebateKind('Prisgaranti') === 'match'
  && K.rebateKind('Reklamasjon – ny lader') === 'claim')
check('anything else is other money back (not counted as saved)', K.rebateKind('Cashback') === 'other' && K.rebateKind('Sold the box') === 'other')

console.log('\n4 · The insurance list')
{
  const cats = [{ id: 'el', user_id: 'u', name: 'Electronics', parent_id: null, created_at: '' }, { id: 'ph', user_id: 'u', name: 'Phones', parent_id: 'el', created_at: '' }]
  const phone = item({ id: 'phone', title: 'Phone', price: 9000, category_id: 'ph', platform: 'Power', bought_at: at('2025-03-01'), serial: 'X1', url: 'https://example.com/p' })
  const tv = item({ id: 'tv', title: 'TV', price: 12000, category_id: 'el', bought_at: at('2024-01-01') })
  const caseA = item({ id: 'case', title: 'Phone case', price: 300, accessory_of: 'phone', bought_at: at('2025-03-01') })
  const sold = item({ id: 'old', title: 'Old phone', price: 5000, disposal: 'sold', disposed_on: '2025-03-02', sale_price: 1500, bought_at: at('2022-01-01') })
  const gift = item({ id: 'gift', title: 'Gift lamp', price: 0, got_as_gift: true, bought_at: at('2025-12-24') })
  const watch = (cond, low) => new Map([['phone', { item_id: 'phone', url: 'https://example.com/p', status: 'ok', condition: cond, low, currency: 'NOK', checked_at: '2026-11-09T05:00:00Z', last_ok_at: '2026-11-09T05:00:00Z', source: 'store' }]])
  const rows = I.insuranceRows([phone, tv, caseA, sold, gift], cats, ctx(), watch('new', 13000))
  check('everything still yours, accessories too — never what is gone', rows.map(r => r.id).join() === 'phone,tv,case,gift', rows.map(r => r.id).join())
  check('sorted by value: the new price now when read (13 000 > the TV\'s 12 000 paid)', rows[0].id === 'phone' && rows[0].value === 13000 && rows[1].value === 12000)
  check('the category path, the accessory\'s item named', rows[0].category === 'Electronics › Phones' && rows[2].accessoryOf === 'Phone' && rows[2].category === 'Electronics › Phones')
  const mixed = I.insuranceRows([phone], cats, ctx(), watch('mixed', 4000))
  check('a mixed (new and used) figure is never the new price now', mixed[0].newNow === null && mixed[0].value === 9000)
  const t = I.insuranceTotals(rows)
  check('totals: things, paid, new prices checked', t.things === 4 && t.paid.nok === 21300 && t.checked === 1 && t.newNow === 13000)
  const csv = I.insuranceCsv(rows)
  const lines = csv.slice(1).trim().split('\r\n')
  check('a byte-order mark, semicolons, one header and a line per thing', csv.charCodeAt(0) === 0xfeff && lines.length === 5 && lines[0].split(';').length === I.INSURANCE_COLUMNS.length)
  check('dates DD.MM.YYYY, whole amounts; text quoted, numbers bare', lines[1] === '"Phone";"Electronics › Phones";;"Power";"01.03.2025";"X1";9000;"NOK";9000;13000;"09.11.2026"', lines[1])
  check('a gift reads 0 paid', lines[4].startsWith('"Gift lamp";;;;"24.12.2025";;0;"NOK";0;;'), lines[4])
  check('a cell is never a formula (=, +, -, @ get an apostrophe)', I.csvCell('=HYPERLINK("x")') === '"\'=HYPERLINK(""x"")"' && I.csvCell('+1') === '"\'+1"' && I.csvCell('@cmd') === '"\'@cmd"' && I.csvCell('-5') === '"\'-5"')
  check('…nor after spaces, in full-width form, or after a leading tab, return or line break (tested before the breaks are tidied)',
    I.csvCell('  =1+1') === '"\'  =1+1"' && I.csvCell('\uFF1D1+1') === '"\'\uFF1D1+1"' && I.csvCell('\t=1+1') === '"\'\t=1+1"' && I.csvCell('\r=1+1') === '"\'\n=1+1"' && I.csvCell('\r\n=1+1') === '"\'\n=1+1"')
  check('every text cell is quoted, so a comma or a tab never starts a cell (security review, 11.11.2026: "Lamp,=1+1", "Lamp<tab>=1+1")',
    I.csvCell('Lamp,=1+1') === '"Lamp,=1+1"' && I.csvCell('Lamp\t=1+1') === '"Lamp\t=1+1"' && I.csvCell('Lamp') === '"Lamp"')
  check('a separator, a quote or a line break stays inside its quotes', I.csvCell('a;b') === '"a;b"' && I.csvCell('say "hi"') === '"say ""hi"""' && I.csvCell('a\r\nb') === '"a\nb"')
  {
    // The file read back as a comma-, a tab- and a semicolon-separated sheet would read it (quotes honoured): no cell is a formula.
    const evil = I.insuranceCsv([{ ...rows[0], title: 'Lamp,=1+1', store: 'Shop\t@SUM(A1)', serial: '\r-2+3', category: ' +1' }])
    const cellsBy = sep => {
      const out = []
      let cur = '', quoted = false
      for (const ch of evil.slice(1)) {
        if (ch === '"') quoted = !quoted
        else if (!quoted && (ch === sep || ch === '\n' || ch === '\r')) { out.push(cur); cur = '' } else cur += ch
      }
      return out.concat(cur)
    }
    const formulas = [',', '\t', ';'].flatMap(sep => cellsBy(sep).filter(c => /^[\s]*[=+\-@]/.test(c)))
    check('…read back with a comma, a tab or a semicolon as the separator, no cell is a formula', formulas.length === 0, JSON.stringify(formulas))
  }
  check('numbers are whole, negative numbers stay numbers; no NaN', I.csvCell(1234.6) === '1235' && I.csvCell(-20) === '-20' && I.csvCell(NaN) === '')
  check('the file is named with the day', I.insuranceFileName(TODAY) === 'Insurance list 10.11.2026.csv')
}

console.log('\n5 · Stats: was it a wish first, need or fun')
{
  const byId = new Map()
  const tapped = item({ created_at: '2026-03-01T09:00:00.000Z', bought_at: '2026-03-01T15:42:17.123456+00:00' })
  const ownedToday = item({ created_at: '2026-03-01T09:00:00.000Z', bought_at: '2026-03-01T11:00:00+00:00' })
  const ownedBefore = item({ created_at: '2026-03-05T09:00:00.000Z', bought_at: '2026-03-01T11:00:00.000Z' })
  const longWish = item({ created_at: '2026-01-05T09:00:00.000Z', bought_at: '2026-03-01T11:00:00.000Z' })
  check('a wish bought later the same day by a tap was a wish', S.wishedSince(tapped, byId) === tapped.created_at)
  check('added as owned with today\'s day typed (noon on the dot) never was a wish', S.wishedSince(ownedToday, byId) === null)
  check('added as owned with a day before it was made never was a wish', S.wishedSince(ownedBefore, byId) === null)
  check('made on an earlier day than bought: a wish (the Story\'s rule)', S.wishedSince(longWish, byId) === longWish.created_at)
  const wish = item({ id: 'gw', kind: 'general', status: 'fulfilled', created_at: '2025-12-01T10:00:00.000Z' })
  const model = item({ option_for: 'gw', created_at: '2026-02-01T10:00:00.000Z', bought_at: '2026-02-03T10:00:00.000Z' })
  check('a model\'s wish began with its general wish', S.wishedSince(model, new Map([['gw', wish]])) === wish.created_at)

  const p26 = S.periodOf('2026', TODAY)
  const rows = [
    item({ price: 1000, reason: 'need', priority: 'high', created_at: '2026-01-01T10:00:00.000Z', bought_at: at('2026-02-01') }),
    item({ price: 500, reason: 'fun', priority: 'low', created_at: '2026-01-01T10:00:00.000Z', bought_at: at('2026-03-01') }),
    item({ price: 200, reason: null, created_at: '2026-04-01T10:00:00.000Z', bought_at: at('2026-04-01') }),
    item({ price: 999, reason: 'need', disposal: 'returned', bought_at: at('2026-05-01') }),
    item({ price: 700, reason: 'need', created_at: '2025-01-01T10:00:00.000Z', bought_at: at('2025-06-01') }),
  ]
  const why = S.needOrFun(rows, p26, 'why')
  check('by why: need · fun · not said, what each cost — a returned one and last year left out',
    why.rows.map(r => `${r.key}:${r.count}:${r.spent.nok}`).join() === 'need:1:1000,fun:1:500,unsaid:1:200', why.rows.map(r => `${r.key}:${r.count}:${r.spent.nok}`).join())
  const pri = S.needOrFun(rows, p26, 'priority')
  check('by priority: only the wishes first (one added as owned is left out, and said)', pri.rows.map(r => r.key).join() === 'high,low' && pri.leftOut === 1)
  check('all time takes last year too', S.needOrFun(rows, S.periodOf(null, TODAY), 'why').rows[0].spent.nok === 1700)
}

console.log('\n6 · Stats: saved by watching, this year vs last')
{
  const a = item({ id: 'a', price: 3000, platform: 'Elkjøp', created_at: '2025-01-01T10:00:00.000Z', bought_at: at('2025-03-01') })
  const b = item({ id: 'b', price: 2000, platform: 'Power', created_at: '2026-01-01T10:00:00.000Z', bought_at: at('2026-02-01') })
  const costs = [
    cost('a', -500, K.REBATE_LABEL.claim, '2026-03-10'),
    cost('b', -300, 'Prisgaranti', '2026-02-10'),
    cost('b', -100, 'Cashback', '2026-02-11'),
    cost('a', -200, K.REBATE_LABEL.match, '2025-03-05'),
    cost('a', 400, 'Repair', '2026-03-12'),
    cost('b', -1000, K.REBATE_LABEL.claim, '2026-04-01', 'TRY', null),
  ]
  const C = ctx(costs)
  const s26 = S.savedIn([a, b], C, S.periodOf('2026', TODAY))
  check('saved = claims + price matches in the year; other money back listed, not counted', s26.claims.nok === 500 && s26.matches.nok === 300 && s26.other.nok === 100 && s26.saved.nok === 800)
  check('a rebate waiting for its rate is pending, never today\'s rate', s26.claims.pending === 1 && !O.complete(s26.saved))
  check('a cost (a repair) is never money back', !s26.rows.some(r => r.label === 'Repair'))
  check('2025 has its own price match only', S.savedIn([a, b], C, S.periodOf('2025', TODAY)).saved.nok === 200)
  check('all time: every one', S.savedIn([a, b], ctx(costs.slice(0, 5)), S.periodOf(null, TODAY)).saved.nok === 1000)

  const sold = item({ id: 's', price: 1000, bought_at: at('2025-01-15'), disposal: 'sold', disposed_on: '2025-10-01', sale_price: 600 })
  const late = item({ id: 'late', price: 900, bought_at: at('2025-12-01') })
  const v = S.yearVsLast([a, b, sold, late], ctx(costs.slice(0, 5)), S.periodOf('2026', TODAY))
  check('this year so far against last year to the same day', v.year === '2026' && v.last === '2025' && v.partial && v.toDay === '11-10')
  check('…spent: purchases + costs − money back (2026: 2 000 + 400 − 500 − 300 − 100)', v.now.spent.nok === 1500 && v.now.purchases === 1, String(v.now.spent.nok))
  check('…last year counted to 10.11 only (the December purchase left out)', v.before.spent.nok === 3000 + 1000 - 200 && v.before.purchases === 2 && v.before.got.nok === 600, String(v.before.spent.nok))
  check('…saved by watching each year', v.now.saved.nok === 800 && v.before.saved.nok === 200)
  const past = S.yearVsLast([a, b, sold, late], ctx(costs.slice(0, 5)), S.periodOf('2025', TODAY))
  check('a past year: the whole of it against the whole year before', !past.partial && past.toDay === '12-31' && past.now.purchases === 3 && past.before.purchases === 0)
  check('all time compares this year with last', S.yearVsLast([a], ctx(), S.periodOf(null, TODAY)).year === '2026')
  const leap = S.yearVsLast([], ctx(), S.periodOf(null, '2028-02-29'))
  check('29 February: last year counts to the 28th', leap.toDay === '02-29' && leap.last === '2027')
}

console.log('\n7 · Stats: wish to purchase, impulse buys')
{
  const rows = [
    item({ id: 'imp', title: 'Impulse', created_at: '2026-05-01T09:00:00.000Z', bought_at: '2026-05-01T20:11:43.5+00:00' }),
    item({ id: 'next', title: 'Next day', created_at: '2026-05-01T20:00:00.000Z', bought_at: at('2026-05-02') }),
    item({ id: 'week', title: 'Week', created_at: '2026-05-01T09:00:00.000Z', bought_at: at('2026-05-06') }),
    item({ id: 'long', title: 'Long', created_at: '2025-09-01T09:00:00.000Z', bought_at: at('2026-06-01') }),
    item({ id: 'own', title: 'Owned', created_at: '2026-07-01T09:00:00.000Z', bought_at: at('2026-06-01') }),
    item({ id: 'prev', title: 'Last year', created_at: '2025-01-01T09:00:00.000Z', bought_at: at('2025-01-02') }),
  ]
  const w = S.wishToPurchase(rows, S.periodOf('2026', TODAY))
  check('the wishes bought in the year, the longest wait first', w.rows.map(r => r.item.id).join() === 'long,week,next,imp' && w.notWished === 1)
  check('days from wish to purchase, and the middle one', w.rows.map(r => r.days).join() === '273,5,1,0' && w.median === 3, w.rows.map(r => r.days).join())
  check('impulse buys: on the day or the next', w.impulse.map(r => r.item.id).join() === 'next,imp')
  check('buckets add up', w.buckets.reduce((s, b) => s + b.count, 0) === 4 && w.buckets[0].count === 2 && w.buckets[1].count === 1 && w.buckets[4].count === 1)
  check('the year before has its own', S.wishToPurchase(rows, S.periodOf('2025', TODAY)).impulse.map(r => r.item.id).join() === 'prev')
}

console.log('\n8 · Stats: value kept by category, the store scorecard')
{
  const cats = [{ id: 'el', user_id: 'u', name: 'Electronics', parent_id: null, created_at: '' }, { id: 'sp', user_id: 'u', name: 'Sports', parent_id: null, created_at: '' }]
  const rows = [
    item({ id: 's1', price: 1000, category_id: 'el', platform: 'Power', bought_at: at('2025-01-01'), disposal: 'sold', disposed_on: '2026-03-01', sale_price: 600 }),
    item({ id: 's2', price: 3000, category_id: 'el', platform: 'power ', bought_at: at('2025-02-01'), disposal: 'traded_in', disposed_on: '2026-04-01', sale_price: 1200 }),
    item({ id: 's3', price: 2000, category_id: 'el', bought_at: at('2024-01-01'), disposal: 'sold', disposed_on: '2025-03-01', sale_price: 1000 }),
    item({ id: 'h1', price: 4000, category_id: 'sp', platform: 'Power', bought_at: at('2026-01-01'), value_now: 3000, value_currency: 'NOK' }),
    item({ id: 'g1', price: 0, got_as_gift: true, category_id: 'sp', bought_at: at('2026-01-01'), value_now: 500 }),
    item({ id: 'r1', price: 800, category_id: 'sp', platform: 'Power', bought_at: at('2026-02-01'), disposal: 'returned', disposed_on: '2026-02-05', sale_price: 800 }),
    item({ id: 'u1', price: 1500, category_id: 'el', bought_at: at('2026-01-01'), disposal: 'given', disposed_on: '2026-05-01' }),
  ]
  const k = S.valueKeptByCategory(rows, cats, ctx(), S.periodOf('2026', TODAY))
  const el = k.find(r => r.key === 'el'), sp = k.find(r => r.key === 'sp')
  check('sold in 2026: 1 800 back of 4 000 = 45 % (2025\'s sale and a given-away thing left out)', el.sold.count === 2 && Math.round(el.sold.share * 100) === 45)
  check('still yours with an estimate: 3 000 of 4 000 = 75 % (a gift left out)', sp.held.count === 1 && sp.held.share === 0.75 && el.held.count === 0)
  check('2025: its own sale (50 %)', Math.round(S.valueKeptByCategory(rows, cats, ctx(), S.periodOf('2025', TODAY)).find(r => r.key === 'el').sold.share * 100) === 50)
  const costs = [cost('h1', -400, K.REBATE_LABEL.match, '2026-03-01'), cost('h1', -100, 'Cashback', '2026-03-02')]
  const sc = S.storeScores(rows, ctx(costs), S.periodOf('2026', TODAY))
  const power = sc.get('power')
  check('Power in 2026: 2 purchases, 1 returned, 1 price match, 400 back (cashback not counted)', power && power.bought === 2 && power.returned === 1 && power.matches === 1 && power.claims === 0 && power.back.nok === 400,
    JSON.stringify(power))
  const sc25 = S.storeScores(rows, ctx(), S.periodOf('2025', TODAY)).get('power')
  check('Power in 2025: bought there, kept 1 800 of 4 000 when sold ("Power" and "power " are one store)', sc25.bought === 2 && sc25.kept === 2 && Math.round(sc25.keptShare * 100) === 45)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
