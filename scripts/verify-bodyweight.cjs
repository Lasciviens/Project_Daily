#!/usr/bin/env node
/*
 * Verification — bodyweight.ts, the ONE bodyweight series (smart scale + Hevy
 * + Apple Health). Real module through sucrase, no test framework.
 *
 * Audit T08 / TRN-M12 / H-12: five readers each picked their own table and
 * none read the smart scale in use, so the same person had a different
 * "current weight" on each screen.
 *
 * Run: node scripts/verify-bodyweight.cjs
 */
require('sucrase/register')
const { mergeBodyweight, latestBodyweight } = require('../src/features/health/bodyweight.ts')

let passed = 0
const failures = []
function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++
  else failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`)
}
const R = (date, kg, fatPct = null, at = `${date}T07:00:00Z`) => ({ date, at, kg, fatPct })

// §1 Same-day precedence: Hevy (manual) > smart scale > Apple Health
{
  const pts = mergeBodyweight({
    hevy:  [R('2026-09-20', 81.0)],
    scale: [R('2026-09-20', 81.4, 18.2), R('2026-09-21', 81.2, 18.0)],
    apple: [R('2026-09-20', 81.5, 19.0), R('2026-09-21', 81.3), R('2026-09-22', 81.1, 18.5)],
  })
  check('§1.1 one point per day', pts.map(p => p.date), ['2026-09-20', '2026-09-21', '2026-09-22'])
  check('§1.2 a manual Hevy weight wins its day', [pts[0].kg, pts[0].source], [81.0, 'hevy'])
  check('§1.3 …fat % falls to the next source that has one', [pts[0].fatPct, pts[0].fatSource], [18.2, 'scale'])
  check('§1.4 the scale beats Apple Health', [pts[1].kg, pts[1].source, pts[1].fatPct, pts[1].fatSource], [81.2, 'scale', 18.0, 'scale'])
  check('§1.5 Apple Health fills a day nobody else has', [pts[2].kg, pts[2].source], [81.1, 'apple'])
}

// §2 Several readings on one day: the last weigh-in of the day
{
  const pts = mergeBodyweight({
    hevy: [],
    scale: [R('2026-09-20', 80.2, 17.9, '2026-09-20T06:10:00Z'), R('2026-09-20', 81.0, null, '2026-09-20T20:00:00Z')],
    apple: [],
  })
  check('§2.1 the later reading of the day wins the weight', pts[0].kg, 81.0)
  check('§2.2 …without erasing the earlier fat %', pts[0].fatPct, 17.9)
}

// §3 Sanity guard: pounds / misreads never become a weight
{
  const pts = mergeBodyweight({ hevy: [R('2026-09-20', 178.6 * 2.2)], scale: [], apple: [R('2026-09-20', 81), R('2026-09-21', 12)] })
  check('§3.1 an out-of-range manual value falls through to the next source', [pts[0].kg, pts[0].source], [81, 'apple'])
  check('§3.2 an impossible reading is dropped, not plotted', pts.length, 1)
  const fat = mergeBodyweight({ hevy: [], scale: [R('2026-09-20', 80, 0.18)], apple: [] })
  check('§3.3 a fraction-shaped fat % (0.18) is not read as 0.18%', fat[0].fatPct, null)
}

// §4 Range filter and latest
{
  const inputs = { hevy: [], scale: [R('2026-08-01', 83)], apple: [R('2026-09-01', 82), R('2026-09-25', 80.9)] }
  check('§4.1 range keeps only days inside it', mergeBodyweight(inputs, { from: '2026-09-01', to: '2026-09-30' }).map(p => p.date), ['2026-09-01', '2026-09-25'])
  check('§4.2 latest = newest merged day', latestBodyweight(mergeBodyweight(inputs)).kg, 80.9)
  check('§4.3 nothing → null', latestBodyweight([]), null)
  check('§4.4 a day with only a fat % and no weight is not a point',
    mergeBodyweight({ hevy: [R('2026-09-20', null, 18)], scale: [], apple: [] }), [])
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log('One bodyweight series, one precedence.\n')
