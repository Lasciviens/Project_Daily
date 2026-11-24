#!/usr/bin/env node
/* Verification — a Shop thing has ONE screen (owner, 24.11.2026: "One screen, different ways to use it … I don't want to see
 * faulty data"): the body `components/record/RecordBody.tsx` with modes add | open | bought.
 *   1. Same data as before: every typical save of the three old screens (ShopCreate, ShopRecord, JustBoughtSheet), run on the
 *      new code, gives the payload the old code gave (scripts/fixtures/shop-one-body-payloads.json, made from origin/main
 *      f207a3a1 on scripts/fixtures/shop-one-body-scenarios.cjs) — or a difference listed in INTENDED with its reason.
 *   2. One body: each entry frame (adding, opening, Just bought) renders `<RecordBody` and has no field, picture or finder of
 *      its own; the field, picture and autofill parts are imported only under components/record/, plus ALLOW with a reason;
 *      the quick list's errand sheet uses none of them (an errand is not a thing).
 *   3. Self-test: a copied field, a frame without the body and a part imported elsewhere each fail the check.
 * Run: node scripts/verify-shop-one-body.mjs */
process.env.TZ = 'Europe/Oslo'
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
require('sucrase/register')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ── 1. Same data as before ────────────────────────────────────────────────────
console.log('1. The same data as before')
const S = require('./fixtures/shop-one-body-scenarios.cjs')
const want = JSON.parse(readFileSync(join(root, 'scripts/fixtures/shop-one-body-payloads.json'), 'utf8'))
const C = require('../src/features/shop/components/record/createDraft')
const { patchOf } = require('../src/features/shop/components/record/useRecordDraft')
const P = require('../src/features/shop/components/record/purchaseDraft')

/** Differences from the old payloads that were meant, each with its reason. None so far. */
const INTENDED = {}

for (const [name, { spec, s }] of Object.entries(S.addScenarios(C))) {
  // The add's Save: inputOf, plus the Purchase part only when the owner opened it (here: untouched).
  const got = { ...C.inputOf(spec, s, s.draft.category_id ?? null, S.CATS), ...P.purchaseAtCreate(s.purchase ?? null, null) }
  check(`${name}: the insert is the old one`, same(got, want.add[name]) || INTENDED[name], JSON.stringify({ got, want: want.add[name] }))
  check(`${name}: never sends what the database derives`, !('owner_edited' in got) && !('source_facts' in got) && (!('fx_nok' in got) || (got.currency !== 'NOK' && s.draft.fx_nok != null)))
}
for (const [name, [item, draft]] of Object.entries(S.openScenarios)) {
  const got = patchOf(item, draft)
  check(`${name}: the update is the old one`, same(got, want.open[name]) || INTENDED[name], JSON.stringify({ got, want: want.open[name] }))
}
/** The owner's changes, as the Purchase editor's controls set them (a complaint chip marks the choice and clears the others). */
function withChanges(f, ch) {
  const next = { ...f }
  for (const [k, v] of Object.entries(ch)) {
    if (k === 'years') Object.assign(next, { years: v, complainSet: true, keepComplain: false, useReceiptComplain: false })
    else if (k === 'useReceiptComplain') Object.assign(next, { useReceiptComplain: v, complainSet: true }, v ? { keepComplain: false } : {})
    else if (k === 'keepComplain') Object.assign(next, { keepComplain: v, complainSet: true })
    else next[k] = v
  }
  return next
}
for (const [name, [item, changes, extra]] of Object.entries(S.boughtScenarios)) {
  let f = P.purchaseFormOf(item, S.ctx)
  if (extra?.receipt) f = P.withReceiptOnForm(f, extra.receipt.fill, extra.receipt.read, f.day, S.ctx.today)
  f = withChanges(f, changes)
  const got = P.purchaseWrite(item, f, P.purchaseView(item, f, S.ctx))
  check(`${name}: Just bought writes what it wrote`, same(got, want.bought[name]) || INTENDED[name], JSON.stringify({ got, want: want.bought[name] }))
}
{
  // The one stated difference of adding: a thing you own being added may carry its purchase facts — only what the owner set
  // (guardian B1 + critic, 24.11.2026: never a date worked out from facts typed on the same screen).
  const item = S.row({ id: '', bought_at: '2026-11-20T11:00:00.000Z', platform: 'Elkjøp', category_id: 'c3' })
  const seed = P.purchaseFormOf(item, S.ctx)
  const at = (f, it = item) => P.purchaseAtCreate(f, P.purchaseView(it, f, S.ctx), seed)
  const f = { ...seed, channel: 'online', note: ' Order 7 ' }
  const got = at(f)
  check('adding with Purchase changed: how it was bought and the note — no return or complaint day the owner did not set, never the day, the store or a price',
    same(got, { bought_channel: 'online', receipt_note: 'Order 7' }), JSON.stringify(got))
  check('adding: Purchase opened and closed (the form as it opened) writes nothing', same(at(seed), {}) && same(P.purchaseAtCreate(null, null, null), {}))
  check('adding: a return day only when the owner set their own; a complaint day only when they chose years, Keep or the receipt\'s',
    same(at({ ...seed, ownReturn: '2026-12-24' }), { return_by: '2026-12-24' })
    && at(withChanges(seed, { years: 5 })).warranty_until === '2031-11-20' && !('warranty_until' in at({ ...seed, note: 'x' })), JSON.stringify(at(withChanges(seed, { years: 5 }))))
  // The form opened while the thing had no category (2 years), then the owner picked Electronics: nothing stale is shown or written.
  const later = { ...item, category_id: 'c2' }
  const shown = P.purchaseView(later, { ...seed, channel: 'in_store' }, S.ctx)
  check('adding: a category picked after the form opened gives the years it suggests now, never stale ones — and writes none',
    seed.years === 2 && shown.years === 5 && shown.complainBy === '2031-11-20' && !('warranty_until' in at({ ...seed, channel: 'in_store' }, later)), JSON.stringify({ seed: seed.years, shown: shown.years }))
  check('adding: a Purchase that does not hold writes nothing (an arrival before the day)', same(at({ ...seed, channel: 'online', arrived: '2026-11-01' }), {}))
  check('purchaseTouched: only the owner\'s choices count, never the day or the store', !P.purchaseTouched({ ...seed, day: '2026-01-01', storePick: 'x' }, seed) && P.purchaseTouched({ ...seed, extra: '2028-01-01' }, seed))
  check('an arrival before the purchase day can\'t be saved (Just bought\'s own check)', P.purchaseWrite(item, { ...f, arrived: '2026-11-01' }, P.purchaseView(item, { ...f, arrived: '2026-11-01' }, S.ctx)) === null)
  check('a purchase day in the future can\'t be saved', P.purchaseWrite(item, { ...f, day: '2027-01-01' }, P.purchaseView(item, { ...f, day: '2027-01-01' }, S.ctx)) === null)
  // The open record's in-place editor: the Facts own the day and the store, so a stale form never writes them back.
  const row = S.row({ platform: 'Power', bought_at: '2026-11-18T11:00:00.000Z' })
  const stale = { ...P.purchaseFormOf(S.row(), S.ctx), day: '2026-11-20', storePick: 'other', otherName: 'Old Shop', channel: 'in_store' }
  const used = P.inPlaceForm(stale, row, S.ctx.today)
  const w = P.purchaseWrite(row, used, P.purchaseView(row, used, S.ctx))
  check('in place: the row\'s own day and no store — a Facts edit made meanwhile is never written back', w && !('bought_at' in w.patch) && !('platform' in w.patch) && w.patch.bought_channel === 'in_store', JSON.stringify(w?.patch))
  // A receipt read in place (or a Facts edit) puts a new day in the record's draft: the deadlines count from it, never from the old one.
  const old = S.row({ platform: 'Power', bought_at: '2026-11-01T11:00:00.000Z' })
  const seen = P.withDraftDayAndStore(old, { bought_day: '2026-11-15' })
  const f2 = P.inPlaceForm({ ...P.purchaseFormOf(old, S.ctx), channel: 'in_store' }, seen, S.ctx.today)
  const fromNew = P.purchaseWrite(seen, f2, P.purchaseView(seen, f2, S.ctx))
  const f3 = P.inPlaceForm({ ...P.purchaseFormOf(old, S.ctx), channel: 'in_store' }, old, S.ctx.today)
  const fromOld = P.purchaseWrite(old, f3, P.purchaseView(old, f3, S.ctx))
  check('in place: a day in the record\'s draft moves the deadlines with it (return by counts from 15.11, not 01.11), still without writing the day',
    fromNew.patch.return_by !== fromOld.patch.return_by && fromNew.patch.return_by > fromOld.patch.return_by && !('bought_at' in fromNew.patch), JSON.stringify([fromNew.patch.return_by, fromOld.patch.return_by]))
  // The saved row's complaint day is the rules' own (counted from its old day): a new day moves it, never keeps it as "your own".
  const fOld = P.purchaseFormOf(old, S.ctx)
  const rulesDay = P.purchaseView(old, fOld, S.ctx).complainBy
  const savedRow = { ...old, warranty_until: rulesDay }
  const moved = P.withDraftDayAndStore(savedRow, { bought_day: '2026-11-15' })
  const fNew = P.inPlaceForm(P.purchaseFormOf(savedRow, S.ctx), moved, S.ctx.today)
  const after = P.purchaseView(moved, fNew, S.ctx, savedRow)
  check('in place: a rules\' complaint day counted from the old day moves with a new day (never kept as "your own")', after.complainBy > rulesDay && !after.complainOwn, JSON.stringify([rulesDay, after.complainBy]))
  check('in place: a store in the record\'s draft is the store the deadlines count with', P.withDraftDayAndStore(old, { platform: 'Elkjøp' }).platform === 'Elkjøp' && P.withDraftDayAndStore(old, {}).platform === 'Power')
  check('in place: no purchase day → no day to count from (the editor says so and its Save waits)', P.withDraftDayAndStore(old, { bought_day: '' }).bought_at === null)
}
{
  // Typed extra costs while adding: each ticked draft on the thing's own day (today when it has none), its sign kept.
  const spec = { preset: 'own' }
  const s = { ...C.blankState(spec, S.CATS, S.TODAY), costs: [{ id: 't:1', kind: 'fee', label: 'Shipping', amount: 99, currency: 'NOK', on: true }, { id: 't:2', kind: 'fee', label: 'Price match', amount: -200, currency: 'NOK', on: true }, { id: 'r:0', kind: 'fee', label: 'Fee', amount: 10, currency: 'EUR', on: false }] }
  const day = C.costsAtSave({ ...s, draft: { ...s.draft, bought_day: '2026-11-02' } }, 'new-id', S.TODAY)
  check('adding: the ticked costs only, on the thing\'s day, money back negative', same(day, [
    { item_id: 'new-id', label: 'Shipping', amount: 99, currency: 'NOK', spent_on: '2026-11-02' }, { item_id: 'new-id', label: 'Price match', amount: -200, currency: 'NOK', spent_on: '2026-11-02' }]), JSON.stringify(day))
  check('adding: no day yet → today', C.costsAtSave(s, 'x', S.TODAY).every(c => c.spent_on === S.TODAY))
  check('adding: a blank draft is clean, and opening Purchase without a change keeps it clean (the receipt hand-off closes it unasked)',
    !C.isDirty(s.costs.length ? C.blankState(spec, S.CATS, S.TODAY) : s) && !C.isDirty({ ...C.blankState(spec, S.CATS, S.TODAY), purchase: P.purchaseFormOf(S.row(), S.ctx), purchaseSeed: P.purchaseFormOf(S.row(), S.ctx) }))
}
{
  // An errand switched to Wishlist hands over everything typed (critic, 24.11.2026): the wish starts where the errand left off.
  const spec = { preset: 'wish', defaults: { title: 'Batteries', platform: 'Jernia', price: 89, currency: 'NOK', url: 'https://example.com/aa', notes: '4 × AA', priority: 'high', plannedDate: '2026-12-01', region: 'NO' } }
  const s = C.blankState(spec, S.CATS, S.TODAY)
  const got = C.inputOf(spec, s, null, S.CATS)
  check('the errand\'s price, link, note, priority, day and region reach the wish it becomes', got.title === 'Batteries' && got.platform === 'Jernia' && got.price === 89 && got.currency === 'NOK'
    && got.url === 'https://example.com/aa' && got.notes === '4 × AA' && got.priority === 'high' && got.planned_date === '2026-12-01' && got.region === 'NO', JSON.stringify(got))
  check('and an errand without them adds nothing (a plain add is as before)', same(C.inputOf({ preset: 'wish' }, C.blankState({ preset: 'wish', defaults: {} }, S.CATS, S.TODAY), null, S.CATS), C.inputOf({ preset: 'wish' }, C.blankState({ preset: 'wish' }, S.CATS, S.TODAY), null, S.CATS)))
}
{
  // Find picture on a saved thing: only the picture, and its Undo writes back exactly the one before.
  const F = require('../src/features/shop/productPicture')
  check('Find picture writes only image_url; Undo writes back the one before (none → null)', same(F.picturePatch('https://example.com/a.jpg'), { image_url: 'https://example.com/a.jpg' })
    && same(F.pictureUndoPatch({ image_url: null }), { image_url: null }) && same(F.pictureUndoPatch({}), { image_url: null }) && same(F.pictureUndoPatch({ image_url: 'https://example.com/old.jpg' }), { image_url: 'https://example.com/old.jpg' }))
}
{
  // The open record's link reader, scan and "Filled in for you": the same mapping as adding, empty fields only, written by the record's Save.
  const A = require('../src/features/shop/components/record/recordAutofill')
  const row = S.row({ title: 'Demo Headphones X5', price: 3490, url: null, image_url: null, facts: { brand: { value: 'Mine', source: 'you', confidence: 'exact' } } })
  const fact = (key, value, origin = 'link') => ({ key, value, source: { origin, label: 'example.com' }, confidence: 'likely', on: true, at: S.NOW })
  const facts = [fact('brand', 'Demo'), fact('model', 'X5')]
  const patch = A.recordAutofillPatch(row, {}, S.CATS, [], { url: 'https://example.com/x5', image: 'https://example.com/x5.jpg', facts })
  check('open: the link and a picture fill empty fields; brand by "you" stays; the model fact is kept for Save', patch.url === 'https://example.com/x5' && patch.image_url === 'https://example.com/x5.jpg'
    && patch.facts.brand.value === 'Mine' && patch.facts.model.value === 'X5' && !('title' in patch) && !('price' in patch), JSON.stringify(patch))
  check('open: nothing new is no change (the row\'s own facts object, so the record is not dirty)', A.recordAutofillPatch(row, {}, S.CATS, [], {}).facts === row.facts)
  const cur = A.recordAutofillPatch(S.row({ currency: 'EUR', fx_nok: 11.5, fx_source: 'manual' }), {}, S.CATS, [], { currency: 'EUR' })
  check('open: the same currency again never drops a typed rate', !('fx_nok' in cur) && !('currency' in cur), JSON.stringify(cur))
}

// ── 2. One body ───────────────────────────────────────────────────────────────
console.log('2. One body')
const SHOP = 'src/features/shop'
const RECORD = `${SHOP}/components/record/`
/** The entry frames: each renders the body and adds nothing of its own. */
const ENTRIES = [`${RECORD}ShopCreate.tsx`, `${RECORD}ShopRecord.tsx`, `${RECORD}JustBought.tsx`]
/** The parts of a thing's screen: only the body (components/record/) imports them. */
const PARTS = ['RecordFacts', 'factKit', 'useProductPicture', 'ShopAutofill', 'ReceiptPhoto', 'FindPicture', 'PurchaseEditor', 'factList']
/** A frame holds no field, picture or finder of its own. */
const FRAME_FORBIDDEN = [/<input\b/, /<select\b/, /<textarea\b/, /\bDateInput\b/, /\bMoneyEditor\b/, /\bToggle\b/, /\bItemThumb\b/, ...PARTS.map(p => new RegExp(`\\b${p}\\b`))]
/** Files outside components/record/ that may import a part, each with its reason. */
const ALLOW = {
  [`${SHOP}/hooks/useProductPicture.ts`]: { parts: ['useProductPicture'], why: 'the module itself' },
  [`${SHOP}/hooks/useShopTidy.ts`]: { parts: ['useProductPicture'], why: 'Tidy up info reads its AI suggestion\'s product page for many things at once, in its own review popup (it writes through updateShopItem with one Undo)' },
  [`${SHOP}/hooks/useReadReceipts.ts`]: { parts: ['useProductPicture'], why: 'Read a receipt sends the owner\'s best picture sites (usePreferredHosts) with the file as a hint; the pictures themselves are read in the body' },
}
/** The quick list's errand sheet: not a thing, so none of the parts. */
const ERRAND = [`${SHOP}/components/ShopItemSheet.tsx`, `${SHOP}/components/ShopItemForm.tsx`]

const importsOf = src => [...src.matchAll(/(?:import|export)\s[^;]*?from\s+'([^']+)'/g), ...src.matchAll(/import\(\s*'([^']+)'\s*\)/g)].map(m => m[1])
const partOf = spec => PARTS.find(p => spec.split('/').pop() === p)

/** Every rule of section 2 over a set of files ({ path: source }); answers the problems. */
function problems(files) {
  const out = []
  for (const e of ENTRIES) {
    const src = files[e]
    if (src == null) { out.push(`${e}: missing`); continue }
    if (!/<RecordBody\b/.test(src)) out.push(`${e}: does not render <RecordBody`)
    for (const re of FRAME_FORBIDDEN) if (re.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))) out.push(`${e}: a frame has ${re.source} of its own`)
  }
  for (const [path, src] of Object.entries(files)) {
    if (!path.startsWith('src/') || path.startsWith(RECORD)) continue
    for (const spec of importsOf(src)) {
      const part = partOf(spec)
      if (!part) continue
      if (ERRAND.includes(path)) { out.push(`${path}: the errand sheet imports ${part}`); continue }
      if (!ALLOW[path]?.parts.includes(part)) out.push(`${path}: imports ${part} outside components/record/`)
    }
  }
  return out
}

function walk(dir, acc = {}) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (/\.(tsx?|mjs|cjs)$/.test(name)) acc[relative(root, p).split('\\').join('/')] = readFileSync(p, 'utf8')
  }
  return acc
}
const files = walk(join(root, 'src'))
const found = problems(files)
check('each entry frame renders <RecordBody and has no field, picture or finder of its own; the parts are imported only by the body (and ALLOW)', found.length === 0, found.join('; '))
check('every ALLOW entry says why and still exists', Object.entries(ALLOW).every(([p, a]) => a.why.length > 10 && p in files))
check('the body is one file with the three modes', /mode: 'open'/.test(files[`${RECORD}RecordBody.tsx`]) && /mode: 'add'/.test(files[`${RECORD}RecordBody.tsx`]) && /mode: 'bought'/.test(files[`${RECORD}RecordBody.tsx`]))
check('the old Just bought sheet is gone (its fields live in the body\'s Purchase editor)', !Object.keys(files).some(p => /JustBoughtSheet\.tsx$/.test(p)))
check('Find picture is in the body for every mode, and nowhere else', /<FindPicture\b/.test(files[`${RECORD}RecordBody.tsx`]) && !Object.entries(files).some(([p, s]) => !p.startsWith(RECORD) && /<FindPicture\b/.test(s)))

// ── 3. Self-test ──────────────────────────────────────────────────────────────
console.log('3. Self-test: a broken copy fails')
const probe = (label, change) => { const copy = { ...files }; change(copy); check(label, problems(copy).length > 0) }
probe('a field copied into a frame fails', f => { f[`${RECORD}JustBought.tsx`] += '\nconst x = <input value="" />' })
probe('a fact list copied into a frame fails', f => { f[`${RECORD}ShopCreate.tsx`] += "\nimport { RecordFacts } from './RecordFacts'" })
probe('a frame that does not render the body fails', f => { f[`${RECORD}ShopRecord.tsx`] = f[`${RECORD}ShopRecord.tsx`].replace(/<RecordBody\b/g, '<Other') })
probe('a part imported by another Shop screen fails', f => { f[`${SHOP}/components/owned/SellSheet.tsx`] += "\nimport { ReceiptPhoto } from '../record/ReceiptPhoto'" })
probe('the picture finder used outside the body fails', f => { f[`${SHOP}/components/WishlistView.tsx`] += "\nimport { useProductPicture } from '../hooks/useProductPicture'" })
probe('the errand sheet taking the autofill fails', f => { f[`${SHOP}/components/ShopItemForm.tsx`] += "\nimport { ShopAutofill } from './record/ShopAutofill'" })

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
