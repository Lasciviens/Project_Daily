#!/usr/bin/env node
/*
 * Verification — Shop's 📷✨: a thing from photos (owner, 25.11.2026: "Take photo/send photo, write a description send to ai, ai
 * asks few questions if needed I answer then it should create a draft of the product with info filled"). The app's half, run
 * against the real modules, and the flow through the harness's `claude` (which runs the REAL function's own input and answer
 * checks on a canned model answer):
 *   1. the app's second check of the answer (featureRules.readProductPhoto): questions OR a draft, what is dropped;
 *   2. AI last: a link and a typed barcode number never reach the AI (photoPlan);
 *   3. the draft as facts "photo + AI" (photoFacts) through the one body's autofill: never over what was typed, in the add
 *      (createDraft) and on a saved thing (recordAutofill), and the call id never saved with the facts;
 *   4. what the Save reports to the learning (photoLearnReport);
 *   5. the flow: questions, then the same photos with the answers, then the draft (the harness's claude);
 *   6. the screen: one body (the button lives in the autofill every mode renders), a short button with its words in its tip,
 *      the photos shrunk for two and never stored, the app's limits the function's.
 * Made-up data only. Run: node scripts/verify-shop-photo.cjs
 */
process.env.TZ = 'Europe/Oslo'
require('sucrase/register')
const fs = require('node:fs'), path = require('node:path')
const R = require('../src/features/ai/claude/photoProductRules')
const PF = require('../src/features/shop/photoFacts')
const A = require('../src/features/shop/autofillModel')
const K = require('../src/features/shop/factsKept')
const C = require('../src/features/shop/components/record/createDraft')
const RA = require('../src/features/shop/components/record/recordAutofill')

let ok = 0, bad = 0
const check = (name, cond, detail) => {
  if (cond) { ok++; console.log('  ✓', name) } else { bad++; console.log('  ✗', name, detail === undefined ? '' : `— ${JSON.stringify(detail)}`.slice(0, 600)) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const root = path.join(__dirname, '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')

const CATS = [{ id: 'c1', name: 'Electronics', parent_id: null }, { id: 'c2', name: 'Headphones', parent_id: 'c1' }, { id: 'c3', name: 'Garden', parent_id: null }]
const SENT = new Set(['c1', 'c2', 'c3'])
const CALL = '7d3c2b1a-0f9e-4d8c-b7a6-5e4d3c2b1a09'
const AT = '2026-11-25T10:00:00.000Z'

console.log('\n1. the app reads the answer again')
const DRAFT = { kind: 'draft', name: 'Demo Headphones X1, black', brand: 'Demo', model: 'X1', category_id: 'c2', condition: 'used', page_urls: ['https://shop.example.com/x1'], page_named: true, searched: true }
let a = R.readProductPhoto(DRAFT, SENT)
check('a draft keeps its name, brand, model, category, condition, pages and "searched"', a?.kind === 'draft' && same(a.draft, { name: DRAFT.name, brand: 'Demo', model: 'X1', category_id: 'c2', condition: 'used', page_urls: DRAFT.page_urls, page_named: true, searched: true }), a)
a = R.readProductPhoto({ ...DRAFT, category_id: 'c-evil', condition: 'broken', page_urls: ['http://shop.example.com/x', 'javascript:alert(1)', 'https://u:p@shop.example.com/x'], name: 'Buy at evil.example', price: 10, currency: 'GBP' }, SENT)
check('a category the app never sent, a condition off the list, a page that is not a plain https link, a name with a host name and a price in a currency the app does not hold are dropped', a?.kind === 'draft' && same(a.draft, { brand: 'Demo', model: 'X1', searched: true }), a)
a = R.readProductPhoto({ ...DRAFT, price: 1299, currency: 'NOK' }, SENT)
check('a price with a currency the app holds is kept', a?.draft.price === 1299 && a.draft.currency === 'NOK', a)
check('a draft with no name, brand or model, an unknown kind and a non-object are nothing', R.readProductPhoto({ kind: 'draft', category_id: 'c2' }, SENT) === null && R.readProductPhoto({ kind: 'both' }, SENT) === null && R.readProductPhoto('x', SENT) === null)
a = R.readProductPhoto({ kind: 'questions', searched: false, questions: [{ question: 'Which colour?', choices: ['Black', 'black', 'Silver', 'www.evil.example'] }, { question: 'See evil.example', choices: ['A', 'B'] }, { question: 'Wired?', choices: ['Yes'] }, { question: 'Box?', choices: ['A', 'B', 'C', 'D', 'E'] }, { question: 'Year?', choices: ['2024', '2025'] }, { question: 'Fourth?', choices: ['A', 'B'] }] }, SENT)
check('questions: distinct plain choices (2–4), no web address, at most 3 questions', a?.kind === 'questions' && same(a.questions, [{ question: 'Which colour?', choices: ['Black', 'Silver'] }, { question: 'Box?', choices: ['A', 'B', 'C', 'D'] }, { question: 'Year?', choices: ['2024', '2025'] }]), a)
check('questions of which none can be used are nothing', R.readProductPhoto({ kind: 'questions', questions: [{ question: 'Q?', choices: ['A'] }] }, SENT) === null)

console.log('\n2. AI last: code first')
const ZW = String.fromCharCode(0x200b), WJ = String.fromCharCode(0x2060)
let plan = R.photoPlan(' see https://shop.example.com/x1, please ')
check('a link in the line goes to the link reader alone (just the link, the words stay), never the AI', plan.kind === 'link' && plan.url === 'https://shop.example.com/x1' && plan.rest === 'see please', plan)
plan = R.photoPlan('www.shop.example.com/x1')
check('a "www." link is read as https', plan.kind === 'link' && plan.url === 'https://www.shop.example.com/x1', plan)
plan = R.photoPlan(`see ht${ZW}tps://shop.example.com/x1`)
check('a link split by a zero-width space, or behind a word joiner, is still a link (cleaned first, as the function does)', plan.kind === 'link' && plan.url === 'https://shop.example.com/x1' && R.photoPlan(`w${WJ}ww.shop.example.com`).kind === 'link' && R.photoPlan('ｗｗｗ.shop.example.com').kind === 'link', plan)
check('a typed barcode number (8–14 digits, spaces or dashes allowed) goes to the barcode lookup', same(R.photoPlan('7 0 4 0 1 2 3 4 5 6 7 8 9'), { kind: 'barcode', code: '7040123456789' }) && same(R.photoPlan('7040-1234'), { kind: 'barcode', code: '70401234' }))
check('words, or nothing typed, go to the AI', R.photoPlan('my old headphones').kind === 'ai' && R.photoPlan('').kind === 'ai' && R.photoPlan('X1 2024').kind === 'ai')
check('an answer holding a link (also split or full-width) is caught before it is sent; plain words are not', R.holdsLink('https://shop.example.com') && R.holdsLink(`h${ZW}ttps://x.example`) && R.holdsLink('ｗｗｗ.x') && !R.holdsLink('Black, 2024 model'))
check('a barcode for the job is digits only, 8–14', R.photoEan('7040123456789') === '7040123456789' && R.photoEan('70401234') === '70401234' && R.photoEan('7040123') === null && R.photoEan('70401234567890123') === null && R.photoEan('7040a23456789') === null && R.photoEan(null) === null)
check('a third photo says: "Two photos at most — remove one first"', R.PHOTO_WORDS.twoAtMost === 'Two photos at most — remove one first')
{
  const prices = { webSearchUsdEach: 0.01, longPromptOverTokens: 200_000, longPromptMultiplier: 2, model: { cacheWrite1hPerMTok: 0.2, outputPerMTok: 0.5 } }
  const job = { instructionsChars: 3000, maxOutputTokens: 1500 }
  const prompt = 3000 + (300 + 3 * 248 + 200) + 120 + 1000 + 2 * R.PHOTO_TOKENS_EACH_WORST
  const one = ((3 * prompt + 3 * 25_000) * 0.2 + 1500 * 0.5) / 1e6 + 2 * 0.01
  const got = R.photoWorstCost(prices, job, 120)
  check('the worst cost on Ask is both calls at the function\'s own worst case (two photos at 2116 tokens each, 3 rounds, 2 searches each)', R.PHOTO_TOKENS_EACH_WORST === 2116 && Math.abs(got - 2 * one) < 1e-6, [got, 2 * one])
}

console.log('\n3. the draft as facts, never over what was typed')
const facts = PF.photoFacts({ name: 'Demo Headphones X1, black', brand: 'Demo', model: 'X1', category_id: 'c2', condition: 'used', price: 1299, currency: 'NOK', searched: true }, CATS, AT, CALL)
check('every fact says "photo + AI + web search" (it searched), is "check" and carries the call id in its source', facts.length === 6 && facts.every(f => f.source.origin === 'photo' && f.source.label === 'photo + AI + web search' && f.confidence === 'check' && f.on && f.source.call === CALL), facts.map(f => [f.key, f.source]))
check('the category fact is the subcategory under its top one (Electronics › Headphones)', same(facts.find(f => f.key === 'category')?.value, { topId: 'c1', subId: 'c2', name: 'Electronics › Headphones' }))
check('without a search the label is "photo + AI"; a category no longer there gives no fact', PF.photoFacts({ name: 'N', category_id: 'gone' }, CATS, AT, null).every(f => f.source.label === 'photo + AI' && f.key !== 'category' && !('call' in f.source)))
{
  const spec = { preset: 'own' }
  let s = C.blankState(spec, CATS, '2026-11-25')
  s = { ...s, draft: { ...s.draft, title: 'My own words', bought_day: '2026-11-20' } }
  const before = C.shopDraftOf(spec, s, CATS)
  const merged = A.mergeFacts(s.facts, 'photo', facts)
  const next = C.withShopPatch(spec, s, CATS, { facts: merged, ...A.fieldsAfter(before, s.facts, merged) })
  check('adding: the name the owner typed stays; the empty category and price are filled from the draft', next.draft.title === 'My own words' && next.draft.category_id === 'c2' && next.draft.price === 1299 && next.draft.currency === 'NOK', next.draft)
  const view = C.shopDraftOf(spec, next, CATS)
  const untick = A.toggleFact(next.facts, 'category', view)
  const after = C.withShopPatch(spec, next, CATS, { facts: untick.facts, ...untick.fields })
  check('adding: unticking the category takes it back out of the field', !after.draft.category_id, after.draft)
  const input = C.inputOf(spec, next, 'c2', CATS)
  check('adding: Save writes the brand, model and condition as facts with the source "photo + AI + web search" — never the call id', input.facts?.brand?.source === 'photo + AI + web search' && input.facts?.model?.value === 'X1' && input.facts?.condition?.value === 'used' && !JSON.stringify(input).includes(CALL), input.facts)
  check('factsToSave never writes the call id', !JSON.stringify(K.factsToSave(facts, C.shopDraftOf(spec, next, CATS))).includes(CALL))
}
{
  const item = { id: 'i1', title: 'Saved name', category_id: null, image_url: null, url: null, price: 999, currency: 'NOK', status: 'bought', list: 'wishlist', kind: 'item', priority: 'medium', facts: { brand: { value: 'Mine', source: 'you', confidence: 'exact' } }, updated_at: AT }
  const patch = RA.recordAutofillPatch(item, {}, CATS, [], { facts: A.mergeFacts([], 'photo', facts), ...A.fieldsAfter(RA.recordShopDraft(item, {}, CATS, []), [], facts) })
  check('a saved thing: its name and price stay (what the row holds counts as typed); the empty category is filled', !('title' in patch) && !('price' in patch) && patch.category_id === 'c2', patch)
  check('a saved thing: a brand the owner typed (source "you") is never replaced; the model and condition come in as facts', patch.facts?.brand?.value === 'Mine' && patch.facts?.model?.value === 'X1' && patch.facts?.condition?.source === 'photo + AI + web search', patch.facts)
}

console.log('\n4. the Save reports what it kept (Developer → AI → Learned)')
{
  const kept = facts.map(f => (f.key === 'condition' ? { ...f, on: false } : f))
  const rep = PF.photoLearnReport(kept, { title: 'Demo Headphones X1', category_id: 'c2', facts: { brand: { value: 'Demo', source: 'photo + AI', confidence: 'check' }, model: { value: 'X1', source: 'you', confidence: 'exact' } } })
  check('the report names the call and the saved name, brand, model, category and condition; an unticked fact is named by its learn field', same(rep, { callId: CALL, saved: { name: 'Demo Headphones X1', brand: 'Demo', model: 'X1', category_id: 'c2', condition: '' }, unticked: ['condition'] }), rep)
  check('no fact of a photo draft: nothing to report', PF.photoLearnReport(A.mergeFacts([], 'link', []), { title: 'x', category_id: null }) === null && PF.photoLearnReport(PF.photoFacts({ name: 'N' }, CATS, AT, null), { title: 'x', category_id: null }) === null)
  check('the learn spec takes the same field names the report sends', /PHOTO_FIELDS = \{ name: .*brand: .*model: .*category_id: .*condition:/.test(read('supabase/claude-src/learn-specs.ts')))
}

;(async () => {
  console.log('\n5. the flow through the harness: questions, then the same photos with the answers, then the draft')
  const { claudeMock } = require('./harness/claude.cjs')
  const store = { ownerId: '00000000-0000-4000-8000-000000000001', tables: { ai_calls: [], ai_settings: [], ai_job_settings: [] } }
  const claude = claudeMock()
  // A tiny but header-correct JPEG, as the function reads it.
  const jpeg = (w, h) => ({ media_type: 'image/jpeg', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0x00, 0x11, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xda, 0, 12, ...new Array(200).fill(7)]).toString('base64') })
  const photos = [jpeg(1280, 960), jpeg(960, 1280)]
  const categories = [{ id: 'c1', path: 'Electronics' }, { id: 'c2', path: 'Electronics / Headphones' }]
  const first = await claude({ body: { action: 'run', job: 'product_photo', input: { images: photos, text: 'my headphones', categories } }, store })
  const q = R.readProductPhoto(first.result, new Set(['c1', 'c2']))
  check('the first call asks: questions with choices, through the real function\'s check, and it is ledgered', first.ok && q?.kind === 'questions' && q.questions.length === 2 && store.tables.ai_calls.length === 1 && store.tables.ai_calls[0].job === 'product_photo', first)
  const second = await claude({ body: { action: 'run', job: 'product_photo', input: { images: photos, text: 'my headphones', categories, answers: [{ question: q.questions[0].question, answer: 'Silver' }] } }, store })
  const d = R.readProductPhoto(second.result, new Set(['c1', 'c2']))
  check('the second call (the same photos and the answers) drafts: the answer is used, the category number maps to the id sent, the page is the search\'s, and it is ledgered too', d?.kind === 'draft' && d.draft.name === 'Demo Headphones X1, silver' && d.draft.category_id === 'c2' && same(d.draft.page_urls, ['https://shop.example.com/demo-headphones-x1']) && d.draft.searched === true && store.tables.ai_calls.length === 2, second)
  const linked = await claude({ body: { action: 'run', job: 'product_photo', input: { images: photos, text: 'https://shop.example.com/x1' } }, store })
  check('a link in the line is refused by the function too (bad_input), before any model', linked.ok === false && linked.reason === 'bad_input', linked)
  const three = await claude({ body: { action: 'run', job: 'product_photo', input: { images: [...photos, photos[0]] } }, store })
  check('three photos are refused (bad_input)', three.ok === false && three.reason === 'bad_input', three)

  console.log('\n6. the screen')
  const body = read('src/features/shop/components/record/RecordBody.tsx')
  const panel = read('src/features/shop/components/autofill/AutofillPanel.tsx')
  const stepUi = read('src/features/shop/components/autofill/ProductPhotoStep.tsx')
  const stepHook = read('src/features/shop/components/autofill/useProductPhotoStep.ts')
  const hooks = read('src/features/ai/claude/hooks/useProductPhoto.ts')
  check('one body, one step: RecordBody holds the ONE step and shows the button and the step in ONE place — the top line beside the switch on a narrow add, else the autofill\'s link row — never in a frame',
    (body.match(/useProductPhotoStep\(/g) ?? []).length === 1 && !/useProductPhotoStep\(/.test(panel)
    && /const photoInBar = !!c && photoOffered && narrow/.test(body) && /inRow: !photoInBar/.test(body) && /photo=\{photoInBar \? photoStep : null\}/.test(body)
    && /\{photo && <PhotoAskButton step=\{photo\} \/>\}/.test(body) && /\{photo && <ProductPhotoPanel step=\{photo\} \/>\}/.test(body)
    && /\{photo\?\.inRow && <PhotoAskButton step=\{photo\.step\} \/>\}/.test(panel) && /\{photo\?\.inRow && <ProductPhotoPanel step=\{photo\.step\} \/>\}/.test(panel)
    && /\(!item\.category_id \|\| !item\.image_url \|\| !item\.facts\?\.brand \|\| !item\.facts\?\.model\)/.test(body)
    && !/PhotoAskButton|ProductPhotoPanel/.test(read('src/features/shop/components/record/ShopCreate.tsx') + read('src/features/shop/components/record/ShopRecord.tsx') + read('src/features/shop/components/record/JustBought.tsx')))
  check('a short button with its own icon (a box with ✨, not the receipt\'s camera), its words in the tip and accessible name, starting with its own word', /<PhotoButton iconOnly bordered multiple icon=\{<PackageAi \/>\}[\s\S]*?tip=\{PHOTO_TIP\}>\s*Photo\s*<\/PhotoButton>/.test(stepUi) && /const PHOTO_TIP = 'Photo — /.test(stepUi) && /<Package aria-hidden \/>/.test(stepUi))
  check('the step\'s buttons are one word each (Ask with the most both calls can cost, "Ask · ≤ $0.05"), their words in their tips; ✕ sits top-right', /\{worst \? `Ask · \$\{worst\}` : 'Ask'\}/.test(stepUi) && /tip=\{`Ask — /.test(stepUi) && /tip="Fill — [^"]+">Fill<\/Button>/.test(stepUi) && /tip="Skip — [^"]+">Skip<\/Button>/.test(stepUi) && /className="absolute right-1 top-1"/.test(stepUi))
  check('the photos: shrunk for two in one request (≤ 500 KB each, the function takes 700 000 base64 characters), held in memory only, their previews released; a third is refused in words', R.PRODUCT_PHOTO_MAX_BYTES * 4 / 3 <= 700_000 && /shrinkPhoto\(p\.file, \{ maxBytes: PRODUCT_PHOTO_MAX_BYTES \}\)/.test(stepHook) && /URL\.revokeObjectURL/.test(stepHook)
    && !/localStorage|sessionStorage|indexedDB|caches\./.test(stepHook + stepUi) && /logPayload: false,\s*mutationFn: input => productFromPhotos\(input\)/.test(hooks) && /setProblem\(PHOTO_WORDS\.twoAtMost\)/.test(stepHook))
  const fnLimits = read('supabase/claude-src/job-product-photo.ts')
  check('the app\'s limits are the function\'s (2 photos, a line of 300, 3 answers of 120, questions of 120, choices of 40)', /photos: 2,/.test(fnLimits) && /text: 300, answers: 3, answer: 120, question: 120, questions: 3, choices: 4, choiceMin: 2, choice: 40/.test(fnLimits) && same(R.PRODUCT_PHOTO_LIMITS, { photos: 2, text: 300, answers: 3, answer: 120, question: 120, choice: 40 }))
  check('the draft fills only through the autofill\'s facts (mergeFacts + fieldsAfter), labelled, and a page gives the picture only through useProductPicture (shop-price) while the field is empty',
    /addFacts\('photo', photoFacts\(/.test(panel) && /readPicture\(d\.page_urls/.test(panel) && /if \(fact && !latest\.current\.image\) latest\.current\.addFacts\('page', \[fact\]\)/.test(panel) && /Filled from photo \+ AI/.test(stepUi) && /costNote\(/.test(stepUi))
  check('AI last on screen: a link is read alone by the link reader (the photos stay); a typed number, then a barcode the app reads in the photos, goes to the lookup first, and a lookup that filled the thing asks no AI; only a code it did not find goes with the photos, as digits',
    /if \(plan\.kind === 'link' && t\)/.test(stepHook) && /await t\.readLink\(plan\.url\)/.test(stepHook) && /setText\(plan\.rest\)/.test(stepHook)
    && /if \(tried\.current !== plan\.code\) \{ await lookUp\(t, plan\.code\); return \}/.test(stepHook)
    && /await import\('\.\.\/\.\.\/stillBarcode'\)/.test(stepHook) && /if \(code && tried\.current !== code && await lookUp\(t, code\)\) return/.test(stepHook) && /ean\.current = photoEan\(code\)/.test(stepHook)
    && /if \(r\.filled\) \{ filledFree\(r\.note\); return true \}/.test(stepHook) && /lookupEan: async code =>/.test(panel) && /lookUpGroceryEan\(ean\)/.test(panel))
  const still = read('src/features/shop/stillBarcode.ts')
  check('the still photo\'s barcode is read by the app\'s own readers (native BarcodeDetector, else ZXing imported only then), nothing sent anywhere', /BarcodeDetector/.test(still) && /await import\('@zxing\/browser'\)/.test(still) && /decodeFromImageUrl/.test(still) && !/fetch\(|supabase|invoke\(/.test(still))
  check('an answer that is a link is never sent (the function refuses it too)', /if \(answers\.some\(a => holdsLink\(a\.answer\)\)\) \{ setProblem\(PHOTO_WORDS\.answerLink\); return \}/.test(stepHook))
  check('the Save reports what it kept: the add after its write; an open record only at its OWN Save (useShopRecord\'s afterSave), never another write', /photoLearnReport\(s\.facts, row\)/.test(read('src/features/shop/components/record/useCreateRecord.ts'))
    && /onSaved\(row => \{ const report = photoLearnReport\(latest\.current\.facts, row\)/.test(body) && /afterSave\?\.\(saved\)/.test(read('src/features/shop/components/record/useShopRecord.tsx')) && !/setLearnReport|updated_at[^\n]*photoLearnReport/.test(body))

  console.log(`\n${ok} passed, ${bad} failed`)
  process.exit(bad ? 1 : 0)
})().catch(e => { console.log('  ✗ the script crashed:', e && e.stack || e); process.exit(1) })
