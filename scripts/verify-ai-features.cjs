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
check('an amount rounds to cents; 12 lines at most; a line with no name is dropped; a bad line price is null', (() => {
  const r = R.readReceipt({ total: 1.005, items: [{ name: 'a', price: -1 }, { name: '' }, ...Array.from({ length: 20 }, (_, i) => ({ name: `i${i}` }))] }, TODAY)
  return r.items.length === 12 && r.items[0].price === null && Math.abs(r.total - 1.005) <= 0.005
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
check('one line: its name and price, the currency, the day, the matched store (its own name), and a warranty in the note with its date, said once', fill1.title === 'Sony WH-1000XM5' && fill1.price === 2990 && fill1.currency === 'NOK' && fill1.day === '2026-11-08' && fill1.storeId === 's1' && fill1.storeName === null && fill1.storeLabel === 'Elkjøp' && fill1.note === 'From the receipt: 24 months warranty, until 08.11.2028.' && fill1.warrantyUntil === '2028-11-08' && fill1.left.length === 0, fill1)
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
check('no currency printed: the amount is left out (never assumed) and the owner is told', noCur.price === undefined && noCur.currency === undefined && noCur.left.some(l => /no clear currency/.test(l)), noCur)
const unknownStore = R.receiptFill({ ...GOOD, store: 'Jernbanetorget Kiosk' }, STORES, null)
check('an unmatched store keeps its printed name as text; no store id', unknownStore.storeId === null && unknownStore.storeName === 'Jernbanetorget Kiosk')
check('nothing read of a field is nothing filled (no invented day, amount or store)', (() => { const f = R.receiptFill({ items: [{ name: 'Thing', price: null }] }, STORES, null); return f.price === undefined && f.day === undefined && f.storeId === null && f.storeName === null && f.title === 'Thing' })())
check('a warranty with no day is noted without a date', R.receiptFill({ warranty_months: 12 }, STORES, null).note === 'From the receipt: 12 months warranty.')
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
const RULES = { isClosed: t => isClosed(t.status), isOpen: t => t.status === 'open', isOverdue: (t, today) => !!t.due_date && t.due_date < today }
const wk = R.weekInput(tasks, [{ title: 'Release', done: true }, { title: ' ', done: false }, { title: 'Docs', done: false }], '  rough notes ', '2026-11-11', RULES)
check('only tasks closed this week count, by their local day (23:30 UTC on Sunday is Monday 09.11 in Oslo)', same(wk.closed.map(t => t.title), ['Ship export', 'Fix login', 'Mon early']), wk.closed)
check('an open task, one closed outside the week, with no or a bad stamp, or no title is left out', !wk.closed.some(t => ['Still open', 'Reopened', 'Last week', 'Next week', 'No stamp', 'Bad stamp'].includes(t.title)) && wk.closed.length === 3)
check('the week, the goals (a blank one dropped) and the trimmed notes go along', wk.week_start === '2026-11-09' && wk.week_end === '2026-11-15' && same(wk.goals, [{ done: true, title: 'Release' }, { done: false, title: 'Docs' }]) && wk.notes === 'rough notes')
const lots = R.weekInput([...Array.from({ length: 100 }, (_, i) => T(`t${i} ${'x'.repeat(300)}`, 'done', '2026-11-10T10:00:00Z')), ...Array.from({ length: 50 }, (_, i) => ({ ...T(`o${i}`, 'open', null), due_date: i < 5 ? '2026-11-01' : null }))], Array.from({ length: 30 }, (_, i) => ({ title: `g${i}`, done: false })), 'n'.repeat(5000), '2026-11-11', RULES)
check('at most 60 closed tasks, 30 open ones listed (the totals count all 50, 5 overdue, overdue first), 20 goals, 3000 characters of notes, 160 per title', lots.closed.length === 60 && lots.open.length === 30 && lots.open_total === 50 && lots.overdue_total === 5 && lots.open.slice(0, 5).every(t => t.overdue) && lots.goals.length === 20 && lots.notes.length === 3000 && lots.closed.every(t => [...t.title].length <= 160))
check('nothing at all gives empty lists (the sheet then asks no AI)', (() => { const e = R.weekInput([], [], null, '2026-11-11', RULES); return e.closed.length === 0 && e.open.length === 0 && e.open_total === 0 && e.goals.length === 0 && e.notes === '' })())
check('an open task listed with its overdue mark; a closed one is never open', (() => { const e = R.weekInput([{ ...T('Late', 'open', null), due_date: '2026-11-10' }, { ...T('Fine', 'open', null), due_date: '2026-11-20' }, T('Done', 'done', '2026-11-10T10:00:00Z')], [], null, '2026-11-11', RULES); return same(e.open, [{ title: 'Late', overdue: true }, { title: 'Fine', overdue: false }]) && e.open_total === 2 && e.overdue_total === 1 })())

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

section('Tidy up keeps the owner\'s words')
check('hasMarks sees a Pick link or a review mark, nothing else', R.hasMarks('see [[@abc]] here') && R.hasMarks('x\n[[review p1 fixed]]') && !R.hasMarks('plain [text] with brackets'))
check('the owner\'s words are kept as one paragraph under "Said:", the points above them', R.tidiedDescription(['Make it red.', 'Dark mode too.'], 'um make it red\n\n\nalso dark mode') === 'Make it red.\n\nDark mode too.\n\nSaid: um make it red\nalso dark mode')
check('splitSaid finds the block and the rest; a description with none says so', same(R.splitSaid('A.\n\nB.\n\nSaid: first words'), { rest: 'A.\n\nB.', said: 'first words' }) && R.splitSaid('A.\n\nB.').said === null)
check('no points still keeps the words', R.tidiedDescription([], 'hello') === 'Said: hello')

section('a receipt line, and the facts')
check('matchLine: a model-like word picks the line ("XM5"), two shared words pick one, a stranger matches none', R.matchLine('Sony WH-1000XM5 headphones', ['USB-C cable 2 m', 'Sony WH-1000XM5']) === 1 && R.matchLine('Laptop sleeve 13 inch', ['Laptop sleeve', 'Mouse']) === 0 && R.matchLine('Laptop', ['TV Samsung 55', 'Cable']) === null && R.matchLine('Laptop', []) === null)
check('matchLine: two lines that both fit are not guessed between', R.matchLine('Cable', ['USB-C cable', 'HDMI cable']) === null)
const RF = require('../src/features/shop/receiptFacts')
const AM = require('../src/features/shop/autofillModel')
const manyLines = { ...GOOD, items: [{ name: 'TV', price: 8990 }, { name: 'Cable', price: 199 }], total: 9189 }
const fFill = R.receiptFill(GOOD, STORES, null)
const rFacts = RF.receiptFacts(fFill, '2026-11-11T10:00:00Z')
check('receiptFacts: the name, the amount with its currency and the store, from "the receipt", the store exact when matched', same(rFacts.map(f => f.key), ['title', 'price', 'store']) && rFacts.every(f => f.source.label === 'the receipt' && f.source.origin === 'receipt' && f.on) && rFacts[2].confidence === 'exact' && rFacts[1].value.amount === 2990, rFacts)
// The category the function chose from the owner's own list: only an id the app sent, the subcategory when one fits.
{
  const CATS = [{ id: 'c1', name: 'Electronics', parent_id: null }, { id: 'c2', name: 'Headphones', parent_id: 'c1' }, { id: 'c3', name: 'Orphan', parent_id: 'gone' }]
  const line = { name: 'Demo Headphones X1', price: 2990, category_id: 'c2' }
  const sent = new Set(['c1', 'c2'])
  const read = R.readReceipt({ ...GOOD, items: [line, { name: 'Other', price: 5, category_id: 'zzz' }, { name: 'Third', price: 6, category_id: 42 }] }, TODAY, sent)
  check('readReceipt: a category id is kept only when the app sent it; any other id or type is dropped', read.items[0].category_id === 'c2' && !('category_id' in read.items[1]) && !('category_id' in read.items[2]), read.items)
  check('readReceipt: with no ids sent no category survives', !('category_id' in R.readReceipt({ ...GOOD, items: [line] }, TODAY).items[0]))
  const fill = R.receiptFill(read, STORES, 0)
  check('receiptFill carries the picked line\'s category id', fill.categoryId === 'c2', fill)
  const cf = RF.receiptFacts(fill, 'x', CATS).find(f => f.key === 'category')
  check('receiptFacts: the subcategory is a category fact to check, named "Top › Sub", from the receipt', cf && cf.value.topId === 'c1' && cf.value.subId === 'c2' && cf.value.name === 'Electronics › Headphones' && cf.confidence === 'check' && cf.source.label === 'the receipt', cf)
  check('receiptFacts: a top category fits as the top alone', RF.receiptFacts({ ...fill, categoryId: 'c1' }, 'x', CATS).find(f => f.key === 'category').value.subId === '')
  check('receiptFacts: an id that is not in the list now, or a sub whose top is gone, gives no category; no list gives none', ['zzz', 'c3'].every(id => !RF.receiptFacts({ ...fill, categoryId: id }, 'x', CATS).some(f => f.key === 'category')) && !RF.receiptFacts(fill, 'x').some(f => f.key === 'category'))
  const TM = require('../src/features/shop/tidyModel')
  const many = Array.from({ length: 300 }, (_, i) => ({ id: `id${i}`, name: `Name ${i}`, parent_id: null }))
  check('tidyCategories: 100 for a tidy, up to 200 beside a receipt', TM.tidyCategories(many).length === 100 && TM.tidyCategories(many, 200).length === 200)
}
check('an unmatched store is a fact to check; no price without a currency', RF.receiptFacts(R.receiptFill({ ...GOOD, store: 'Kiosk' }, STORES, null), 'x').find(f => f.key === 'store').confidence === 'check' && !RF.receiptFacts(R.receiptFill({ ...GOOD, currency: undefined }, STORES, null), 'x').some(f => f.key === 'price'))
const emptyDraft = { title: '', price: null, currency: 'NOK', image: null, platform: '', topId: '', subId: '' }
const merged = AM.mergeFacts([], 'receipt', rFacts)
const patch = AM.fieldsAfter(emptyDraft, [], merged)
check('into an empty form the receipt fills name, price, currency and store', patch.title === 'Sony WH-1000XM5' && patch.price === 2990 && patch.currency === 'NOK' && patch.platform === 'Elkjøp', patch)
const typedDraft = { ...emptyDraft, title: 'My own name', price: 100, platform: 'Corner shop' }
check('over what the owner typed the receipt fills nothing (it never overwrites)', same(AM.fieldsAfter(typedDraft, [], merged), {}), AM.fieldsAfter(typedDraft, [], merged))
const second = AM.mergeFacts(merged, 'receipt', RF.receiptFacts(R.receiptFill(manyLines, STORES, 1), 'x'))
check('another line picked replaces what the receipt put there, and only that', (() => { const filled = { ...emptyDraft, ...patch }; const p2 = AM.fieldsAfter(filled, merged, second); return p2.title === 'Cable' && p2.price === 199 })())
check('another line picked leaves a name the owner changed after the first fill alone', (() => { const filled = { ...emptyDraft, ...patch, title: 'Owner renamed' }; const p2 = AM.fieldsAfter(filled, merged, second); return !('title' in p2) && p2.price === 199 })())
check('the receipt\'s other lines are the accessories on offer: the picked one is not among them, and none without a pick', same(R.receiptFill(manyLines, STORES, 1).others, [{ name: 'TV', price: 8990 }]) && R.receiptFill(GOOD, STORES, null).others.length === 0 && R.receiptFill(manyLines, STORES, null).others.length === 0)

section('Read a receipt: kind, product lines, a PDF, and what the popup does with them')
const RR = require('../src/features/shop/receiptRead')
const LINE = { name: 'Demo Headphones X1', price: 2990, brand: 'Demo', model: 'X1', quantity: 1, condition: 'new' }
const DEMO = { kind: 'bought', store: 'Demo Elektro', date: '2026-11-08', currency: 'NOK', total: 2990, items: [LINE] }
check('a read with a kind, brand, model, quantity and condition comes through unchanged', same(R.readReceipt(DEMO, TODAY), DEMO))
check('a kind of any other word is dropped; a kind alone is no receipt', !('kind' in R.readReceipt({ ...DEMO, kind: 'purchase' }, TODAY)) && R.readReceipt({ kind: 'sold' }, TODAY) === null)
check('a null brand, model, quantity or condition leaves the key out (the function sends null)', same(R.readReceipt({ items: [{ name: 'A', price: 5, brand: null, model: null, quantity: null, condition: null }] }, TODAY).items, [{ name: 'A', price: 5 }]))
check('shipping, pick-up, bag and 0,01 lines never come through; a link or path is no brand or model; a bad quantity or condition is dropped', same(R.readReceipt({ items: [{ name: 'Frakt', price: 99 }, { name: 'Pick-up Point Jernbanetorget' }, { name: 'Bæreposer', price: 5 }, { name: 'EKSTRA SERVICE', price: 0.01 }, { ...LINE, brand: 'https://evil.example', model: '//evil.example', quantity: 2.5, condition: 'broken' }] }, TODAY).items, [{ name: 'Demo Headphones X1', price: 2990 }]))
check('the kind sets the popup\'s first switch: sold is Sold, everything else (and none) is Bought', RR.sideOf({ kind: 'sold' }) === 'sold' && RR.sideOf({ kind: 'bought' }) === 'bought' && RR.sideOf({ kind: 'unknown' }) === 'bought' && RR.sideOf({}) === 'bought')
const fillDemo = R.receiptFill(DEMO, STORES, 0)
check('a picked line fills name, brand, model, condition, price, currency and day', fillDemo.title === LINE.name && fillDemo.brand === 'Demo' && fillDemo.model === 'X1' && fillDemo.condition === 'new' && fillDemo.price === 2990 && fillDemo.currency === 'NOK' && fillDemo.day === '2026-11-08', fillDemo)
const demoFacts = RF.receiptFacts(fillDemo, 'x')
check('printed brand and model are "likely" facts from "the receipt" (they beat a title autofill, where an equal confidence loses); the condition is likely; nothing for a line without them', demoFacts.find(f => f.key === 'brand')?.confidence === 'likely' && demoFacts.find(f => f.key === 'model')?.value === 'X1' && demoFacts.find(f => f.key === 'condition')?.value === 'new' && demoFacts.every(f => f.source.label === 'the receipt') && !RF.receiptFacts(R.receiptFill(GOOD, STORES, null), 'x').some(f => f.key === 'brand'))
const foundFacts = RF.receiptFacts(R.receiptFill({ ...DEMO, searched: true }, STORES, 0), 'x')
check('what a web search found (the read says it searched) is a "check" fact from "receipt + web search": the name, brand and model; the price, store and condition stay the receipt\'s own', ['title', 'brand', 'model'].every(k => foundFacts.find(f => f.key === k)?.confidence === 'check' && foundFacts.find(f => f.key === k)?.source.label === 'receipt + web search') && foundFacts.find(f => f.key === 'price')?.source.label === 'the receipt' && foundFacts.find(f => f.key === 'price')?.confidence === 'exact')
const AMfacts = AM.mergeFacts([{ key: 'brand', value: 'Demo', source: { origin: 'title', label: 'the title' }, confidence: 'check', on: true, at: 'x' }], 'receipt', demoFacts)
check('a printed brand from the receipt replaces the title autofill\'s equal brand (likely beats check): its source is the receipt', AMfacts.find(f => f.key === 'brand')?.source.label === 'the receipt', AMfacts.filter(f => f.key === 'brand'))
const outlet = R.receiptFill({ ...DEMO, items: [{ ...LINE, condition: 'outlet', quantity: 2 }] }, STORES, 0)
check('an Outlet line has no condition fact (the app holds none for it) but says so in the note, with the pieces it covers', outlet.condition === undefined && /marked Outlet/.test(outlet.note) && /2 pieces on this line/.test(outlet.note), outlet)
const addFill = RR.addFillFor({ ...DEMO, items: [LINE, { name: 'Cable', price: 199 }] }, 0, STORES)
check('Add starts from the one line and offers no "other lines as accessories" (each line has its own Add)', addFill.title === LINE.name && addFill.others.length === 0)
check('Sell starts from the line price and the receipt day; a currency the app lacks gives no amount; a line with no price gives none', same(RR.saleFor(DEMO, LINE), { amount: 2990, currency: 'NOK', day: '2026-11-08' }) && same(RR.saleFor({ ...DEMO, currency: 'SEK' }, LINE), { day: '2026-11-08' }) && same(RR.saleFor(DEMO, { name: 'x', price: null }), { day: '2026-11-08' }))
const mine = (id, title, over = {}) => ({ id, title, list: 'wishlist', kind: 'item', status: 'bought', kept: true, disposal: null, accessory_of: null, ...over })
const THINGS = [mine('a', 'Demo Headphones X1'), mine('b', 'Other Speaker Z9'), mine('c', 'Demo Headphones X1 case', { accessory_of: 'a' }), mine('d', 'Old Phone', { disposal: 'sold' })]
check('a sold line finds your own thing by its name (folded), never an accessory, never one that already left', RR.thingForLine({ name: 'DEMO headphones x1' }, THINGS)?.id === 'a' && RR.thingForLine({ name: 'Old Phone' }, THINGS) === null && RR.thingForLine({ name: 'Demo Headphones X1 case' }, [THINGS[2]]) === null)
check('a sold line finds it by brand and model together, or by a model-like word', RR.thingForLine({ name: 'HP', brand: 'Demo', model: 'Headphones X1' }, THINGS)?.id === 'a' && RR.thingForLine({ name: 'Demo wireless headphones X1 black' }, THINGS)?.id === 'a')
check('two things that fit equally are not guessed between, and a stranger matches nothing', RR.thingForLine({ name: 'Demo Headphones X1' }, [mine('a', 'Demo Headphones X1'), mine('e', 'demo headphones x1')]) === null && RR.thingForLine({ name: 'Garden Hose 20 m' }, THINGS) === null)
check('a line in words: brand, model, the condition and the pieces, and never the name twice', RR.lineFacts(LINE) === 'Demo · X1 · new' && RR.lineFacts({ ...LINE, condition: 'outlet', quantity: 3 }) === 'Demo · X1 · Outlet · ×3' && RR.lineFacts({ name: 'Demo', price: 1, brand: 'Demo' }) === '')
const pdfBytes = (head, pad = 50, tail = '\n%%EOF') => new Uint8Array([...Buffer.from(head), ...new Array(pad).fill(32), ...Buffer.from(tail)])
const pdfOk = R.pdfFromBytes(pdfBytes('%PDF-1.4\n'))
check('a PDF is taken by its own first bytes and sent as base64 with its type', pdfOk.media_type === 'application/pdf' && Buffer.from(pdfOk.data, 'base64').subarray(0, 5).toString() === '%PDF-')
const refusal = (fn) => { try { fn(); return 'accepted' } catch (e) { return e.message } }
check('a file that is not a PDF (by its bytes), a password-protected one and a PDF over 1 MB are refused in words', /isn't a PDF/.test(refusal(() => R.pdfFromBytes(pdfBytes('%PNG-1.4\n')))) && /password protected/.test(refusal(() => R.pdfFromBytes(pdfBytes('%PDF-1.4\n', 50, '/Encrypt 5 0 R\n%%EOF')))) && /too large/.test(refusal(() => R.pdfFromBytes(pdfBytes('%PDF-1.4\n', 1_000_001)))) && /isn't a PDF/.test(refusal(() => R.pdfFromBytes(new Uint8Array(3)))))
check('the PDF limit is the function\'s (1,000,000 bytes → 1.33 million base64 characters, under 1.4 million)', R.PDF_MAX_BYTES === 1_000_000 && Math.ceil(R.PDF_MAX_BYTES / 3) * 4 < 1_400_000)

section('the cost line, the zero-width and link filters, the search in the breakdown')
check('costNote: four decimals under a cent, three above; nothing when unknown', R.costNote(0.00031) === '≈ $0.0003' && R.costNote(0.0123) === '≈ $0.012' && R.costNote(null) === '' && R.costNote(-1) === '' && R.costNote(NaN) === '')
check('ideas: anything that reads as a host name is dropped, zero-width characters are taken out of the lines that stay', (() => { const r = R.readIdeas({ ideas: ['Visit example.no today', 'Visit exam​ple.no', 'Walk at the harbour.', 'The old‮ church.', 'Sunset at the quay.'] }); return same(r.ideas, ['Walk at the harbour.', 'The old church.', 'Sunset at the quay.']) })())
const LR = require('../src/features/ai/claude/ledgerRules')
const priced = { checkedOn: '2026-11-20', source: '', longPromptOverTokens: 100000, longPromptMultiplier: 5, batchMultiplier: 0.5, webSearchUsdEach: 0.01, webSearchMaxUses: 3, models: [{ model: 'claude-haiku-5-5', inputPerMTok: 0.1, outputPerMTok: 0.5, cacheReadPerMTok: 0.01, cacheWrite5mPerMTok: 0.125, cacheWrite1hPerMTok: 0.2 }] }
const searchCall = { outcome: 'ok', model: 'claude-haiku-5-5', mode: 'live', long_prompt: false, input_tokens: 9000, cache_read_tokens: 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0, output_tokens: 400, thinking_tokens: 0, cost_usd: 0.0011 + 0.02, tools: [{ name: 'web_search', searches: 2 }] }
const bd = LR.costBreakdown(searchCall, priced)
check('a call that searched: the breakdown has the search line (2 × $0.01), adds it after the tokens, and matches the stored cost (no "prices may have changed" gap)', bd.searches === 2 && bd.searchEach === 0.01 && bd.searchUsd === 0.02 && Math.abs(bd.worked - searchCall.cost_usd) < 0.0000015, bd)
check('a call without searches has none; tools that are not searches or have a bad count count nothing', LR.costBreakdown({ ...searchCall, tools: [] }, priced).searches === 0 && LR.searchesOf({ tools: [{ name: 'other', searches: 5 }, { name: 'web_search', searches: -1 }, { name: 'web_search', searches: 'x' }, null, 'y'] }) === 0 && LR.searchesOf({ tools: [{ name: 'web_search', searches: 1 }, { name: 'web_search', searches: 2 }] }) === 3)
check('a long prompt multiplies the tokens, never the searches', (() => { const c = { ...searchCall, long_prompt: true, cost_usd: 0.0011 * 5 + 0.02 }; const b2 = LR.costBreakdown(c, priced); return Math.abs(b2.worked - c.cost_usd) < 0.0000015 })())

const RP = { ...DEMO, items: [{ ...LINE, product: 'Demo Headphones X1, black' }] }
check('a line\'s product name is the thing\'s name when there is one (title = product ?? name)', R.receiptFill(RP, STORES, 0).title === 'Demo Headphones X1, black' && R.receiptFill(DEMO, STORES, 0).title === 'Demo Headphones X1')
check('a product that is a link, or over 120 characters, is dropped; a slash inside a model or product is fine; brand and model of a link or a path are null', same(R.readReceipt({ items: [{ ...LINE, product: 'Demo https://evil.example' }, { ...LINE, product: 'x'.repeat(121) }, { ...LINE, model: '16/512 GB', product: 'Demo 16/512 GB' }, { ...LINE, model: '/etc/passwd', brand: 'www.evil.example' }] }, TODAY).items.map(i => [i.product ?? null, i.model ?? null, i.brand ?? null]), [[null, 'X1', 'Demo'], [null, 'X1', 'Demo'], ['Demo 16/512 GB', '16/512 GB', 'Demo'], [null, null, null]]))
check('a store number in front of the name is dropped ("0420 Demo Elektro" matches your "Demo Elektro"); digits alone stay', R.readReceipt({ store: '0420 Demo Elektro Majorstuen' }, TODAY).store === 'Demo Elektro Majorstuen' && R.readReceipt({ store: '1234' }, TODAY).store === '1234')
check('more than 12 lines: the 12 most expensive, in the order they were printed', (() => { const r = R.readReceipt({ items: Array.from({ length: 20 }, (_, i) => ({ name: `Thing ${i}`, price: i + 1 })) }, TODAY); return r.items.length === 12 && r.items[0].name === 'Thing 8' && r.items[11].name === 'Thing 19' })())
check('the channel and the search flag come through only as their own words; a channel alone is no receipt', R.readReceipt({ ...DEMO, channel: 'online', searched: true }, TODAY).channel === 'online' && R.readReceipt({ ...DEMO, channel: 'online', searched: true }, TODAY).searched === true && !('channel' in R.readReceipt({ ...DEMO, channel: 'phone' }, TODAY)) && !('searched' in R.readReceipt({ ...DEMO, searched: 'yes' }, TODAY)) && R.readReceipt({ channel: 'online', searched: true }, TODAY) === null)
check('a web order says online in the Just bought sheet\'s terms: the fill carries the channel and the search flag', R.receiptFill({ ...DEMO, channel: 'in_store', searched: true }, STORES, 0).channel === 'in_store' && R.receiptFill({ ...DEMO, searched: true }, STORES, 0).searched === true)
const THINGS2 = [mine('a', 'Demo Headphones X1'), mine('w', 'Demo Speaker Z9 black', { status: 'wishlist', kept: true }), mine('x', 'Demo Cable', { status: 'wishlist', option_for: 'a' }), mine('g', 'Demo Tablet', { status: 'wishlist', kind: 'general' }), mine('q', 'Demo Milk', { status: 'wishlist', list: 'quick' })]
check('a bought line that is one of your wishes is found by the same match: a wish still to buy, never a model of a general wish, a general wish, a quick-list row or a thing you already own', RR.wishForLine({ name: 'DEMO speaker z9' }, THINGS2)?.id === 'w' && RR.wishForLine({ name: 'Demo Cable' }, THINGS2) === null && RR.wishForLine({ name: 'Demo Tablet' }, THINGS2) === null && RR.wishForLine({ name: 'Demo Milk' }, THINGS2) === null && RR.wishForLine({ name: 'Demo Headphones X1' }, THINGS2) === null)
check('the product name, brand and model help the match: a printed code finds the wish by its product name', RR.wishForLine({ name: 'DS-9', product: 'Demo Speaker Z9, black' }, THINGS2)?.id === 'w')
const MARKETS = [{ id: 's1', name: 'Demo Marketplace', kind: 'marketplace' }, { id: 's2', name: 'Demo Hidden', hidden: true }]
check('Sell\'s "Sold to" is the receipt\'s store when it is one of your own stores (never a name made from the print)', RR.saleFor({ ...DEMO, store: 'Demo Marketplace AS' }, LINE, MARKETS).to === 'Demo Marketplace' && !('to' in RR.saleFor({ ...DEMO, store: 'Some Stranger' }, LINE, MARKETS)) && !('to' in RR.saleFor({ ...DEMO, store: 'Demo Hidden' }, LINE, MARKETS)) && !('to' in RR.saleFor(DEMO, LINE)))
check('saleFor never sets moneyTo itself: the money target is the app\'s own id (a bought line saved first), put on Sell by the popup and taken by the sheet only when it is one of the sheet\'s own choices', !('moneyTo' in RR.saleFor(DEMO, LINE, MARKETS)) && /moneyTo\?: string/.test(require('fs').readFileSync(require('path').join(__dirname, '../src/features/shop/receiptRead.ts'), 'utf8')) && /isMoneyTarget\(c, item\.id\)/.test(require('fs').readFileSync(require('path').join(__dirname, '../src/features/shop/components/owned/SellSheet.tsx'), 'utf8')))
const SOLD_ITEMS = [{ id: 'a', title: 'Old Phone Z9 64GB', list: 'wishlist', kind: 'item', status: 'bought', disposal: 'sold' }, { id: 'b', title: 'Lamp', list: 'wishlist', kind: 'item', status: 'bought', disposal: null }]
check('a sold line is matched to a thing already sold in the app only among sold things (never an accessory, never a returned one), and never to one still yours', RR.soldThingForLine({ name: 'OLD PHONE Z9 64GB', price: 1 }, SOLD_ITEMS)?.id === 'a' && RR.soldThingForLine({ name: 'Lamp', price: 1 }, SOLD_ITEMS) === null && RR.soldThingForLine({ name: 'Old Phone Z9 64GB', price: 1 }, [{ ...SOLD_ITEMS[0], accessory_of: 'x' }]) === null && RR.soldThingForLine({ name: 'Old Phone Z9 64GB', price: 1 }, [{ ...SOLD_ITEMS[0], disposal: 'returned' }]) === null)

console.log(`\n${ok} passed, ${bad} failed`)
process.exit(bad ? 1 : 0)
