#!/usr/bin/env node
/* Verification — the finish-by date (src/features/books/finishBy.ts): time
 * left (the book's own pace per percent) ÷ time read per calendar day over the
 * last 14 days. Too little read or fewer than 3 reading days → no date, and
 * the words say why; never a guess. Run: node scripts/verify-finish-by.cjs */
require('sucrase/register')
const { finishBy, finishByText, MIN_PACE_DAYS } = require('../src/features/books/finishBy')
let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const TODAY = '2026-11-22'
const ev = (day, seconds, page = 1) => ({ book_id: 'b', page, started_at: `${day}T12:00:00+01:00`, duration_seconds: seconds })
// 30 % read in 3 hours → 7 hours left (25 200 s).
const book = { progress_pct: 30, read_seconds: 3 * 3600 }

console.log('a date')
// 3 days read in the last 14, 1 h each, first on the 20th → span 3 days → 3 600 s/day → 7 days.
let r = finishBy(book, [ev('2026-11-20', 3600), ev('2026-11-21', 3600), ev('2026-11-22', 3600)], TODAY)
check('7 h left at 1 h/day → in 7 days', r.kind === 'date' && r.days === 7 && r.day === '2026-11-29', JSON.stringify(r))
check('says 60 min a day', r.minutesPerDay === 60)
check('words', finishByText(r) === 'Finish around 29.11.2026 · about 60 min a day', finishByText(r))
// A gap lowers the pace: 3 reading days spread over 12 days, 1 h each → 3 600×3/12 = 900 s/day → 28 days.
r = finishBy(book, [ev('2026-11-11', 3600), ev('2026-11-16', 3600), ev('2026-11-22', 3600)], TODAY)
check('days without reading count: 3 h over 12 days → 28 days', r.kind === 'date' && r.days === 28, JSON.stringify(r))
check('reading older than 14 days is left out', finishBy(book, [ev('2026-10-01', 3600), ev('2026-10-02', 3600), ev('2026-10-03', 3600), ev('2026-11-22', 600)], TODAY).kind === 'none')
check('a window longer than the data uses the whole 14 days', (() => {
  const x = finishBy(book, [ev('2026-11-09', 3600), ev('2026-11-15', 3600), ev('2026-11-22', 3600)], TODAY)
  return x.kind === 'date' && x.days === 33
})())
check('local day: a read just after midnight (Oslo) counts on its Oslo day', finishBy(book, [{ book_id: 'b', page: 1, started_at: '2026-11-21T23:30:00Z', duration_seconds: 3600 }, ev('2026-11-20', 3600), ev('2026-11-19', 3600)], TODAY).kind === 'date')

console.log('no date, and why')
check('under 5 %', finishBy({ progress_pct: 3, read_seconds: 7200 }, [ev('2026-11-20', 3600), ev('2026-11-21', 3600), ev('2026-11-22', 3600)], TODAY).why === 'no-progress')
check('under 20 minutes', finishBy({ progress_pct: 30, read_seconds: 600 }, [ev('2026-11-20', 200), ev('2026-11-21', 200), ev('2026-11-22', 200)], TODAY).why === 'no-progress')
check('no progress at all', finishBy({ progress_pct: null, read_seconds: 7200 }, [], TODAY).why === 'no-progress')
check('finished (100 %)', finishBy({ progress_pct: 100, read_seconds: 7200 }, [], TODAY).kind === 'none')
r = finishBy(book, [ev('2026-11-21', 3600), ev('2026-11-22', 3600)], TODAY)
check(`2 reading days (< ${MIN_PACE_DAYS}) → no pace yet`, r.kind === 'none' && r.why === 'no-pace')
check('no events → no pace yet', finishBy(book, [], TODAY).why === 'no-pace')
check('no-pace words', finishByText(r).startsWith('No pace yet'))
check('no-progress words', finishByText({ kind: 'none', why: 'no-progress' }).startsWith('No finish date yet'))

console.log('far away')
r = finishBy({ progress_pct: 6, read_seconds: 1300 }, [ev('2026-11-20', 30), ev('2026-11-21', 30), ev('2026-11-22', 30)], TODAY)
check('over a year → no date printed', r.kind === 'far', JSON.stringify(r))
check('far words', finishByText(r).startsWith('Over a year'))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
