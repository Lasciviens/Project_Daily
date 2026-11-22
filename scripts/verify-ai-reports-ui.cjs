#!/usr/bin/env node
/*
 * Verification — the weekly report's app side (AI phase 3): src/features/ai/claude/reportRules.ts, the Home card's
 * place on the board, the Batches view's place under Learn, the rule that no column the database keeps server-only
 * is ever asked for, and the harness's own copy of the function's report actions.
 *
 *   node scripts/verify-ai-reports-ui.cjs
 */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const R = require('../src/features/ai/claude/reportRules.ts')
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

check('Batches is the fourth page of Learn, by ?learn=batches (the header and the four views stay as they were)', J(B.AI_VIEWS) === J(['overview', 'calls', 'settings', 'learn']) && B.AI_LEARN_VIEWS.includes('batches') && B.AI_LEARN_LABEL.batches === 'Batches' && B.parseAiLocation('learn', 'batches').learn === 'batches' && B.parseAiLocation('batches', null).view === 'learn')
check('Home\'s weekly report card is one section on every step (the card is an addition: nothing else was dropped)', H.HOME_SECTIONS.includes('report') && [1, 2, 3, 4].every(s => H.HOME_BOARD && require('../src/shared/ui/pageBoardRules.ts').resolveBoardLayout(H.HOME_BOARD, s) && JSON.stringify(require('../src/shared/ui/pageBoardRules.ts').resolveBoardLayout(H.HOME_BOARD, s)).includes('"report"')) && JSON.stringify(require('../src/shared/ui/pageBoardRules.ts').resolveBoardLayout(H.HOME_BOARD_SPLIT, 2)).includes('"report"'))
const card = read('src/features/home/components/WeeklyReportCard.tsx')
check('the card reads the report id from the address only through isReportId, cleans a bad one, and keeps its room (nothing jumps when it lands)', /isReportId\(asked\)/.test(card) && /n\.delete\('report'\)/.test(card) && /<KeepRoom ids="home:weekly-report"/.test(card) && /first="none"/.test(card))
check('the card draws the model\'s text only as text: no dangerouslySetInnerHTML anywhere in the report files', !['src/features/ai/components/WeeklyReportText.tsx', 'src/features/ai/components/WeeklyReportSheet.tsx', 'src/features/home/components/WeeklyReportCard.tsx', 'src/features/developer/components/ai/AiBatches.tsx'].some(f => /dangerouslySetInnerHTML|innerHTML/.test(read(f))))
check('the report popup is a ModalShell (never a raw dialog) and the card\'s query key is a qk key that is never kept on the device', /<ModalShell/.test(read('src/features/ai/components/WeeklyReportSheet.tsx')) && !/@headlessui\/react/.test(read('src/features/ai/components/WeeklyReportSheet.tsx')) && /'ai-reports'/.test(read('src/shared/query/persistRules.ts')))
check('Home\'s card only reads: it imports no code that runs the function (the first download stays small)', !/from '[^']*(claudeApi|reportActions|useMutationWithFeedback)/.test(read('src/features/ai/claude/reportApi.ts') + read('src/features/ai/claude/hooks/useReports.ts')))
check('the app\'s two buttons are mutations with feedback that name the function\'s sentence, and both refresh the reports and the ledger', /useMutationWithFeedback/.test(read('src/features/ai/claude/hooks/useReportActions.ts')) && (read('src/features/ai/claude/hooks/useReportActions.ts').match(/invalidates: \['aiReports'\]/g) || []).length === 2)

// The harness plays the function's two report actions as the real one answers them.
const { claudeMock } = require('./harness/claude.cjs')
const store = { ownerId: 'o', tables: { ai_calls: [], ai_settings: [], ai_job_settings: [] } }
const mock = claudeMock()
const made = mock({ body: { action: 'report_make' }, store })
check('harness: report_make queues one report and one pending batch ledger row at its worst case', made.ok && made.queued && store.tables.ai_reports.length === 1 && store.tables.ai_calls[0].mode === 'batch' && store.tables.ai_calls[0].outcome === 'pending')
check('harness: a second tap while it waits is "already_queued"', mock({ body: { action: 'report_make' }, store }).skipped === 'already_queued')
const checked = mock({ body: { action: 'report_check' }, store })
check('harness: report_check reads it back: ready, and the ledger row is corrected below its worst case at the batch price', checked.ready === 1 && store.tables.ai_reports[0].status === 'ready' && store.tables.ai_calls[0].outcome === 'ok' && store.tables.ai_calls[0].cost_usd < 0.001299)
const off = mock({ body: { action: 'report_make' }, store: { ...store, tables: { ...store.tables, ai_reports: [], ai_settings: [{ ai_enabled: false }] } } })
check('harness: with all AI off the button gets the function\'s sentence', off.ok === false && off.reason === 'off')
check('harness: the seed has a ready report for the newest week, an older one and a failed one, each with a batch ledger row', (() => {
  const t = require('./harness/seed.cjs').buildTables(new Date('2026-11-22T12:00:00Z'))
  return t.ai_reports.length === 3 && t.ai_reports.filter(r => r.status === 'ready').length === 2 && t.ai_reports.every(r => t.ai_calls.some(c => c.id === r.call_id && c.mode === 'batch' && c.job === 'weekly_report'))
})())

console.log(`\n${ok} passed, ${bad} failed`)
process.exit(bad ? 1 : 0)
