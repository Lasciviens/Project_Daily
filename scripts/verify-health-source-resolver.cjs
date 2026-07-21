#!/usr/bin/env node
/*
 * Phase 0 verification — stream-level source resolver (Fitbit Air integration,
 * redesigned 2026-07-21: hourly-slice union + priority ladders).
 *
 * Proves, against the REAL un-mocked module code (loaded via sucrase — the
 * repo has no unit-test runner by convention):
 *   1. IDENTITY — single-stream data returns the SAME array reference, so all
 *      of today's single-stream metrics (heart_rate, sleep, weight, …) stay
 *      byte-identical.
 *   2. REAL-DATA BUG FIX — fixtures shaped like the live 2026-07-10 step_count
 *      day (Watch + iPhone writing the same hours) and the live active_energy
 *      duplicate-delivery case dedupe correctly instead of double-counting.
 *   3. GAP-FILLING UNION — hours only one device covered are filled by that
 *      device; no hour is ever counted from two streams.
 *   4. LADDERS — cumulative: manual > watch > fitbit > phone (user's call);
 *      physiological (HR/…): fitbit first; sleep: whole-night winner, fitbit
 *      first, manual beats everything.
 *
 *   Run:  node scripts/verify-health-source-resolver.cjs
 */
require('sucrase/register')

const {
  resolveSourcePoints,
  streamTierOf,
  computeDailySeries,
  computeHourlyBuckets,
  computeHeartRateDailySeries,
  computeSleepSummary,
} = require('../src/features/training/healthAggregate')
const { strategyFor, ladderFor } = require('../src/features/training/healthSourceDefaults')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// HealthMetric factory. `src` is the raw source string; `fam` defaults to
// 'apple' unless the stream is Fitbit. hhmm places the point inside an hour.
let seq = 0
function m(metric, date, qty, src, hhmm = '08:00', fam) {
  seq++
  const row = {
    id: String(seq), user_id: 'u', metric_name: metric, date,
    recorded_at: `${date}T${hhmm}:00Z`, unit: 'count', source: src,
    value: { qty }, synced_at: 'x',
  }
  if (fam) row.source_family = fam
  return row
}
const WATCH = 'Furkan’s Apple Watch|Lasci'   // live compound watch string
const WATCH2 = 'Furkan’s Apple Watch'         // second watch-tier string (dup case)
const PHONE = 'Lasci'                          // the iPhone's own name
const FITBIT = 'Fitbit Air'
const fb = (metric, date, qty, hhmm) => m(metric, date, qty, FITBIT, hhmm, 'fitbit')

console.log('\n== 0. Config sanity ==')
{
  check("strategy: step_count → bucket", strategyFor('step_count') === 'bucket')
  check("strategy: heart_rate → bucket", strategyFor('heart_rate') === 'bucket')
  check("strategy: sleep_analysis → night", strategyFor('sleep_analysis') === 'night')
  check("strategy: weight_body_mass → day", strategyFor('weight_body_mass') === 'day')
  check("ladder: step_count = manual>watch>fitbit>phone",
    JSON.stringify(ladderFor('step_count')) === JSON.stringify(['manual','watch','fitbit','phone']))
  check("ladder: heart_rate fitbit-first", ladderFor('heart_rate')[1] === 'fitbit')
  check("ladder: flights_climbed apple-first (Air has no altimeter)",
    JSON.stringify(ladderFor('flights_climbed')) === JSON.stringify(['manual','watch','phone','fitbit']))
  check("tier: 'manual' source → manual", streamTierOf(m('x','2026-07-19',1,'manual')) === 'manual')
  check("tier: watch string → watch", streamTierOf(m('x','2026-07-19',1,WATCH)) === 'watch')
  check("tier: 'Lasci' → phone", streamTierOf(m('x','2026-07-19',1,PHONE)) === 'phone')
  check("tier: fitbit family → fitbit", streamTierOf(fb('x','2026-07-19',1)) === 'fitbit')
}

console.log('\n== 1. Identity: single-stream data passes through untouched ==')
{
  const hr = [m('heart_rate','2026-07-18',70,'Furkan’s Apple Watch','08:00'), m('heart_rate','2026-07-19',72,'Furkan’s Apple Watch','09:00')]
  check('single-stream heart_rate → identical array reference', resolveSourcePoints(hr,'heart_rate') === hr)
  const steps = [m('step_count','2026-07-18',100,WATCH), m('step_count','2026-07-19',300,WATCH,'21:00')]
  check('single-stream step_count → identical array reference', resolveSourcePoints(steps,'step_count') === steps)
  check('daily sum unchanged', JSON.stringify(computeDailySeries('step_count',steps)) ===
    JSON.stringify([{date:'2026-07-18',value:100},{date:'2026-07-19',value:300}]))
}

console.log('\n== 2. REAL 2026-07-10 shape: Watch + iPhone same hours → no double-count ==')
{
  // Simplified live shape: overlap hours where both streams write, one
  // phone-only hour (Watch charging). Live day: 5,721 (watch) + 4,634 (phone)
  // summed to 10,355 by the old code.
  const pts = [
    m('step_count','2026-07-10',1857,WATCH,'06:10'), m('step_count','2026-07-10',831,PHONE,'06:20'),
    m('step_count','2026-07-10',103, WATCH,'07:05'), m('step_count','2026-07-10',103,PHONE,'07:06'),
    m('step_count','2026-07-10',264, WATCH,'09:15'), m('step_count','2026-07-10',227,PHONE,'09:30'),
    m('step_count','2026-07-10',500, PHONE,'12:00'),                       // phone-ONLY hour → phone fills
  ]
  const out = computeDailySeries('step_count', pts)
  // watch hours: 1857+103+264 = 2224; phone-only hour adds 500 → 2724
  check('hourly winners: watch hours + phone-only gap = 2724 (NOT 3885 sum-all)',
    out.length === 1 && out[0].value === 2724, JSON.stringify(out))
  const hourly = computeHourlyBuckets('step_count', pts)
  check('hour 06 = watch only (1857)', hourly[6].value === 1857, JSON.stringify(hourly[6]))
  check('hour 12 = phone fills gap (500)', hourly[12].value === 500)
}

console.log('\n== 3. REAL active_energy shape: duplicate delivery under two watch strings ==')
{
  const pts = [
    m('active_energy','2026-07-07',50,WATCH2,'10:05'), m('active_energy','2026-07-07',53,WATCH2,'10:35'),
    m('active_energy','2026-07-07',50,'Furkan’s Apple Watch|Lasci|HUAWEI Health: Europe','10:06'),
  ]
  const out = computeDailySeries('active_energy', pts)
  // Same tier (both watch): keep ONE stream — WATCH2 has more points (2) → 103.
  check('duplicate watch-tier streams: one stream kept → 103 (NOT 153)',
    out.length === 1 && out[0].value === 103, JSON.stringify(out))
}

console.log('\n== 4. Gap-filling union across families (the Fitbit future) ==')
{
  // Watch worn 08-13, Fitbit worn all day: overlap hours → Watch (user: apple
  // preferred when both on wrist); Fitbit-only hours fill the rest.
  const pts = [
    m('step_count','2026-08-01',900,WATCH,'08:30'), fb('step_count','2026-08-01',850,'08:40'),
    m('step_count','2026-08-01',700,WATCH,'11:30'), fb('step_count','2026-08-01',680,'11:40'),
    fb('step_count','2026-08-01',600,'15:30'),   // fitbit-only
    fb('step_count','2026-08-01',400,'20:30'),   // fitbit-only
    m('step_count','2026-08-01',30, PHONE,'15:45'), // phone loses to fitbit in-hour
  ]
  const out = computeDailySeries('step_count', pts)
  // 900 + 700 (watch hours) + 600 + 400 (fitbit hours; phone loses 15h) = 2600
  check('watch overlap-hours + fitbit gap-hours = 2600 (fitbit beats phone in-hour)',
    out.length === 1 && out[0].value === 2600, JSON.stringify(out))
}

console.log('\n== 5. Heart rate: fitbit-first per hour, sensors never blended ==')
{
  function hr(date, src, fam, min, avg, max, hhmm) {
    seq++
    const r = { id:String(seq), user_id:'u', metric_name:'heart_rate', date, recorded_at:`${date}T${hhmm}:00Z`, unit:'count/min', source:src, value:{Min:min,Avg:avg,Max:max}, synced_at:'x' }
    if (fam) r.source_family = fam
    return r
  }
  const pts = [
    hr('2026-08-01','Furkan’s Apple Watch',undefined,55,75,130,'10:00'),
    hr('2026-08-01',FITBIT,'fitbit',50,65,110,'10:30'),  // same hour → fitbit wins
    hr('2026-08-01','Furkan’s Apple Watch',undefined,60,90,150,'17:00'), // watch-only hour fills
  ]
  const out = computeHeartRateDailySeries(pts)
  // winners: fitbit(10h) 50/65/110 + watch(17h) 60/90/150 → min 50, max 150, avg (65+90)/2
  check('day range from winning hours only: min 50 / max 150 / avg 77.5',
    out.length === 1 && out[0].min === 50 && out[0].max === 150 && Math.abs(out[0].avg - 77.5) < 1e-9,
    JSON.stringify(out))
}

console.log('\n== 6. Sleep: whole-night winner — fitbit > apple, manual > all ==')
{
  function sleep(nightDate, src, fam, total) {
    seq++
    const r = { id:String(seq), user_id:'u', metric_name:'sleep_analysis', date:nightDate,
      recorded_at:`${nightDate}T07:00:00Z`, unit:'hr', source:src,
      value:{ sleepStart:`${nightDate} 00:00:00 +0200`, sleepEnd:`${nightDate} 0${Math.min(9,Math.round(total))}:00:00 +0200`, totalSleep:total, core:total*0.6, rem:total*0.25, deep:total*0.15, awake:0 }, synced_at:'x' }
    if (fam) r.source_family = fam
    return r
  }
  const both = [sleep('2026-08-02','Furkan’s Apple Watch',undefined,7), sleep('2026-08-02',FITBIT,'fitbit',8)]
  const s = computeSleepSummary(both)
  check('both-device night → fitbit total 8h (never 15h)', s.length === 1 && Math.abs(s[0].total-8) < 1e-9, JSON.stringify(s))

  const appleOnly = [sleep('2026-08-03','Furkan’s Apple Watch',undefined,6)]
  const s2 = computeSleepSummary(appleOnly)
  check('apple-only night falls back to apple 6h', s2.length === 1 && Math.abs(s2[0].total-6) < 1e-9)

  // Manual correction must beat fitbit (this was ChatGPT-review bug: old code
  // resolved family first, manual second — a fitbit night would have hidden
  // the manual row).
  const manual = { ...sleep('2026-08-02','manual',undefined,9) }
  const s3 = computeSleepSummary([...both, manual])
  check('manual night beats fitbit (9h shown)', s3.length === 1 && Math.abs(s3[0].total-9) < 1e-9, JSON.stringify(s3))
}

console.log('\n== 6b. REAL 2026-07-20 shape: intra-stream workout twins collapse ==')
{
  // Live case: starting a Fitness-app workout duplicated the SAME minutes
  // inside the SAME watch stream (float-noise twins). One stream → the
  // cross-stream resolver rightly does nothing; the minute-collapse must.
  const pts = [
    m('step_count','2026-07-20',106.86025364796929,WATCH,'16:03'),
    { ...m('step_count','2026-07-20',106.86025364796926,WATCH,'16:03'), recorded_at:'2026-07-20T16:03:41Z' },
    m('step_count','2026-07-20',37.66,WATCH,'16:02'),
    { ...m('step_count','2026-07-20',106.86,WATCH,'16:02'), recorded_at:'2026-07-20T16:02:55Z' },
    m('step_count','2026-07-20',50,WATCH,'16:05'),   // clean minute untouched
  ]
  const out = computeDailySeries('step_count', pts)
  // per-minute max: 16:03→106.86…, 16:02→106.86, 16:05→50 = 263.72…
  check('same-stream same-minute twins keep max per minute (≈264, not 408)',
    out.length === 1 && Math.abs(out[0].value - (106.86025364796929 + 106.86 + 50)) < 0.01,
    JSON.stringify(out))

  // Non-sum metrics are untouched by the collapse (avg of twins is harmless
  // and dropping points would distort minmaxavg counts).
  const hrv = [
    m('heart_rate_variability','2026-07-20',40,WATCH,'08:00'),
    { ...m('heart_rate_variability','2026-07-20',60,WATCH,'08:00'), recorded_at:'2026-07-20T08:00:30Z' },
  ]
  const hv = computeDailySeries('heart_rate_variability', hrv)
  check('average-type metrics NOT collapsed (avg 50 from both points)',
    hv.length === 1 && hv[0].value === 50, JSON.stringify(hv))
}

console.log('\n== 7. Day-strategy metrics: one winner per day, no in-day mixing ==')
{
  const w = [
    m('weight_body_mass','2026-08-01',80,'Furkan’s Apple Watch','08:00'),
    fb('weight_body_mass','2026-08-01',79,'09:00'),
  ]
  const out = computeDailySeries('weight_body_mass', w)
  check('weight: apple-first day winner → 80', out.length === 1 && out[0].value === 80, JSON.stringify(out))

  const hrv = [
    m('heart_rate_variability','2026-08-01',45,'Furkan’s Apple Watch','08:00'),
    fb('heart_rate_variability','2026-08-01',52,'03:00'),
    fb('heart_rate_variability','2026-08-01',48,'04:00'),
  ]
  const out2 = computeDailySeries('heart_rate_variability', hrv)
  // fitbit-first day winner: avg(52,48)=50 — apple's 45 never mixed in.
  check('HRV: fitbit day winner avg 50 (apple 45 not blended)', out2.length === 1 && out2[0].value === 50, JSON.stringify(out2))
}

console.log(`\n${failed === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
