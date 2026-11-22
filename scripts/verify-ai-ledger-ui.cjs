#!/usr/bin/env node
/*
 * Verification — Developer → AI (src/features/ai/claude/ledgerRules.ts) against the real module through
 * sucrase: money, the Oslo month across both clock changes, totals, budget tones, values read as they enter,
 * the function's answer to a run, and the links the page builds.
 *
 *   Run:  node scripts/verify-ai-ledger-ui.cjs
 */
require('sucrase/register')
const R = require('../src/features/ai/claude/ledgerRules')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const J = JSON.stringify
const hours = (r) => (Date.parse(r.to) - Date.parse(r.from)) / 36e5
const usage = (o) => ({ day: '2026-11-02', job: 'item_fill', mode: 'live', model: 'claude-haiku-5-5', calls: 1, failed: 0, input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, thinking_tokens: 0, cost_usd: 0, avg_duration_ms: 0, max_duration_ms: 0, timed_calls: 0, held_calls: 0, held_cost_usd: 0, ...o })

console.log('\nnum')
check('numeric text is read', R.num('0.012300') === 0.0123 && R.num(' 5 ') === 5 && R.num('1e-3') === 0.001)
check('odd input is 0', R.num('abc') === 0 && R.num(null) === 0 && R.num(-3) === 0 && R.num(NaN) === 0 && R.num(Infinity) === 0 && R.num({}) === 0 && R.num('') === 0)

console.log('\nformatUsd')
check('zero', R.formatUsd(0) === '$0.00' && R.formatUsd(undefined) === '$0.00')
check('a dollar and up: two decimals', R.formatUsd(1) === '$1.00' && R.formatUsd(5) === '$5.00' && R.formatUsd(12.345) === '$12.35' || R.formatUsd(12.345) === '$12.34')
check('whole cents: two decimals', R.formatUsd(0.5) === '$0.50' && R.formatUsd(0.03) === '$0.03')
check('below a dollar: four decimals', R.formatUsd(0.0123) === '$0.0123' && R.formatUsd(0.00027) === '$0.0003')
check('rounds up into a dollar', R.formatUsd(0.99999) === '$1.00', R.formatUsd(0.99999))
check('less than a hundredth of a cent', R.formatUsd(0.00001) === '< $0.0001' && R.formatUsd(0.00004) === '< $0.0001')
check('fine shows six decimals', R.formatUsd(0.00027, { fine: true }) === '$0.000270' && R.formatUsd(0.0000004, { fine: true }) === '< $0.000001')
check('numeric text and bad input', R.formatUsd('0.0123') === '$0.0123' && R.formatUsd('x') === '$0.00')

console.log('\ncounts, tokens, duration, prices')
check('formatCount', R.formatCount(1234567) === '1 234 567'.replace(/ /g, ' ') && R.formatCount(12) === '12')
check('formatTokens', R.formatTokens(850) === '850' && R.formatTokens(12345) === '12.3k' && R.formatTokens(250000) === '250k' && R.formatTokens(1250000) === '1.25M')
check('formatDuration', R.formatDuration(850) === '850 ms' && R.formatDuration(1180) === '1.2 s' && R.formatDuration(14000) === '14 s' && R.formatDuration(null) === '' && R.formatDuration(-1) === '')
check('formatPrice', R.formatPrice(0.1) === '$0.10' && R.formatPrice(0.125) === '$0.125' && R.formatPrice(2) === '$2.00')

console.log('\nOslo month')
{
  const nov = R.osloMonthRange(new Date('2026-11-21T12:00:00Z'))
  check('November: 720 hours, from the 1st to the 30th', hours(nov) === 720 && nov.firstDay === '2026-11-01' && nov.lastDay === '2026-11-30' && nov.today === '2026-11-21', J(nov))
  check('November starts at midnight Oslo (23:00 UTC the day before)', nov.from === '2026-10-31T23:00:00.000Z' && nov.to === '2026-11-30T23:00:00.000Z', J(nov))
  const mar = R.osloMonthRange(new Date('2026-03-15T12:00:00Z'))
  check('March 2026 (clock goes forward) is 743 hours', hours(mar) === 743, String(hours(mar)))
  check('March starts at +01:00 and ends at +02:00', mar.from === '2026-02-28T23:00:00.000Z' && mar.to === '2026-03-31T22:00:00.000Z', J(mar))
  const oct = R.osloMonthRange(new Date('2026-10-15T12:00:00Z'))
  check('October 2026 (clock goes back) is 745 hours', hours(oct) === 745, String(hours(oct)))
  const dec = R.osloMonthRange(new Date('2026-12-31T23:30:00Z'))
  check('31.12 at 23:30 UTC is already 1 January in Oslo; the year turns', dec.today === '2027-01-01' && dec.firstDay === '2027-01-01' && dec.to === '2027-01-31T23:00:00.000Z', J(dec))
  const feb = R.osloMonthRange(new Date('2028-02-10T12:00:00Z'))
  check('a leap February ends on the 29th', feb.lastDay === '2028-02-29' && hours(feb) === 696, J(feb))
  check('the last minute of a month stays in it', R.osloMonthRange(new Date('2026-11-30T22:59:00Z')).firstDay === '2026-11-01' && R.osloMonthRange(new Date('2026-11-30T23:00:00Z')).firstDay === '2026-12-01')
  check('osloDay', R.osloDay(new Date('2026-06-30T22:30:00Z')) === '2026-07-01' && R.osloDay(new Date('2026-06-30T21:30:00Z')) === '2026-06-30')
  check('daysBetween', J(R.daysBetween('2026-02-27', '2026-03-02')) === J(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']) && R.daysBetween('x', '2026-01-01').length === 0 && R.daysBetween('2026-01-02', '2026-01-01').length === 0)
}

console.log('\ntotals')
{
  const rows = [
    usage({ day: '2026-11-01', job: 'a', calls: 2, failed: 1, cost_usd: 0.1, input_tokens: 10 }),
    usage({ day: '2026-11-01', job: 'b', calls: 5, cost_usd: 0.1 }),
    usage({ day: '2026-11-03', job: 'a', calls: 1, cost_usd: 0.2, cache_read_tokens: 7 }),
    usage({ day: '2026-11-03', job: 'c', calls: 1, cost_usd: 0.3 }),
  ]
  const all = R.usageTotals(rows)
  check('usageTotals adds up, money without float dust', all.calls === 9 && all.failed === 1 && all.input_tokens === 10 && all.cache_read_tokens === 7 && all.cost_usd === 0.7, J(all))
  check('no rows is all zero', R.usageTotals([]).cost_usd === 0 && R.usageTotals([]).calls === 0)
  const byJob = R.totalsByJob(rows)
  check('by job: dearest first, then most used, then name', J(byJob.map(j => j.job)) === J(['a', 'c', 'b']) && byJob[0].calls === 3 && byJob[0].cost_usd === 0.3, J(byJob.map(j => [j.job, j.cost_usd])))
  check('a tie in cost goes to the most calls, then the name', J(R.totalsByJob([usage({ job: 'x', calls: 1, cost_usd: 1 }), usage({ job: 'y', calls: 3, cost_usd: 1 }), usage({ job: 'a', calls: 3, cost_usd: 1 })]).map(j => j.job)) === J(['a', 'y', 'x']))
  const byDay = R.totalsByDay(rows, ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'])
  check('by day: every day in order, a quiet day is zero', byDay.length === 4 && byDay[1].calls === 0 && byDay[1].cost_usd === 0 && byDay[0].calls === 7 && byDay[2].cost_usd === 0.5 && byDay[3].day === '2026-11-04', J(byDay.map(d => [d.day, d.calls])))
  check('a day outside the list is left out', R.totalsByDay(rows, ['2026-11-03']).length === 1)
}

console.log('\ncache and call cost')
{
  const prices = { checkedOn: '', source: '', longPromptOverTokens: 0, longPromptMultiplier: 5, batchMultiplier: 0.5, models: [{ model: 'm', inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheWrite5mPerMTok: 1.25, cacheWrite1hPerMTok: 2 }] }
  const e = R.cacheEffect([usage({ model: 'm', cache_read_tokens: 1_000_000, cache_write_tokens: 1_000_000 }), usage({ model: 'unknown', cache_read_tokens: 500 })], prices)
  check('saved, extra, net; a model without a price counts nothing but its tokens', e.saved === 0.9 && e.extra === 0.25 && e.net === 0.65 && e.readTokens === 1_000_500, J(e))
  check('net can be below zero', R.cacheEffect([usage({ model: 'm', cache_write_tokens: 1_000_000 })], prices).net === -0.25)
  check('a batch counts at the batch share', R.cacheEffect([usage({ model: 'm', mode: 'batch', cache_read_tokens: 1_000_000 })], prices).saved === 0.45)
  check('callCost', R.callCost(prices.models[0], { input: 1000, output: 1000 }) === 0.006 && R.callCost(prices.models[0], { input: 1_000_000 }, 5) === 5)
}

console.log('\nbudgetProgress')
{
  const at = (s, b) => R.budgetProgress(s, b)
  check('under 80 %: ok, success', at(3.9, 5).state === 'ok' && at(3.9, 5).tone === 'success')
  check('from 80 %: near, warn', at(4, 5).state === 'near' && at(4, 5).tone === 'warn' && at(4, 5).percent === 80)
  check('at the budget: over, danger, nothing left', at(5, 5).state === 'over' && at(5, 5).tone === 'danger' && at(5, 5).left === 0)
  check('past the budget: share held at 1', at(7, 5).share === 1 && at(7, 5).percent === 140)
  check('a budget of 0 is reached at once', at(0, 0).state === 'over' && at(0, 0).share === 1)
  check('left is worked out', at(1.25, 5).left === 3.75 && at(1.25, 5).share === 0.25)
  check('numeric strings go through num', at('4.5', '5').state === 'near' && at('x', '5').state === 'ok')
}

console.log('\ntyped input')
check('readUsdInput', R.readUsdInput('', 50) === null && R.readUsdInput('$5', 50) === 5 && R.readUsdInput('2,5', 50) === 2.5 && R.readUsdInput('51', 50) === undefined && R.readUsdInput('1.234', 50) === undefined && R.readUsdInput('-1', 50) === undefined && R.readUsdInput('abc', 50) === undefined)
check('readIntInput', R.readIntInput('', 1, 90) === null && R.readIntInput('30', 1, 90) === 30 && R.readIntInput('0', 1, 90) === undefined && R.readIntInput('91', 1, 90) === undefined && R.readIntInput('1.5', 1, 90) === undefined)

console.log('\noutcomes')
{
  check('every known outcome has a word and a tone', ['ok', 'refused', 'cut_off', 'invalid', 'error', 'budget', 'off', 'not_configured', 'bad_input'].every(o => R.outcomeMeta(o).known && R.outcomeMeta(o).label))
  const u = R.outcomeMeta('rate_limited')
  check('an unknown outcome shows its own word, grey', !u.known && u.label === 'Rate limited' && u.tone === 'neutral', J(u))
  check('an odd outcome is "Unknown"', R.outcomeMeta('<b>x</b>').label === 'Unknown' && R.outcomeMeta(null).label === 'Unknown' && R.outcomeMeta(7).label === 'Unknown')
}

console.log('\nvalues as they enter')
{
  const u = R.readUsageRows([{ day: '2026-11-01', job: 'item_fill', calls: '3', cost_usd: '0.012300', model: 'm' }, { day: 'bad', job: 'x' }, null, 5, { day: '2026-11-02' }])
  check('usage rows: text numbers read, bad rows skipped', u.length === 1 && u[0].calls === 3 && u[0].cost_usd === 0.0123 && u[0].mode === 'live', J(u))
  check('usage rows: not a list is empty', R.readUsageRows(null).length === 0 && R.readUsageRows({}).length === 0)
  check('a call needs an id and a real time', R.readCall({ id: 'a', created_at: 'nope' }) === null && R.readCall({ created_at: '2026-11-01T10:00:00Z' }) === null && R.readCall(null) === null)
  const c = R.readCall({ id: 'a', created_at: '2026-11-01T10:00:00Z', cost_usd: '0.5', input_tokens: '12', duration_ms: null, outcome: 'ok', request: { big: 1 } })
  check('a call: numbers read, text columns never copied, no duration stays null', c.cost_usd === 0.5 && c.input_tokens === 12 && c.duration_ms === null && !('request' in c) && c.step === 1)
  const t = R.readCallWithText({ id: 'a', created_at: '2026-11-01T10:00:00Z', request: { x: 1 }, response: null, thinking: '' })
  check('a call with text: thinking "" is null', t.request.x === 1 && t.response === null && t.thinking === null)
  const d = { monthlyBudgetUsd: 5, logText: true, logDays: 30 }
  check('settings: none → defaults', J(R.readSettings(null, d)) === J({ monthly_budget_usd: 5, log_text: true, log_days: 30, ai_enabled: true }))
  check('settings: odd fields → defaults, a budget of 0 stays 0', J(R.readSettings({ monthly_budget_usd: 0, log_text: 'yes', log_days: 'x' }, d)) === J({ monthly_budget_usd: 0, log_text: true, log_days: 30, ai_enabled: true }))
  const j = R.readJobSettings([{ job: 'item_fill', enabled: false, max_output_tokens: '2000', monthly_budget_usd: '1' }, { job: '' }, { enabled: true }])
  check('job settings: bad rows skipped, text numbers read', j.length === 1 && j[0].enabled === false && j[0].max_output_tokens === 2000 && j[0].monthly_budget_usd === 1 && j[0].model === null)
  check('jobSettingsOf: none changed → defaults on', R.jobSettingsOf([], 'x').enabled === true && R.jobSettingsOf(j, 'item_fill').enabled === false)
  const dd = R.readDescribe({ configured: 'yes', models: [{ id: 'm' }, { name: 'no id' }], jobs: [{ name: 'a' }, { title: 'no name' }], prices: { checkedOn: 'today' } })
  check('describe: odd fields become empty, never a crash', dd.configured === false && dd.models.length === 1 && dd.models[0].name === 'm' && dd.jobs.length === 1 && dd.jobs[0].title === 'a' && dd.prices.checkedOn === '' && dd.steps.length === 0)
  check('describe: nothing at all', R.readDescribe(undefined).configured === false && R.readDescribe('x').jobs.length === 0)
  check('a row for work code did alone (provider page) is labelled "Read by code, no AI"; any other shows its model id', R.callModelLabel({ provider: 'page', model: 'none' }) === 'Read by code, no AI' && R.callModelLabel({ provider: 'anthropic', model: 'claude-haiku-5-5' }) === 'claude-haiku-5-5')
  check('titles and names fall back to the id', R.jobTitleOf([{ name: 'a', title: 'A job' }], 'a') === 'A job' && R.jobTitleOf([], 'gone') === 'gone' && R.jobTitleOf(undefined, 'z') === 'z' && R.modelNameOf([{ id: 'm', name: 'Model' }], 'm') === 'Model' && R.modelNameOf(undefined, 'q') === 'q')
}

console.log('\nreadRunAnswer')
{
  const ok = R.readRunAnswer({ ok: true, result: { fill: { title: 'x' } }, call: { id: 'c1', cost_usd: '0.01' } })
  check('a result with its call', ok.ok === true && ok.result.fill.title === 'x' && ok.call.id === 'c1' && ok.call.cost_usd === 0.01)
  const known = R.readRunAnswer({ ok: false, reason: 'budget', message: '  Used up.  ' })
  check('a known reason keeps the function\'s sentence', !known.ok && known.reason === 'budget' && known.message === 'Used up.' && known.call === undefined)
  const unknown = R.readRunAnswer({ ok: false, reason: 'martians', message: 'Odd.' })
  check('an unknown reason becomes error, with the sentence', !unknown.ok && unknown.reason === 'error' && unknown.message === 'Odd.')
  const bare = R.readRunAnswer({ ok: false, reason: 'martians' })
  check('no sentence: the fallback for error', !bare.ok && bare.message === R.REASON_FALLBACK.error)
  check('garbage is an error, not a throw', R.readRunAnswer(null).ok === false && R.readRunAnswer('x').ok === false && R.readRunAnswer({ ok: 'true' }).ok === false)
  check('a long sentence is cut', R.readRunAnswer({ ok: false, reason: 'busy', message: 'x'.repeat(1000) }).message.length === 300)
  check('an answer made by code alone says source "page" and has no call; any other source word is ignored', (() => {
    const page = R.readRunAnswer({ ok: true, result: { title: 't' }, source: 'page' })
    const odd = R.readRunAnswer({ ok: true, result: {}, source: 'elsewhere', call: { id: 'c' } })
    return page.ok && page.source === 'page' && page.call === undefined && odd.ok && odd.source === undefined && odd.call.id === 'c'
  })())
}

console.log('\nrecipeAnswers (the recipe jobs\' answers, read again in the browser)')
{
  const A = require('../src/features/ai/claude/recipeAnswers')
  const good = { title: 'Pancakes', servings: 4, instructions: 'Mix.\nFry.', ingredients: [{ name: 'flour', quantity: 2, unit: 'cups', note: null }], macro_estimate: { calories: 250, protein_g: 8, carbs_g: 38, fat_g: 7, sugar_g: 5 }, usedAi: true, language: 'english' }
  check('a good recipe passes unchanged', J(A.readParsedRecipe(good)) === J(good))
  const odd = A.readParsedRecipe({ title: ' Cake ', servings: 'x', instructions: ['a'], usedAi: false, extra: 1, ingredients: [{ name: 5 }, null, { name: 'ok', quantity: -1, unit: 4, note: 'n'.repeat(300) }, { name: 'y'.repeat(200) }, { name: 'egg', quantity: 1e9 }], macro_estimate: { calories: -5, protein_g: '8', carbs_g: 9999, fat_g: 7.4, sugar_g: null } })
  check('hostile values are dropped, never repaired: servings 1, steps none, bad numbers null, long text gone, one extra key never leaves', odd && odd.title === 'Cake' && odd.servings === 1 && odd.instructions === null && odd.usedAi === false
    && J(odd.ingredients) === J([{ name: 'ok', quantity: null, unit: null, note: null }, { name: 'egg', quantity: null, unit: null, note: null }])
    && J(odd.macro_estimate) === J({ calories: null, protein_g: null, carbs_g: null, fat_g: 7, sugar_g: null }) && !('extra' in odd), J(odd))
  check('no title, no ingredient, or something that is not an object is no recipe', A.readParsedRecipe({ ingredients: [{ name: 'a' }] }) === null && A.readParsedRecipe({ title: 'x', ingredients: [] }) === null && A.readParsedRecipe({ title: 'x', ingredients: [{ name: 5 }] }) === null && A.readParsedRecipe(null) === null && A.readParsedRecipe([good]) === null && A.readParsedRecipe('x') === null)
  check('a recipe is English unless the function says its language is the page\'s (code read it, no model)', A.readParsedRecipe({ ...good, language: undefined }).language === 'english' && A.readParsedRecipe({ ...good, language: 'source' }).language === 'source' && A.readParsedRecipe({ ...good, language: 'Turkish' }).language === 'english')
  check('a recipe is a model\'s unless it says otherwise only with usedAi false', A.readParsedRecipe({ ...good, usedAi: undefined }).usedAi === true && A.readParsedRecipe({ ...good, usedAi: 'no' }).usedAi === true)
  check('the macros job needs all five values, whole, in range', J(A.readMacroEstimate({ calories: 310.4, protein_g: 11, carbs_g: 52, fat_g: 6, sugar_g: 4 })) === J({ calories: 310, protein_g: 11, carbs_g: 52, fat_g: 6, sugar_g: 4 })
    && A.readMacroEstimate({ calories: 310, protein_g: 11, carbs_g: 52, fat_g: 6 }) === null && A.readMacroEstimate({ calories: 310, protein_g: 11, carbs_g: 52, fat_g: 6, sugar_g: -1 }) === null && A.readMacroEstimate({}) === null && A.readMacroEstimate(5) === null)
}

console.log('\nlog parts')
{
  const p = R.logParts({ model: 'claude-haiku-5-5', instructions: 'a\nb', answer_schema: { type: 'object' }, empty: '', none: null })
  check('short values beside their label, long and objects as blocks, empty dropped', p.length === 3 && p[0].block === false && p[1].block === true && p[2].block === true && p[2].label === 'answer schema', J(p))
  check('a plain string is one block; nothing is none', R.logParts('hello').length === 1 && R.logParts('hello')[0].block === true && R.logParts(null).length === 0 && R.logParts('').length === 0)
  check('a text-block list reads as its words', R.logParts({ text: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] })[0].text === 'one\n\ntwo')
  const circular = {}; circular.self = circular
  check('a value that can\'t be written as JSON does not throw', R.logParts({ x: circular }).length === 1)
}

console.log('\nlinks')
check('sourceUrl: a plain repo path', R.sourceUrl('supabase/claude-src/run.ts') === 'https://github.com/Lasciviens/Project_Daily/blob/main/supabase/claude-src/run.ts')
check('sourceUrl refuses odd input', ['../etc/passwd', 'a/../b', '/abs', 'a//b', 'https://evil.example.com/x', 'a b', 'a?x=1', 'a#b', '', 'javascript:alert(1)', '.hidden', 'a'.repeat(300)].every(f => R.sourceUrl(f) === null))
check('priceSourceUrl: https on Anthropic\'s own hosts', R.priceSourceUrl('https://platform.claude.com/docs/en/about-claude/pricing') === 'https://platform.claude.com/docs/en/about-claude/pricing')
check('priceSourceUrl refuses odd input', ['http://platform.claude.com/x', 'https://platform.claude.com.evil.example.com/x', 'https://evil.example.com/platform.claude.com', 'https://user:pw@platform.claude.com/x', 'https://platform.claude.com:8443/x', 'javascript:alert(1)', 'platform.claude.com', '', 'https://claude.com@evil.example.com/'].every(s => R.priceSourceUrl(s) === null))

console.log('\nDiagnose: the answer as it enters')
{
  const step = (name, ok, ms, detail = 'A sentence.') => ({ name, title: name, ok, ms, detail })
  const good = [step('network_key', true, 400), step('request_shape', true, 380), step('tiny_answer', true, 1200), step('fill_request', true, 48000)]
  const read = R.readDiagnoseAnswer({ ok: true, steps: good })
  check('four steps are read in order, with their fields', read.ok && read.steps.length === 4 && read.steps[3].ms === 48000 && read.steps[0].ok === true, J(read))
  check('a step with an unknown name or no ok is dropped; none left is an error', R.readDiagnoseAnswer({ ok: true, steps: [{ name: 'x', ok: true }, { name: 'tiny_answer' }] }).ok === false && R.readDiagnoseAnswer({ ok: true }).ok === false)
  check('odd values are held: ms from text, negative to 0, a long detail cut', (() => { const r = R.readDiagnoseAnswer({ ok: true, steps: [{ name: 'tiny_answer', ok: false, ms: '1500', detail: 'x'.repeat(900) }, { name: 'fill_request', ok: true, ms: -5, detail: 3 }] }); return r.ok && r.steps[0].ms === 1500 && r.steps[0].detail.length === 500 && r.steps[1].ms === 0 && r.steps[1].detail === '' })())
  const busy = R.readDiagnoseAnswer({ ok: false, reason: 'busy', message: 'Diagnose already ran in the last minute.' })
  check('busy keeps the function\'s sentence; any other reason is an error; no sentence gets ours', !busy.ok && busy.reason === 'busy' && busy.message === 'Diagnose already ran in the last minute.' && R.readDiagnoseAnswer({ ok: false, reason: 'weird' }).reason === 'error' && R.readDiagnoseAnswer(null).message.length > 10)

  console.log('\nDiagnose: the verdict')
  const v = (...steps) => { const r = R.diagnoseVerdict(steps); return { ...r, text: r.text.replace(/\u00a0/g, ' ') } }
  const net = (ok, ms = 400, detail = 'The list.') => step('network_key', ok, ms, detail)
  const shape = (ok, ms = 380, detail = 'The count.') => step('request_shape', ok, ms, detail)
  const tiny = (ok, ms = 1200, detail = 'The tiny one.') => step('tiny_answer', ok, ms, detail)
  const fill = (ok, ms, detail = 'The fill.') => step('fill_request', ok, ms, detail)
  let x = v(net(false, 20000, 'Listing the models failed after 20.0 s: Anthropic did not answer within 20 seconds.'))
  check('step 1 failed: "could not be reached from the server", the detail, danger', x.tone === 'danger' && /^Anthropic could not be reached from the server/.test(x.text) && x.text.includes('within 20 seconds'), J(x))
  x = v(net(true), shape(false, 300, 'Counting the tokens failed (HTTP 400): the answer shape is refused.'))
  check('step 2 failed: the network works, Anthropic did not accept ✨\'s request, danger', x.tone === 'danger' && /^The network and key work, but Anthropic did not accept ✨’s request/.test(x.text) && x.text.includes('HTTP 400'), J(x))
  x = v(net(true), shape(true), tiny(false, 20000, 'A tiny answer did not come back.'))
  check('step 3 failed: even a tiny answer did not come back, danger', x.tone === 'danger' && /but even a tiny answer did not come back/.test(x.text), J(x))
  x = v(net(true), shape(true), tiny(true, 1200), fill(true, 48000))
  check('✨ took 48 s against a tiny 1.2 s: the answer form is the slow part, over the 30 s limit, warn', x.tone === 'warn' && x.text.includes('a tiny answer came in 1.2 s') && x.text.includes('✨’s request took 48 s') && x.text.includes('the answer form is the slow part') && x.text.includes('over ✨’s 30 s limit'), J(x))
  x = v(net(true), shape(true), tiny(true, 1200), fill(true, 12000))
  check('12 s is slow against 1.2 s but under 30 s: still the form, without the limit remark, warn', x.tone === 'warn' && x.text.includes('answer form is the slow part') && !x.text.includes('30 s limit'), J(x))
  x = v(net(true), shape(true), tiny(true, 1500), fill(true, 2400))
  check('✨ in 2.4 s: everything answers in time, success', x.tone === 'success' && x.text.includes('2.4 s') && x.text.includes('everything answers in time'), J(x))
  x = v(net(true), shape(true), tiny(true, 20000), fill(true, 45000))
  check('both slow (tiny 20 s, ✨ 45 s): Anthropic is slow overall, not the form, warn', x.tone === 'warn' && /slow overall/.test(x.text) && !/answer form is the slow part/.test(x.text), J(x))
  x = v(net(true), shape(true), tiny(true, 1200), fill(false, 90000, '✨’s request failed: did not answer within 90 seconds.'))
  check('✨ ran 90 s and failed: says it ran 90 s and then failed, with the detail, danger', x.tone === 'danger' && x.text.includes('ran 90 s and then failed') && x.text.includes('within 90 seconds'), J(x))
  x = v(net(true), shape(true), tiny(true, 1200), fill(false, 800, 'switched off'))
  check('✨ failed quickly: "failed after 0.8 s", danger', x.tone === 'danger' && x.text.includes('failed after 0.8 s'), J(x))
  x = v(net(false, 300, 'claude-haiku-5-5 is NOT in the list.'), shape(true), tiny(true), fill(true, 2000))
  check('haiku missing from the list but the rest works: the network works, the list is not what ✨ needs', x.text.startsWith('The network works, but the list of models is not what ✨ needs'), J(x))
  x = v(net(true), shape(true), tiny(true, 1200))
  check('no fourth step: says ✨\'s own request was not tried, neutral', x.tone === 'neutral' && /was not tried/.test(x.text), J(x))
  check('stepSeconds: one decimal under 10 s, whole seconds above', R.stepSeconds(412).replace(/\u00a0/g, ' ') === '0.4 s' && R.stepSeconds(48250).replace(/\u00a0/g, ' ') === '48 s')
  check('no steps at all: a sentence, not a crash', R.diagnoseVerdict([]).text.length > 10)
  check('every verdict is one line of plain text: no newline', [v(net(false)), v(net(true), shape(false)), v(net(true), shape(true), tiny(true), fill(true, 50000))].every(r => !/\n/.test(r.text)))
}

console.log('\nmigration 195: the times and held calls in ai_usage, the two settings')
{
  const row = (o) => usage({ calls: 2, ...o })
  const u = R.readUsageRows([{ day: '2026-11-01', job: 'item_fill', model: 'm', calls: 5, avg_duration_ms: '1200', max_duration_ms: 9000, timed_calls: '4', held_calls: 1, held_cost_usd: '0.0019' }, { day: '2026-11-02', job: 'old' }])
  check('usage rows read the five new columns, also as text', u[0].avg_duration_ms === 1200 && u[0].max_duration_ms === 9000 && u[0].timed_calls === 4 && u[0].held_calls === 1 && u[0].held_cost_usd === 0.0019, J(u[0]))
  check('a database from before 195 sends none of them: all read as 0 (no crash, no NaN)', u[1].avg_duration_ms === 0 && u[1].timed_calls === 0 && u[1].held_calls === 0 && u[1].held_cost_usd === 0)
  const rows = [
    row({ job: 'a', model: 'claude-haiku-5-5', calls: 4, timed_calls: 4, avg_duration_ms: 1000, max_duration_ms: 2000, cost_usd: 0.004, input_tokens: 100, cache_read_tokens: 300, cache_write_tokens: 100, thinking_tokens: 40 }),
    row({ job: 'a', model: 'claude-haiku-5-5', calls: 2, timed_calls: 2, avg_duration_ms: 4000, max_duration_ms: 9000, cost_usd: 0.002, input_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 50, thinking_tokens: 10 }),
    row({ job: 'a', model: 'claude-sonnet-5-5', calls: 1, timed_calls: 1, avg_duration_ms: 3000, max_duration_ms: 3000, cost_usd: 0.02 }),
    row({ job: 'b', model: 'claude-haiku-5-5', calls: 3, timed_calls: 2, avg_duration_ms: 500, max_duration_ms: 700, cost_usd: 0.0069, held_calls: 1, held_cost_usd: 0.0019 }),
    row({ job: 'c', calls: 2, timed_calls: 0, cost_usd: 0 }),
  ]
  const byJob = Object.fromEntries(R.totalsByJob(rows).map(t => [t.job, t]))
  check('a job\'s average time is weighted by the calls that ran (not an average of averages): (4×1000 + 2×4000 + 1×3000) ÷ 7', R.avgDurationMs(byJob.a) === Math.round(15000 / 7) && byJob.a.max_duration_ms === 9000, J(byJob.a))
  check('a job whose calls all stopped before sending has no average time (null), never 0 ms', R.avgDurationMs(byJob.c) === null)
  check('the average cost leaves the held calls out of both sides: ($0.0069 − $0.0019) ÷ (2 − 1)', R.avgCostUsd(byJob.b) === 0.005 && R.avgCostUsd(byJob.a) === Math.round((0.026 / 7) * 1e6) / 1e6 && R.avgCostUsd(byJob.c) === null, J([R.avgCostUsd(byJob.a), R.avgCostUsd(byJob.b)]))
  const month = R.usageTotals(rows)
  check('the month totals: held calls and what they hold are kept apart from the rest', month.held_calls === 1 && month.held_cost_usd === 0.0019 && month.timed_calls === 9 && month.max_duration_ms === 9000, J(month))
  check('cache hit: cached ÷ (input + cached + written), as a whole percent; null with no prompt', R.cacheHitPercent(byJob.a) === Math.round((300 / 600) * 100) && R.cacheHitPercent(byJob.c) === null && R.cacheHitPercent({ input_tokens: 10, cache_read_tokens: 90, cache_write_tokens: 0 }) === 90)
  const models = R.totalsByModel(rows, 'a')
  check('split by model for one job, the most used first: Haiku 6 calls, Sonnet 1', models.map(m => `${m.model}:${m.calls}`).join() === 'claude-haiku-5-5:6,claude-sonnet-5-5:1', models.map(m => m.model).join())
  check('split by model for the whole month when no job is named', R.totalsByModel(rows).reduce((n, m) => n + m.calls, 0) === 12)
  check('thinking tokens add up per job', byJob.a.thinking_tokens === 50)
  check('a day with no calls has zero for every new field too', (() => { const d = R.totalsByDay(rows, ['2026-11-02', '2026-12-31']); return d[1].timed_calls === 0 && d[1].held_calls === 0 && d[1].max_duration_ms === 0 })())
  const j = R.readJobSettings([{ job: 'a', thinking: 'off' }, { job: 'b', thinking: 'adaptive' }, { job: 'c', thinking: 'maybe' }, { job: 'd' }, { job: 'e', thinking: null }, { job: 'f', thinking: 5 }])
  check('a job\'s thinking: off, adaptive, or null (the default) for anything else or nothing', j.map(x => x.thinking).join() === 'off,adaptive,,,,', j.map(x => x.thinking).join())
  check('no stored row means every default, thinking null', R.jobSettingsOf([], 'x').thinking === null)
  check('the master switch reads false only when it is false: a missing column or odd value is on', R.readSettings({ monthly_budget_usd: 5, ai_enabled: false }, { monthlyBudgetUsd: 5, logText: true, logDays: 30 }).ai_enabled === false && R.readSettings({ monthly_budget_usd: 5 }, { monthlyBudgetUsd: 5, logText: true, logDays: 30 }).ai_enabled === true && R.readSettings({ ai_enabled: 'no' }, { monthlyBudgetUsd: 5, logText: true, logDays: 30 }).ai_enabled === true)
  check('a call still pending has its own word, "In flight", and is not unknown', R.outcomeMeta('pending').known === true && R.outcomeMeta('pending').label === 'In flight')
}

console.log('\nthe cost of one call: each kind of token times its price')
{
  const prices = { checkedOn: '2026-11-20', source: '', longPromptOverTokens: 100000, longPromptMultiplier: 5, batchMultiplier: 0.5, models: [
    { model: 'claude-haiku-5-5', inputPerMTok: 0.10, outputPerMTok: 0.50, cacheReadPerMTok: 0.01, cacheWrite5mPerMTok: 0.125, cacheWrite1hPerMTok: 0.20 },
    { model: 'claude-sonnet-5-5', inputPerMTok: 2, outputPerMTok: 10, cacheReadPerMTok: 0.10, cacheWrite5mPerMTok: 2.5, cacheWrite1hPerMTok: 4 },
  ] }
  const call = (o) => ({ id: 'c', created_at: '2026-11-22T10:00:00Z', run_id: 'r', step: 1, job: 'item_fill', caller: 'app', mode: 'live', provider: 'anthropic', model: 'claude-haiku-5-5', served_model: null, effort: 'low', outcome: 'ok', stop_reason: 'end_turn', error: null, request_id: null, input_tokens: 0, cache_read_tokens: 0, cache_write_5m_tokens: 0, cache_write_1h_tokens: 0, output_tokens: 0, thinking_tokens: 0, long_prompt: false, cost_usd: 0, duration_ms: 1000, instructions_version: 'v', tools: [], ...o })
  // 120 input, 1500 cached, 300 output (100 of it thinking) on Haiku, the numbers of the function's own test.
  const c = call({ input_tokens: 120, cache_read_tokens: 1500, output_tokens: 300, thinking_tokens: 100, cost_usd: 0.000177 })
  const b = R.costBreakdown(c, prices)
  check('one line per kind of token used, each tokens × price ÷ 1 000 000', b.lines.map(l => `${l.key}:${l.tokens}:${l.usd}`).join() === 'input:120:0.000012,cacheRead:1500:0.000015,output:300:0.00015', J(b.lines))
  check('the lines add up to the stored cost, to the ledger\'s six decimals', b.worked === 0.000177 && b.stored === 0.000177 && b.multiplier === 1 && !b.held, J(b))
  check('the output line says how much of it was thinking, and the cached line says it is the instructions', /100 tokens of it thinking/.test(b.lines[2].what) && /instructions/.test(b.lines[1].what) && /your text/.test(b.lines[0].what))
  const w = R.costBreakdown(call({ cache_write_5m_tokens: 2000, cache_write_1h_tokens: 1000, input_tokens: 10, output_tokens: 10, cost_usd: 1 }), prices)
  check('both cache writes are their own lines at their own prices', w.lines.find(l => l.key === 'cacheWrite5m').usd === 0.00025 && w.lines.find(l => l.key === 'cacheWrite1h').usd === 0.0002, J(w.lines))
  const lp = R.costBreakdown(call({ input_tokens: 150000, output_tokens: 1000, long_prompt: true, cost_usd: 0.0775 }), prices)
  check('a long prompt multiplies every line by 5 and says so; 150 000 × 0.10 + 1 000 × 0.50 per million = 0.0155, ×5 = 0.0775', lp.multiplier === 5 && lp.multiplierWhy.join() === 'long prompt ×5' && lp.worked === 0.0775, J(lp))
  const ba = R.costBreakdown(call({ mode: 'batch', input_tokens: 1000000, cost_usd: 0.05 }), prices)
  check('a batch call costs half, and says so', ba.multiplier === 0.5 && ba.worked === 0.05 && ba.multiplierWhy.join() === 'batch ×0.5')
  check('both together multiply: ×2.5', R.costBreakdown(call({ mode: 'batch', long_prompt: true, input_tokens: 1000000 }), prices).multiplier === 2.5)
  // Held at the worst case.
  const held = call({ outcome: 'error', stop_reason: null, cost_usd: 0.00191, duration_ms: 30020 })
  check('a failed call with a cost and no token is held at worst case: no lines, the stored amount is the reservation', R.heldAtWorstCase(held) && R.costBreakdown(held, prices).held && R.costBreakdown(held, prices).lines.length === 0 && R.costBreakdown(held, prices).stored === 0.00191)
  check('a pending call with a reservation is held too', R.heldAtWorstCase(call({ outcome: 'pending', cost_usd: 0.002 })))
  check('a failure with tokens is a real bill, not held; a failure that cost nothing (a refused key) is not held; an answered call never', !R.heldAtWorstCase(call({ outcome: 'error', cost_usd: 0.0001, input_tokens: 10 })) && !R.heldAtWorstCase(call({ outcome: 'error', cost_usd: 0 })) && !R.heldAtWorstCase(call({ outcome: 'ok', cost_usd: 0.001 })) && !R.heldAtWorstCase(call({ outcome: 'budget', cost_usd: 0 })))
  const un = R.costBreakdown(call({ model: 'claude-unknown-9', input_tokens: 10, cost_usd: 0.5 }), prices)
  check('a model with no price in the table shows the stored cost and says it is unpriced', un.unpriced && un.lines.length === 0 && un.stored === 0.5)
  check('prices not loaded yet: the stored cost, no crash', R.costBreakdown(c, undefined).lines.length === 0 && R.costBreakdown(c, undefined).stored === 0.000177)
  check('a stop before sending has no lines and no hold', (() => { const s = R.costBreakdown(call({ outcome: 'budget' }), prices); return s.lines.length === 0 && !s.held && s.stored === 0 })())
  check('a changed price shows up as a difference between the worked and the stored cost', Math.abs(R.costBreakdown(call({ input_tokens: 1000000, cost_usd: 0.2 }), prices).worked - 0.1) < 1e-9)
}

console.log('\nthe AI views: four, with Learn holding three')
{
  const B = require('../src/features/developer/developerBoards')
  check('four views under the bar', J(B.AI_VIEWS) === J(['overview', 'calls', 'settings', 'learn']) && J(B.AI_LEARN_VIEWS) === J(['how', 'prices', 'bench', 'batches']))
  check('the four labels are short enough for a phone: none over 10 characters', B.AI_VIEWS.every(v => B.AI_VIEW_LABEL[v].length <= 10))
  check('an address names its view; anything else is the Overview', J(B.parseAiLocation(null, null)) === J({ view: 'overview', learn: 'how' }) && B.parseAiLocation('calls', null).view === 'calls' && B.parseAiLocation('nonsense', 'bench').view === 'overview' && B.parseAiLocation('constructor', null).view === 'overview')
  check('Learn names its page; an unknown page is How it works', J(B.parseAiLocation('learn', 'prices')) === J({ view: 'learn', learn: 'prices' }) && B.parseAiLocation('learn', 'x').learn === 'how' && B.parseAiLocation('learn', null).learn === 'how')
  check('the older links ?view=how, ?view=prices and ?view=bench, and the new ?learn=batches, land on their page inside Learn', ['how', 'prices', 'bench'].every(v => J(B.parseAiLocation(v, null)) === J({ view: 'learn', learn: v })) && J(B.parseAiLocation('learn', 'batches')) === J({ view: 'learn', learn: 'batches' }))
  check('the page board of How it works puts Diagnose right after the path of a request, and Gemini\'s leftovers before the jobs', J(B.AI_HOW_BOARD[1]) === J(['status', 'steps', 'diagnose', 'gemini', 'jobs', 'parts', 'rules', 'glossary']) && J(B.AI_HOW_SECTIONS) === J(B.AI_HOW_BOARD[1]))
  check('every board is still counted for the page header\'s one width', B.AI_VIEW_BOARDS.length === 6)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
