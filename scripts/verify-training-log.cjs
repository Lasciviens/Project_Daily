#!/usr/bin/env node
/*
 * Verification — Training → Log (one entry per real session, and the session
 * detail), against the REAL un-mocked modules loaded through sucrase (no
 * unit-test runner by this repo's convention). Fixtures are synthetic but
 * shaped like the live rows (a recurring template titled like the Hevy
 * routine; Hevy's workout mirrored into Apple Health a second apart).
 *   components/calendar/calendarSessions.ts — plan ↔ workout pairing, missed/today/upcoming
 *   workoutSessionStats.ts                  — sets, volume, RPE, top set per exercise
 *   workoutHealthMatch.ts                   — which Apple Health workout is this session
 *   health/workoutRaw.ts                    — the HAE raw-field readers
 *   sessionRef.ts                           — what the training-session popup opens
 *   sessionLinks.ts                         — which workout a session popup shows (Health back-links)
 *   components/calendar/calendarPlans.ts    — plans per day (blocks + projected templates)
 *   components/calendar/monthGrid.ts        — month weeks, one mark per day, week totals
 *   pages/trainingTabs.ts                   — ?view= for Log / Library, the moved Body view
 *
 *   Run:  node scripts/verify-training-log.cjs
 */
require('sucrase/register')
process.env.TZ = 'Europe/Oslo'

const cs = require('../src/features/training/components/calendar/calendarSessions')
const { summarizeWorkout, compareSets } = require('../src/features/training/workoutSessionStats')
const { matchHealthWorkout, overlapSeconds } = require('../src/features/training/workoutHealthMatch')
const raw = require('../src/features/health/workoutRaw')
const sr = require('../src/features/training/sessionRef')
const { buildPlansByDate } = require('../src/features/training/components/calendar/calendarPlans')
const mg = require('../src/features/training/components/calendar/monthGrid')
const tabs = require('../src/features/training/pages/trainingTabs')
const links = require('../src/features/training/sessionLinks')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

const TODAY = '2026-09-27'
const recurring = (id, title, start = '16:30:00') => ({ id, title, kind: 'recurring', scheduleBlock: { id: id.split('__')[0], title, start_time: start, end_time: '17:30:00', days_of_week: [1], category: 'training' } })
const block = (id, title, o = {}) => ({ id, title, kind: 'block', timeBlock: { id, title, date: o.date ?? '2026-09-22', start_time: o.start ?? '16:45:00', duration_minutes: 60, category: 'training', source_type: o.sourceType ?? 'manual', source_id: o.sourceId ?? null } })
// 15:35 UTC = 17:35 Oslo (CEST).
const workout = (id, title, startUtc = '2026-09-22T15:35:33Z', routineId = null) => ({ id, title, routine_id: routineId, start_time: startUtc, end_time: null, hevy_created_at: startUtc })
const day = (date, plans, workouts, hasActivity = false) => cs.matchDaySessions({ date, todayStr: TODAY, plans, workouts, hasActivity })

// ─── calendarSessions ───────────────────────────────────────────────────────
console.log('\n== calendarSessions: the reported duplicate ==')
{
  const r = day('2026-09-22', [recurring('sb1__2026-09-22', 'Lower A (Quadriceps & Kalf)')], [workout('w1', 'Lower A (Quadriceps & Kalf)')])
  check('a recurring slot and its same-titled workout are ONE session', r.sessions.length === 1 && r.openPlans.length === 0)
  check('the session carries the plan it covered', r.sessions[0].plans.length === 1 && r.sessions[0].plans[0].id === 'sb1__2026-09-22')
  check('its note reads "Planned weekly for 16:30" (the popup\'s words)', sr.coveredPlanNote(r.sessions[0].plans, r.sessions[0].workout) === 'Planned weekly for 16:30')
}

console.log('\n== calendarSessions: matching evidence ==')
{
  check('routine id beats titles (score 3)', cs.planWorkoutScore(block('b', 'Push', { sourceType: 'training_session', sourceId: 'R1' }), workout('w', 'Something else', undefined, 'R1')) === 3)
  check('a routine id is only read from a training_session block', cs.planWorkoutScore(block('b', 'Push', { sourceId: 'R1' }), workout('w', 'Other', undefined, 'R1')) === 0)
  check('same title, accents and punctuation ignored (score 2)', cs.planWorkoutScore(recurring('r', 'Üpper-A'), workout('w', 'upper a')) === 2)
  check('a contained title (score 1)', cs.planWorkoutScore(recurring('r', 'Push day — heavy'), workout('w', 'Push day')) === 1)
  check('unrelated titles (score 0)', cs.planWorkoutScore(recurring('r', 'Upper A'), workout('w', 'Random')) === 0)
  check('planStartHHMM reads a recurring template', cs.planStartHHMM(recurring('r', 'X', '16:45:00')) === '16:45')
  check('planStartHHMM reads a one-off block', cs.planStartHHMM(block('b', 'X', { start: '07:05:00' })) === '07:05')
  check('workoutStartHHMM is the LOCAL time', cs.workoutStartHHMM(workout('w', 'X', '2026-09-22T15:35:33Z')) === '17:35')
  check('workoutStartHHMM without a start → null', cs.workoutStartHHMM({ start_time: null }) === null)

  const r = day('2026-09-22',
    [block('b1', 'Push', { sourceType: 'training_session', sourceId: 'R1' })],
    [workout('w1', 'Push'), workout('w2', 'Push (edited)', '2026-09-22T16:00:00Z', 'R1')])
  check('with two candidates, the routine-id workout takes the plan', r.sessions.find(s => s.workout.id === 'w2').plans.length === 1)
  check('…and the other stays an unplanned session', r.sessions.find(s => s.workout.id === 'w1').plans.length === 0 && r.openPlans.length === 0)
}

console.log('\n== calendarSessions: plans nothing covered ==')
{
  const missed = day('2026-09-25', [recurring('sb4__2026-09-25', 'Lower B')], [])
  check('a past plan with nothing logged stays a plan: missed', missed.sessions.length === 0 && missed.openPlans[0].status === 'missed')
  const today = day(TODAY, [recurring('sb__t', 'Upper A')], [])
  check('today without a workout → today', today.openPlans[0].status === 'today')
  const up = day('2026-09-29', [recurring('sb__u', 'Lower A')], [])
  check('a future plan → upcoming', up.openPlans[0].status === 'upcoming')
  const strava = day('2026-09-24', [recurring('sb__s', 'Run')], [], true)
  check('a plan on a Strava-only day → done (not missed)', strava.openPlans[0].status === 'done')
  const future = day('2026-09-29', [recurring('sb__f', 'Mystery')], [workout('wf', 'Random', '2026-09-29T15:00:00Z')])
  check('a future day never pairs by "same day" alone', future.openPlans.length === 1 && future.sessions[0].plans.length === 0)
}

console.log('\n== calendarSessions: several plans or workouts on one day ==')
{
  const twice = day('2026-09-22', [block('b1', 'Upper A'), recurring('sb1__2026-09-22', 'Upper A')], [workout('w1', 'Upper A')])
  check('the same session planned twice (block + recurring) folds into one entry', twice.sessions.length === 1 && twice.sessions[0].plans.length === 2 && twice.openPlans.length === 0)

  const swap = day('2026-09-22', [recurring('sb1__2026-09-22', 'Upper A (Chest & Arm)')], [workout('w1', 'Random', '2026-09-22T10:00:00Z')])
  check('a different workout on a planned day covers that plan', swap.sessions[0].plans.length === 1 && swap.openPlans.length === 0)
  check('…and says what it replaced', sr.coveredPlanNote(swap.sessions[0].plans, swap.sessions[0].workout) === 'In place of ⟳ Upper A (Chest & Arm) · 16:30')

  const split = day('2026-09-22',
    [recurring('m__d', 'Run', '07:00:00'), recurring('e__d', 'Upper A', '16:30:00')],
    [workout('w1', 'Random', '2026-09-22T10:00:00Z')])          // 12:00 local
  check('a leftover workout covers the NEAREST plan in time', split.sessions[0].plans[0].id === 'e__d' && split.openPlans.length === 1 && split.openPlans[0].plan.id === 'm__d')
  check('…the other past plan is missed', split.openPlans[0].status === 'missed')

  const both = day('2026-09-22',
    [recurring('a__d', 'Lower A', '16:45:00'), recurring('b__d', 'Upper B', '08:00:00')],
    [workout('w1', 'Lower A', '2026-09-22T15:35:00Z')])
  check('a title match wins before any same-day fill', both.sessions[0].plans[0].id === 'a__d')
  check('…and the unmatched plan stays missed', both.openPlans.length === 1 && both.openPlans[0].plan.id === 'b__d' && both.openPlans[0].status === 'missed')

  const order = day('2026-09-22', [], [workout('late', 'B', '2026-09-22T18:00:00Z'), workout('early', 'A', '2026-09-22T06:00:00Z')])
  check('sessions are in start-time order', order.sessions.map(s => s.workout.id).join() === 'early,late')
  check('an unplanned workout has no note', sr.coveredPlanNote(order.sessions[0].plans, order.sessions[0].workout) === null)

  const opens = day('2026-09-29', [recurring('x__d', 'Late', '18:00:00'), recurring('y__d', 'Early', '06:00:00')], [])
  check('open plans are in start-time order', opens.openPlans.map(o => o.plan.id).join() === 'y__d,x__d')
}

// ─── workoutSessionStats ────────────────────────────────────────────────────
console.log('\n== workoutSessionStats ==')
{
  const set = (index, o) => ({ id: `s${index}-${Math.random()}`, index, type: 'normal', weight_kg: null, reps: null, duration_seconds: null, distance_meters: null, custom_metric: null, rpe: null, ...o })
  const ex = (id, index, type, sets) => ({ id, index, title: id, exercise_template_id: `T-${id}`, sets, template: type ? { type } : undefined })
  const stats = summarizeWorkout([
    ex('Bench', 0, 'weight_reps', [
      set(0, { type: 'warmup', weight_kg: 40, reps: 10 }),
      set(1, { weight_kg: 80, reps: 8, rpe: 8 }),
      set(2, { weight_kg: 80, reps: 9, rpe: 9 }),
      set(3, { weight_kg: 60, reps: 12, type: 'dropset' }),
    ]),
    ex('Pull-up', 1, 'bodyweight_assisted', [set(0, { weight_kg: 20, reps: 8 }), set(1, { weight_kg: 10, reps: 6 }), set(2, { weight_kg: 10, reps: 7 })]),
    ex('Plank', 2, 'duration', [set(0, { duration_seconds: 60 }), set(1, { duration_seconds: 75 })]),
    ex('Push-up', 3, 'reps_only', [set(0, { reps: 20 }), set(1, { reps: 25, rpe: 0 })]),
    ex('Dip', 4, 'bodyweight_weighted', [set(0, { weight_kg: 10, reps: 10 })]),
  ])
  check('warm-ups are counted apart', stats.warmupSets === 1 && stats.workingSets === 11, `${stats.workingSets}/${stats.warmupSets}`)
  check('exercise count', stats.exercises === 5)
  check('volume = weighted working sets only (warm-up, assisted, reps-only left out)', stats.volumeKg === 80 * 8 + 80 * 9 + 60 * 12 + 10 * 10, String(stats.volumeKg))
  check('avg RPE over rated sets only (0 is not a rating)', stats.avgRpe === 8.5 && stats.ratedSets === 2, `${stats.avgRpe} / ${stats.ratedSets}`)
  const top = Object.fromEntries(stats.topSets.map(t => [t.title, t.set]))
  check('weighted top set: heaviest, then most reps', top.Bench.weight_kg === 80 && top.Bench.reps === 9)
  check('assisted top set: least assistance, then most reps', top['Pull-up'].weight_kg === 10 && top['Pull-up'].reps === 7)
  check('timed top set: longest', top.Plank.duration_seconds === 75)
  check('reps-only top set: most reps', top['Push-up'].reps === 25)
  check('top sets keep exercise order and carry the type', stats.topSets.map(t => t.title).join() === 'Bench,Pull-up,Plank,Push-up,Dip' && stats.topSets[0].type === 'weight_reps')

  const empty = summarizeWorkout([ex('Warm', 0, 'weight_reps', [set(0, { type: 'warmup', weight_kg: 20, reps: 10 })])])
  check('only warm-ups → no top set, no volume, no RPE', empty.topSets.length === 0 && empty.volumeKg === null && empty.avgRpe === null)
  check('no template → heaviest set still wins', compareSets(set(0, { weight_kg: 50, reps: 5 }), set(1, { weight_kg: 45, reps: 12 }), null) > 0)
  check('distance: farther, then faster', compareSets(set(0, { distance_meters: 5000, duration_seconds: 1500 }), set(1, { distance_meters: 5000, duration_seconds: 1600 }), 'distance_duration') > 0)
}

// ─── workoutHealthMatch ─────────────────────────────────────────────────────
console.log('\n== workoutHealthMatch ==')
{
  const hevy = { start_time: '2026-08-25T15:10:29Z', end_time: '2026-08-25T15:54:42Z' }
  const watch = { id: 'a', start_time: '2026-08-25T15:10:29Z', end_time: '2026-08-25T15:54:48Z' }
  const walk = { id: 'walk', start_time: '2026-08-25T14:00:00Z', end_time: '2026-08-25T15:05:00Z' }
  check('Hevy mirrored into Apple Health (seconds apart) matches', matchHealthWorkout(hevy, [walk, watch])?.id === 'a')
  check('a walk that ended before the session does not', matchHealthWorkout(hevy, [walk]) === null)
  check('overlapSeconds of the mirrored pair ≈ the session length', Math.abs(overlapSeconds(hevy, watch) - 2653) < 1)

  const long = { start_time: '2026-09-18T14:43:18Z', end_time: '2026-09-18T15:15:08Z' }
  const stray = { id: 'stray', start_time: '2026-09-18T15:14:58Z', end_time: '2026-09-18T15:15:14Z' }
  check('a few-second watch workout at the very end is NOT the session', matchHealthWorkout(long, [stray]) === null)

  const late = { id: 'late', start_time: '2026-08-25T15:20:00Z', end_time: '2026-08-25T15:54:00Z' }
  check('a watch workout started 10 min late still matches', matchHealthWorkout(hevy, [late])?.id === 'late')
  const forgot = { id: 'forgot', start_time: '2026-08-25T15:10:00Z', end_time: '2026-08-25T16:40:00Z' }
  check('a watch left running (session ≈ half of it) still matches', matchHealthWorkout(hevy, [forgot])?.id === 'forgot')
  check('the larger overlap wins', matchHealthWorkout(hevy, [late, watch])?.id === 'a')
  const noEnd = { id: 'dur', start_time: '2026-08-25T15:10:30Z', end_time: null, duration_seconds: 2650 }
  check('a missing end_time falls back to duration_seconds', matchHealthWorkout(hevy, [noEnd])?.id === 'dur')
  check('a session without an end matches nothing', matchHealthWorkout({ start_time: hevy.start_time, end_time: null }, [watch]) === null)
  check('a brushing overlap (<60% of the shorter) is rejected', matchHealthWorkout(hevy, [{ id: 'brush', start_time: '2026-08-25T15:40:00Z', end_time: '2026-08-25T16:30:00Z' }]) === null)
}

// ─── workoutRaw ─────────────────────────────────────────────────────────────
console.log('\n== workoutRaw ==')
{
  check('rawQty: plain number', raw.rawQty(154) === 154)
  check('rawQty: { qty, units }', raw.rawQty({ qty: 100.5, units: 'count/min' }) === 100.5)
  check('rawQty: junk → null', raw.rawQty('12') === null && raw.rawQty({ qty: 'x' }) === null && raw.rawQty(NaN) === null)
  const d = raw.parseRawDate('2026-08-25 17:10:29 +0200')
  check('parseRawDate reads the HAE form (Safari rejects it natively)', d && d.toISOString() === '2026-08-25T15:10:29.000Z', d && d.toISOString())
  check('parseRawDate passes ISO through', raw.parseRawDate('2026-08-25T15:10:29Z').toISOString() === '2026-08-25T15:10:29.000Z')
  check('parseRawDate: junk → null', raw.parseRawDate('soon') === null && raw.parseRawDate(5) === null)
  check('rawHHMM is local time', raw.rawHHMM('2026-08-25 17:10:00 +0200') === '17:10' && raw.rawHHMM(null) === '')
  const series = raw.heartRateSeries({ heartRateData: [
    { Avg: 83.4, Min: 81, Max: 87, date: '2026-08-25 17:10:00 +0200' },
    { Min: 80, date: '2026-08-25 17:11:00 +0200' },
    { Avg: 120, date: '2026-08-25 17:12:00 +0200' },
  ] })
  check('heartRateSeries keeps readable points and rounds', series.length === 2 && series[0].avg === 83 && series[0].range.join() === '81,87' && series[0].label === '17:10')
  check('heartRateSeries: a missing Min/Max collapses to the average', series[1].range.join() === '120,120')
  check('heartRateSeries: no array → []', raw.heartRateSeries({}).length === 0)
  check('heartRateRecoveryDrop = first − last', raw.heartRateRecoveryDrop({ heartRateRecovery: [{ Avg: 113 }, { Avg: 100 }, { Avg: 92 }] }) === 21)
  check('heartRateRecoveryDrop needs two samples', raw.heartRateRecoveryDrop({ heartRateRecovery: [{ Avg: 113 }] }) === null)
  check('energyKcal: stored kcal passes through', raw.energyKcal(238.8, { qty: 238.8, units: 'kcal' }) === 238.8)
  check('energyKcal: a kJ export is converted', Math.round(raw.energyKcal(1000, { qty: 1000, units: 'kJ' })) === 239)
  check('energyKcal: falls back to the raw field', raw.energyKcal(null, { qty: 300, units: 'kcal' }) === 300 && raw.energyKcal(null, undefined) === null)
}

// ─── sessionRef: what the training-session popup opens ─────────────────────
console.log('\n== sessionRef ==')
{
  const resolve = (o) => sr.resolveTrainingSession({ date: '2026-09-22', todayStr: TODAY, plans: [], workouts: [], hasActivity: false, ...o })
  check('planItemId: a block is its own id', sr.planItemId({ kind: 'block', id: 'b1', date: '2026-09-22' }) === 'b1')
  check('planItemId: a recurring occurrence is <template>__<date>', sr.planItemId({ kind: 'recurring', id: 'sb1', date: '2026-09-22' }) === 'sb1__2026-09-22')

  const covered = resolve({
    plan: { kind: 'recurring', id: 'sb1', date: '2026-09-22' },
    plans: [recurring('sb1__2026-09-22', 'Lower A (Quadriceps & Kalf)')],
    workouts: [workout('w1', 'Lower A (Quadriceps & Kalf)')],
  })
  check('a plan a workout covered opens as that WORKOUT (the reported bug: it opened the schedule form)', covered.kind === 'workout' && covered.workoutId === 'w1' && covered.openedFromPlan)
  check('…carrying the plan it covered', covered.kind === 'workout' && covered.plans.length === 1 && covered.plans[0].id === 'sb1__2026-09-22')

  const byRoutine = resolve({
    plan: { kind: 'block', id: 'b1', date: '2026-09-22' },
    plans: [block('b1', 'Push', { sourceType: 'training_session', sourceId: 'R1' })],
    workouts: [workout('w1', 'Push'), workout('w2', 'Push (edited)', '2026-09-22T16:00:00Z', 'R1')],
  })
  check('a block planned from a routine opens the workout of THAT routine', byRoutine.kind === 'workout' && byRoutine.workoutId === 'w2')

  const other = resolve({
    plan: { kind: 'block', id: 'b2', date: '2026-09-22' },
    plans: [block('b1', 'Upper A'), block('b2', 'Lower B', { start: '07:00:00' })],
    workouts: [workout('w1', 'Upper A')],
  })
  check('pairing sees every plan that day: a workout that is ANOTHER plan\'s stays out of this one', other.kind === 'plan' && other.plan.id === 'b2' && other.status === 'missed')

  const upcoming = resolve({ date: '2026-09-29', plan: { kind: 'recurring', id: 'sb2', date: '2026-09-29' }, plans: [recurring('sb2__2026-09-29', 'Lower A')] })
  check('a future plan opens as the plan: upcoming', upcoming.kind === 'plan' && upcoming.status === 'upcoming' && !upcoming.offSchedule)
  const today = resolve({ date: TODAY, plan: { kind: 'block', id: 'bt', date: TODAY }, plans: [block('bt', 'Upper A', { date: TODAY })] })
  check('today\'s open plan → today', today.kind === 'plan' && today.status === 'today')
  const strava = resolve({ plan: { kind: 'block', id: 'bs', date: '2026-09-22' }, plans: [block('bs', 'Run')], hasActivity: true })
  check('a plan on a Strava day → done (never missed)', strava.kind === 'plan' && strava.status === 'done')

  const gone = resolve({ plan: { kind: 'block', id: 'x', date: '2026-09-22' }, plans: [] })
  check('a deleted plan → missing', gone.kind === 'missing')
  const moved = resolve({ date: '2026-09-29', plan: { kind: 'recurring', id: 'sb9', date: '2026-09-29' }, plans: [], planRow: recurring('sb9__2026-09-29', 'Upper B') })
  check('a template that no longer falls on that day still opens, flagged off-schedule', moved.kind === 'plan' && moved.offSchedule && moved.status === 'upcoming')
  check('no ref at all → missing', resolve({}).kind === 'missing')

  const direct = resolve({ workoutId: 'w1', plans: [recurring('sb1__2026-09-22', 'Lower A')], workouts: [workout('w1', 'Lower A')] })
  check('a workout opens as the workout, with the plan it covered', direct.kind === 'workout' && direct.plans.length === 1 && !direct.openedFromPlan)
  const lone = resolve({ workoutId: 'wX', workouts: [] })
  check('a workout outside the day read still opens (no plans)', lone.kind === 'workout' && lone.workoutId === 'wX' && lone.plans.length === 0)

  check('planRefOf: a recurring entry → template id + the day', JSON.stringify(sr.planRefOf(recurring('sb1__2026-09-22', 'X'), '2026-09-22')) === JSON.stringify({ kind: 'recurring', id: 'sb1', date: '2026-09-22' }))
  check('planRefOf: a block → its id and its OWN date', JSON.stringify(sr.planRefOf(block('b1', 'X', { date: '2026-09-21' }), '2026-09-22')) === JSON.stringify({ kind: 'block', id: 'b1', date: '2026-09-21' }))

  check('sessionWhenLabel: weekday + DD.MM.YYYY', sr.sessionWhenLabel('2026-09-29', '16:30', 51, TODAY) === 'Tue 29.09.2026 · 16:30 · 51m', sr.sessionWhenLabel('2026-09-29', '16:30', 51, TODAY))
  check('sessionWhenLabel: no time/length drops them', sr.sessionWhenLabel('2025-12-30', null, null, TODAY) === 'Tue 30.12.2025', sr.sessionWhenLabel('2025-12-30', null, null, TODAY))
  check('planMinutes: a block\'s duration', sr.planMinutes(block('b', 'X')) === 60)
  check('planMinutes: a template start → end', sr.planMinutes(recurring('r__d', 'X', '16:30:00')) === 60)
  check('planMinutes: a template across midnight', sr.planMinutes({ id: 'r', title: 'X', kind: 'recurring', scheduleBlock: { start_time: '23:30:00', end_time: '00:30:00' } }) === 60)
  check('planLabel names a recurring plan with ⟳ and its time', sr.planLabel(recurring('r__d', 'Lower A', '16:45:00')) === '⟳ Lower A · 16:45')
  check('coveredPlanNote: the plan IS this session → "Planned for <time>"', sr.coveredPlanNote([block('b', 'Push', { start: '18:00:00' })], workout('w', 'Push')) === 'Planned for 18:00')
  check('coveredPlanNote: a recurring slot → "Planned weekly for <time>"', sr.coveredPlanNote([recurring('r__d', 'Lower A', '16:45:00')], workout('w', 'Lower A')) === 'Planned weekly for 16:45')
  check('coveredPlanNote: a different session on a planned day says what it replaced', sr.coveredPlanNote([recurring('r__d', 'Upper B', '17:30:00')], workout('w', 'Random')) === 'In place of ⟳ Upper B · 17:30')
  check('coveredPlanNote: no plans → null', sr.coveredPlanNote([], workout('w', 'X')) === null)
  check('weekdaysLabel: Monday first', sr.weekdaysLabel([5, 1, 3]) === 'Mon, Wed, Fri' && sr.weekdaysLabel([0, 6]) === 'Sat, Sun')
  check('weekdaysLabel: all seven → every day', sr.weekdaysLabel([0, 1, 2, 3, 4, 5, 6]) === 'every day')
}

// ─── sessionLinks ───────────────────────────────────────────────────────────
console.log('\n== sessionLinks: which workout a session popup shows ==')
{
  const byId = { kind: 'training-session', workoutId: 'w1' }
  const fromPlan = { kind: 'training-session', plan: { kind: 'recurring', id: 'sb1', date: '2026-09-22' } }
  const other = { kind: 'training-session', plan: { kind: 'recurring', id: 'sb1', date: '2026-09-22' } }
  check('a request by workout id shows that workout', links.shownWorkoutIdOf(byId) === 'w1')
  check('a plan request shows nothing known before it resolves', links.shownWorkoutIdOf(fromPlan) === null)
  links.rememberShownWorkout(fromPlan, 'w9')
  check('…and the covering workout once it has', links.shownWorkoutIdOf(fromPlan) === 'w9')
  check('…keyed by the request object, not its contents', links.shownWorkoutIdOf(other) === null)
  links.rememberShownWorkout(fromPlan, null)
  check('…cleared again when it no longer shows a workout', links.shownWorkoutIdOf(fromPlan) === null)
}

// ─── calendarPlans ──────────────────────────────────────────────────────────
console.log('\n== calendarPlans ==')
{
  const tpl = (id, days, o = {}) => ({ id, title: o.title ?? 'Lower A', days_of_week: days, start_time: o.start ?? '16:30:00', end_time: o.end ?? '17:30:00', category: o.category ?? 'training', effective_from: o.from })
  const m = buildPlansByDate('2026-09-21', '2026-09-27',
    [{ id: 'b1', title: 'Push', date: '2026-09-23' }, { id: 'bx', title: 'Outside', date: '2026-10-01' }],
    [tpl('sb1', [1, 3]), tpl('work', [1, 2, 3, 4, 5], { category: 'work', title: 'Stand-up' }), tpl('late', [5], { from: '2026-09-26' })])
  check('a one-off block lands on its date', m.get('2026-09-23')?.some(p => p.id === 'b1' && p.kind === 'block'))
  check('a block outside the range is dropped', ![...m.values()].flat().some(p => p.id === 'bx'))
  check('a training template projects onto its weekdays with <id>__<date>', m.get('2026-09-21')?.[0]?.id === 'sb1__2026-09-21' && m.get('2026-09-23')?.some(p => p.id === 'sb1__2026-09-23'))
  check('a non-training template is ignored', ![...m.values()].flat().some(p => p.title === 'Stand-up'))
  check('never before effective_from', !m.has('2026-09-25'))
  const night = buildPlansByDate('2026-09-21', '2026-09-22', [], [tpl('n', [1], { start: '23:00:00', end: '01:00:00' })])
  check('a cross-midnight template is ONE entry, on the day it starts', night.get('2026-09-21')?.length === 1 && !night.has('2026-09-22'))
}

// ─── monthGrid ──────────────────────────────────────────────────────────────
console.log('\n== monthGrid ==')
{
  const sep = mg.monthWeeks(2026, 8)
  check('September 2026: five Monday-first weeks', sep.length === 5 && sep[0].weekStart === '2026-08-31' && sep[4].cells[6].date === '2026-10-04')
  check('every week has seven days', sep.every(w => w.cells.length === 7))
  check('neighbouring months are marked', sep[0].cells[0].inMonth === false && sep[0].cells[1].inMonth === true && sep[0].cells[1].dayOfMonth === 1)
  check('the grid range covers the neighbours', JSON.stringify(mg.monthGridRange(sep)) === JSON.stringify({ from: '2026-08-31', to: '2026-10-04' }))
  const feb = mg.monthWeeks(2027, 1)
  check('a February starting on Monday is four weeks', feb.length === 4 && feb[0].weekStart === '2027-02-01' && feb[3].cells[6].date === '2027-02-28')
  const mar = mg.monthWeeks(2026, 2)
  check('March 2026 needs six weeks (starts on a Sunday)', mar.length === 6 && mar[0].weekStart === '2026-02-23')
  check('DST week keeps whole days (29 Mar 2026)', mar.flatMap(w => w.cells).filter(c => c.inMonth).length === 31)
  check('monthOf / shiftMonth across a year', JSON.stringify(mg.shiftMonth(mg.monthOf('2026-12-05'), 1)) === JSON.stringify({ year: 2027, month: 0 }) && JSON.stringify(mg.shiftMonth({ year: 2026, month: 0 }, -1)) === JSON.stringify({ year: 2025, month: 11 }))
  const d = (sessions, statuses) => ({ sessions: Array(sessions).fill({}), openPlans: statuses.map(status => ({ status })) })
  check('a workout wins over any open plan', mg.dayMarkOf(d(1, ['missed'])) === 'done')
  check('a Strava-covered plan reads done', mg.dayMarkOf(d(0, ['done'])) === 'done')
  check('today beats missed beats upcoming', mg.dayMarkOf(d(0, ['upcoming', 'today'])) === 'today' && mg.dayMarkOf(d(0, ['upcoming', 'missed'])) === 'missed' && mg.dayMarkOf(d(0, ['upcoming'])) === 'upcoming')
  check('an empty day has no mark', mg.dayMarkOf(d(0, [])) === null)
  check('week total counts workouts', mg.weekSessionCount([d(1, []), d(2, ['missed']), d(0, ['upcoming'])]) === 3)
}

// ─── trainingTabs ───────────────────────────────────────────────────────────
console.log('\n== trainingTabs ==')
{
  check('Log defaults to Hevy (old "workouts" too)', tabs.parseLogView(null) === 'hevy' && tabs.parseLogView('workouts') === 'hevy' && tabs.parseLogView('strava') === 'strava')
  check('Library defaults to Routines', tabs.parseLibraryView(null) === 'routines' && tabs.parseLibraryView('exercises') === 'exercises')
  check('the old Log → Body link moves to Health → Body', tabs.movedLogView('log', 'body') === '/health?section=body')
  check('…only on Log', tabs.movedLogView('library', 'body') === null && tabs.movedLogView('log', 'hevy') === null)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
