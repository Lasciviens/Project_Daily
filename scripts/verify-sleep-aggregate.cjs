// Verification for healthAggregate.ts's sleep functions, run through sucrase
// against the REAL module (no mocks) — this repo ships no unit-test framework,
// see CLAUDE.md's Session Workflow.
//
// Why this exists: sleep aggregation is the most bug-prone code in the Health
// feature — four real, live-confirmed bugs have been fixed in it (the Safari
// date-parse divergence, manual entries being shadowed by Watch data, naive
// summing of overlapping re-reports, and the session-identity bug this script
// was written for) — and until now it had NO coverage at all. Every assertion
// below is a bug that actually happened or a guarantee one of those fixes
// depends on.
//
//   node scripts/verify-sleep-aggregate.cjs

require('sucrase/register')
const {
  computeSleepSummary,
  extractSleepSessions,
  estimateSleepStageProportions,
} = require('../src/features/training/healthAggregate.ts')

let passed = 0
const failures = []
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) passed++
  else failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`)
}
const round = (n) => Math.round(n * 100) / 100

// Health Auto Export's own local-time-with-offset format. Never ISO here — the
// whole point is that the parser has to cope with what HAE actually sends.
const at = (day, clock) => `2026-07-${day} ${clock} +0200`

function session(opts) {
  const { day = '17', start, end, total, core = 0, rem = 0, deep = 0, awake = 0,
          source = "Furkan's Apple Watch", date = `2026-07-${day}` } = opts
  return {
    id: `${start}-${source}`, metric_name: 'sleep_analysis', date, source,
    recorded_at: start,
    value: { sleepStart: start, sleepEnd: end, totalSleep: total, core, rem, deep, awake },
  }
}

// A raw per-segment row — the shape HAE sends with "Summarize" OFF.
function segment(stage, qty, { date = '2026-07-17', source = "Furkan's Apple Watch" } = {}) {
  return { id: `${stage}-${qty}-${source}`, metric_name: 'sleep_analysis', date, source,
           recorded_at: `${date}T00:00:00Z`, value: { value: stage, qty } }
}

// ─── §1 Session identity — the bug this script was written for ───────────────
// A partial "Since Last Sync" delivery and the complete re-export of the SAME
// night share a sleepStart. They are NOT the same session and must not be
// deduped by arrival order; the longer one has to win either way round.
//
// Reachable in production because `recorded_at` for sleep is the session's own
// sleepStart, so the (user_id, metric_name, recorded_at, source) unique key
// lets a same-start pair coexist whenever `source` differs — which is exactly
// what the pre-canonicalizeSource rows still in the table look like.
{
  const partial  = session({ start: at('17', '02:00:51'), end: at('17', '05:00:00'), total: 3.00, core: 1.8, rem: 0.6, deep: 0.6, source: "Furkan's Apple Watch" })
  const complete = session({ start: at('17', '02:00:51'), end: at('17', '07:27:08'), total: 4.94, core: 3.0, rem: 1.0, deep: 0.94, source: "Furkan's Apple Watch|Furkan's Apple Watch" })

  check('§1.1 same start, partial listed first → keeps the longer session',
    round(computeSleepSummary([partial, complete])[0].total), 4.94)
  check('§1.2 same start, complete listed first → identical answer',
    round(computeSleepSummary([complete, partial])[0].total), 4.94)
  check('§1.3 stage totals come from the kept session, not a blend',
    computeSleepSummary([partial, complete]).map(n => [round(n.core), round(n.rem), round(n.deep)])[0], [3, 1, 0.94])
  check('§1.4 the two orders agree on every field, not just the total',
    computeSleepSummary([partial, complete]), computeSleepSummary([complete, partial]))
}

// A genuinely identical session delivered under two row keys must still
// collapse — that is what the dedup is FOR, and the §1 fix must not lose it.
{
  const a = session({ start: at('17', '02:00:51'), end: at('17', '07:27:08'), total: 4.94, core: 3.0, source: "Furkan's Apple Watch" })
  const b = session({ start: at('17', '02:00:51'), end: at('17', '07:27:08'), total: 4.94, core: 3.0, source: "Furkan's Apple Watch|Furkan's Apple Watch" })
  check('§1.5 byte-identical session under two sources counts once',
    round(computeSleepSummary([a, b])[0].total), 4.94)
  check('§1.6 …and its stages are not doubled either',
    round(computeSleepSummary([a, b])[0].core), 3)
}

// ─── §2 Overlap merge — distinct starts ──────────────────────────────────────
// The live 2026-07-17 case: a 4.94h session and its 3.34h subset. Summing them
// showed 8.28h for what was really 4.94h of sleep.
{
  const outer = session({ start: at('17', '02:00:00'), end: at('17', '07:27:00'), total: 4.94 })
  const inner = session({ start: at('17', '03:36:00'), end: at('17', '07:27:00'), total: 3.34 })
  check('§2.1 overlapping sessions keep the longest, not the sum',
    round(computeSleepSummary([outer, inner])[0].total), 4.94)
  check('§2.2 …and order still does not matter',
    round(computeSleepSummary([inner, outer])[0].total), 4.94)
}

// Non-overlapping sessions in one night are REAL — an interrupted night or a
// nap. They must be summed, which is the case the overlap merge must not eat.
{
  const first  = session({ start: at('16', '22:00:00'), end: at('17', '01:00:00'), total: 3.0 })
  const second = session({ start: at('17', '02:30:00'), end: at('17', '07:00:00'), total: 4.5 })
  check('§2.3 disjoint sessions in one night are summed',
    round(computeSleepSummary([first, second])[0].total), 7.5)
  check('§2.4 both survive as separate intervals on the timeline',
    extractSleepSessions([first, second], '2026-07-17').length, 2)
}

// ─── §2b Edge overlap is NOT a duplicate ─────────────────────────────────────
// The bug this section exists for, reported as "Health sleep is far lower than
// Apple Health". Waking briefly makes Apple count the awake stretch at the edge
// of BOTH blocks, so two genuinely different parts of one night overlap by a
// few minutes. The old "any overlap ⇒ keep the longest" rule deleted the
// smaller block: 4.10h + 4.35h with five minutes of edge overlap reported
// 4.35h where Apple showed 8.45h.
{
  const before = session({ start: at('19', '23:10:00'), end: at('20', '03:20:00'), total: 4.10, core: 2.5, rem: 0.8, deep: 0.8 })
  const after  = session({ start: at('20', '03:15:00'), end: at('20', '07:40:00'), total: 4.35, core: 2.6, rem: 0.9, deep: 0.85 })
  check('§2b.1 five minutes of edge overlap does not delete a block',
    round(computeSleepSummary([before, after])[0].total), 8.45)
  check('§2b.2 …and the order of the two rows does not change it',
    round(computeSleepSummary([after, before])[0].total), 8.45)
  check('§2b.3 stages are summed across both blocks',
    round(computeSleepSummary([before, after])[0].deep), 1.65)
  check('§2b.4 both blocks survive onto the session timeline',
    extractSleepSessions([before, after], '2026-07-20').length, 2)
  check('§2b.5 …in chronological order, not ranked order',
    extractSleepSessions([before, after], '2026-07-20').map(s => s.totalSleep), [4.10, 4.35])
}

// The containment rule has to keep working in the other direction, or the fix
// above just trades an under-report for a double-count.
{
  const full   = session({ start: at('17', '02:00:00'), end: at('17', '07:00:00'), total: 5.0 })
  // A subset sharing the END — the other half of the partial-delivery shape.
  const subset = session({ start: at('17', '05:00:00'), end: at('17', '07:00:00'), total: 2.0 })
  check('§2b.6 a fully contained subset is still dropped, not summed',
    round(computeSleepSummary([full, subset])[0].total), 5)

  // 30 min of a 60 min session lies inside the other: 50%, well under the
  // containment bar, so it is real sleep and is kept.
  const a = session({ start: at('17', '01:00:00'), end: at('17', '02:00:00'), total: 1.0 })
  const b = session({ start: at('17', '01:30:00'), end: at('17', '06:00:00'), total: 4.5 })
  check('§2b.7 a half-overlapping session is kept, not treated as a duplicate',
    round(computeSleepSummary([a, b])[0].total), 5.5)
}

// Sessions whose timestamps cannot be parsed can't be proven to overlap, so
// they are kept rather than silently dropped.
{
  const timed   = session({ start: at('17', '02:00:00'), end: at('17', '06:00:00'), total: 4.0 })
  const untimed = { id: 'u', metric_name: 'sleep_analysis', date: '2026-07-17', source: 'manual-ish',
                    recorded_at: '2026-07-17T00:00:00Z', value: { totalSleep: 1.5 } }
  check('§2.5 an unparseable-time session is kept, never dropped',
    round(computeSleepSummary([timed, untimed])[0].total), 5.5)
}

// ─── §3 The Safari / JavaScriptCore parse divergence ─────────────────────────
// V8 parses "2026-07-17 02:00:51 +0200" directly; JSC returns Invalid Date.
// When it did, overlapping sessions read as "untimed" and were summed, so one
// night showed ~14h on an iPhone and 8.6h on desktop for the same rows. The
// normalization must make both engines agree, which is observable here as the
// overlap merge firing at all on HAE's space-separated format.
{
  const outer = session({ start: at('17', '02:00:51'), end: at('17', '07:27:08'), total: 4.94 })
  const inner = session({ start: at('17', '03:36:00'), end: at('17', '07:27:08'), total: 3.34 })
  check('§3.1 HAE\'s space-separated local format is parsed, so overlap is detected',
    round(computeSleepSummary([outer, inner])[0].total), 4.94)
  check('§3.2 …confirmed by the interval extractor seeing ONE window',
    extractSleepSessions([outer, inner], '2026-07-17').length, 1)
  const sess = extractSleepSessions([outer, inner], '2026-07-17')[0]
  check('§3.3 the parsed window is the real one, in the right order',
    sess.endMs > sess.startMs && Number.isFinite(sess.startMs), true)
}

// ─── §4 Night attribution ────────────────────────────────────────────────────
// A night belongs to the day you WOKE UP (Apple's convention), derived from the
// session's own sleepEnd rather than the ingest-stamped `date` — otherwise an
// interrupted night split across two rows lands on two different chart bars.
{
  const beforeMidnight = session({ start: at('16', '22:30:00'), end: at('17', '01:30:00'), total: 3.0, date: '2026-07-16' })
  const afterMidnight  = session({ start: at('17', '02:30:00'), end: at('17', '07:00:00'), total: 4.5, date: '2026-07-17' })
  const nights = computeSleepSummary([beforeMidnight, afterMidnight])
  check('§4.1 one interrupted night stays ONE night, keyed on the wake day',
    nights.map(n => n.date), ['2026-07-17'])
  check('§4.2 …carrying both sessions',
    round(nights[0].total), 7.5)
}

// A row with no parseable offset keeps its stored date rather than guessing.
{
  const noOffset = { id: 'n', metric_name: 'sleep_analysis', date: '2026-07-19', source: 'w',
                     recorded_at: '2026-07-19T00:00:00Z',
                     value: { sleepStart: '2026-07-19 01:00:00', sleepEnd: '2026-07-19 08:00:00', totalSleep: 7 } }
  check('§4.3 a sleepEnd without an offset falls back to the stored date',
    computeSleepSummary([noOffset])[0].date, '2026-07-19')
}

// ─── §5 Manual entries win ───────────────────────────────────────────────────
// A manual entry is a deliberate correction for that night. The bug this
// guards: any Watch row for the date used to win unconditionally, so a manual
// backfill silently never appeared.
{
  const watch  = session({ start: at('17', '02:00:00'), end: at('17', '06:00:00'), total: 4.0 })
  const manual = session({ start: at('17', '23:00:00'), end: at('17', '07:30:00'), total: 8.0, source: 'manual' })
  check('§5.1 a manual entry replaces the Watch data for that night',
    round(computeSleepSummary([watch, manual])[0].total), 8)
  check('§5.2 …and is not summed with it',
    computeSleepSummary([watch, manual]).length, 1)
}

// ─── §6 Raw per-segment rows ("Summarize" OFF) ───────────────────────────────
{
  const pts = [segment('Core', 3.5), segment('REM', 1.2), segment('Deep', 0.8), segment('Awake', 0.4)]
  const n = computeSleepSummary(pts)[0]
  check('§6.1 stage segments sum into the night total', round(n.total), 5.5)
  check('§6.2 Awake is tracked separately…', round(n.awake), 0.4)
  check('§6.3 …and deliberately excluded from total sleep',
    round(n.core + n.rem + n.deep), round(n.total))
  check('§6.4 an unrecognised stage name is ignored rather than counted',
    round(computeSleepSummary([...pts, segment('Nonsense', 99)])[0].total), 5.5)
}

// Awake must not inflate the total on the pre-aggregated path either.
{
  const s = session({ start: at('17', '02:00:00'), end: at('17', '08:00:00'), total: 5.5, core: 3.5, rem: 1.2, deep: 0.8, awake: 0.5 })
  const n = computeSleepSummary([s])[0]
  check('§6.5 pre-aggregated: awake is reported but not added to total',
    [round(n.total), round(n.awake)], [5.5, 0.5])
}

// ─── §7 Stage proportions for manual backfill ────────────────────────────────
{
  const summaries = [
    { date: '2026-07-17', deep: 1, core: 2, rem: 1, awake: 0, total: 4 },
    { date: '2026-07-18', deep: 2, core: 4, rem: 2, awake: 0, total: 8 },
  ]
  const p = estimateSleepStageProportions(summaries)
  check('§7.1 proportions are the mean of per-night shares',
    [round(p.deep), round(p.core), round(p.rem)], [0.25, 0.5, 0.25])
  check('§7.2 …and sum to 1', round(p.deep + p.core + p.rem), 1)
  check('§7.3 nights with no stage data give null rather than NaN',
    estimateSleepStageProportions([{ date: 'x', deep: 0, core: 0, rem: 0, awake: 1, total: 0 }]), null)
}

// ─── §8 Degenerate input ─────────────────────────────────────────────────────
check('§8.1 no points → no nights', computeSleepSummary([]), [])
check('§8.2 a night with only Awake time still reports',
  computeSleepSummary([segment('Awake', 0.3)]).length, 1)
check('§8.3 extractSleepSessions on an unknown night → empty',
  extractSleepSessions([session({ start: at('17', '02:00:00'), end: at('17', '06:00:00'), total: 4 })], '2026-01-01'), [])

// ─── Report ──────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log('All sleep aggregation assertions hold.\n')
