#!/usr/bin/env node
/*
 * Verification — an item's category add-on fields (owner, 27.11.2026: "Category decides how the task's add-on fields
 * would show up … when you choose cinema it should also show some additional fields like which movie, which cinema,
 * with who and how much it costed"; "Start with games and media."; migration 215). Runs the real modules:
 *   1. the registry (items/categoryDetails): Media's types and fields, Games', nothing for the rest;
 *   2. the cleaning (cleanDetails — the browser's copy of 215's task_details_ok): every case the database refuses is
 *      left out here, and what is kept the database takes (verify-db-item-details runs the SQL side);
 *   3. suggestions only from the owner's own earlier values (Games' On: no seeded list);
 *   4. the save: the details go as app_save_item's p_details with the item and its link — one call, never a second
 *      write; a database without 215 refuses before anything is written, and only details beyond the category are said;
 *   5. the guards around it: nothing that counts money reads them, Ask AI never writes them, Apple never gets them.
 *
 *   Run:  node scripts/verify-item-details.cjs
 */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const REPO = path.join(__dirname, '..')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✓', name) } else { failed++; console.log('  ✗', name, detail === undefined ? '' : JSON.stringify(detail)) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const src = p => fs.readFileSync(path.join(REPO, p), 'utf8')

// A stand-in for the Supabase client: records each RPC call and answers as told.
const calls = []
let answer = () => ({ data: { taskId: 't1', blockId: null, scheduleBlockId: null }, error: null })
const clientPath = path.join(REPO, 'src/integrations/supabase/client.ts')
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: { supabase: { rpc: async (fn, args) => { calls.push({ fn, args }); return answer(args) } } }, children: [], paths: [] }

const D = require('../src/features/items/categoryDetails')
const api = require('../src/features/items/itemApi')

console.log('\n== 1. The registry ==')
check('Media has Movie / TV / Cinema; Games has no type; the rest have no section',
  same(D.CATEGORY_DETAILS.media.types.map(t => t.value), ['movie', 'tv', 'cinema']) && !D.CATEGORY_DETAILS.games.types
  && ['daily', 'training', 'work', 'projects', 'football', 'other'].every(c => D.detailFields(c, undefined).length === 0 && !D.detailsOf(c)))
check('a cinema trip asks which movie, which cinema, with who, the cost, seats and booking (owner\'s words + seats, booking)',
  same(D.detailFields('media', 'cinema'), ['thing', 'cinema', 'with', 'cost', 'seats', 'booking']))
check('…a movie or a show at home: which one, and with who', same(D.detailFields('media', 'movie'), ['thing', 'with']) && same(D.detailFields('media', 'tv'), ['thing', 'with']))
check('Games: which game, on what, with who ("which game … and on what")', same(D.detailFields('games', undefined), ['thing', 'on', 'with']))
check('the thing each links: a movie (also at the cinema), a show, a game — 210\'s kinds',
  D.CATEGORY_DETAILS.media.linkKind('movie') === 'movie' && D.CATEGORY_DETAILS.media.linkKind('cinema') === 'movie'
  && D.CATEGORY_DETAILS.media.linkKind('tv') === 'tv' && D.CATEGORY_DETAILS.games.linkKind() === 'game')
check('Football has no add-on fields (owner: "nah this is made to plan watching it on tv so no need for this")', D.detailFields('football', undefined).length === 0)
check('every button word is one or two words (Short buttons)', D.CATEGORY_DETAILS.media.types.every(t => t.label.split(' ').length <= 2 && t.tip.startsWith(t.label)))

console.log('\n== 2. The cleaning (215\'s rule in the browser) ==')
const full = { category: 'media', type: 'cinema', with: ['Ola', 'Kari Nordmann'], cost: { amount: 149.5, currency: 'NOK' }, seats: 'H12–H13', booking: 'AB12CD' }
check('a full cinema trip is kept as it is', same(D.cleanDetails(full), full))
check('a category with no fields keeps only the category (an item with no slot keeps its category)', same(D.cleanDetails({ category: 'work', with: ['Ola'] }), { category: 'work' }))
check('not details: null, a list, a string, an unknown category', [null, undefined, [], 'media', { category: 'cinema' }, { category: 5 }].every(x => D.cleanDetails(x) === null))
check('one source: the item\'s own category (its slot\'s or repeat\'s) decides, never one stored with older details',
  same(D.cleanDetails({ category: 'media', type: 'cinema', with: ['Ola'], seats: 'H1' }, 'games'), { category: 'games', with: ['Ola'] }))
check('…details stored without a category (an item with a slot) read as Media\'s with a type, else as Games\'',
  same(D.cleanDetails({ type: 'movie', with: ['Ola'], on: 'PS5' }), { type: 'movie', with: ['Ola'] }) && same(D.cleanDetails({ on: 'RP6' }), { on: 'RP6' }))
check('a cinema trip\'s cinema (≤ 60, an item with no slot); never on a movie at home',
  D.cleanDetails({ category: 'media', type: 'cinema', cinema: 'Ringen kino' }).cinema === 'Ringen kino'
  && !('cinema' in D.cleanDetails({ category: 'media', type: 'movie', cinema: 'Ringen kino' })) && !('cinema' in D.cleanDetails({ category: 'media', type: 'cinema', cinema: 'x'.repeat(61) })))
check('invisible format characters are refused (U+200B, U+200E, U+202E, U+2060, U+FEFF) — 215\'s copy',
  ['Ola\u200b', '\u200eOla', 'AB\u202eDC', 'RP\u20606', '\ufeffRP6'].every(t => D.cleanText(t, 60) === undefined) && D.cleanText('Åse Ødegård', 40) === 'Åse Ødegård')
check('only the type\'s fields: a movie at home drops cost, seats, booking', same(D.cleanDetails({ ...full, type: 'movie' }), { category: 'media', type: 'movie', with: ['Ola', 'Kari Nordmann'] }))
check('…Games drops a media type and seats; Media drops On', same(D.cleanDetails({ category: 'games', type: 'movie', seats: 'A1', on: 'RP6' }), { category: 'games', on: 'RP6' })
  && same(D.cleanDetails({ category: 'media', type: 'movie', on: 'PS5' }), { category: 'media', type: 'movie' }))
check('an unknown key is left out', !('script' in D.cleanDetails({ ...full, script: '<b>x</b>' })))
check('names: trimmed, once in any case, at most 10, each ≤ 40, no spaces-only or control character',
  same(D.cleanNames([' Ola ', 'ola', 'Kari', '   ', 'x'.repeat(41), 'Bad\u0007', 42, 'Per\nAsk']), ['Ola', 'Kari', 'Per Ask'])
  && D.cleanNames(Array.from({ length: 15 }, (_, i) => `N${i}`)).length === 10 && D.cleanNames([]) === undefined && D.cleanNames('Ola') === undefined)
check('seats / booking ≤ 60, On ≤ 30', D.cleanText('x'.repeat(60), 60) === 'x'.repeat(60) && D.cleanText('x'.repeat(61), 60) === undefined
  && same(D.cleanDetails({ category: 'games', on: 'x'.repeat(31) }), { category: 'games' }) && D.cleanDetails({ category: 'games', on: 'PS5' }).on === 'PS5')
check('a cost: 0 to a million, two decimals, a currency from the list',
  same(D.cleanCost({ amount: 0, currency: 'EUR' }), { amount: 0, currency: 'EUR' }) && D.cleanCost({ amount: -1, currency: 'NOK' }) === undefined
  && D.cleanCost({ amount: 1000001, currency: 'NOK' }) === undefined && D.cleanCost({ amount: 10.005, currency: 'NOK' }) === undefined
  && D.cleanCost({ amount: '10', currency: 'NOK' }) === undefined && D.cleanCost({ amount: 10, currency: 'BTC' }) === undefined
  && D.cleanCost({ amount: NaN, currency: 'NOK' }) === undefined && D.cleanCost({ amount: Infinity, currency: 'NOK' }) === undefined)
check('the cost field as typed: "149", "149,50", " 1 000 " are amounts; "", none; "12,345", "1e3", "-5" say why',
  same(D.readAmount('149'), { amount: 149 }) && same(D.readAmount('149,50'), { amount: 149.5 }) && same(D.readAmount(' 1 000 '), { amount: 1000 })
  && same(D.readAmount(''), { amount: null }) && ['12,345', '1e3', '-5', 'abc', '99999999'].every(t => 'problem' in D.readAmount(t)))
check('the type defaults to Movie for Media, none for Games', D.defaultType('media') === 'movie' && D.defaultType('games') === undefined)

console.log('\n== 3. Suggestions: only the owner\'s own earlier values ==')
const rows = [
  { details: { category: 'games', on: 'RP6', with: ['Kari'] } },
  { details: { category: 'games', on: 'rp6' } },
  { details: { category: 'games', on: 'PS5' } },
  { details: { category: 'games', on: 'x'.repeat(31) } },
  { details: '{"category":"games","on":"Forged"}' },
  { details: { category: 'media', type: 'cinema', with: ['Ola', 'Kari'] } },
]
check('On: newest first, once in any case, cleaned again (a row read back is input)', same(D.earlierValues(rows, d => d.on), ['RP6', 'PS5']))
check('names: from every category\'s with who', same(D.earlierValues(rows, d => d.with), ['Kari', 'Ola']))
check('as typed: those that start with it first, then those that contain it; not the one already picked or typed exactly',
  same(D.suggestionsFor(['MacBook', 'PS5', 'RP6', 'Steam Deck'], 'p'), ['PS5', 'RP6']) && same(D.suggestionsFor(['RP6', 'RP6 Pro'], 'RP6'), ['RP6 Pro'])
  && same(D.suggestionsFor(['Ola', 'Kari'], '', ['ola']), ['Kari']) && same(D.suggestionsFor(['Steam Deck'], 'deck'), ['Steam Deck']))
const det = src('src/shared/components/plan-modal/DetailsSection.tsx')
check('no seeded list of devices anywhere ("do not add those manually, it will be added after I put them in")',
  !/['"](RP6|PS5|MacBook|Steam Deck|Switch)['"]/.test(det + src('src/features/items/categoryDetails.ts').replace(/\/\/.*$/gm, '')) && /offered=\{earlierValues\(rows, d => d\.on\)\}/.test(det))

console.log('\n== 4. The save ==')
;(async () => {
  const ctx = { section: 'today', today: '2026-11-27', googleConnected: false }
  const base = { title: 'Cinema: Film One', domain: 'media', priority: 'medium', date: '2026-11-28', time: '19:00', durationMinutes: 120, google: 'none' }
  const link = { kind: 'movie', id: '00000000-0000-4000-8000-000000000001' }
  calls.length = 0
  await api.saveItem({ ...base, link, details: full }, ctx)
  check('one call: app_save_item(p_item, p_link, p_details) — the item, its link and its details in one transaction',
    calls.length === 1 && calls[0].fn === 'app_save_item' && same(Object.keys(calls[0].args), ['p_item', 'p_link', 'p_details'])
    && same(calls[0].args.p_link, link) && same(calls[0].args.p_details, full))
  check('…the item itself carries neither (they travel as their own arguments)', !('details' in calls[0].args.p_item) && !('link' in calls[0].args.p_item))
  calls.length = 0
  await api.saveItem({ ...base, details: { category: 'games', on: 'RP6' } }, ctx)
  check('details with no link: p_link null (210 keeps the task\'s link)', calls[0].args.p_link === null)
  calls.length = 0
  await api.saveItem({ ...base, details: null }, ctx)
  check('null details: sent as null (none)', calls.length === 1 && calls[0].args.p_details === null)
  calls.length = 0
  await api.saveItem({ ...base, link: null, details: { category: 'work' } }, ctx)
  check('a link taken off (an edit\'s ×, 215): p_link {"kind":"none"} with the details, one call',
    calls.length === 1 && same(calls[0].args.p_link, { kind: 'none' }) && same(calls[0].args.p_details, { category: 'work' }))
  let refused = null
  try { await api.saveItem({ ...base, link: null }, ctx) } catch (e) { refused = e.message }
  check('…never without the details (only the 3-argument save knows "none"; 210\'s null keeps the link)', !!refused)
  calls.length = 0
  await api.saveItem({ ...base, link }, ctx)
  check('no details (absent = keep): the 2-argument save as before', same(Object.keys(calls[0].args), ['p_item', 'p_link']))
  // A database without 215.
  answer = args => ('p_details' in args ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } } : { data: { taskId: 't1' }, error: null })
  calls.length = 0
  let thrown = null
  try { await api.saveItem({ ...base, link, details: full }, ctx) } catch (e) { thrown = e.message }
  check('without 215: real add-on fields are said ("migration 215 not applied"), nothing else is tried', thrown === api.ITEM_DETAILS_NOT_MIGRATED && calls.length === 1)
  calls.length = 0
  const r = await api.saveItem({ ...base, details: { category: 'work' } }, ctx)
  check('…details that are only the category save without them (the slot keeps its category as before)', r.taskId === 't1' && calls.length === 2 && same(Object.keys(calls[1].args), ['p_item']))
  answer = () => ({ data: null, error: { code: '22023', message: "app_save_item: those details can't be saved" } })
  thrown = null
  try { await api.saveItem({ ...base, details: full }, ctx) } catch (e) { thrown = e.message }
  check('the database\'s refusal is said as it is (never a retry without the details)', /can't be saved/.test(thrown ?? ''))

  console.log('\n== 5. The guards ==')
  const sheet = src('src/shared/components/plan-modal/UnifiedPlanModal.tsx')
  const form = src('src/shared/components/plan-modal/planForm.ts')
  check('the screen saves the details only through the one save (inputFromForm → useSaveItem); no table write',
    /\.\.\.\(repeat \? \{\} : detailsInput\(f, ctx\)\)/.test(form) && !/from\('tasks'\)/.test(sheet + det + src('src/features/items/useItemDetails.ts')))
  check('the one load: the task read by id (select *) carries its details, read through cleanDetails',
    /task && task\.details !== undefined \? \{ \.\.\.read, details: cleanDetails\(task\.details\) \}/.test(sheet))
  // "Cost not toward my spending no.": nothing that counts money names the details.
  const money = ['src/features/shop/shopModel.ts', 'src/features/daily/monthLines.ts'].concat(
    fs.readdirSync(path.join(REPO, 'src/features/shop'), { recursive: true }).filter(f => /\.tsx?$/.test(f)).map(f => `src/features/shop/${f}`))
  const reads = money.filter(f => fs.existsSync(path.join(REPO, f)) && /\.details\b[^\n]*cost|details\?*\.cost/.test(src(f)))
  check('no money read (Shop, the month\'s lines) reads a plan\'s cost', reads.length === 0, reads)
  const claudeSrc = fs.readdirSync(path.join(REPO, 'supabase/claude-src')).map(f => src(`supabase/claude-src/${f}`)).join('\n')
  check('Ask AI never writes them: the assistant\'s code names neither the column nor p_details',
    !/\bp_details\b|\bdetails: (a|changes)\./.test(claudeSrc))
  const icloud = src('src/features/calendar/areas/icloudEvents.ts')
  check('Apple Calendar never gets them: the event builder doesn\'t read a task\'s details', !/\.details\b/.test(icloud))

  console.log(`\nverify-item-details: ${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})()
