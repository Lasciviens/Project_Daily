#!/usr/bin/env node
/*
 * Verification — the app side of the AI features of 22.11.2026 (src/features/ai/claude/featureRules.ts), against the
 * REAL module via sucrase:
 *   photos        the size a photo is sent at, the data-URL → job input step
 *   receipt       the app's second check of a read receipt, matching the printed store to the owner's own stores
 *                 (never a new store), the form fields a receipt fills, a printed warranty's date
 *   week          Monday–Sunday bounds, the closed Work tasks of the week from completed_at, caps
 *   error         secrets taken out of an error and its context before anything is sent
 *   Dev Requests  a drafted request checked against the app's own page list
 *   ideas         the idea lines, and what is added to a wish's notes
 * (The function's own checks, with the same limits, are in verify-claude-function.cjs §17.)
 *
 * Run: node scripts/verify-ai-features.cjs
 */
process.env.TZ = 'Europe/Oslo'
require('sucrase/register')
const R = require('../src/features/ai/claude/featureRules')

let ok = 0, bad = 0
const check = (name, cond, detail) => {
  if (cond) { ok++; console.log('  ✓', name) } else { bad++; console.log('  ✗', name, detail === undefined ? '' : `— ${JSON.stringify(detail)}`.slice(0, 500)) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const section = t => console.log(`\n${t}`)

section('photos')
check('a 4032×3024 photo is drawn at 1280×960', same(R.fitWithin(4032, 3024), { width: 1280, height: 960 }))
check('a portrait 3000×4000 photo is drawn at 960×1280', same(R.fitWithin(3000, 4000), { width: 960, height: 1280 }))
check('a photo already within 1280 px is never scaled (or scaled up)', same(R.fitWithin(800, 600), { width: 800, height: 600 }) && same(R.fitWithin(1280, 1280), { width: 1280, height: 1280 }))
check('a very long thin photo keeps at least 1 px on its short side', R.fitWithin(100000, 10).height >= 1 && R.fitWithin(100000, 10).width === 1280)
check('a size of 0 or a fraction becomes at least 1 × 1', same(R.fitWithin(0, 0), { width: 1, height: 1 }))
check('the long side never goes over 1280, whatever comes in', [[5000, 5000], [1281, 10], [99999, 99999], [1280.4, 900]].every(([w, h]) => Math.max(R.fitWithin(w, h).width, R.fitWithin(w, h).height) <= 1280))
const B64 = 'A'.repeat(120)
check('a JPEG data URL becomes the job input (type and bare base64)', same(R.photoFromDataUrl(`data:image/jpeg;base64,${B64}`), { media_type: 'image/jpeg', data: B64 }))
check('a PNG data URL, a plain string, and one with a space are refused', R.photoFromDataUrl(`data:image/png;base64,${B64}`) === null && R.photoFromDataUrl(B64) === null && R.photoFromDataUrl('data:image/jpeg;base64,AA AA') === null)
check('the limits are the function\'s (1280 px, 85 %, 1,000,000 bytes → under 1.4 million base64 characters)', R.PHOTO_LONG_SIDE === 1280 && R.PHOTO_QUALITY === 0.85 && R.PHOTO_MAX_BYTES * 4 / 3 < 1_400_000)

section('receipt: the second check')
const TODAY = '2026-11-11'
const GOOD = { store: 'Elkjøp', date: '2026-11-08', currency: 'NOK', total: 2990, items: [{ name: 'Sony WH-1000XM5', price: 2990 }], warranty_months: 24 }
check('a good read comes through unchanged', same(R.readReceipt(GOOD, TODAY), GOOD))
for (const [label, patch, key] of [
  ['an amount of 0', { total: 0 }, 'total'], ['a negative amount', { total: -5 }, 'total'], ['6 million', { total: 6_000_000 }, 'total'], ['an amount as text', { total: '2 990' }, 'total'],
  ['a lower-case currency', { currency: 'nok' }, 'currency'], ['a 4-letter currency', { currency: 'NOKK' }, 'currency'],
  ['tomorrow', { date: '2026-11-12' }, 'date'], ['more than 5 years ago', { date: '2021-11-10' }, 'date'], ['30 February', { date: '2026-02-30' }, 'date'],
  ['a store that is a link', { store: 'https://evil.example' }, 'store'], ['a store of 81 characters', { store: 'S'.repeat(81) }, 'store'],
  ['0 months of warranty', { warranty_months: 0 }, 'warranty_months'], ['121 months', { warranty_months: 121 }, 'warranty_months'], ['2.5 months', { warranty_months: 2.5 }, 'warranty_months'],
]) {
  const r = R.readReceipt({ ...GOOD, ...patch }, TODAY)
  check(`${label}: dropped, never repaired; the rest stays`, r && !(key in r) && Object.keys(GOOD).filter(k => k !== key).every(k => k in r), r)
}
check('today and exactly 5 years back are allowed', R.readReceipt({ date: '2026-11-11' }, TODAY).date === '2026-11-11' && R.readReceipt({ date: '2021-11-11' }, TODAY).date === '2021-11-11')
check('an amount rounds to cents; 8 lines at most; a line with no name is dropped; a bad line price is null', (() => {
  const r = R.readReceipt({ total: 1.005, items: [{ name: 'a', price: -1 }, { name: '' }, ...Array.from({ length: 20 }, (_, i) => ({ name: `i${i}` }))] }, TODAY)
  return r.items.length === 8 && r.items[0].price === null && Math.abs(r.total - 1.005) <= 0.005
})())
check('an answer with nothing usable, a list, null and text are null', [R.readReceipt({}, TODAY), R.readReceipt({ total: -1 }, TODAY), R.readReceipt([GOOD], TODAY), R.readReceipt(null, TODAY), R.readReceipt('x', TODAY)].every(v => v === null))
check('unknown keys (a link, a note) never come through', !('url' in R.readReceipt({ ...GOOD, url: 'https://evil.example', note: 'x' }, TODAY)))

section('receipt: the store is matched to the owner\'s own stores, in code')
const STORES = [{ id: 's1', name: 'Elkjøp' }, { id: 's2', name: 'Power' }, { id: 's3', name: 'Kiwi' }, { id: 's4', name: 'Komplett' }, { id: 's5', name: 'Hidden Shop', hidden: true }, { id: 's6', name: 'Prisjakt', kind: 'price_site' }, { id: 's7', name: 'Ab' }, { id: 's8', name: 'Power Fix' }]
const m = n => R.matchStore(n, STORES)?.id ?? null
check('foldName: case, accents, æøå, spaces and punctuation meet', R.foldName('Elkjøp Norge AS') === 'elkjopnorgeas' && R.foldName('ELKJØP') === R.foldName('Elkjop') && R.foldName('Kiwi 1234') === 'kiwi1234')
check('the same name, any case, matches', m('ELKJØP') === 's1' && m('elkjop') === 's1')
check('a printed company name matches the store it starts with ("ELKJØP NORGE AS")', m('ELKJØP NORGE AS') === 's1' && m('Power Norge AS') === 's2')
check('a store whose name the printed one starts with matches ("Kiwi 123 Storo")', m('Kiwi 123 Storo') === 's3' && m('KOMPLETT.NO') === 's4')
check('the longest of several is taken, "Power Fix" over "Power"', m('Power Fix Oslo') === 's8')
check('an unknown store matches none, and none is ever made', m('Jernbanetorget Kiosk') === null && STORES.length === 8)
check('a hidden store, a price site and a name under 3 characters are never matched', m('Hidden Shop') === null && m('Prisjakt') === null && m('Ab') === null)
check('nothing printed matches nothing', R.matchStore(undefined, STORES) === null && R.matchStore('', STORES) === null)
check('two stores with the same folded name are not guessed between', R.matchStore('Kiwi', [{ id: 'a', name: 'Kiwi' }, { id: 'b', name: 'KIWI' }]) === null)
check('a printed name merely containing a store somewhere inside does not match ("The Kiwi Shop")', m('The Power Shop') === null)

section('receipt: what it fills')
const fill1 = R.receiptFill(GOOD, STORES, null)
check('one line: its name and price, the currency, the day, the matched store, and a warranty in the note with its date', fill1.title === 'Sony WH-1000XM5' && fill1.price === 2990 && fill1.currency === 'NOK' && fill1.day === '2026-11-08' && fill1.storeId === 's1' && fill1.storeName === null && /warranty on the receipt: 24 months \(until 08\.11\.2028\)/.test(fill1.note) && fill1.left.length === 0, fill1)
const many = { ...GOOD, items: [{ name: 'TV', price: 8990 }, { name: 'Cable', price: 199 }], total: 9189 }
const fillM = R.receiptFill(many, STORES, null)
check('several lines, none picked: no name, no price (never a guess), and it says to pick', fillM.title === undefined && fillM.price === undefined && fillM.left.some(l => /pick the one you bought/.test(l)), fillM)
const fillPick = R.receiptFill(many, STORES, 1)
check('a picked line gives its own name and price; the total goes in the note when it differs', fillPick.title === 'Cable' && fillPick.price === 199 && /receipt total 9189 NOK/.test(fillPick.note), fillPick)
const fillTotal = R.receiptFill(many, STORES, 'total')
check('"Use the total" fills the total and no name', fillTotal.price === 9189 && fillTotal.title === undefined)
const sek = R.receiptFill({ ...GOOD, currency: 'SEK' }, STORES, null)
check('a currency this app does not hold: no amount, no currency (never converted), and it says why', sek.price === undefined && sek.currency === undefined && sek.left.some(l => /SEK/.test(l)), sek)
const noCur = R.receiptFill({ ...GOOD, currency: undefined }, STORES, null)
check('no currency printed: the amount is filled and the owner is told to check the currency', noCur.price === 2990 && noCur.currency === undefined && noCur.left.some(l => /no clear currency/.test(l)), noCur)
const unknownStore = R.receiptFill({ ...GOOD, store: 'Jernbanetorget Kiosk' }, STORES, null)
check('an unmatched store keeps its printed name as text; no store id', unknownStore.storeId === null && unknownStore.storeName === 'Jernbanetorget Kiosk')
check('nothing read of a field is nothing filled (no invented day, amount or store)', (() => { const f = R.receiptFill({ items: [{ name: 'Thing', price: null }] }, STORES, null); return f.price === undefined && f.day === undefined && f.storeId === null && f.storeName === null && f.title === 'Thing' })())
check('a warranty with no day is noted without a date', /warranty on the receipt: 12 months\./.test(R.receiptFill({ warranty_months: 12 }, STORES, null).note))
check('addMonthsToDay keeps the day, or the month\'s last day', R.addMonthsToDay('2026-11-08', 24) === '2028-11-08' && R.addMonthsToDay('2026-01-31', 1) === '2026-02-28' && R.addMonthsToDay('2024-01-31', 1) === '2024-02-29' && R.addMonthsToDay('2026-12-15', 1) === '2027-01-15' && R.addMonthsToDay('2026-03-31', 12) === '2027-03-31')

section('week')
check('Wednesday 11.11.2026 is in 09.11–15.11.2026', same(R.weekBounds('2026-11-11'), { start: '2026-11-09', end: '2026-11-15' }))
check('Monday and Sunday are in their own week', same(R.weekBounds('2026-11-09'), { start: '2026-11-09', end: '2026-11-15' }) && same(R.weekBounds('2026-11-15'), { start: '2026-11-09', end: '2026-11-15' }))
check('a week across the year end (Friday 01.01.2027)', same(R.weekBounds('2027-01-01'), { start: '2026-12-28', end: '2027-01-03' }))
check('a week across the clock change (Sunday 25.10.2026 → Monday 26.10) holds 7 days', (() => { const w = R.weekBounds('2026-10-28'); return w.start === '2026-10-26' && w.end === '2026-11-01' })())
const isClosed = s => s === 'done' || s === 'cancelled'
const T = (title, status, completed_at) => ({ title, status, completed_at })
const tasks = [
  T('Ship export', 'done', '2026-11-12T08:00:00Z'), T('Mon early', 'done', '2026-11-08T23:30:00Z'), T('Fix login', 'done', '2026-11-10T10:00:00+01:00'),
  T('Last week', 'done', '2026-11-06T10:00:00Z'), T('Next week', 'done', '2026-11-16T10:00:00Z'), T('Still open', 'open', null), T('Reopened', 'open', '2026-11-10T10:00:00Z'),
  T('No stamp', 'done', null), T('Bad stamp', 'done', 'not a date'), T('  ', 'done', '2026-11-10T10:00:00Z'),
]
const wk = R.weekInput(tasks, [{ title: 'Release', done: true }, { title: ' ', done: false }, { title: 'Docs', done: false }], '  rough notes ', '2026-11-11', isClosed)
check('only tasks closed this week count, by their local day (23:30 UTC on Sunday is Monday 09.11 in Oslo)', same(wk.closed.map(t => t.title), ['Ship export', 'Fix login', 'Mon early']), wk.closed)
check('an open task, one closed outside the week, with no or a bad stamp, or no title is left out', !wk.closed.some(t => ['Still open', 'Reopened', 'Last week', 'Next week', 'No stamp', 'Bad stamp'].includes(t.title)) && wk.closed.length === 3)
check('the week, the goals (a blank one dropped) and the trimmed notes go along', wk.week_start === '2026-11-09' && wk.week_end === '2026-11-15' && same(wk.goals, [{ done: true, title: 'Release' }, { done: false, title: 'Docs' }]) && wk.notes === 'rough notes')
const lots = R.weekInput(Array.from({ length: 100 }, (_, i) => T(`t${i} ${'x'.repeat(300)}`, 'done', '2026-11-10T10:00:00Z')), Array.from({ length: 30 }, (_, i) => ({ title: `g${i}`, done: false })), 'n'.repeat(5000), '2026-11-11', isClosed)
check('at most 60 tasks, 20 goals, 3000 characters of notes, 160 per title', lots.closed.length === 60 && lots.goals.length === 20 && lots.notes.length === 3000 && lots.closed.every(t => [...t.title].length <= 160))
check('nothing at all gives empty lists (the sheet then asks no AI)', (() => { const e = R.weekInput([], [], null, '2026-11-11', isClosed); return e.closed.length === 0 && e.goals.length === 0 && e.notes === '' })())

section('an error, before it is sent')
const JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
const SECRETS = [JWT, 'sk-ant-api03-ABCDEFGH12345678', 'sb_secret_TESTSERVICE0123456789', 'sb_publishable_TESTPUBLISH0123456', 'hunter2hunter2', 'ola.nordmann@example.com', 'AKIAIOSFODNN7EXAMPLEKEY1234567890ABCDEF', 'abc123tokenvalue', 'supersecretpw']
const HOSTILE = `TypeError: Cannot read properties of null (reading 'id') at fetch https://example.supabase.co/rest/v1/tasks?apikey=${SECRETS[3]}&select=*#access_token=abc123tokenvalue\nAuthorization: Bearer ${JWT}\n{"password": "hunter2hunter2", "email": "ola.nordmann@example.com", "key": "${SECRETS[1]}"}\nsecret=${SECRETS[2]} client_secret: supersecretpw\nlong ${SECRETS[6]}\nhttps://ola:supersecretpw@example.com/path?x=1\n` + 'at frame\n'.repeat(40)
const scrubbed = R.scrubErrorForAi(HOSTILE, 800)
check('no secret, e-mail, link query or credential survives; the failure itself stays', SECRETS.every(s => !scrubbed.includes(s)) && !/\?apikey|access_token=abc|ola:supersecretpw/.test(scrubbed) && /Cannot read properties of null/.test(scrubbed), scrubbed)
check('a link keeps host and path; a stack keeps 14 lines; the cut is at the limit', /https:\/\/example\.supabase\.co\/rest\/v1\/tasks\?\[hidden\]/.test(scrubbed) && scrubbed.split('\n').length <= 14 && R.scrubErrorForAi('x '.repeat(5000), 800).length === 800)
check('plain words that only contain "token" or "key" stay', R.scrubErrorForAi('Invalid token for the key column', 200) === 'Invalid token for the key column')
const ctx = R.errorContextForAi({ route: '#/daily', status: 404, user_agent: 'Mozilla/5.0 (iPhone)', at: '2026-11-11T10:00:00Z', payload: { token: 'abc123tokenvalue', nested: { Password: 'hunter2hunter2', fine: 'ok' } }, authorization: 'Bearer x', email: 'ola.nordmann@example.com' })
check('a context: the user agent is left out, secret-looking keys blanked at any depth, the e-mail hidden, the route kept', !/Mozilla/.test(ctx) && !/abc123tokenvalue|hunter2hunter2|ola\.nordmann/.test(ctx) && /#\/daily/.test(ctx) && /"fine":"ok"/.test(ctx), ctx)
check('no context is an empty string; a circular one does not throw', R.errorContextForAi(null) === '' && R.errorContextForAi({}) === '' && (() => { const c = {}; c.self = c; return typeof R.errorContextForAi(c) === 'string' })())
check('it is fast on 200 KB of hostile text', (() => { const t = Date.now(); R.scrubErrorForAi('a=b&'.repeat(50_000) + '{'.repeat(50_000), 800); return Date.now() - t < 1500 })())

section('Dev Requests')
const PAGES = ['/home', '/daily', '/shop', 'other']
const D = R.readRequestDraft({ title: ' Water card  red ', page: '/daily', category: 'improvement', priority: 'high', points: ['one', '', 5, 'two'] }, PAGES)
check('a draft: the title\'s spaces collapse, the page is in the list, the category and priority are words from their lists, only real points stay', same(D, { title: 'Water card red', page: '/daily', category: 'improvement', priority: 'high', points: ['one', 'two'] }), D)
const E = R.readRequestDraft({ title: 'x', page: '/etc/passwd', category: 'bugfix', priority: 'asap', points: Array.from({ length: 30 }, (_, i) => `p${i}`) }, PAGES)
check('a page outside the app\'s list is "other"; unknown category/priority fall back; at most 12 points', E.page === 'other' && E.category === 'feature' && E.priority === 'medium' && E.points.length === 12, E)
check('the fallback category of an error draft is bug', R.readRequestDraft({ title: 'x' }, PAGES, 'bug').category === 'bug')
check('no title, a title of 101 characters, a list and null are refused', [R.readRequestDraft({ points: ['a'] }, PAGES), R.readRequestDraft({ title: 'T'.repeat(101) }, PAGES), R.readRequestDraft([], PAGES), R.readRequestDraft(null, PAGES)].every(v => v === null))
check('the outline is one point per paragraph (a blank line between)', R.outlineOf(['a', 'b c', 'd']) === 'a\n\nb c\n\nd' && R.outlineOf([]) === '')

section('ideas')
const ID = R.readIdeas({ ideas: ['A.', 'See https://evil.example', 'B.', 'B.', 'C.', 'D', ...Array.from({ length: 10 }, (_, i) => `Idea ${i}`)], from_search: true })
check('ideas: a line with a link and a repeat are dropped, at most 8, and a search is said when the function said it', ID.ideas.length === 8 && !ID.ideas.some(l => /http/.test(l)) && new Set(ID.ideas).size === 8 && ID.fromSearch === true, ID)
check('fewer than 3 ideas, no list or null is refused; "from_search" must be exactly true', R.readIdeas({ ideas: ['a', 'b'] }) === null && R.readIdeas({ ideas: 'x' }) === null && R.readIdeas(null) === null && R.readIdeas({ ideas: ['a', 'b', 'c'], from_search: 'true' }).fromSearch === false)
check('the block says where the ideas come from', /^Ideas \(found with web search\):\n- a\n- b$/.test(R.ideasBlock(['a', 'b'], true)) && /general knowledge, check before you go/.test(R.ideasBlock(['a'], false)))
check('the block is added after the notes with one blank line, or alone', R.notesWithIdeas('Maybe in June  \n', 'BLOCK') === 'Maybe in June\n\nBLOCK' && R.notesWithIdeas('', 'BLOCK') === 'BLOCK')

console.log(`\n${ok} passed, ${bad} failed`)
process.exit(bad ? 1 : 0)
