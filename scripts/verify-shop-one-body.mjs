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
/** The owner's changes, as the Purchase editor's controls set them (a complaint-years chip clears "keep" and "receipt"). */
function withChanges(f, ch) {
  const next = { ...f }
  for (const [k, v] of Object.entries(ch)) {
    if (k === 'years') Object.assign(next, { years: v, keepComplain: false, useReceiptComplain: false })
    else if (k === 'useReceiptComplain') Object.assign(next, { useReceiptComplain: v }, v ? { keepComplain: false } : {})
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
  // The one stated difference of adding: a thing you own being added may carry its purchase facts — only when the owner opened Purchase.
  const item = S.row({ id: '', bought_at: '2026-11-20T11:00:00.000Z', platform: 'Elkjøp' })
  const f = { ...P.purchaseFormOf(item, S.ctx), channel: 'online', note: ' Order 7 ' }
  const got = P.purchaseAtCreate(f, P.purchaseView(item, f, S.ctx))
  check('adding with Purchase opened: how it was bought, the deadlines and the note — never the day, the store or a price (they are the add\'s own facts)',
    got.bought_channel === 'online' && got.receipt_note === 'Order 7' && typeof got.return_by === 'string' && typeof got.warranty_until === 'string'
    && !('bought_at' in got) && !('platform' in got) && !('price' in got) && !('arrived_on' in got), JSON.stringify(got))
  check('adding with Purchase untouched writes no purchase column', same(P.purchaseAtCreate(null, null), {}))
  check('an arrival before the purchase day can\'t be saved (Just bought\'s own check)', P.purchaseWrite(item, { ...f, arrived: '2026-11-01' }, P.purchaseView(item, { ...f, arrived: '2026-11-01' }, S.ctx)) === null)
  check('a purchase day in the future can\'t be saved', P.purchaseWrite(item, { ...f, day: '2027-01-01' }, P.purchaseView(item, { ...f, day: '2027-01-01' }, S.ctx)) === null)
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
