#!/usr/bin/env node
/*
 * Verification — the weekly report's app side (AI phase 3): src/features/ai/claude/reportRules.ts, the Home card's
 * place on the board, the Batches view's place under Learn, the rule that no column the database keeps server-only
 * is ever asked for, and the harness's own copy of the function's report actions. §2: the figures the cards draw
 * (src/features/ai/claude/reportFigures.ts, 25.11.2026): every tile, change and bar is read from the saved figures,
 * never from the model's text, and every saved figure is input.
 *
 *   node scripts/verify-ai-reports-ui.cjs
 */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const R = require('../src/features/ai/claude/reportRules.ts')
const F = require('../src/features/ai/claude/reportFigures.ts')
const B = require('../src/features/developer/developerBoards.ts')
const H = require('../src/features/home/pages/homeBoard.ts')

let ok = 0, bad = 0
const check = (name, cond, detail) => { if (cond) { ok++; console.log('  ✓', name) } else { bad++; console.log('  ✗', name, detail === undefined ? '' : String(JSON.stringify(detail)).slice(0, 400)) } }
const J = JSON.stringify
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')

const ID = 'a1ca5500-0000-4000-8000-000000000001'
const ROW = { id: ID, week_start: '2026-11-16', made_by: 'schedule', status: 'ready', failure: null, content: '**Training**\nThree sessions. A new best.\n\n**Next week**\n1. Keep going.', facts: { a: 1 }, call_id: ID, created_at: '2026-11-22T22:30:00Z', ready_at: '2026-11-23T00:41:00Z', pushed_at: null }

check('readReport keeps a good row and drops what is not one (no id, a bad week, an unknown status)', R.readReport(ROW)?.id === ID && R.readReport({ ...ROW, id: 'x' }) === null && R.readReport({ ...ROW, week_start: 'Monday' }) === null && R.readReport({ ...ROW, status: 'done' }) === null && R.readReport(null) === null && R.readReport('x') === null)
check('only a ready report carries its text, and a text is cut at 6000 characters', R.readReport({ ...ROW, status: 'queued' }).content === null && R.readReport({ ...ROW, content: 'x'.repeat(7000) }).content.length === 6000)
check('a made_by that is not "app" is the schedule; a call id that is not a uuid is none; facts that are not an object are empty', R.readReport({ ...ROW, made_by: 'robot' }).made_by === 'schedule' && R.readReport({ ...ROW, call_id: 'nope' }).call_id === null && J(R.readReport({ ...ROW, facts: [1] }).facts) === '{}')
check('readReports of an answer that is not a list is empty', R.readReports(null).length === 0 && R.readReports({}).length === 0 && R.readReports([ROW, 5, null]).length === 1)
check('the columns the app asks for never include batch_id or claimed_at (the database refuses those to the browser)', !/batch_id|claimed_at/.test(R.REPORT_COLUMNS) && !/select\('\*'\)/.test(read('src/features/ai/claude/reportApi.ts')) && !/batch_id|claimed_at/.test(read('src/features/ai/claude/reportApi.ts').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')))
check('isReportId accepts a uuid only', R.isReportId(ID) && !R.isReportId('../x') && !R.isReportId('') && !R.isReportId(5) && !R.isReportId(`${ID}x`) && !R.isReportId(`<${ID}>`))
check('latestReadyReport: the newest week\'s newest ready report; a queued or failed one never', R.latestReadyReport([{ ...ROW, id: 'a', week_start: '2026-11-09' }, { ...ROW, week_start: '2026-11-16' }, { ...ROW, week_start: '2026-11-23', status: 'queued', content: null }].map(r => ({ ...r, id: r.id === 'a' ? 'a1ca5500-0000-4000-8000-0000000000aa' : r.id })))?.week_start === '2026-11-16' && R.latestReadyReport([]) === null && R.latestReadyReport([{ ...ROW, status: 'failed', content: null }]) === null)
const sections = R.reportSections('Before.\n**Training**\nOne.\nTwo **bold** words.\n\n**Health**\nThree.')
check('reportSections: text before a heading, headed sections, bold marks taken out of paragraphs', J(sections) === J([{ heading: '', lines: ['Before.'] }, { heading: 'Training', lines: ['One.', 'Two bold words.'] }, { heading: 'Health', lines: ['Three.'] }]), sections)
check('reportSections never returns markup as anything but text: a tag stays a string', R.reportSections('**Food**\n<img src=x onerror=alert(1)>')[0].lines[0] === '<img src=x onerror=alert(1)>')
check('reportTeaser: the first sentence of the first section, cut with an ellipsis when long, empty with no text', R.reportTeaser(ROW.content) === 'Three sessions.' && R.reportTeaser('**Food**\n' + 'word '.repeat(60)).endsWith('…') && R.reportTeaser('') === '')
check('the dates are DD.MM.YYYY, the week 16.11.2026 – 22.11.2026 (a Monday and its Sunday, across a month end too)', R.reportDay('2026-11-16') === '16.11.2026' && R.reportWeekLabel('2026-11-16') === '16.11.2026 – 22.11.2026' && R.reportWeekLabel('2026-11-30') === '30.11.2026 – 06.12.2026' && R.reportWeekLabel('x') === 'x')
check('the button\'s answers are plain sentences: queued, already waiting, no data, the function\'s own sentence for a stop', R.reportMakeMessage({ ok: true, queued: true }).ok && /half price/.test(R.reportMakeMessage({ ok: true, queued: true }).message) && /already waiting/.test(R.reportMakeMessage({ ok: true, queued: false, skipped: 'already_queued' }).message) && /no data/i.test(R.reportMakeMessage({ ok: true, queued: false, skipped: 'no_data' }).message) && R.reportMakeMessage({ ok: false, message: 'All AI is switched off.' }).message === 'All AI is switched off.' && R.reportMakeMessage('x').ok === false)
check('the check\'s answers: ready, failed, still waiting, nothing waiting, or the function\'s sentence', /ready/.test(R.reportCheckMessage({ ok: true, ready: 1 }).message) && /ended without/.test(R.reportCheckMessage({ ok: true, failed: 1 }).message) && /still working/.test(R.reportCheckMessage({ ok: true, waiting: 1 }).message) && /Nothing is waiting/.test(R.reportCheckMessage({ ok: true }).message) && R.reportCheckMessage({ ok: false, message: 'No key.' }).ok === false)
check('every status has a label and a tone', ['queued', 'ready', 'failed'].every(s => R.REPORT_STATUS_LABEL[s] && R.REPORT_STATUS_TONE[s]))

const FACTS = { training: { has_data: true, session_count: 3 }, health: { steps: { avg_per_day: 9286 } }, food: { has_data: true, avg_kcal_on_logged_days: 1933, target_kcal: 2200 }, tasks: { has_data: true, done: 1 } }
check('reportSummary is built by code from the saved figures: sessions, steps a day, kcal against the target, tasks done', R.reportSummary(FACTS) === '3 sessions · 9 286 steps a day · 1 933 of 2 200 kcal · 1 task done', R.reportSummary(FACTS))
check('reportSummary leaves out what has no figure, reads nothing but numbers, and is empty for no facts', R.reportSummary({ health: { steps: { avg_per_day: '9286' } }, tasks: { done: 2 } }) === '' && R.reportSummary({}) === '' && R.reportSummary({ training: { has_data: false, session_count: 0 }, food: { has_data: true, avg_kcal_on_logged_days: 1900 } }) === '1 900 kcal' && R.groupDigits(1234567) === '1 234 567')
const real = { week_start: '2026-11-09', made_by: 'schedule', status: 'ready' }
check('Home card shows only in the week after the report week (Monday to Sunday), only for the real report', !R.reportShownOn(real, '2026-11-15') && R.reportShownOn(real, '2026-11-16') && R.reportShownOn(real, '2026-11-22') && !R.reportShownOn(real, '2026-11-23') && !R.reportShownOn({ ...real, made_by: 'app' }, '2026-11-17') && !R.reportShownOn({ ...real, status: 'queued' }, '2026-11-17') && !R.reportShownOn(real, 'x') && R.reportShownOn({ ...real, week_start: '2026-12-28' }, '2027-01-06'))
check('every row says what kind of report it is: the Monday timer, the button redo, a test copy, the week so far', R.reportKindLabel({ made_by: 'schedule', facts: {} }) === 'Monday timer' && /made again/.test(R.reportKindLabel({ made_by: 'schedule', facts: { kind: 'redo' } })) && R.reportKindLabel({ made_by: 'app', facts: { kind: 'so_far' } }) === 'Test · week so far' && R.reportKindLabel({ made_by: 'app', facts: { kind: 'copy' } }) === 'Test copy')
const usd = (n) => `$${n}`
check('the cost: a waiting one is held, a failed one that holds its worst case says likely $0, the others are plain; no ledger row says nothing', R.reportCostNote('queued', 'pending', 0.0013, usd) === '$0.0013 held' && R.reportCostNote('failed', 'error', 0.0013, usd) === '$0.0013 held, likely $0' && R.reportCostNote('failed', 'error', 0, usd) === '$0' && R.reportCostNote('ready', 'ok', 0.0002, usd) === '$0.0002' && R.reportCostNote('ready', undefined, 0, usd) === null && /bills nothing for a failed batch/.test(R.REPORT_HELD_SENTENCE))
check('the figures sent are the saved text, cut at 20000 characters; none saved is empty', R.reportFiguresSent({ sent_text: '<week>x</week>' }) === '<week>x</week>' && R.reportFiguresSent({ sent_text: 'x'.repeat(30000) }).length === 20000 && R.reportFiguresSent({ sent_text: 5 }) === '' && R.reportFiguresSent({}) === '')
check('the button answers name what was made: the real report again, a test copy, the week so far', /real report of last week is made again/.test(R.reportMakeMessage({ ok: true, queued: true, kind: 'redo' }).message) && /test copy/.test(R.reportMakeMessage({ ok: true, queued: true, kind: 'copy' }).message) && /week so far/.test(R.reportMakeMessage({ ok: true, queued: true, kind: 'so_far' }).message))
const cardSrc = read('src/features/home/components/WeeklyReportCard.tsx'), batchSrc = read('src/features/developer/components/ai/AiBatches.tsx')
check('the card shows four figures in one row built by code (reportHeadline from reportTiles only, so Home\'s first download stays small), no change on it, its accessible name carries the week and the figures, and it falls back to the code-built summary cut with Truncate (never a bare line-clamp); it asks reportShownOn', /reportHeadline\(facts\)/.test(cardSrc) && /from '\.\.\/\.\.\/ai\/claude\/reportTiles'/.test(cardSrc) && !/reportFigures|WeeklyReportView|ReportCharts|ReportChange/.test(cardSrc) && /<dl className="flex items-start justify-between/.test(cardSrc) && /aria-label=\{`Open the weekly report, \$\{reportWeekLabel\(shown\.week_start\)\}/.test(cardSrc) && /reportSummary\(shown\.facts\)/.test(cardSrc) && /<Truncate as="p" lines=\{2\}/.test(cardSrc) && !/line-clamp/.test(cardSrc) && /reportSummary\(facts\)/.test(cardSrc) && /reportShownOn\(report, todayStr\(\)\)/.test(cardSrc) && /<ReportHeadline facts=\{shown\.facts\} \/>/.test(cardSrc))
check('Home query reads the scheduled report only', /eq\('made_by', 'schedule'\)/.test(read('src/features/ai/claude/reportApi.ts')))
check('the Batches view: the intro is one short line, a failed row has Try again, every row can show the Figures sent block', /Made Monday 05:00 at/.test(batchSrc) && /Try again/.test(batchSrc) && /Figures sent/.test(batchSrc) && /reportFiguresSent\(report\.facts\)/.test(batchSrc) && /REPORT_HELD_SENTENCE/.test(batchSrc))
check('the report popup shows what the report cost', /useReportCosts/.test(read('src/features/ai/components/WeeklyReportSheet.tsx')) && /at batch price/.test(read('src/features/ai/components/WeeklyReportSheet.tsx')))
check('Batches is the fourth page of Learn, by ?learn=batches (the views under the bar: the four and Learned)', J(B.AI_VIEWS) === J(['overview', 'calls', 'settings', 'learn', 'learned']) && B.AI_LEARN_VIEWS.includes('batches') && B.AI_LEARN_LABEL.batches === 'Batches' && B.parseAiLocation('learn', 'batches').learn === 'batches' && B.parseAiLocation('batches', null).view === 'learn')
check('Home\'s weekly report card is one section on every step (the card is an addition: nothing else was dropped)', H.HOME_SECTIONS.includes('report') && [1, 2, 3, 4].every(s => H.HOME_BOARD && require('../src/shared/ui/pageBoardRules.ts').resolveBoardLayout(H.HOME_BOARD, s) && JSON.stringify(require('../src/shared/ui/pageBoardRules.ts').resolveBoardLayout(H.HOME_BOARD, s)).includes('"report"')) && JSON.stringify(require('../src/shared/ui/pageBoardRules.ts').resolveBoardLayout(H.HOME_BOARD_SPLIT, 2)).includes('"report"'))
const card = read('src/features/home/components/WeeklyReportCard.tsx')
check('the card reads the report id from the address only through isReportId, cleans a bad one, and keeps its room (nothing jumps when it lands; a new id since the card changed height on 25.11.2026)', /isReportId\(asked\)/.test(card) && /n\.delete\('report'\)/.test(card) && /<KeepRoom ids="home:weekly-report-2"/.test(card) && /first="none"/.test(card))
check('the card draws the model\'s text only as text: no dangerouslySetInnerHTML anywhere in the report files', !['src/features/ai/components/WeeklyReportView.tsx', 'src/features/ai/components/ReportCharts.tsx', 'src/features/ai/components/ReportChange.tsx', 'src/features/ai/components/WeeklyReportSheet.tsx', 'src/features/home/components/WeeklyReportCard.tsx', 'src/features/developer/components/ai/AiBatches.tsx'].some(f => /dangerouslySetInnerHTML|innerHTML/.test(read(f))))
check('the report popup is a ModalShell (never a raw dialog) and the card\'s query key is a qk key that is never kept on the device', /<ModalShell/.test(read('src/features/ai/components/WeeklyReportSheet.tsx')) && !/@headlessui\/react/.test(read('src/features/ai/components/WeeklyReportSheet.tsx')) && /'ai-reports'/.test(read('src/shared/query/persistRules.ts')))
check('Home\'s card only reads: it imports no code that runs the function (the first download stays small)', !/from '[^']*(claudeApi|reportActions|useMutationWithFeedback)/.test(read('src/features/ai/claude/reportApi.ts') + read('src/features/ai/claude/hooks/useReports.ts')))
check('the app\'s two buttons are mutations with feedback that name the function\'s sentence, and both refresh the reports and the ledger', /useMutationWithFeedback/.test(read('src/features/ai/claude/hooks/useReportActions.ts')) && (read('src/features/ai/claude/hooks/useReportActions.ts').match(/invalidates: \['aiReports'\]/g) || []).length === 2)

// The harness plays the function's two report actions as the real one answers them.
const { claudeMock } = require('./harness/claude.cjs')
const store = { ownerId: 'o', tables: { ai_calls: [], ai_settings: [], ai_job_settings: [] } }
const mock = claudeMock()
const made = mock({ body: { action: 'report_make' }, store })
check('harness: report_make, with no real report of last week, makes that real report again (made_by schedule, kind redo) and one pending batch ledger row at its worst case', made.ok && made.queued && made.kind === 'redo' && store.tables.ai_reports[0].made_by === 'schedule' && store.tables.ai_reports.length === 1 && store.tables.ai_calls[0].mode === 'batch' && store.tables.ai_calls[0].outcome === 'pending')
check('harness: a second tap while it waits is "already_queued"', mock({ body: { action: 'report_make' }, store }).skipped === 'already_queued')
const checked = mock({ body: { action: 'report_check' }, store })
check('harness: report_check reads it back: ready, and the ledger row is corrected below its worst case at the batch price', checked.ready === 1 && store.tables.ai_reports[0].status === 'ready' && store.tables.ai_calls[0].outcome === 'ok' && store.tables.ai_calls[0].cost_usd < 0.001299)
const off = mock({ body: { action: 'report_make' }, store: { ...store, tables: { ...store.tables, ai_reports: [], ai_settings: [{ ai_enabled: false }] } } })
check('harness: with all AI off the button gets the function\'s sentence', off.ok === false && off.reason === 'off')
check('harness: the seed has a ready report for the newest week, an older one and a failed one, each with a batch ledger row', (() => {
  const t = require('./harness/seed.cjs').buildTables(new Date('2026-11-22T12:00:00Z'))
  return t.ai_reports.length === 3 && t.ai_reports.filter(r => r.status === 'ready').length === 2 && t.ai_reports.every(r => t.ai_calls.some(c => c.id === r.call_id && c.mode === 'batch' && c.job === 'weekly_report'))
})())

// ── §2 The figures the cards draw (reportFigures.ts, reportTiles.ts) ─────────
// The saved figures as week-facts.ts writes them (made-up numbers; the harness uses the same shape).
const WEEK = '2026-11-16'
const FULL = {
  week_start: WEEK, week_end: '2026-11-22', partial: false, unreadable: [], kind: 'scheduled', sent_text: '<week>…</week>',
  training: {
    has_data: true, session_count: 3, previous_weeks_avg_sessions: 2.3, working_sets: 39, volume_kg: 13180, previous_weeks_avg_volume_kg: 10940,
    sessions: [{ date: '16.11.2026', title: 'Leg Day', working_sets: 12, volume_kg: 4820 }, { date: '18.11.2026', title: 'Push A', working_sets: 14, volume_kg: 3950 }, { date: '18.11.2026', title: 'Arms', working_sets: 4, volume_kg: 50 }, { date: '01.01.2020', title: 'Not this week', working_sets: 1, volume_kg: 999 }],
    muscles: [{ muscle: 'chest', sets: 9 }, { muscle: 'quadriceps', sets: 8 }],
    key_lifts: [{ exercise: 'Bench Press', top_set: '85 kg × 3', top_weight_kg: 85, best_before_kg: 80, change: 'new_best' }, { exercise: 'Row', top_set: '70 kg × 8', top_weight_kg: 70, best_before_kg: 72.5, change: 'lower' }, { exercise: 'Squat', top_set: '100 kg × 5', top_weight_kg: 100, best_before_kg: null, change: 'no_history' }],
  },
  health: {
    has_data: true, truncated: false,
    sleep: { nights: 7, avg_hours: 6.79, best_hours: 8, worst_hours: 5.5, previous_avg_hours: 6, under_6h_nights: 1, per_night: [7, 6.5, 5.5, 8, 7, 7.5, 6] },
    steps: { days: 7, avg_per_day: 9286, best_day: 12400, previous_avg_per_day: 6000, per_day: [8200, 10400, 7100, 12400, 9600, 8300, 9002] },
    active_energy: { avg_kcal_per_day: 520, previous_avg_kcal_per_day: 520 },
    resting_heart_rate: { avg_bpm: 56, previous_avg_bpm: 57.5 },
    weight: { latest_kg: 81, change_in_week_kg: -0.5, change_since_before_week_kg: -1 },
  },
  food: { has_data: true, days_logged: 5, avg_kcal_on_logged_days: 1933, avg_protein_g_on_logged_days: 145, target_kcal: 2200, target_protein_g: 140, days_within_10pct_of_kcal_target: 2, days_protein_target_met: 3, avg_water_ml_on_logged_days: 2300, target_water_ml: 2500, kcal_per_day: [2150, 1780, null, 2240, 1610, 1885, null] },
  tasks: { has_data: true, done: 11, done_by_area: [{ area: 'work', count: 6 }, { area: 'personal', count: 3 }], slipped: 2, slipped_titles: ['Renew passport', 'Book dentist'], carried_over_open: 4, created: 9, scheduled_hours_by_area: [{ area: 'work', hours: 14 }, { area: 'training', hours: 4.5 }, { area: 'idle', hours: 0 }] },
}
const TEXT = '**Training**\nYou trained 99 times and lifted 1 kg.\n\n**Health**\nSlept well.\n\n**Food**\nAte.\n\n**Tasks & time**\nBusy.\n\n**Next week**\n1. Rest.\n2. Walk.'
const view = F.reportView(FULL, TEXT, WEEK)
const sec = (k) => view.find(s => s.key === k)
const tile = (k, t) => sec(k)?.tiles.find(x => x.key === t)
const tileKeys = (k) => sec(k).tiles.map(t => t.key)
check('§2 the sections in order: Training, Health, Food, Tasks & time, then Next week (words only)', J(view.map(s => s.key)) === J(['training', 'health', 'food', 'tasks', 'next']) && J(view.map(s => s.title)) === J(['Training', 'Health', 'Food', 'Tasks & time', 'Next week']) && J(sec('next').text) === J(['1. Rest.', '2. Walk.']) && sec('next').tiles.length === 0, view.map(s => s.key))
check('§2 every tile is the saved figure, never the model\'s: the text says 99 sessions and 1 kg, the tiles 3 and 13 180 kg', tile('training', 'sessions').value === '3' && tile('training', 'volume').value === '13 180' && tile('training', 'volume').unit === 'kg' && J(sec('training').text) === J(['You trained 99 times and lifted 1 kg.']))
check('§2 compact (owner-critic, 25.11.2026): two tiles for Training (the working sets are Volume\'s line), four for Health (the active energy is Steps\' line), four for Food and Tasks — never one alone in a row', J(tileKeys('training')) === J(['sessions', 'volume']) && tile('training', 'volume').hint === '39 working sets' && J(tileKeys('health')) === J(['sleep', 'steps', 'resting', 'weight']) && tile('health', 'steps').hint === '520 kcal active' && J(tileKeys('food')) === J(['kcal', 'days', 'protein', 'water']) && J(tileKeys('tasks')) === J(['done', 'slipped', 'older', 'created']))
check('§2 no hint repeats the change or a chart: Sessions has none (never "a week before" for a four-week average), Steps no best day, Calories no target, Sleep only its short nights', tile('training', 'sessions').hint === undefined && !/best day/.test(tile('health', 'steps').hint) && tile('food', 'kcal').hint === undefined && tile('health', 'sleep').hint === '1 night under 6 h' && F.reportView({ health: { has_data: true, sleep: { avg_hours: 7, under_6h_nights: 0 } } }, null, WEEK)[0].tiles[0].hint === undefined)
check('§2 with no steps the active energy keeps a tile of its own; with no volume the working sets do', J(F.reportView({ health: { has_data: true, active_energy: { avg_kcal_per_day: 400, previous_avg_kcal_per_day: 500 } } }, null, WEEK)[0].tiles.map(t => [t.key, t.value, t.change.tone])) === J([['energy', '400', 'warn']]) && J(F.reportView({ training: { has_data: true, working_sets: 12 } }, null, WEEK)[0].tiles.map(t => [t.key, t.value])) === J([['sets', '12']]))
check('§2 training is set against the four weeks before: "+0.7 · +30 %" and "+2 240 kg · +20 %" (the tile shows "+30 %"), up is better (success), named once in the header', J(tile('training', 'sessions').change) === J({ text: '+0.7 · +30 %', short: '+30 %', dir: 'up', tone: 'success', against: 'vs 4-week avg' }) && tile('training', 'volume').change.text === '+2 240 kg · +20 %' && sec('training').against === 'vs 4-week avg', tile('training', 'sessions').change)
check('§2 training\'s chart is the volume by day from the sessions\' own dates (two on Wednesday add up; a session outside the week is left out), its line the session titles', (() => { const c = sec('training').charts[0]; return c.kind === 'days' && J(c.values) === J([4820, null, 4000, null, null, null, null]) && c.texts[2] === '4 000 kg' && c.texts[1] === null && c.summary === 'Leg Day · Push A · Arms' && c.days[0] === 'Mon 16.11.2026' && c.days[6] === 'Sun 22.11.2026' })(), sec('training').charts[0])
check('§2 the key lifts: the top set with a tone badge (new best success, below the best before warn and naming it, first time neutral)', J(sec('training').rows) === J([{ label: 'Bench Press', value: '85 kg × 3', badge: 'New best', tone: 'success' }, { label: 'Row', value: '70 kg × 8', badge: 'Below 72.5 kg', tone: 'warn' }, { label: 'Squat', value: '100 kg × 5', badge: 'First time', tone: 'neutral' }]), sec('training').rows)
check('§2 health against last week: sleep "6 h 47 min" shows "+47 min" (a duration reads as itself), steps "+55 %", a lower resting heart rate is better (success)', tile('health', 'sleep').value === '6 h 47 min' && tile('health', 'sleep').change.text === '+47 min · +13 %' && tile('health', 'sleep').change.short === '+47 min' && tile('health', 'steps').change.text === '+3 286 · +55 %' && tile('health', 'steps').change.short === '+55 %' && tile('health', 'steps').change.tone === 'success' && tile('health', 'resting').change.dir === 'down' && tile('health', 'resting').change.tone === 'success' && tile('health', 'resting').change.text === '-1.5 bpm · -3 %')
check('§2 weight is never good or bad: set against the last weigh-in before the week (the header\'s "vs last week"), neutral, no percent', tile('health', 'weight').value === '81' && J(tile('health', 'weight').change) === J({ text: '-1 kg', short: '-1 kg', dir: 'down', tone: 'neutral', against: 'vs last week' }) && sec('health').against === 'vs last week', tile('health', 'weight'))
check('§2 a change of zero is "no change", neutral', J(F.changeOf(520, 520, { better: 'up', against: 'vs last week' })) === J({ text: 'no change', short: 'no change', dir: 'same', tone: 'neutral', against: 'vs last week' }))
check('§2 health has two day charts side by side: steps and sleep per night, each with last week\'s average as the dashed line, the best day named by its weekday', (() => { const [s, z] = sec('health').charts; return s.key === 'steps' && J(s.values) === J(FULL.health.steps.per_day) && s.reference.value === 6000 && s.reference.label === 'last week' && s.summary === 'best Thu · 12 400 steps' && z.key === 'sleep' && z.texts[0] === '7 h' && z.reference.value === 6 })(), sec('health').charts)
check('§2 food against the targets: calories within 10 % is on target only then (here -12 %: warn), protein at or above it is success, water under it warn; the chart has the target line', tile('food', 'kcal').change.text === '-267 kcal · -12 %' && tile('food', 'kcal').change.tone === 'warn' && tile('food', 'kcal').change.against === 'vs target' && tile('food', 'protein').change.tone === 'success' && tile('food', 'protein').change.text === '+5 g · +4 %' && tile('food', 'water').change.tone === 'warn' && tile('food', 'days').value === '5' && tile('food', 'days').unit === 'of 7' && tile('food', 'days').hint === '2 near target' && sec('food').charts[0].reference.value === 2200 && sec('food').charts[0].reference.label === 'target' && sec('food').charts[0].values[2] === null)
check('§2 a calorie average within 10 % of the target is on target (success)', F.reportView({ ...FULL, food: { ...FULL.food, avg_kcal_on_logged_days: 2050 } }, null, WEEK).find(s => s.key === 'food').tiles[0].change.tone === 'success')
check('§2 tasks: four bare counts in one row (done, slipped, overdue from before the week, created), what they are made of as lines (done by area, the slipped titles); the scheduled time as bars per area, a zero hour left out, written as a duration', J(sec('tasks').tiles.map(t => [t.label, t.value])) === J([['Done', '11'], ['Slipped', '2'], ['Overdue', '4'], ['Created', '9']]) && J(sec('tasks').lines) === J(['Done: work 6 · personal 3', 'Slipped: Renew passport · Book dentist']) && sec('tasks').tiles.every(t => !t.hint) && /grid-cols-4/.test(read('src/features/ai/components/WeeklyReportView.tsx')) && J(sec('tasks').charts[0].rows) === J([{ label: 'work', value: 14, text: '14 h' }, { label: 'training', value: 4.5, text: '4 h 30 min' }]))
check('§2 the figures are input: a number saved as text, a series of the wrong length or with a negative, and a missing section are left out, never guessed', (() => {
  const v = F.reportView({ ...FULL, health: { has_data: true, steps: { avg_per_day: '9286', per_day: [1, 2, 3] }, sleep: { avg_hours: 7, per_night: [1, 2, 3, 4, 5, 6, -1] } }, food: null }, null, WEEK)
  const h = v.find(s => s.key === 'health')
  return !h.tiles.some(t => t.key === 'steps') && h.charts.length === 0 && h.tiles[0].value === '7 h' && !v.some(s => s.key === 'food')
})())
check('§2 free text in the figures stays text: a title with markup is a plain string, control characters are spaces, long names are cut', (() => {
  const v = F.reportView({ ...FULL, training: { ...FULL.training, key_lifts: [{ exercise: '<img src=x onerror=alert(1)>\u0007' + 'x'.repeat(80), top_set: '1 kg × 1', change: 'same' }] } }, null, WEEK)
  const r = v.find(s => s.key === 'training').rows[0]
  return r.label.startsWith('<img src=x onerror=alert(1)> ') && r.label.length === 60 && r.label.endsWith('…')
})())
check('§2 a report saved without figures (before 25.11.2026, or none) still draws its words, a section to a card; a heading the app does not know keeps its own card; text before a heading comes first', (() => {
  const v = F.reportView({}, 'Hello.\n**Training**\nTwo sessions.\n**Mood**\nGood.\n**Next week**\n1. More.', WEEK)
  return J(v.map(s => [s.key, s.title, s.tiles.length, s.charts.length])) === J([['intro', '', 0, 0], ['training', 'Training', 0, 0], ['other', 'Mood', 0, 0], ['next', 'Next week', 0, 0]])
})())
check('§2 a report saved before the day series (25.11.2026) has no day chart for health or food, and still its tiles', (() => {
  const old = { ...FULL, health: { ...FULL.health, steps: { ...FULL.health.steps, per_day: undefined }, sleep: { ...FULL.health.sleep, per_night: undefined } }, food: { ...FULL.food, kcal_per_day: undefined } }
  const v = F.reportView(old, null, WEEK)
  return v.find(s => s.key === 'health').charts.length === 0 && v.find(s => s.key === 'food').charts.length === 0 && v.find(s => s.key === 'health').tiles.length === 4
})())
check('§2 a section that could not be read says so; one with no figures and no words is left out', (() => {
  const v = F.reportView({ unreadable: ['food'], training: { has_data: false } }, '**Health**\nFine.', WEEK)
  return J(v.map(s => s.key)) === J(['health', 'food']) && /could not be read/i.test(v[1].note) && v[0].note === null
})())
check('§2 partial health readings say so on the card', /partial/.test(F.reportView({ health: { ...FULL.health, truncated: true } }, null, WEEK)[0].note))
check('§2 Home\'s card (reportTiles.ts only): four figures, each label with its unit — Sessions, Steps/day, kcal/day as "1 933 of 2 200", Tasks done; no change; sleep stands in for a missing one; none for no figures', (() => {
  const h = F.reportHeadline(FULL)
  const noSteps = F.reportHeadline({ ...FULL, health: { ...FULL.health, steps: null } })
  return J(h) === J([{ key: 'sessions', label: 'Sessions', value: '3' }, { key: 'steps', label: 'Steps/day', value: '9 286' }, { key: 'kcal', label: 'kcal/day', value: '1 933 of 2 200' }, { key: 'done', label: 'Tasks done', value: '11' }])
    && J(noSteps.map(f => f.label)) === J(['Sessions', 'kcal/day', 'Tasks done', 'Sleep']) && F.reportHeadline({}).length === 0
    && F.reportHeadline({ training: { has_data: true, session_count: 1 } })[0].label === 'Session'
    && F.reportHeadline({ food: { has_data: true, avg_kcal_on_logged_days: 1800, target_kcal: 0 } })[0].value === '1 800'
})())
check('§2 the writers: thousands grouped, one decimal at most, durations in hours and minutes, a change with no percent against zero', F.figure(13180) === '13 180' && F.figure(2.25) === '2.3' && F.figure(-0.5) === '-0.5' && F.figure(1234567.04) === '1 234 567' && F.duration(6.79) === '6 h 47 min' && F.duration(7) === '7 h' && F.duration(0.5) === '30 min' && F.changeOf(3, 0, { better: 'up', against: 'x' }).text === '+3' && F.changeOf(5, 10, { better: 'up', against: 'x' }).tone === 'warn' && F.changeOf(5, 10, { better: 'none', against: 'x' }).tone === 'neutral')
check('§2 the chart days are DD.MM.YYYY with their weekday, across a month and a year end', J(F.weekDays('2026-12-28')) === J(['Mon 28.12.2026', 'Tue 29.12.2026', 'Wed 30.12.2026', 'Thu 31.12.2026', 'Fri 01.01.2027', 'Sat 02.01.2027', 'Sun 03.01.2027']))
const viewSrc = read('src/features/ai/components/WeeklyReportView.tsx'), chartSrc = read('src/features/ai/components/ReportCharts.tsx'), changeSrc = read('src/features/ai/components/ReportChange.tsx'), sheetSrc = read('src/features/ai/components/WeeklyReportSheet.tsx'), tileSrc = read('src/shared/ui/StatTile.tsx')
check('§2 one report view for every way in: Home\'s popup (and the push that opens it) and the Batches view render WeeklyReportView; the old text-only component is gone', /<WeeklyReportView facts=\{report\.facts\} content=\{report\.content\} weekStart=\{report\.week_start\} \/>/.test(sheetSrc) && /<WeeklyReportView facts=\{report\.facts\} content=\{report\.content\} weekStart=\{report\.week_start\} \/>/.test(batchSrc) && !fs.existsSync(path.join(__dirname, '..', 'src/features/ai/components/WeeklyReportText.tsx')))
check('§2 the popup is a grouped ModalShell (the cards on its canvas), one size whatever the answer; its cost line steps aside in a short window', /<ModalShell[\s\S]*size="xl"[\s\S]*grouped/.test(sheetSrc) && /\[@media\(max-height:500px\)\]:hidden/.test(sheetSrc))
check('§2 the cards: tiles are StatTile inset with the change on the number\'s line, three tiles a row of three (none alone), the model\'s words whole (they carry no numbers now), the columns dealt by index by the view\'s own width', /<StatTile key=\{t\.key\} inset/.test(viewSrc) && /n % 2 === 1 \? 'grid-cols-3'/.test(viewSrc) && /\{change != null && <span className="ml-0\.5 min-w-0">\{change\}<\/span>\}\s*<\/span>/.test(tileSrc) && /\{words && <p className=/.test(viewSrc) && /dealByIndex\(cards/.test(viewSrc) && /useElementWidthRem/.test(viewSrc) && !/line-clamp|\btruncate\b|lines=\{3\}/.test(viewSrc))
check('§2 the charts take their colours from useChartColors\' series (never the accent, no literal colour; sleep rose, apart from Food\'s violet calories), grow only with motion allowed, and each bar\'s value is reachable by tap and keyboard (not hover only)', /useChartColors\(\)/.test(chartSrc) && /sleep: 3, kcal: 1/.test(chartSrc) && !/\.accent\b|#[0-9a-f]{3,6}\b|rgb\(/i.test(chartSrc) && (chartSrc.match(/motion-safe:animate-barGrow/g) || []).length >= 2 && (chartSrc.match(/animate-barGrow/g) || []).length === (chartSrc.match(/motion-safe:animate-barGrow/g) || []).length && /onClick=\{\(\) => setPicked\(i\)\}/.test(chartSrc) && /onFocus=\{\(\) => setPicked\(i\)\}/.test(chartSrc) && /aria-label=\{`\$\{chart\.days\[i\]\}/.test(chartSrc))
check('§2 a change is a tone (data-tone, never the accent) and gives screen readers the whole change and its basis', /data-tone=\{change\.tone\}/.test(changeSrc) && !/accent/.test(changeSrc.replace(/\/\*[\s\S]*?\*\//g, '')) && /<span className="sr-only">\{`\$\{change\.text\} \$\{change\.against\}`\}<\/span>/.test(changeSrc))

console.log(`\n${ok} passed, ${bad} failed`)
process.exit(bad ? 1 : 0)
