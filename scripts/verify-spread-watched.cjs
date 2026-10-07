// Checks src/features/media/spreadWatched.ts — the "Spread watched dates" planner.
// Runs itself in three time zones (days must not move).
require('sucrase/register')
const assert = require('assert')
const { execFileSync } = require('child_process')

if (!process.env.SPREAD_TZ_CHILD) {
  const outs = ['UTC', 'Pacific/Kiritimati', 'America/Los_Angeles', 'Europe/Oslo'].map(tz =>
    execFileSync(process.execPath, [__filename], { env: { ...process.env, TZ: tz, SPREAD_TZ_CHILD: '1' } }).toString())
  const days = outs.map(o => o.split('\n').find(l => l.startsWith('DAYS ')))
  assert.ok(days.every(d => d === days[0]), 'planned days identical in every time zone')
  console.log(outs[0].split('\n').filter(l => !l.startsWith('DAYS ')).join('\n').trim() + ' · same days in 4 time zones')
  process.exit(0)
}

const S = require('../src/features/media/spreadWatched.ts')
const { planSpread, DEFAULT_SPREAD, activeDays, cleanBreaks, addDays, spreadHeadline } = S
let n = 0
const ok = (c, m) => { assert.ok(c, m); n++ }
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++ }
const TODAY = '2026-10-07'

const series = (seasons, per, firstAir = '2015-01-01') => {
  const out = []
  for (let s = 1; s <= seasons; s++) for (let e = 1; e <= per; e++)
    out.push({ season: s, episode: e, airDate: addDays(firstAir, (s - 1) * 365 + (e - 1) * 7), runtime: 45 })
  return out
}
const input = (o) => ({ ...DEFAULT_SPREAD, start: '2020-04-01', end: '2026-06-07', seed: 42, ...o })

function check(inp, eps, label) {
  const r = planSpread(inp, eps, TODAY)
  ok(r.ok, `${label}: ok (${r.error || ''})`)
  const p = r.plan
  const end = inp.end > TODAY ? TODAY : inp.end
  eq(p.length, eps.length, `${label}: every episode once`)
  eq(new Set(p.map(x => `${x.season}x${x.episode}`)).size, eps.length, `${label}: no duplicates`)
  const breaks = cleanBreaks(inp.breaks, inp.start, end)
  const perDay = new Map()
  for (let i = 0; i < p.length; i++) {
    const x = p[i]
    perDay.set(x.day, (perDay.get(x.day) || 0) + 1)
    assert.ok(x.day >= inp.start && x.day <= end, `${label}: day in range`)
    if (r.stats.movedToAirDate === 0) {
      assert.ok(!breaks.some(b => x.day >= b.from && x.day <= b.to), `${label}: not in a break`)
      const wd = (new Date(`${x.day}T00:00:00Z`).getUTCDay() + 6) % 7
      assert.ok(inp.weekdays[wd] !== false, `${label}: weekday allowed`)
    }
    if (i > 0) {
      assert.ok(x.day >= p[i - 1].day, `${label}: order follows days`)
      assert.ok(x.at > p[i - 1].at, `${label}: at strictly increasing`)
    }
    const local = new Date(x.at)
    const pad = v => String(v).padStart(2, '0')
    assert.strictEqual(`${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`, x.day, `${label}: at falls on its day`)
  }
  n += 6
  if (r.stats.movedToAirDate === 0) ok(Math.max(...perDay.values()) <= inp.maxPerDay, `${label}: cap respected`)
  const A = activeDays(inp.start, end, inp.breaks, inp.weekdays)
  if (eps.length >= 2 && r.stats.movedToAirDate === 0) {
    ok(perDay.has(A[0]) && perDay.has(A[A.length - 1]), `${label}: first and last active day used`)
  }
  eq(r.stats.watchDays, perDay.size, `${label}: watch days`)
  eq(r.stats.activeDays, A.length, `${label}: active days`)
  eq(r.stats.months.reduce((s, m) => s + m.count, 0), eps.length, `${label}: month strip sums`)
  return r
}

// The owner's example: 7×17 from 01.04.2020 to 07.06.2026, a break 01.01.2022 → 01.06.2024.
const owner = input({ breaks: [{ from: '2022-01-01', to: '2024-05-31' }] })
const eps = series(7, 17)
const r1 = check(owner, eps, 'owner example')
ok(!r1.plan.some(x => x.day >= '2022-01-01' && x.day <= '2024-05-31'), 'owner: nothing in 2022–2024 break')
ok(r1.stats.perActiveDay < 1, 'owner: under one a day on average')
ok(/every \d+ days/.test(spreadHeadline(r1.stats)), `owner headline: ${spreadHeadline(r1.stats)}`)
const counts = new Set(r1.plan.reduce((m, x) => m.set(x.day, (m.get(x.day) || 0) + 1), new Map()).values())
ok(counts.size >= 2, 'owner: days vary (not all the same count)')

// Deterministic and seeded.
eq(planSpread(owner, eps, TODAY), planSpread(owner, eps, TODAY), 'same seed, same plan')
ok(JSON.stringify(planSpread({ ...owner, seed: 43 }, eps, TODAY).plan) !== JSON.stringify(r1.plan), 'new seed, new plan')
// Changing the start time never moves a day.
const late = planSpread({ ...owner, startTime: '22:30' }, eps, TODAY)
eq(late.plan.map(x => x.day), r1.plan.map(x => x.day), 'start time keeps the days')

// Dense: 119 episodes in 50 days ≈ 2.4/day; varied counts.
const dense = check(input({ start: '2026-01-01', end: '2026-02-19', respectAirDates: false }), eps, 'dense')
ok(dense.stats.perActiveDay > 2 && dense.stats.perActiveDay < 3, 'dense: ~2.4 a day')
ok(/^About 2\.4 episodes a day$/.test(spreadHeadline(dense.stats)), `dense headline: ${spreadHeadline(dense.stats)}`)
for (const style of ['steady', 'mixed', 'binge']) check(input({ start: '2026-01-01', end: '2026-03-01', style, respectAirDates: false }), eps, `style ${style}`)
const steady = planSpread(input({ start: '2026-01-01', end: '2026-03-01', style: 'steady', respectAirDates: false }), eps, TODAY)
const binge = planSpread(input({ start: '2026-01-01', end: '2026-03-01', style: 'binge', respectAirDates: false }), eps, TODAY)
ok(binge.stats.watchDays < steady.stats.watchDays, 'binge uses fewer days than steady')

// Weekdays: weekends only.
check(input({ start: '2025-01-01', end: '2025-12-31', weekdays: [false, false, false, false, false, true, true], respectAirDates: false }), eps, 'weekends only')

// Air dates: a series that aired during the window never gets a day before its air date.
const airing = series(2, 10, '2024-01-01')
const ra = check(input({ start: '2023-06-01', end: '2025-06-01' }), airing, 'air dates')
ok(ra.plan.every((x, i) => x.day >= airing[i].airDate), 'never before air date')
ok(ra.stats.movedToAirDate > 0, 'some moved to their air date')

// One episode, one day.
check(input({ start: '2025-03-03', end: '2025-03-03' }), [{ season: 1, episode: 1 }], 'one episode one day')
const one = planSpread(input({ start: '2020-01-01', end: '2020-12-31' }), [{ season: 1, episode: 1 }], TODAY)
eq(one.plan[0].day, '2020-01-01', 'one episode lands on the first day')

// Errors.
eq(planSpread(input({ start: '2026-05-01', end: '2026-04-01' }), eps, TODAY).ok, false, 'start after end')
eq(planSpread(input({}), [], TODAY).ok, false, 'nothing to mark')
eq(planSpread(input({ breaks: [{ from: '2019-01-01', to: '2027-01-01' }] }), eps, TODAY).ok, false, 'break covers all')
eq(planSpread(input({ weekdays: [false, false, false, false, false, false, false] }), eps, TODAY).ok, false, 'no weekdays')
const tight = planSpread(input({ start: '2026-01-01', end: '2026-01-10', maxPerDay: 6, respectAirDates: false }), eps, TODAY)
eq(tight.ok, false, 'cap infeasible')
const sMax = tight.suggestions.find(s => s.kind === 'maxPerDay')
const sEnd = tight.suggestions.find(s => s.kind === 'end')
eq(sMax.value, 12, 'suggest max 12 a day')
ok(planSpread(input({ start: '2026-01-01', end: '2026-01-10', maxPerDay: sMax.value, respectAirDates: false }), eps, TODAY).ok, 'raising the max fits')
ok(planSpread(input({ start: '2026-01-01', end: sEnd.value, respectAirDates: false }), eps, TODAY).ok, 'the suggested end fits')
eq(planSpread(input({ start: '2026-01-01', end: addDays(sEnd.value, -1), respectAirDates: false }), eps, TODAY).ok, false, 'a day earlier does not')

// End in the future is today; breaks clip and merge.
eq(planSpread(input({ start: '2026-09-01', end: '2027-01-01', respectAirDates: false }), eps.slice(0, 5), TODAY).stats.end, TODAY, 'end capped at today')
eq(cleanBreaks([{ from: '2020-03-01', to: '2020-05-01' }, { from: '2020-04-15', to: '2020-06-01' }, { from: '2020-06-02', to: '2020-06-03' }], '2020-04-01', '2020-12-31'),
  [{ from: '2020-04-01', to: '2020-06-03' }], 'breaks clipped and merged')
eq(activeDays('2024-02-28', '2024-03-01', [], DEFAULT_SPREAD.weekdays), ['2024-02-28', '2024-02-29', '2024-03-01'], 'leap day')

// Random sweep.
for (let k = 0; k < 150; k++) {
  const start = addDays('2018-01-01', (k * 37) % 2000)
  const end = addDays(start, 3 + (k * 53) % 900)
  const len = 1 + (k * 13) % 160
  const inp = input({ start, end, seed: k, style: ['steady', 'mixed', 'binge'][k % 3], maxPerDay: 2 + k % 8,
    breaks: k % 4 ? [{ from: addDays(start, 2), to: addDays(start, 2 + k % 60) }] : [], respectAirDates: false })
  const r = planSpread(inp, series(8, 20).slice(0, len), TODAY)
  if (r.ok) check(inp, series(8, 20).slice(0, len), `sweep ${k}`)
  else ok(r.suggestions.length > 0 || /watching days/.test(r.error), `sweep ${k}: a reason (${r.error})`)
}

console.log('DAYS ' + r1.plan.map(x => x.day).join(','))
console.log(`verify-spread-watched: ${n} assertions passed`)
