#!/usr/bin/env node
/*
 * Verification — bodyweight.ts, the ONE bodyweight series (smart scale via
 * Apple Health > the scale's photo report > Hevy). Real module through
 * sucrase, no test framework.
 *
 * Audit T08 / TRN-M12 / H-12: five readers each picked their own table, so
 * the same person had a different "current weight" on each screen. Owner
 * feedback (Sep 2026): "only show the scale — Apple Health gets data from the
 * scale anyway"; live data confirmed every report and Hevy weight was a copy
 * of a scale reading already in Apple Health.
 *
 * Run: node scripts/verify-bodyweight.cjs
 */
require('sucrase/register')
const {
  mergeBodyweight, latestBodyweight, splitAppleBodyRows, isManualAppleSource, scaleOnly, isScaleSource,
  scaleChartDomain, appleDevice, currentDeviceSeries, BODYWEIGHT_PRECEDENCE, BODYWEIGHT_SOURCE_LABEL,
} = require('../src/features/health/bodyweight.ts')

let passed = 0
const failures = []
function check(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) passed++
  else failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`)
}
const R = (date, kg, fatPct = null, at = `${date}T07:00:00Z`, leanKg = null) => ({ date, at, kg, fatPct, leanKg })
const EMPTY = { scale: [], report: [], hevy: [] }

// §1 Same-day precedence: the scale (Apple Health) > its report > Hevy
{
  const pts = mergeBodyweight({
    scale:  [R('2026-09-20', 81.5, 19.0), R('2026-09-21', 81.3)],
    report: [R('2026-09-20', 81.4, 18.2), R('2026-09-21', 81.2, 18.0), R('2026-09-22', 81.1, 18.5)],
    hevy:   [R('2026-09-20', 81.0), R('2026-09-22', 80.9), R('2026-09-23', 80.8, 17.9)],
  })
  check('§1.0 the precedence order', BODYWEIGHT_PRECEDENCE, ['scale', 'report', 'hevy'])
  check('§1.1 one point per day', pts.map(p => p.date), ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23'])
  check('§1.2 the scale reading wins its day over a hand-typed Hevy weight', [pts[0].kg, pts[0].source, pts[0].fatPct, pts[0].fatSource], [81.5, 'scale', 19.0, 'scale'])
  check('§1.3 …fat % falls to the next source that has one', [pts[1].kg, pts[1].source, pts[1].fatPct, pts[1].fatSource], [81.3, 'scale', 18.0, 'report'])
  check('§1.4 the scale report fills a day Apple Health has not synced, before Hevy', [pts[2].kg, pts[2].source], [81.1, 'report'])
  check('§1.5 Hevy only fills a day without any scale reading', [pts[3].kg, pts[3].source, pts[3].fatSource], [80.8, 'hevy', 'hevy'])
}

// §2 Several readings on one day: the last weigh-in of the day
{
  const pts = mergeBodyweight({
    ...EMPTY,
    scale: [R('2026-09-20', 80.2, 17.9, '2026-09-20T06:10:00Z', 62.1), R('2026-09-20', 81.0, null, '2026-09-20T20:00:00Z')],
  })
  check('§2.1 the later reading of the day wins the weight', pts[0].kg, 81.0)
  check('§2.2 …without erasing the earlier fat % or lean mass', [pts[0].fatPct, pts[0].leanKg], [17.9, 62.1])
}

// §3 Sanity guard: pounds / misreads never become a weight
{
  const pts = mergeBodyweight({ ...EMPTY, scale: [R('2026-09-20', 178.6 * 2.2), R('2026-09-21', 12)], hevy: [R('2026-09-20', 81)] })
  check('§3.1 an out-of-range scale value falls through to the next source', [pts[0].kg, pts[0].source], [81, 'hevy'])
  check('§3.2 an impossible reading is dropped, not plotted', pts.length, 1)
  const fat = mergeBodyweight({ ...EMPTY, report: [R('2026-09-20', 80, 0.18)] })
  check('§3.3 a fraction-shaped fat % (0.18) in a report is not read as 0.18%', fat[0].fatPct, null)
  const lean = mergeBodyweight({ ...EMPTY, scale: [R('2026-09-20', 80, null, undefined, 400)] })
  check('§3.4 an impossible lean mass is dropped', lean[0].leanKg, null)
}

// §4 Range filter and latest
{
  const inputs = { ...EMPTY, report: [R('2026-08-01', 83)], scale: [R('2026-09-01', 82), R('2026-09-25', 80.9)] }
  check('§4.1 range keeps only days inside it', mergeBodyweight(inputs, { from: '2026-09-01', to: '2026-09-30' }).map(p => p.date), ['2026-09-01', '2026-09-25'])
  check('§4.2 latest = newest merged day', latestBodyweight(mergeBodyweight(inputs)).kg, 80.9)
  check('§4.3 nothing → null', latestBodyweight([]), null)
  check('§4.4 a day with only a fat % and no weight is not a point',
    mergeBodyweight({ ...EMPTY, hevy: [R('2026-09-20', null, 18)] }), [])
}

// §5 Apple Health rows: the scale's vs the ones Hevy wrote there
{
  check('§5.1 Hevy is a hand-typed source', isManualAppleSource('Hevy'), true)
  check('§5.2 the scale app is not', isManualAppleSource('Smart Scale App'), false)
  check('§5.3 a mixed hour still holds the scale reading', isManualAppleSource('Hevy|Smart Scale App'), false)
  check('§5.4 a missing source is not manual', isManualAppleSource(null), false)
  const row = (metric, date, qty, source, at = `${date}T07:00:00Z`) => ({ metric, date, at, source, qty })
  const split = splitAppleBodyRows([
    row('weight_body_mass', '2026-09-20', 81.4, 'Smart Scale App'),
    row('body_fat_percentage', '2026-09-20', 0.182, 'Smart Scale App'),
    row('lean_body_mass', '2026-09-20', 63.1, 'Smart Scale App'),
    row('weight_body_mass', '2026-09-20', 81.0, 'Hevy', '2026-09-20T22:00:00Z'),
    row('body_mass_index', '2026-09-20', 24.1, 'Smart Scale App'),
    row('weight_body_mass', '2026-09-21', null, 'Smart Scale App'),
  ])
  check('§5.5 scale rows become one reading per metric', split.scale.map(r => [r.kg, r.fatPct, r.leanKg]),
    [[81.4, null, null], [null, 18.2, null], [null, null, 63.1]])
  check('§5.6 a Hevy row goes to the manual bucket', split.hevy.map(r => r.kg), [81.0])
  check('§5.7 other metrics and missing values are ignored', split.scale.length + split.hevy.length, 4)
  // The day Hevy wrote a later, different weight into Apple Health: the scale still wins.
  const pts = mergeBodyweight({ scale: split.scale, report: [], hevy: split.hevy })
  check('§5.8 merged: the scale weight, fat % and lean mass win the day', [pts[0].kg, pts[0].source, pts[0].fatPct, pts[0].leanKg, pts[0].leanSource],
    [81.4, 'scale', 18.2, 63.1, 'scale'])
}

// §6 The scale alone (the Body window)
{
  const pts = mergeBodyweight({
    scale:  [R('2026-09-20', 81.5, 19.0, undefined, 63.0)],
    report: [R('2026-09-21', 81.2)],
    hevy:   [R('2026-09-21', null, 17.5), R('2026-09-22', 80.9, 17.9)],
  })
  const s = scaleOnly(pts)
  check('§6.1 a Hevy-only day is dropped', s.map(d => d.date), ['2026-09-20', '2026-09-21'])
  const pick = d => ({ date: d.date, kg: d.kg, fatPct: d.fatPct, leanKg: d.leanKg })
  check('§6.2 a scale day keeps weight, fat and lean', pick(s[0]), { date: '2026-09-20', kg: 81.5, fatPct: 19.0, leanKg: 63.0 })
  check('§6.3 a hand-typed fat % on a scale day is not shown as the scale', pick(s[1]), { date: '2026-09-21', kg: 81.2, fatPct: null, leanKg: null })
  check('§6.4 the scale and its report are the scale; Hevy is not', [isScaleSource('scale'), isScaleSource('report'), isScaleSource('hevy'), isScaleSource(null)], [true, true, false, false])
  check('§6.5 every source has a label', Object.keys(BODYWEIGHT_SOURCE_LABEL).sort(), ['hevy', 'report', 'scale'])
}

// §7 Chart range: noise must not fill the chart
{
  check('§7.1 a narrow range widens to the minimum span, rounded out', scaleChartDomain([82.1, 82.6, 82.4], 3), [80, 84])
  check('§7.2 a wide range keeps its readings, rounded out to 4 even steps', scaleChartDomain([80.2, 86.7], 3), [80, 88])
  check('§7.3 no readings → no fixed range', scaleChartDomain([], 3), undefined)
  check('§7.4 non-finite values are ignored', scaleChartDomain([NaN, 21.4], 3), [19, 23])
  check('§7.5 a kcal-sized range rounds to tens', scaleChartDomain([1748, 1771], 70), [1720, 1800])
  check('§7.6 a small span rounds to tenths without float noise', scaleChartDomain([8.31, 8.44], 0.5), [8, 8.8])
  check('§7.7 a range near zero never goes below it', scaleChartDomain([0.2, 0.3], 3), [0, 4])
}

// §8 Two scales: weight joins up, body fat and lean mass never share a line
{
  check('§8.1 the device is the scale part of an Apple source', [appleDevice('Old Scale'), appleDevice('Hevy|New Scale'), appleDevice('New Scale|Hevy'), appleDevice(''), appleDevice('Hevy')],
    ['Old Scale', 'New Scale', 'New Scale', null, 'Hevy'])
  const row = (metric, date, qty, source) => ({ metric, date, at: `${date}T07:00:00Z`, source, qty })
  const split = splitAppleBodyRows([
    row('weight_body_mass', '2026-08-10', 84.3, 'Old Scale'), row('body_fat_percentage', '2026-08-10', 27.0, 'Old Scale'),
    row('weight_body_mass', '2026-08-12', 84.4, 'Old Scale'), row('body_fat_percentage', '2026-08-12', 27.1, 'Old Scale'),
    row('weight_body_mass', '2026-08-13', 84.5, 'New Scale'), row('body_fat_percentage', '2026-08-13', 25.0, 'New Scale'),
    row('lean_body_mass', '2026-08-13', 63.4, 'New Scale'),
    row('weight_body_mass', '2026-08-15', 84.2, 'New Scale'), row('body_fat_percentage', '2026-08-15', 24.8, 'Hevy|New Scale'),
  ])
  const report = [R('2026-08-16', 84.0, 24.6)]
  const days = scaleOnly(mergeBodyweight({ scale: split.scale, report, hevy: [] }))
  check('§8.2 weight keeps every day from both scales', days.filter(d => d.kg != null).map(d => d.date), ['2026-08-10', '2026-08-12', '2026-08-13', '2026-08-15', '2026-08-16'])
  const fat = currentDeviceSeries(days, 'fatPct')
  check('§8.3 body fat only from the scale in use (plus its photo report)', fat.readings.map(r => r.date), ['2026-08-13', '2026-08-15', '2026-08-16'])
  check('§8.4 …which scale, since when, and how many readings were left out', [fat.device, fat.since, fat.dropped], ['New Scale', '2026-08-13', 2])
  const lean = currentDeviceSeries(days, 'leanKg')
  check('§8.5 nothing left out when one scale reported it', [lean.readings.length, lean.dropped], [1, 0])
  check('§8.6 no readings → empty', currentDeviceSeries([], 'fatPct'), { readings: [], device: null, since: null, dropped: 0 })
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log('One bodyweight series, the scale first.\n')
