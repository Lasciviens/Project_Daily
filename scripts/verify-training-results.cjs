#!/usr/bin/env node
/*
 * Verification — the Training → Results tab's three cards and its exercise list (owner, 27.11.2026: "Scientific
 * results based on proven calculations! … not confusing! More understandable."), against the REAL modules through
 * sucrase:
 *   plan/volumeBands.ts       — S18's words for weekly sets per muscle, the one source of the ranges
 *   plan/results.ts           — main lifts (e1RM ≤ 10 reps, the 3-week arrow rule, reps at a load), weekly hard sets
 *                               (direct 1, helper 0.5, warm-ups 0), the 4-week tally, the longest break (S27)
 *   plan/sessionState.ts      — weekCount: the strip's, Daily's and Results' one "This week N of M"
 *   coach/coachFacts.ts       — easyWeekReasons: the coach's and Results' one S31/S32 offer
 *   progress/decisionTabs.ts  — the list's four groups (every exercise in one) and the next session's order
 *
 *   Run:  node scripts/verify-training-results.cjs
 */
require('sucrase/register')
process.env.TZ = 'Europe/Oslo'

const VB = require('../src/features/training/plan/volumeBands')
const R = require('../src/features/training/plan/results')
const SS = require('../src/features/training/plan/sessionState')
const CF = require('../src/features/training/coach/coachFacts')
const DT = require('../src/features/training/progress/decisionTabs')
const PA = require('../src/features/training/progressAggregate')
const P = require('../src/features/training/plan/programBalance')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const J = JSON.stringify
const TODAY = '2026-11-27' // a Friday

// ─── S18 bands ──────────────────────────────────────────────────────────────
console.log('\nS18 bands (plan/volumeBands.ts)')
{
  const word = n => VB.volumeBandOf(n).label
  check('0 sets: Not trained', word(0) === 'Not trained')
  check('0.5 sets (rounds to 0, but trained): Below minimum', word(0.5) === 'Below minimum')
  check('3 sets: Below minimum', word(3) === 'Below minimum')
  check('3.6 sets reads 4 (whole sets): Low, still works', word(3.6) === 'Low, still works')
  check('4 and 9 sets: Low, still works', word(4) === 'Low, still works' && word(9) === 'Low, still works')
  check('10 and 20 sets: Target', word(10) === 'Target' && word(20) === 'Target')
  check('21 and 30 sets: High — extra sets add less', word(21) === 'High — extra sets add less' && word(30) === 'High — extra sets add less')
  check('31 sets: Very high', word(31) === 'Very high')
  check('never red: no band takes a warn or danger tone (S18: no band is an error)', VB.VOLUME_BANDS.every(b => b.tone !== 'warn' && b.tone !== 'danger'))
  check('the body map index follows the band (0–5)', [0, 2, 6, 15, 25, 40].map(VB.volumeBandIdx).join() === '0,1,2,3,4,5')
  check('one source: the Plan tab\'s planned card reads the same edges', P.RECOMMENDED_RANGE.min === VB.VOLUME_TARGET.min && P.RECOMMENDED_RANGE.max === VB.VOLUME_TARGET.max)
  const planned = n => P.readMuscle({ slug: 'chest', label: 'Chest', weeklySets: n, directSets: n }, { preference: null, restriction: null, experience: null }).status
  check('…30 planned sets is "high" there too, 31 "very high" (S18: 21–30 high)', planned(30) === 'high' && planned(31) === 'very_high')
}

// ─── e1RM ≤ 10 reps (S15) ───────────────────────────────────────────────────
console.log('\ne1RM only from sets of 10 reps or fewer (S15)')
{
  check('10 reps gives an e1RM', PA.est1RM(100, 10) === 133.3)
  check('11 reps gives none', PA.est1RM(100, 11) === null)
}

// ─── Main lifts ─────────────────────────────────────────────────────────────
console.log('\nMain lifts (plan/results.ts)')
{
  const routines = [
    { id: 'r1', exercises: [{ exercise_template_id: 'squat', index: 1 }, { exercise_template_id: 'bench', index: 0 }] },
    { id: 'r2', exercises: [{ exercise_template_id: 'bench', index: 0 }] },
    { id: 'r3', exercises: [{ exercise_template_id: 'row', index: 0 }] },
    { id: 'r4', exercises: [] },
  ]
  check('main lifts: each routine\'s first exercise, once each, in routine order', J(R.mainLiftIds(routines)) === J(['bench', 'row']))

  const set = (w, d, tpl, weight, reps, type = 'normal', i = 0) => ({ workout_id: w, date: d, exercise_template_id: tpl, set_type: type, weight_kg: weight, reps, duration_seconds: null, distance_meters: null, set_index: i })
  const bench = { id: 'bench', title: 'Bench Press', type: 'weight_reps' }
  // 4 sessions over 4 weeks: e1RM 100×5 → 105×5 (+5 %).
  const four = [
    set('w1', '2026-10-30', 'bench', 100, 5), set('w2', '2026-11-06', 'bench', 100, 5),
    set('w3', '2026-11-20', 'bench', 105, 5), set('w4', '2026-11-27', 'bench', 105, 5),
    set('w4', '2026-11-27', 'bench', 60, 12, 'warmup'),
  ]
  const t = R.mainLiftTrend(four, bench, TODAY)
  check('4 weeks of e1RM: an up arrow, start → end from the better of the first/last two', t.kind === 'e1rm' && t.arrow === 'up' && t.start === 116.7 && t.end === 122.5, J(t))
  // Only 2 weeks of data: numbers but no arrow (S13).
  const two = [set('w1', '2026-11-13', 'bench', 100, 5), set('w2', '2026-11-20', 'bench', 100, 5), set('w3', '2026-11-27', 'bench', 105, 5)]
  const t2 = R.mainLiftTrend(two, bench, TODAY)
  check('2 weeks of data: no arrow yet (S13: 3–4 weeks)', t2.kind === 'e1rm' && t2.arrow === null && t2.end === 122.5, J(t2))
  // Exactly 21 days apart: the arrow shows.
  const three = [set('w1', '2026-11-06', 'bench', 100, 5), set('w2', '2026-11-13', 'bench', 100, 5), set('w3', '2026-11-20', 'bench', 100, 5), set('w4', '2026-11-27', 'bench', 101, 5)]
  const t3 = R.mainLiftTrend(three, bench, TODAY)
  check('3 weeks of data: the arrow shows; within ±3 % it is flat (S16)', t3.arrow === 'flat', J(t3))
  // Older than 8 weeks is outside the window.
  const old = [set('w0', '2026-09-01', 'bench', 80, 5), ...two]
  check('a session older than 8 weeks is not in the trend', R.mainLiftTrend(old, bench, TODAY).arrow === null)
  // Every set above 10 reps: no e1RM — reps at a load instead.
  const high = [
    set('w1', '2026-10-30', 'bench', 16, 10, 'normal', 0), set('w1', '2026-10-30', 'bench', 16, 10, 'normal', 1), set('w1', '2026-10-30', 'bench', 16, 9, 'normal', 2),
    set('w2', '2026-11-27', 'bench', 16, 12, 'normal', 0), set('w2', '2026-11-27', 'bench', 16, 12, 'normal', 1), set('w2', '2026-11-27', 'bench', 16, 11, 'normal', 2),
  ]
  const th = R.mainLiftTrend(high.map(s => s.reps <= 10 ? { ...s, reps: s.reps + 1 } : s), bench, TODAY)
  check('sets above 10 reps give no e1RM: reps at one load instead', th.kind === 'reps' && th.loadKg === 16 && J(th.latest) === J([12, 12, 11]) && J(th.earlier) === J([11, 11, 10]), J(th))
  check('…an up arrow when the mean reps per set rose by 1+ over 3+ weeks (S12)', th.arrow === 'up', J(th))
  const recentHigh = [...four.slice(0, 3), set('w5', '2026-11-27', 'bench', 80, 12)]
  check('the latest session above 10 reps: reps at its load, never an older e1RM read as the trend', R.mainLiftTrend(recentHigh, bench, TODAY).kind === 'reps')
  const bw = { id: 'pull', title: 'Pull Up', type: 'reps_only' }
  const pr = R.mainLiftTrend([set('a', '2026-11-20', 'pull', null, 8), set('b', '2026-11-27', 'pull', null, 9)], bw, TODAY)
  check('a bodyweight move: its reps, no load, no arrow before 3 weeks', pr.kind === 'reps' && pr.loadKg === null && J(pr.latest) === J([9]) && pr.arrow === null, J(pr))
  check('a lift with no sets in 8 weeks: no trend', R.mainLiftTrend([], bench, TODAY) === null)
}

// ─── Weekly sets per muscle (S17) ───────────────────────────────────────────
console.log('\nWeekly hard sets per muscle (S17)')
{
  const templates = [
    { id: 'bench', title: 'Bench', primary_muscle_group: 'chest', secondary_muscle_groups: ['triceps'] },
    { id: 'curl', title: 'Curl', primary_muscle_group: 'biceps', secondary_muscle_groups: [] },
  ]
  const set = (w, d, tpl, type = 'normal') => ({ workout_id: w, date: d, exercise_template_id: tpl, set_type: type, weight_kg: 50, reps: 8, duration_seconds: null, distance_meters: null })
  const sets = [
    // this week: 4 bench working + 2 warm-ups
    ...[0, 1, 2, 3].map(() => set('w1', '2026-11-25', 'bench')), set('w1', '2026-11-25', 'bench', 'warmup'), set('w1', '2026-11-25', 'bench', 'warmup'),
    // 3 weeks ago: 8 bench
    ...Array.from({ length: 8 }, () => set('w0', '2026-11-06', 'bench')),
    // 5 weeks ago: outside the 4 weeks
    ...Array.from({ length: 20 }, () => set('wx', '2026-10-20', 'curl')),
  ]
  const rows = R.weeklyMuscleSets(sets, templates, TODAY, new Map([['biceps', { weight: 'limit' }]]))
  const chest = rows.find(r => r.slug === 'chest'), tri = rows.find(r => r.slug === 'triceps'), bi = rows.find(r => r.slug === 'biceps')
  check('direct set = 1, warm-ups = 0: chest last 7 days 4', chest.lastWeek === 4, J(chest))
  check('4-week average: (4 + 8) ÷ 4 = 3 → Below minimum', chest.average === 3 && chest.band.id === 'below', J(chest))
  check('a helper muscle\'s set counts 0.5: triceps 2 last 7 days, 1.5 a week on average', tri.lastWeek === 2 && tri.average === 1.5, J(tri))
  check('older than 4 weeks is outside: biceps 0, Not trained', bi.lastWeek === 0 && bi.average === 0 && bi.band.id === 'none')
  check('every main muscle is listed, also at 0', ['chest', 'upper-back', 'quadriceps', 'hamstring'].every(s => rows.some(r => r.slug === s)))
  check('most sets first', rows[0].slug === 'chest')
  check('a limited muscle under target keeps the reframe', R.limitationNote(bi) === 'Low — your active limit limitation reaches it, so that may be deliberate.')
  check('…an unlimited one gets none', R.limitationNote(chest) === null)
  check('…nor a limited one at target', R.limitationNote({ restriction: 'avoid', band: VB.volumeBandOf(12) }) === null)
}

// ─── Consistency ────────────────────────────────────────────────────────────
console.log('\nConsistency (plan/results.ts, sessionState.weekCount)')
{
  const st = (state, extra = {}) => ({ state, doneBy: state === 'done' ? 'workout' : null, workoutId: null, countsUntil: null, skipReason: null, open: false, weekOver: false, ...extra })
  const ses = (date, mark, state, shift = null) => ({ key: `${date}-${mark}-${state}-${shift}`, title: 'S', routineId: 'r', date, status: st(state), mark, shift, skippedOver: false })
  const week = (monday, sessions) => ({ monday, sunday: shiftDays(monday, 6), sessions, next: null, offer: null })
  function shiftDays(d, n) { const x = new Date(`${d}T12:00:00`); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }

  const thisWeek = week('2026-11-23', [
    ses('2026-11-18', 'open', 'pending'), // last week's, carried in: not this week's count
    ses('2026-11-23', 'done', 'done'), ses('2026-11-25', 'done', 'done', 1), ses('2026-11-26', 'skipped', 'skipped'), ses('2026-11-28', 'next', 'upcoming'),
  ])
  check('this week: N of M is the strip\'s own sessions, a skipped one left out (Daily\'s count)', J(SS.weekCount(thisWeek)) === J({ done: 2, planned: 3 }))

  check('the 4 full weeks before this one', J(R.previousMondays(TODAY)) === J(['2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16']))
  const weeks = [
    week('2026-10-26', [ses('2026-10-26', 'done', 'done', 0), ses('2026-10-28', 'done', 'done', 2), ses('2026-10-30', 'done', 'done', -1)]),
    week('2026-11-02', [ses('2026-11-02', 'done', 'done'), ses('2026-11-04', 'skipped', 'skipped'), ses('2026-11-06', 'done', 'done')]),
    week('2026-11-09', [ses('2026-11-02', 'open', 'pending'), ses('2026-11-09', 'done', 'done'), ses('2026-11-11', 'open', 'missed')]),
    week('2026-11-16', [ses('2026-11-16', 'done', 'done'), ses('2026-11-18', 'open', 'pending')]),
  ]
  const t = R.tallyWeeks(weeks)
  check('last 4 weeks: X of Y — each week\'s own sessions once (a carried-in one is not counted twice)', t.done === 7 && t.planned === 10, J(t))
  check('…Z % rounded', t.pct === 70)
  check('on its day · late · early', t.onDay === 5 && t.late === 1 && t.early === 1, J(t))
  check('dropped: skipped, or missed', t.dropped === 2, J(t))
  check('nothing planned: no percent', R.tallyWeeks([]).pct === null)

  const lb = R.longestBreak(['2026-10-20', '2026-11-02', '2026-11-05', '2026-11-20', '2026-11-25'], TODAY)
  check('longest break: from the session before the window, days from one session to the next', lb.days === 15 && lb.from === '2026-11-05' && lb.to === '2026-11-20', J(lb))
  const lb2 = R.longestBreak(['2026-11-25'], TODAY)
  check('…the break before the first session in the window is not invented', lb2.days === 2 && lb2.to === null, J(lb2))
  const lb3 = R.longestBreak(['2026-10-01'], TODAY)
  check('…a break still going counts up to today', lb3.days === 57 && lb3.to === null, J(lb3))
  check('no training at all: null', R.longestBreak([], TODAY) === null)
  check('S27: 14 days or less gets the plain note', R.breakNote(14) !== null && R.breakNote(15) === null)

  const none = CF.easyWeekReasons({ weeksSinceEasy: 3, stalled: 1, regression: 0, feeling: null, workloadReview: false })
  check('easy week: not offered without an S31 reason', none.length === 0)
  check('…offered after 6 weeks without an easy week (S31(a); S32\'s half-weeks reset it)', CF.easyWeekReasons({ weeksSinceEasy: 6, stalled: 0, regression: 0, feeling: null, workloadReview: false }).length === 1)
  check('…offered with 2 lifts stalled (S31(b))', CF.easyWeekReasons({ weeksSinceEasy: null, stalled: 2, regression: 0, feeling: null, workloadReview: false })[0] === '2 lifts not rising at their load')
  check('S32: a week at half the planned sessions resets the clock', CF.weeksSinceEasyWeek(['2026-11-16', '2026-11-18', '2026-11-20', '2026-11-11', '2026-11-03', '2026-11-05', '2026-11-07'], TODAY, 3) === 1)
}

// ─── The exercise list ──────────────────────────────────────────────────────
console.log('\nThe exercise list (progress/decisionTabs.ts)')
{
  const d = (id, a, rc = 'WITHIN_RANGE') => ({ exerciseTemplateId: id, currentAction: a, rangeCompliance: rc })
  const all = [
    d('a', 'READY_TO_INCREASE'), d('b', 'ALMOST_READY'), d('c', 'BUILD_AT_CURRENT_LOAD'), d('e', 'HOLD_STEADY'), d('f', 'REPEAT_AT_TOP'),
    d('g', 'NEW_WEIGHT', 'BELOW_MINIMUM'), d('h', 'REVIEW_LOAD_REDUCTION'), d('i', 'INSUFFICIENT_DATA'), d('j', 'STEP_BACK'),
    d('k', 'WATCH_FOR_PLATEAU'), d('l', 'WATCH_FOR_REGRESSION'), d('m', 'CONFIRM_AT_CURRENT_LOAD'), d('n', 'LOG_COMPARABLE_SESSION'),
    d('o', 'BUILD_AT_CURRENT_LOAD', 'BELOW_MINIMUM'),
  ]
  const counts = DT.groupCounts(all)
  check('every exercise is in one group: the counts add up to the list', counts.add_weight + counts.almost + counts.add_reps + counts.check === all.length, J(counts))
  check('Add weight 1 · Almost 1 · Add reps 6 · Check 6', J(counts) === J({ add_weight: 1, almost: 1, add_reps: 6, check: 6 }), J(counts))
  check('a new weight below the minimum builds (S5/S6), never Check', DT.nextActionGroup(d('g', 'NEW_WEIGHT', 'BELOW_MINIMUM')) === 'add_reps')
  check('a first session is Add reps', DT.nextActionGroup(d('i', 'INSUFFICIENT_DATA')) === 'add_reps')
  check('the control opens on the first group with an exercise', DT.firstGroup({ add_weight: 0, almost: 0, add_reps: 2, check: 1 }) === 'add_reps')
  check('the four groups are short (1–2 words)', DT.NEXT_ACTION_GROUPS.every(g => g.label.split(' ').length <= 2))

  const week = { sessions: [{ routineId: 'rA', mark: 'done' }, { routineId: 'rB', mark: 'next' }, { routineId: 'rC', mark: 'open' }] }
  const order = DT.routinesInNextOrder(week, ['rA', 'rB', 'rC', 'rD'])
  check('routines in the order they come up: next, still to do, the rest, then the program', J(order) === J(['rB', 'rC', 'rA', 'rD']))
  const routines = [
    { id: 'rA', exercises: [{ exercise_template_id: 'x1', index: 0 }] },
    { id: 'rB', exercises: [{ exercise_template_id: 'x3', index: 1 }, { exercise_template_id: 'x2', index: 0 }] },
  ]
  const sorted = DT.sortByNextSession([{ exerciseTemplateId: 'zz' }, { exerciseTemplateId: 'x1' }, { exerciseTemplateId: 'x3' }, { exerciseTemplateId: 'x2' }, { exerciseTemplateId: 'aa' }], order, routines, id => id)
  check('sorted by the next session\'s order, then one in no routine A–Z', J(sorted.map(s => s.exerciseTemplateId)) === J(['x2', 'x3', 'x1', 'aa', 'zz']), J(sorted))
  check('no week read: the program\'s order', J(DT.routinesInNextOrder(null, ['rA', 'rB'])) === J(['rA', 'rB']))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
