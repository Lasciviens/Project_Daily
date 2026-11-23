#!/usr/bin/env node
/*
 * Verification — the AI learning layer's pure rules (migration 204, supabase/claude-src/learn-*.ts), run as they are:
 *   §1 hidden Unicode out until stable, plain text, keys
 *   §2 trust and quarantine: only a plain fact from the owner's own words turns on by itself
 *   §3 the correction diff: the "before" is ours, a saved value passes the job's own field check
 *   §4 rule promotion: three identical corrections, no other value among the recent ones
 *   §5 example selection: knn, mmr diversity, the floor, the case itself never its own example
 *   §6 scoring and the decision rule (noise floor, paired wins, no field worse, tokens +20 %), the tripwire, the judge gate
 *   §7 the specs: rules applied by code through the job's own checks, an answer from rules alone, knowledge blocks
 *   §8 the run's retry note, the source host, the order by source memory
 *
 *   node scripts/verify-ai-learning.cjs
 */
require('sucrase/register')
const T = require('../supabase/claude-src/learn-text.ts')
const P = require('../supabase/claude-src/learn-pick.ts')
const S = require('../supabase/claude-src/learn-score.ts')
const SP = require('../supabase/claude-src/learn-specs.ts')
const D = require('../supabase/claude-src/learn-diff.ts')

let ok = 0, bad = 0
const check = (name, cond, detail) => { if (cond) { ok++; console.log('  ✓', name) } else { bad++; console.log('  ✗', name, detail === undefined ? '' : String(JSON.stringify(detail)).slice(0, 400)) } }
const section = (t) => console.log(`\n${t}`)
const J = JSON.stringify

// ── §1 ──
section('§1 hidden Unicode, plain text, keys')
const zw = '​', rlo = '‮', tag = '󠁁', bom = '﻿', shy = '­', vs = '️'
check('zero-width, text-direction, tag, BOM, soft hyphen and variation selectors are all taken out', T.stripHidden(`Kv${zw}ikk${rlo} Lun${tag}sj${bom}${shy}${vs}`) === 'Kvikk Lunsj', T.stripHidden(`Kv${zw}ikk${rlo} Lun${tag}sj`))
check('the strip repeats until the text is stable (NFKC can uncover more)', T.stripHidden('ﬁne') === 'fine' && T.holdsHidden(T.stripHidden(`a${zw}${zw}b`)) === false)
check('control characters out, line breaks kept for the caller to decide', T.stripHidden('a\u0007b\nc') === 'ab\nc')
check('æ, ø, å, ä and ö stay', T.stripHidden('Blåbærsyltetøy och äpplen, ö') === 'Blåbærsyltetøy och äpplen, ö')
check('a plain line refuses markup, brackets, backticks and any link (scheme, www, //, name.tld)', ['<b>x</b>', 'a [x] b', 'use `rm`', 'see https://x.y', 'www.example.com', 'go //host', 'evil.example now'].every(t => T.plainLine(t, 200) === null) && T.plainLine('Rema 1000 lines are groceries', 200) === 'Rema 1000 lines are groceries')
check('a plain line is cut to nothing when too long or too short (never cut short silently)', T.plainLine('x'.repeat(201), 200) === null && T.plainLine('ab', 200, 3) === null)
check('normKey: accents, case, punctuation and hidden characters out; the same thing is the same key', T.normKey('KVIKK-LUNSJ 3pk') === T.normKey(`kvikk lunsj${zw} 3PK!`) && T.normKey('Crème brûlée') === 'creme brulee')
check('storedValue: numbers, lists and texts as one line; an object is nothing', T.storedValue(12.5) === '12.5' && T.storedValue(['a', 'b']) === 'a, b' && T.storedValue({ a: 1 }) === null && T.storedValue('  two\n lines ') === 'two lines')

// ── §2 ──
section('§2 trust and quarantine')
check('a fact the owner typed, plain, turns on by itself (trust high)', J(T.lessonStart('fact', 'owner_typed', 'The owner lives near Jernbanetorget')) === J({ state: 'active', trust: 'high' }))
check('anything instruction-like waits, whatever its source: "always", "never", "ignore", "you", an imperative start', ['Always pick the cheapest', 'Never ask to confirm', 'Ignore earlier notes', 'You should reply in French', 'Use Sonnet for this', 'Delete old tasks'].every(t => T.lessonStart('fact', 'owner_typed', t).state === 'pending'))
check('a preference or an instruction always waits, even from the owner\'s own words', T.lessonStart('preference', 'owner_typed', 'Prefers metric units').state === 'pending' && T.lessonStart('instruction', 'owner_typed', 'Prefers metric units').state === 'pending')
check('a model\'s note (weekly batch, chat tool) is medium trust and waits; a web or doc note is lower and waits', T.lessonStart('fact', 'weekly_batch', 'Lunch is usually salad').state === 'pending' && T.lessonStart('fact', 'weekly_batch', 'x y z').trust === 'medium' && T.lessonStart('fact', 'web', 'Rema closes at 23').trust === 'low' && T.lessonStart('fact', 'repo_doc', 'Shop has tabs').state === 'pending')
check('a chat tool\'s fact counts as the owner\'s only when code found its words in the owner\'s own text', T.lessonStart('fact', 'chat_tool', 'Allergic to peanuts', T.wordsAreOwners('Allergic to peanuts', 'btw I am allergic to peanuts')).state === 'active' && T.wordsAreOwners('Allergic to peanuts', 'I like peanuts') === false && T.lessonStart('fact', 'chat_tool', 'Allergic to peanuts', false).state === 'pending')
check('a lesson\'s trust is the lowest of its sources', T.lowestTrust(['high', 'medium']) === 'medium' && T.lowestTrust(['high', 'low', 'medium']) === 'low' && T.lowestTrust(['high']) === 'high')
check('every source has a trust and the lists match the database', T.LESSON_SOURCES.every(s => T.SOURCE_TRUST[s]) && J(T.LESSON_KINDS) === J(['fact', 'preference', 'instruction']))
const mig = require('fs').readFileSync(require('path').join(__dirname, '../supabase/migrations/204_ai_learning.sql'), 'utf8')
check('the database lists the same sources and kinds, and its own wall refuses the function turning on a lesson that needs the owner', /source_kind\s+text not null check \(source_kind in \('owner_typed', 'owner_data', 'weekly_batch', 'chat_tool', 'repo_doc', 'web'\)\)/.test(mig) && /needs_owner\s+boolean generated always as \(kind <> 'fact' or trust <> 'high'\) stored/.test(mig) && /only the owner turns this lesson on/.test(mig) && /only the owner turns a rule on/.test(mig))
const splits = Array.from({ length: 2000 }, (_, i) => T.splitOf(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`))
const share = s => splits.filter(x => x === s).length / splits.length
check('the split is stable (same id, same split) and about 60 / 30 / 10', T.splitOf('abc') === T.splitOf('abc') && Math.abs(share('train') - 0.6) < 0.05 && Math.abs(share('test') - 0.3) < 0.05 && Math.abs(share('sealed') - 0.1) < 0.04, [share('train'), share('test'), share('sealed')])

// ── §3 ──
section('§3 the correction diff')
const tidy = SP.learnSpecOf('shop_tidy')
const tidyInput = { item: { name: 'SONY WH1000XM5 HODETELEFON SVART', brand: '', model: '', category: '' }, categories: [{ id: 'c_audio', path: 'Electronics / Audio' }, { id: 'c_misc', path: 'Other' }] }
const ai = tidy.values({ name: 'Sony WH-1000XM5, black', brand: 'Sony', model: 'WH1000XM5', category_id: 'c_misc', searched: true })
check('the AI\'s values are the reviewed fields only (no "searched")', J(Object.keys(ai).sort()) === J(['brand', 'category_id', 'model', 'name']))
let d = D.diffSave(tidy, ai, { name: 'Sony WH-1000XM5, black', brand: 'Sony', model: 'WH-1000XM5', category_id: 'c_audio' }, [], false, tidyInput)
const kinds = Object.fromEntries(d.corrections.map(c => [c.field, c.kind]))
check('kept when equal (case and spaces ignored), edited when different', kinds.name === 'kept' && kinds.brand === 'kept' && kinds.model === 'edited' && kinds.category_id === 'edited', d.corrections)
check('every correction carries the AI value from OUR copy and the match key of the thing\'s name', d.corrections.find(c => c.field === 'model').ai_value === 'WH1000XM5' && d.corrections.every(c => c.match_key === 'sony wh1000xm5 hodetelefon svart'))
d = D.diffSave(tidy, ai, { category_id: 'c_evil', name: 'x'.repeat(500), brand: 'https://evil.example' }, ['model'], false, tidyInput)
check('a saved value that fails the job\'s own check is dropped (a category off the list, too long, a link), never recorded', !d.corrections.some(c => ['category_id', 'name', 'brand'].includes(c.field)) && d.corrections.length === 1 && d.corrections[0].kind === 'unticked', d.corrections)
d = D.diffSave(tidy, ai, {}, [], true, tidyInput)
check('a dismissed answer: every AI field is "dismissed" and the case gets nothing', d.corrections.length === 4 && d.corrections.every(c => c.kind === 'dismissed' && c.saved_value === null) && J(d.final) === '{}')
d = D.diffSave(tidy, ai, { 'items.0.name': 'x', evil_field: 'y', '__proto__': 'z', 'name.1.x': 'q' }, ['constructor'], false, tidyInput)
check('a field the job does not review (or a crafted name) is ignored', d.corrections.length === 0)
const receipt = SP.learnSpecOf('receipt_read')
const rIn = { categories: [{ id: 'k_snack', path: 'Food / Snacks' }, { id: 'k_drink', path: 'Food / Drinks' }] }
const rAi = receipt.values({ store: 'REMA 1000', items: [{ name: 'KVIKK LUNSJ 3PK', category_id: 'k_drink', price: 39 }, { name: 'COLA 1,5L', category_id: 'k_drink' }] })
check('a receipt\'s rows are "items.<n>.<field>" (a price is not reviewed)', rAi['items.0.name'] === 'KVIKK LUNSJ 3PK' && rAi['items.1.category_id'] === 'k_drink' && !('items.0.price' in rAi))
d = D.diffSave(receipt, rAi, { 'items.0.category_id': 'k_snack', 'items.0.name': 'KVIKK LUNSJ 3PK', 'items.41.name': 'x' }, [], false, rIn)
check('a row\'s match key is the line name the AI read; a row past 40 is ignored', d.corrections.find(c => c.field === 'items.0.category_id').match_key === 'kvikk lunsj 3pk' && d.corrections.find(c => c.field === 'items.0.category_id').kind === 'edited' && !d.corrections.some(c => c.field.startsWith('items.41')))
check('the case of a receipt is the lines the owner saved (confirmed), and replay is off (the photo is never kept)', receipt.caseText(null, d.final).includes('KVIKK LUNSJ 3PK') && receipt.replayable === false && receipt.trust === 'owner_confirmed')
check('saveCorrected: kept only is not corrected; any edit, untick or dismiss is', D.saveCorrected([{ kind: 'kept' }]) === false && D.saveCorrected([{ kind: 'kept' }, { kind: 'unticked' }]) === true)

// ── §4 ──
section('§4 rule promotion')
const h = (v, n, key = 'kvikk lunsj 3pk', field = 'items.0.category_id') => Array.from({ length: n }, () => ({ field, match_key: key, saved_value: v, kind: 'edited', state: 'counted' }))
check('three identical corrections of the same field and thing propose a rule (the leaf field, the key, the value, the evidence)', J(D.ruleProposals(receipt, h('k_snack', 3))) === J([{ field: 'category_id', match_key: 'kvikk lunsj 3pk', value: 'k_snack', evidence: 3 }]))
check('two are not enough', D.ruleProposals(receipt, h('k_snack', 2)).length === 0)
check('another value among the recent ten: no rule (the owner is still deciding)', D.ruleProposals(receipt, [...h('k_snack', 3), ...h('k_drink', 1)]).length === 0)
check('an ignored correction does not count, a kept one does not count', D.ruleProposals(receipt, [...h('k_snack', 2), { ...h('k_snack', 1)[0], state: 'ignored' }, { ...h('k_snack', 1)[0], kind: 'kept' }]).length === 0)
check('a field no rule may set (a receipt\'s line name, a date of ✨) never becomes a rule', D.ruleProposals(receipt, h('KVIKK', 5, 'kvikk', 'items.0.name')).length === 0 && D.ruleProposals(SP.learnSpecOf('item_fill'), h('2026-12-01', 5, 'dentist tuesday', 'date')).length === 0)

// ── §5 ──
section('§5 example selection')
const cand = (id, text) => ({ id, input_text: text, output: { name: text } })
const pool = [cand('a', 'Sony WH-1000XM5 headphones black'), cand('b', 'Sony WH-1000XM5 headphones black edition'), cand('c', 'Sony WF-1000XM4 earbuds'), cand('d', 'Philips toaster'), cand('e', 'Bosch drill 18V')]
const q = 'SONY WH1000XM5 headphones'
check('trigram similarity is pg_trgm\'s (1 for the same words, 0 for none, symmetric)', P.trigramSimilarity('abc', 'abc') === 1 && P.trigramSimilarity('abc', 'xyz') === 0 && P.trigramSimilarity('sony a', 'a sony') === P.trigramSimilarity('a sony', 'sony a'))
const knn = P.pickExamples(q, pool, 'knn', 2).map(c => c.id)
const mmr = P.pickExamples(q, pool, 'mmr', 2).map(c => c.id)
check('knn picks the two most similar (two near-copies)', J(knn.sort()) === J(['a', 'b']), knn)
check('mmr keeps the best and then picks a different one over the near-copy', mmr[0] === 'a' || mmr[0] === 'b' ? mmr[1] === 'c' : false, mmr)
check('an unrelated case (below the floor) is never sent, and none / k 0 pick nothing', !P.pickExamples(q, pool, 'knn', 5).some(c => c.id === 'd' || c.id === 'e') && P.pickExamples(q, pool, 'none', 3).length === 0 && P.pickExamples(q, pool, 'mmr', 0).length === 0)
check('the replayed case is never its own example, and k is held to 5', !P.pickExamples(q, pool, 'knn', 3, { exclude: new Set(['a']) }).some(c => c.id === 'a') && P.pickExamples('x', Array.from({ length: 9 }, (_, i) => cand(`z${i}`, 'x')), 'knn', 50).length === 5)

// ── §6 ──
section('§6 scoring, the decision rule, the tripwire')
check('fieldScore: equal after normalising; a number in any form; free text by word overlap; both missing is right', S.fieldScore('Sony', ' sony ', false) === 1 && S.fieldScore('12', '12.0', false) === 1 && S.fieldScore('Sony', 'Bose', false) === 0 && S.fieldScore('Sony WH-1000XM5 black', 'Sony WH 1000XM5 black', true) === 1 && S.fieldScore(null, '', false) === 1 && S.fieldScore('x', null, false) === 0)
check('scoreCase: the mean over the gold fields; no answer is 0', S.scoreCase({ a: 'x', b: 'y' }, { a: 'x', b: 'z' }, new Set()).mean === 0.5 && S.scoreCase({ a: 'x' }, null, new Set()).mean === 0)
check('the noise floor is 1/√(cases × repeats)', Math.abs(S.noiseFloor(25, 4) - 0.1) < 1e-9 && S.noiseFloor(0, 0) === 1)
const per = (vals) => Object.fromEntries(vals.map((v, i) => [`c${i}`, v]))
const setup = (name, vals, field = 0.8, tokens = 1000) => ({ setup: name, perCase: per(vals), perField: { name: field }, tokensPerRequest: tokens, answered: vals.length, failed: 0 })
const n = 32
const champ = setup('champion', Array(n).fill(0.6))
let dc = S.decideChallenger(champ, setup('x', Array(n).fill(0.9), 0.9), 2)
check('a clear win: beats the mean by more than the floor, wins every pair, no field worse, tokens within 20 %', dc.wins === true && dc.pairedWins === n, dc)
dc = S.decideChallenger(champ, setup('x', Array(n).fill(0.65), 0.9), 2)
check('a win inside the noise floor is no win (0.05 < 1/√64 = 0.125)', dc.wins === false && /noise floor/.test(dc.reasons.join()), dc.reasons)
dc = S.decideChallenger(champ, setup('x', Array(n).fill(0.9), 0.5), 2)
check('a field worse by more than the floor: no win, and the field is named', dc.wins === false && /worse on name/.test(dc.reasons.join()), dc.reasons)
dc = S.decideChallenger(champ, setup('x', Array(n).fill(0.9), 0.9, 1300), 2)
check('30 % more tokens: no win', dc.wins === false && /more tokens/.test(dc.reasons.join()), dc.reasons)
dc = S.decideChallenger(champ, setup('x', [...Array(20).fill(0.5), ...Array(12).fill(1)], 0.9), 2)
check('more lost pairs than won (a mean lifted by a few cases): no win', dc.wins === false && /won 12 cases and lost 20/.test(dc.reasons.join()), dc.reasons)
const ss = S.setupScore('champion', [{ caseId: 'a', score: { mean: 1, fields: { 'items.0.category_id': 1 } }, tokens: 100 }, { caseId: 'a', score: null, tokens: 50 }])
check('setupScore: a failed replay counts 0 for its case; list rows count as one field', ss.perCase.a === 0.5 && ss.failed === 1 && 'items.category_id' in ss.perField && ss.tokensPerRequest === 75)
check('tripwire: watch until 20 saves; keep at the baseline; roll back when worse by more than 15 points', S.tripwireVerdict(0.2, 10, 2) === 'watch' && S.tripwireVerdict(0.2, 20, 6) === 'keep' && S.tripwireVerdict(0.2, 20, 8) === 'roll_back')
check('tripwire: clearly worse already before the 20th save rolls back early', S.tripwireVerdict(0.1, 9, 6) === 'roll_back' && S.tripwireVerdict(0.1, 4, 4) === 'watch')
check('the judge gate: only after 10 or more owner decisions with 80 % agreement', S.judgeAllowed(8, 10) === true && S.judgeAllowed(7, 10) === false && S.judgeAllowed(9, 9) === false)

// ── §7 ──
section('§7 the specs: rules by code, answers from rules, knowledge')
const rule = (field, value, key = 'sony wh1000xm5 hodetelefon svart', id = `r_${field}`) => ({ id, field, match_key: key, value })
let ap = SP.applyRules(tidy, { name: 'Sony WH-1000XM5', brand: 'Sny', searched: true }, tidyInput, [rule('brand', 'Sony'), rule('category_id', 'c_audio'), rule('category_id', 'c_evil', 'sony wh1000xm5 hodetelefon svart', 'r_bad'), rule('model', 'X', 'another thing')])
check('a tidy rule sets its field for the same thing only; a category off the sent list is refused', ap.result.brand === 'Sony' && ap.result.category_id === 'c_audio' && J(ap.applied.sort()) === J(['r_brand', 'r_category_id']) && !('model' in ap.result), ap)
check('the answer is a copy (the checked answer is untouched)', (() => { const r = { brand: 'Sny' }; SP.applyRules(tidy, r, tidyInput, [rule('brand', 'Sony')]); return r.brand === 'Sny' })())
check('answer from rules alone only when the owner\'s rules cover every field', tidy.answerFromRules(tidyInput, [rule('brand', 'Sony'), rule('model', 'WH-1000XM5')]) === null && J(tidy.answerFromRules(tidyInput, [rule('brand', 'Sony'), rule('model', 'WH-1000XM5'), rule('name', 'Sony WH-1000XM5'), rule('category_id', 'c_audio')])) === J({ brand: 'Sony', model: 'WH-1000XM5', name: 'Sony WH-1000XM5', category_id: 'c_audio', searched: false }))
const recRes = SP.applyRules(receipt, { items: [{ name: 'KVIKK LUNSJ 3PK', category_id: 'k_drink' }, { name: 'COLA', category_id: 'k_drink' }] }, rIn, [rule('category_id', 'k_snack', 'kvikk lunsj 3pk')])
check('a receipt rule sets the field on every line with that name, and only there', recRes.result.items[0].category_id === 'k_snack' && recRes.result.items[1].category_id === 'k_drink')
const fill = SP.learnSpecOf('item_fill')
const filled = SP.applyRules(fill, { fill: { title: 'Gym', date: '2026-11-24' } }, { text: 'gym tomorrow' }, [rule('date', '2026-12-01', 'gym tomorrow'), rule('place', 'SATS Jernbanetorget', 'gym tomorrow')])
check('✨: a rule never sets a date (the same words mean another day next week), a place it may', filled.result.fill.date === '2026-11-24' && filled.result.fill.place === 'SATS Jernbanetorget')
const guess = SP.learnSpecOf('quick_guess')
const gAll = ['title', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'sugar_g'].map(f => rule(f, f === 'title' ? 'Oatmeal with milk' : '10', 'oatmeal'))
check('quick guess: the whole line from the owner\'s rules (numbers in range), with no model', guess.answerFromRules({ text: 'Oatmeal!' }, gAll)?.calories === 10 && guess.answerFromRules({ text: 'oatmeal' }, [...gAll.slice(0, 5), rule('sugar_g', '99999', 'oatmeal')]) === null)
check('the example block escapes the case\'s text and names the category by its path', (() => { const t = SP.exampleBody(tidy, '<b>x</b> & y', { category_id: 'c_audio', name: 'N' }, tidyInput); return t.includes('&lt;b&gt;x&lt;/b&gt; &amp; y') && t.includes('category: Electronics / Audio') && !t.includes('c_audio') })())
check('keptInput leaves out photos, files and long text values', J(Object.keys(SP.keptInput({ text: 'a', image: 'x', documents: [1], pdf: 'p', big: 'y'.repeat(7000) }))) === J(['text']))
check('every spec\'s fields are field names the database takes, and every rule field is a reviewed field', [...SP.LEARN_SPECS.values()].every(s => Object.keys(s.fields).every(f => /^[a-z_]{1,40}$/.test(f)) && s.ruleFields.every(f => f in s.fields)))
check('the jobs that learn by fields are the reviewed ones', J([...SP.LEARN_SPECS.keys()].sort()) === J(['item_fill', 'quick_guess', 'receipt_read', 'recipe_from_text', 'shop_tidy']))

// ── §8 ──
section('§8 the run\'s retry, source memory, knowledge labels')
const fs = require('fs')
const path = require('path')
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')
const run = read('supabase/claude-src/run.ts')
check('the retry is once, only for our own check\'s refusal, with the check\'s sentence escaped, and never asks the model to grade itself', /attempt\.verdict\.outcome === 'invalid' && attempt\.verdict\.problem/.test(run) && /again\.step = 2/.test(run) && /<check_error>\$\{said\}<\/check_error>/.test(run) && !/grade|rate your|is this correct/i.test(run.match(/export function retryNote[\s\S]*?\n}/)[0]))
check('knowledge reaches the model only as search_result blocks after the cached instructions, never in the system text', /type: 'search_result' as const, source: k\.source, title: k\.title/.test(read('supabase/claude-src/provider-anthropic.ts')) && !/system: \[[^\]]*knowledge/.test(read('supabase/claude-src/provider-anthropic.ts')))
const R = (() => { try { return require('../supabase/claude-src/learn-run.ts') } catch (e) { return { error: e } } })()
if (R.error) check('learn-run loads', false, String(R.error))
else {
  check('a source host is code-parsed: lower case, no www, never a path or a query; anything odd is nothing', R.sourceHostOf('https://WWW.Example.com/recipe?id=1') === 'example.com' && R.sourceHostOf('javascript:alert(1)') === null && R.sourceHostOf('not a link') === null && R.sourceHostOf('https://10.0.0.1/x') === null)
  const ordered = R.orderBySource([{ host: 'a.no' }, { host: 'b.no' }, { host: 'c.no' }], [{ host: 'a.no', ok: 1, fail: 9 }, { host: 'b.no', ok: 9, fail: 0 }]).map(x => x.host)
  check('source memory only orders the candidates it is given (good first, unknown in the middle); it adds none', J(ordered) === J(['b.no', 'c.no', 'a.no']))
  const blocks = R.knowledgeFor(tidy, [cand('a', 'Sony')], [{ id: 'l1', kind: 'preference', text: 'Brands <b>upper</b> case', source_kind: 'owner_typed', approved_at: '2026-11-20T10:00:00Z' }], () => tidyInput)
  check('each knowledge block is labelled with its source (a past case, a lesson with where it came from and the day it was approved) and escaped', blocks.length === 2 && blocks[0].source === 'past case · confirmed by the owner' && /^lesson · from owner typed · approved 20\.11\.2026$/.test(blocks[1].source) && blocks[1].text.includes('&lt;b&gt;'), blocks)
  check('the size bound holds: blocks stop at 6000 characters', R.knowledgeFor(tidy, Array.from({ length: 20 }, (_, i) => cand(`k${i}`, 'z'.repeat(1400))), [], () => null).reduce((s, b) => s + b.text.length, 0) <= 6000)
}

console.log(`\n${ok} passed, ${bad} failed`)
process.exit(bad ? 1 : 0)
