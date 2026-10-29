#!/usr/bin/env node
/*
 * Verification — ai-proxy's get_day_summary reads the user's day (audit
 * 28.10.2026). It used to default to the UTC day and bound
 * hevy_workouts.start_time with zone-less strings (read as UTC), so after
 * local midnight it summarised yesterday, and a workout between 00:00 and
 * 01:00/02:00 Oslo counted on the day before.
 *
 * Runs the REAL homeDayStart / nextDay / getDaySummary (TypeScript stripped by
 * sucrase) with a fixed clock and an in-memory database — no network.
 *
 *   Run:  node scripts/verify-ai-day-summary.cjs
 */
const fs = require('fs')
const path = require('path')
const { transform } = require('sucrase')

let passed = 0
let failed = 0
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`) }
}

const src = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/ai-proxy/index.ts'), 'utf8')
const slice = (from, to) => {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a)
  if (a < 0 || b < 0) throw new Error(`ai-proxy: cannot find ${from}`)
  return src.slice(a, b + to.length)
}
// HOME_TZ, homeDay, homeDayStart and nextDay sit together; nextDay is one line.
const homeDays = slice('const HOME_TZ', '\nconst nextDay')
const nextDayLine = src.slice(src.indexOf('\nconst nextDay') + 1).split('\n')[0]
const code = transform('type AnyRecord = Record<string, any>\n'
  + homeDays.slice(0, -'\nconst nextDay'.length) + '\n' + nextDayLine + '\n'
  + slice('async function getDaySummary', '\n}\n'), { transforms: ['typescript'] }).code

function load(nowIso) {
  const FIXED = Date.parse(nowIso)
  class FixedDate extends Date {
    constructor(...a) { super(...(a.length ? a : [FIXED])) }
    static now() { return FIXED }
  }
  return new Function('Date', code + '; return { homeDayStart, nextDay, getDaySummary }')(FixedDate)
}

// Instants compare as instants; a zone-less string is read as UTC (Supabase's session zone).
const instant = (v) => Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v}Z`)
function fakeDb(tables) {
  return {
    from(table) {
      const f = []
      const q = {
        select: () => q, or: () => q, neq: () => q, order: () => q,
        eq: (c, v) => (f.push(r => c === 'user_id' || r[c] === v), q),
        gte: (c, v) => (f.push(r => instant(r[c]) >= instant(v)), q),
        gt: (c, v) => (f.push(r => instant(r[c]) > instant(v)), q),
        lte: (c, v) => (f.push(r => instant(r[c]) <= instant(v)), q),
        lt: (c, v) => (f.push(r => instant(r[c]) < instant(v)), q),
        then: (res) => res({ data: (tables[table] ?? []).filter(r => f.every(fn => fn(r))), error: null }),
      }
      return q
    },
  }
}

;(async () => {
  console.log('homeDayStart — 00:00 in Europe/Oslo')
  const { homeDayStart, nextDay } = load('2026-10-28T12:00:00Z')
  check('winter (UTC+1)', homeDayStart('2026-01-15'), '2026-01-14T23:00:00.000Z')
  check('summer (UTC+2)', homeDayStart('2026-07-15'), '2026-07-14T22:00:00.000Z')
  check('the spring-forward day and the next', [homeDayStart('2026-03-29'), homeDayStart('2026-03-30')], ['2026-03-28T23:00:00.000Z', '2026-03-29T22:00:00.000Z'])
  check('the fall-back day and the next', [homeDayStart('2026-10-25'), homeDayStart('2026-10-26')], ['2026-10-24T22:00:00.000Z', '2026-10-25T23:00:00.000Z'])
  check('nextDay crosses a month and a year', [nextDay('2026-10-31'), nextDay('2026-12-31'), nextDay('2028-02-28')], ['2026-11-01', '2027-01-01', '2028-02-29'])

  console.log('\nget_day_summary')
  // 00:30 in Oslo on 29.10.2026 (UTC+1) is still 28.10 in UTC.
  const { getDaySummary } = load('2026-10-28T23:30:00Z')
  const tables = { hevy_workouts: [{ id: 'w1', start_time: '2026-10-28T23:10:00+00:00' }] } // 00:10 Oslo on 29.10
  let r = await getDaySummary(fakeDb(tables), 'u', {})
  check('no date: the Oslo day, not the UTC one', r.date, '2026-10-29')
  check('a workout at 00:10 Oslo counts on its own day', r.workout_logged, true)
  r = await getDaySummary(fakeDb(tables), 'u', { date: '2026-10-28' })
  check('… and not on the day before', r.workout_logged, false)
  r = await getDaySummary(fakeDb({ hevy_workouts: [{ id: 'w2', start_time: '2026-07-14T22:30:00+00:00' }] }), 'u', { date: '2026-07-15' })
  check('summer: 00:30 Oslo (22:30 UTC the day before) counts on the Oslo day', r.workout_logged, true)
  r = await getDaySummary(fakeDb({ hevy_workouts: [{ id: 'w3', start_time: '2026-07-15T22:00:00+00:00' }] }), 'u', { date: '2026-07-15' })
  check('the next local midnight belongs to the next day', r.workout_logged, false)

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.log(`  ✗ crashed: ${e.stack}`); process.exit(1) })
