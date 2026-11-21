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
const usage = (o) => ({ day: '2026-11-02', job: 'item_fill', mode: 'live', model: 'claude-haiku-5-5', calls: 1, failed: 0, input_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, output_tokens: 0, thinking_tokens: 0, cost_usd: 0, ...o })

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
  check('settings: none → defaults', J(R.readSettings(null, d)) === J({ monthly_budget_usd: 5, log_text: true, log_days: 30 }))
  check('settings: odd fields → defaults, a budget of 0 stays 0', J(R.readSettings({ monthly_budget_usd: 0, log_text: 'yes', log_days: 'x' }, d)) === J({ monthly_budget_usd: 0, log_text: true, log_days: 30 }))
  const j = R.readJobSettings([{ job: 'item_fill', enabled: false, max_output_tokens: '2000', monthly_budget_usd: '1' }, { job: '' }, { enabled: true }])
  check('job settings: bad rows skipped, text numbers read', j.length === 1 && j[0].enabled === false && j[0].max_output_tokens === 2000 && j[0].monthly_budget_usd === 1 && j[0].model === null)
  check('jobSettingsOf: none changed → defaults on', R.jobSettingsOf([], 'x').enabled === true && R.jobSettingsOf(j, 'item_fill').enabled === false)
  const dd = R.readDescribe({ configured: 'yes', models: [{ id: 'm' }, { name: 'no id' }], jobs: [{ name: 'a' }, { title: 'no name' }], prices: { checkedOn: 'today' } })
  check('describe: odd fields become empty, never a crash', dd.configured === false && dd.models.length === 1 && dd.models[0].name === 'm' && dd.jobs.length === 1 && dd.jobs[0].title === 'a' && dd.prices.checkedOn === '' && dd.steps.length === 0)
  check('describe: nothing at all', R.readDescribe(undefined).configured === false && R.readDescribe('x').jobs.length === 0)
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

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
