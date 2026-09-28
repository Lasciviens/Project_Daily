// Verification for sleepCompleteness.ts — the "possibly incomplete night"
// signal — run through sucrase against the REAL module (no test framework in
// this repo; the verify-sleep-aggregate.cjs pattern). Fixtures are synthetic
// but shaped like Health Auto Export's summarised sleep rows.
//
//   node scripts/verify-sleep-completeness.cjs

require('sucrase/register')
const { computeSleepSummary } = require('../src/features/health/healthAggregate.ts')
const {
  findIncompleteNights, startMinutesForWakeDay, clockFromNoonMinutes, INCOMPLETE_NIGHT_RULE,
} = require('../src/features/health/sleepCompleteness.ts')

let passed = 0
const failures = []
function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++
  else failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`)
}

// ─── Day helpers ─────────────────────────────────────────────────────────────
const DAY = 86_400_000
const shift = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10)
// A HAE local-time string for the wake day `wake`; clocks from 12:00 on are
// the evening before.
const local = (wake, clock) => `${Number(clock.slice(0, 2)) >= 12 ? shift(wake, -1) : wake} ${clock}:00 +0200`
let seq = 0
function session(wake, startClock, endClock, total, source = "Test Watch") {
  const start = local(wake, startClock)
  return {
    id: `s${++seq}`, metric_name: 'sleep_analysis', date: wake, source, recorded_at: start,
    value: { sleepStart: start, sleepEnd: local(wake, endClock), totalSleep: total, core: total * 0.55, rem: total * 0.25, deep: total * 0.2, awake: 0.1 },
  }
}
const run = (points, from, to, rule) => findIncompleteNights(points, computeSleepSummary(points), from, to, rule)

// 14 ordinary nights ending 2026-07-14: asleep 00:30–01:35, up ~08:00, ~7 h.
const baseStarts = ['00:30', '00:45', '01:00', '01:10', '00:50', '01:20', '01:35', '00:40', '01:05', '01:15', '00:55', '01:25', '01:00', '00:35']
const base = baseStarts.map((c, i) => session(shift('2026-07-01', i), c, '08:00', 7))
const nextDay = '2026-07-15'

// ─── §1 Wall-clock parsing ───────────────────────────────────────────────────
check('§1.1 23:00 the evening before → 660 min after noon', startMinutesForWakeDay('2026-07-14 23:00:00 +0200', '2026-07-15'), 660)
check('§1.2 01:00 on the wake day → 780', startMinutesForWakeDay('2026-07-15 01:00:00 +0200', '2026-07-15'), 780)
check('§1.3 a colon offset parses too', startMinutesForWakeDay('2026-07-15 04:54:05 +02:00', '2026-07-15'), 1014)
check('§1.4 an ISO "T" separator parses too', startMinutesForWakeDay('2026-07-15T04:54:05+0200', '2026-07-15'), 1014)
check('§1.5 no offset → unknown local time → null', startMinutesForWakeDay('2026-07-15T04:54:00', '2026-07-15'), null)
check('§1.6 a UTC "Z" string → null (local wall clock unknown)', startMinutesForWakeDay('2026-07-15T02:54:00Z', '2026-07-15'), null)
check('§1.7 non-strings → null', [startMinutesForWakeDay(undefined, '2026-07-15'), startMinutesForWakeDay(42, '2026-07-15')], [null, null])
check('§1.8 minutes-after-noon back to a clock', [clockFromNoonMinutes(660), clockFromNoonMinutes(780), clockFromNoonMinutes(1014), clockFromNoonMinutes(-30)], ['23:00', '01:00', '04:54', '11:30'])

// ─── §2 A cut night is flagged ───────────────────────────────────────────────
// The morning run exported nothing; the next run only reached 04:50, so the
// night is a chain of fragments sharing the real wake time.
{
  const cut = [session(nextDay, '04:50', '08:05', 3.2), session(nextDay, '07:40', '08:05', 0.4)]
  const flagged = run([...base, ...cut], nextDay, nextDay)
  check('§2.1 a night starting ~3h45m late and short is flagged', flagged.map(n => n.date), [nextDay])
  check('§2.2 it reports the kept start, the typical (median) start and the lateness',
    flagged.map(n => [n.startClock, n.typicalStartClock, n.lateByMin, n.total, n.usualTotal]), [['04:50', '01:00', 230, 3.2, 7]])
  check('§2.3 the window filters the output, not the baseline', run([...base, ...cut], '2026-07-01', '2026-07-14'), [])
  check('§2.4 row order does not change the answer', run([...cut, ...base].reverse(), nextDay, nextDay).map(n => n.startClock), ['04:50'])
}

// ─── §3 What is NOT flagged ──────────────────────────────────────────────────
{
  const sleptIn = session(nextDay, '04:30', '12:40', 7.9)
  check('§3.1 a late night you slept in on (long) is complete', run([...base, sleptIn], nextDay, nextDay), [])
  const moderate = session(nextDay, '02:20', '08:00', 5.4)
  check('§3.2 a start < 2 h after your early-side start is ordinary variation', run([...base, moderate], nextDay, nextDay), [])
  // Boundary: the early-side (lower-quartile) start of the baseline is 00:46:15.
  check('§3.2b 1 min short of +2 h → not flagged; 2 min past → flagged',
    [run([...base, session(nextDay, '02:45', '08:00', 5.2)], nextDay, nextDay).length,
     run([...base, session(nextDay, '02:48', '08:00', 5.2)], nextDay, nextDay).length], [0, 1])
  const normal = session(nextDay, '01:00', '07:30', 6.2)
  check('§3.3 a normal short night is not flagged', run([...base, normal], nextDay, nextDay), [])
  const few = base.slice(-4)
  const cut = session(nextDay, '05:00', '08:00', 2.9)
  check('§3.4 fewer than 5 reference nights → no verdict', run([...few, cut], nextDay, nextDay), [])
  const manual = { id: 'm1', metric_name: 'sleep_analysis', date: nextDay, source: 'manual', recorded_at: `${nextDay}T06:00:00Z`, value: { value: 'Core', qty: 6 } }
  check('§3.5 a night with a manual entry is never flagged (the entry is the correction)', run([...base, cut, manual], nextDay, nextDay), [])
  const naive = { ...cut, id: 'naive', value: { ...cut.value, sleepStart: `${nextDay}T05:00:00`, sleepEnd: `${nextDay}T08:00:00` } }
  check('§3.6 a row without a local offset gets no verdict (its start clock is unknown)', run([...base, naive], nextDay, nextDay), [])
  // Reference nights must be recent: the same baseline 40 days earlier is ignored.
  const old = baseStarts.map((c, i) => session(shift('2026-05-20', i), c, '08:00', 7))
  check('§3.7 reference nights older than 28 days are not a baseline', run([...old, cut], nextDay, nextDay), [])
}

// ─── §4 The baseline is complete nights only ─────────────────────────────────
// A flagged night never drags "usual" later for the nights after it, so two
// cut nights in a row are both caught.
{
  const d2 = shift(nextDay, 1)
  const cut1 = session(nextDay, '04:50', '08:05', 3.2)
  const cut2 = session(d2, '04:40', '08:10', 3.4)
  check('§4.1 two consecutive cut nights are both flagged', run([...base, cut1, cut2], nextDay, d2).map(n => n.date), [nextDay, d2])
  // Nights under 3 h asleep never enter the baseline either.
  const nap = session('2026-07-14', '14:00', '15:00', 1)
  check('§4.2 a sub-3h night is not part of the baseline', run([...base, nap, cut1], nextDay, nextDay).map(n => n.typicalStartClock), ['01:00'])
}

// ─── §4b A spread-out baseline never reports a lateness ≤ 0 ─────────────────
{
  // Alternating 22:00 / 03:30 starts: the lower quartile is 22:00 but the
  // median is 00:45, AFTER a flagged 00:15 start — the note used to read
  // "−1h −30m later than your usual 00:45".
  const pts = []
  for (let i = 0; i < 14; i++) { const w = shift('2026-07-01', i); pts.push(i % 2 ? session(w, '22:00', '05:00', 7) : session(w, '03:30', '10:30', 7)) }
  pts.push(session(nextDay, '00:15', '06:00', 5.5))
  check('§4b.1 lateness is measured from the early side when the median is not before the start',
    run(pts, nextDay, nextDay).map(n => [n.startClock, n.typicalStartClock, n.lateByMin]), [['00:15', '22:00', 135]])
}

// ─── §5 The rule is what the module documents ────────────────────────────────
check('§5.1 default rule', INCOMPLETE_NIGHT_RULE, {
  lateByMin: 120, shortByMin: 0, startQuantile: 0.25, referenceNights: 14, referenceDays: 28, minReferenceNights: 5, minReferenceHours: 3,
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log('Incomplete-night signal holds on every fixture.\n')
