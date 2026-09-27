#!/usr/bin/env node
/*
 * Verification — the Training tabs' pure plan modules (src/features/training/plan/),
 * against the REAL un-mocked modules through sucrase (no unit-test runner by
 * this repo's convention):
 *   nextSession.ts     — which routine is next, the engine-fed alerts
 *   sessionPlan.ts     — routine + engine target + last session
 *   programBalance.ts  — planned weekly sets per muscle, tiers, preferences,
 *                        restrictions, the planned week's balance notes
 *   muscleBalance.ts   — the ONE push:pull / quad:ham ratio + verdict and the
 *                        "why planned and done differ" line
 *   improvement.ts     — lift changes over a window, main lifts, bodyweight
 *   recovery.ts        — sleep / resting-HR lines, days since each muscle
 *
 *   Run:  node scripts/verify-training-plan.cjs
 */
require('sucrase/register')
process.env.TZ = 'Europe/Oslo'

const N = require('../src/features/training/plan/nextSession')
const S = require('../src/features/training/plan/sessionPlan')
const P = require('../src/features/training/plan/programBalance')
const B = require('../src/features/training/plan/muscleBalance')
const MM = require('../src/features/training/muscleMap')
const I = require('../src/features/training/plan/improvement')
const R = require('../src/features/training/plan/recovery')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const J = JSON.stringify

// ─── nextSession.ts ─────────────────────────────────────────────────────────
console.log('\nnextSession')
{
  const routines = [{ id: 'r1', title: 'Push Day' }, { id: 'r2', title: 'Pull Day' }, { id: 'r3', title: 'Legs' }, { id: 'old', title: 'Push Day' }]
  check('normalizeTitle folds case/accents/punctuation', N.normalizeTitle('  Pûsh—Day! ') === 'push day')
  check('plan matched by source id first', N.matchRoutineToPlan({ title: 'Anything', date: '2026-09-28', startTime: null, sourceId: 'r3' }, routines)?.id === 'r3')
  check('plan matched by exact title, program routine wins a tie', N.matchRoutineToPlan({ title: 'push day', date: 'x', startTime: null }, routines, new Set(['r1']))?.id === 'r1')
  check('plan matched by contained title', N.matchRoutineToPlan({ title: 'Legs — heavy', date: 'x', startTime: null }, routines)?.id === 'r3')
  check('no false match on a partial word', N.matchRoutineToPlan({ title: 'Eggs', date: 'x', startTime: null }, [{ id: 'z', title: 'Egg' }]) === null)
  check('unmatched plan → null', N.matchRoutineToPlan({ title: 'Swim', date: 'x', startTime: null }, routines) === null)

  const last = new Map([['r1', '2026-09-20'], ['r2', '2026-09-24'], ['r3', '2026-09-22']])
  check('least recent: oldest last-trained', N.pickLeastRecentRoutine(['r1', 'r2', 'r3'], last) === 'r1')
  check('least recent: never-trained first', N.pickLeastRecentRoutine(['r1', 'r4', 'r2'], last) === 'r4')
  check('least recent: tie keeps program order', N.pickLeastRecentRoutine(['r2', 'x', 'y'], new Map([['r2', '2026-01-01']])) === 'x')
  check('least recent: empty program → null', N.pickLeastRecentRoutine([], last) === null)

  const planned = N.resolveNextRoutine({ planned: { title: 'Pull Day', date: '2026-09-28', startTime: '17:00' }, routines, programRoutineIds: ['r1', 'r2', 'r3'], lastTrained: last })
  check('resolve: planned session wins', planned.source === 'planned' && planned.routineId === 'r2' && planned.lastTrained === '2026-09-24', J(planned))
  const unmatched = N.resolveNextRoutine({ planned: { title: 'Run', date: '2026-09-28', startTime: null }, routines, programRoutineIds: ['r1'], lastTrained: last })
  check('resolve: planned but unmatched keeps the plan, no routine', unmatched.source === 'planned' && unmatched.routineId === null)
  const lr = N.resolveNextRoutine({ planned: null, routines, programRoutineIds: ['r1', 'r2', 'deleted'], lastTrained: last })
  check('resolve: least recent, ignores a deleted program routine', lr.source === 'least_recent' && lr.routineId === 'r1', J(lr))
  check('resolve: nothing planned, no program → null', N.resolveNextRoutine({ planned: null, routines, programRoutineIds: [], lastTrained: last }) === null)
  check('daysBetween across DST (25→27 Oct 2026)', N.daysBetween('2026-10-24', '2026-10-26') === 2)

  const d = (id, action, clp = 'STABLE_VARIATION', n = 3) => ({ exerciseTemplateId: id, currentAction: action, trend: { currentLoadProgress: clp, currentLoadCycleSessions: n } })
  const titles = { a: 'Bench', b: 'Squat', c: 'Row', e: 'Curl', f: 'Press' }
  const alerts = N.buildTrainingAlerts([
    d('a', 'READY_TO_INCREASE'), d('b', 'READY_TO_INCREASE'), d('c', 'WATCH_FOR_PLATEAU', 'POSSIBLE_PLATEAU', 5),
    d('e', 'WATCH_FOR_REGRESSION', 'DECLINING', 4), d('f', 'REVIEW_LOAD_REDUCTION'), d('g', 'HOLD_STEADY'),
  ], id => titles[id] ?? id, { workload: 'review_workload', corroboratingSignal: 'sleep down ~1h/night', affectedCount: 2 })
  check('alerts: ready lifts grouped in one line', alerts.some(a => a.text === '2 lifts ready to increase: Bench, Squat'), J(alerts.map(a => a.text)))
  check('alerts: plateau names the session count', alerts.some(a => a.text === 'Row flat for 5 sessions at this load'))
  check('alerts: regression line, not also a plateau line', alerts.some(a => a.id === 'down:e') && !alerts.some(a => a.id === 'flat:e'))
  check('alerts: load reduction asks, info tone', alerts.find(a => a.id === 'lower:f')?.tone === 'info')
  check('alerts: workload review included', alerts.some(a => a.id === 'workload' && a.text.includes('sleep down')))
  check('alerts: danger first, info last', alerts[0].tone === 'danger' && alerts[alerts.length - 1].tone === 'info', J(alerts.map(a => a.tone)))
  check('alerts: HOLD_STEADY adds nothing', !alerts.some(a => a.exerciseIds.includes('g')))
  check('alerts: none for nothing', N.buildTrainingAlerts([], () => '').length === 0)
  const many = N.buildTrainingAlerts(['a', 'b', 'c', 'e', 'f'].map(id => d(id, 'READY_TO_INCREASE')), id => titles[id])
  check('alerts: long list folds to "+N more"', many[0].text.endsWith('+2 more'), many[0].text)
}

// ─── sessionPlan.ts ─────────────────────────────────────────────────────────
console.log('\nsessionPlan')
{
  const set = (type, w, reps, lo = null, hi = null) => ({ type, weight_kg: w, reps, rep_range_start: lo, rep_range_end: hi, duration_seconds: null, distance_meters: null })
  const exercises = [
    { exercise_template_id: 'bench', title: 'Bench Press (Barbell)', index: 1, rest_seconds: '120', sets: [set('warmup', 40, 8), set('normal', 100, null, 6, 8), set('normal', 80, null, 8, 10), set('normal', 80, null, 8, 10)] },
    { exercise_template_id: 'curl', title: 'Bicep Curl (Dumbbell)', index: 0, sets: [set('normal', 14, 10), set('normal', 14, 10)] },
    { exercise_template_id: 'pullup', title: 'Pull Up', index: 2, sets: [set('normal', null, 8)] },
  ]
  const decision = {
    metricKind: 'est1rm',
    nextTargets: { nextSession: { headline: 'Add weight', loadKg: 102.5, targetSets: 3, setTargets: [{ weightKg: 102.5, quantity: 6 }, { weightKg: 80, quantity: 10 }, { weightKg: 80, quantity: 9 }], quantityUnit: 'reps', minimumTotalReps: null, minimumSetReps: null, explanationCode: 'x' } },
  }
  const latest = { date: '2026-09-24', allSets: [{ order: 0, kind: 'normal', weightKg: 100, reps: 8, durationSeconds: null, distanceMeters: null }, { order: 1, kind: 'normal', weightKg: 80, reps: 10, durationSeconds: null, distanceMeters: null }], comparableWorkingSets: [] }
  const rows = S.buildSessionPlan(exercises, {
    decisionById: new Map([['bench', decision]]),
    sessionsById: new Map([['bench', [latest]]]),
    metricKindById: new Map([['pullup', 'reps']]),
  })
  check('rows follow the routine order', J(rows.map(r => r.templateId)) === '["curl","bench","pullup"]', J(rows.map(r => r.templateId)))
  const b = rows[1]
  check('target keeps backoff loads on backoff sets', b.target === '102.5 kg × 6 · 80 kg × 10/9', b.target)
  check('prescription from routine working sets (warm-up excluded)', b.prescription === '3 × 6-8 reps', b.prescription)
  check('last session formatted with each set\'s own load', b.lastSets === '100 kg × 8 · 80 kg × 10', b.lastSets)
  check('rest seconds parsed', b.restSeconds === 120)
  const c = rows[0]
  check('no decision: routine loads shown, no target', c.target === null && c.routineLoads === '14 kg × 10/10', J(c))
  const p = rows[2]
  check('bodyweight reps keep their own metric', p.metricKind === 'reps')
  check('routine exercise notes are not carried into the plan', !('notes' in p) && !('warmup' in p))
  check('fixed-rep prescription "1 × 8 reps"', p.prescription === '1 × 8 reps', p.prescription)
  check('no RPE logged → no RPE text, no effort note', b.lastHasRpe === false && b.lastEffort === null && !/RPE/.test(b.lastSets))
}

// ─── sessionPlan.ts — RPE (Hevy) on "Last time" + the effort note ──────────
console.log('\nsessionPlan · RPE')
{
  const cs = (reps, rpe, kind = 'normal', w = 60) => ({ order: 0, kind, weightKg: w, reps, durationSeconds: null, distanceMeters: null, ...(rpe != null ? { rpe } : {}) })
  const plan = sets => S.buildSessionPlan(
    [{ exercise_template_id: 'x', title: 'Row', index: 0, sets: [] }],
    { decisionById: new Map(), sessionsById: new Map([['x', [{ date: '2026-09-24', allSets: sets, comparableWorkingSets: [] }]]]), metricKindById: new Map() },
  )[0]
  const near = plan([cs(10, 8.5), cs(9, 10), cs(8, 10)])
  check('"Last time" carries each set\'s RPE', near.lastSets === '60 kg × 10/9/8 @ RPE 8.5/10/10', near.lastSets)
  check('rated last session flagged for the explainer', near.lastHasRpe === true)
  check('average 9.5 → near your limit', near.lastEffort.note === 'near_limit' && near.lastEffort.averageRpe === 9.5, J(near.lastEffort))
  check('near-limit text names RPE 9.5+ and the reps left', near.lastEffort.text === 'Last time was near your limit (RPE 9.5+) — average 9.5 over 3 working sets, about 0–½ reps left.', near.lastEffort.text)
  const easy = plan([cs(12, 6), cs(12, 6), cs(12, 7), cs(12, 7.5)])
  check('average 6.6 → room to push', easy.lastEffort.note === 'room_to_push' && easy.lastEffort.averageRpe === 6.6, J(easy.lastEffort))
  check('room-to-push text', easy.lastEffort.text === 'Last time left room to push (RPE 7 or lower) — average 6.6 over 4 working sets, about 3+ reps left.', easy.lastEffort.text)
  check('exactly 7 counts as room to push', plan([cs(10, 7), cs(10, 7)]).lastEffort.note === 'room_to_push')
  const mid = plan([cs(10, 8), cs(10, 8.5), cs(10, 9)])
  check('an ordinary effort (8.5) → no note, no text', mid.lastEffort.note === null && mid.lastEffort.text === null && mid.lastEffort.averageRpe === 8.5)
  check('just under the line (9.3) → no note', plan([cs(10, 9), cs(10, 9.5), cs(10, 9.5)]).lastEffort.note === null)
  const dropset = plan([cs(10, 7), cs(10, 7), cs(12, 10, 'dropset', 40)])
  check('a dropset is not a working set for the effort read', dropset.lastEffort.workingSets === 2 && dropset.lastEffort.note === 'room_to_push', J(dropset.lastEffort))
  const failure = plan([cs(10, 9.5), cs(8, 10, 'failure')])
  check('a failure set counts as a working set', failure.lastEffort.workingSets === 2 && failure.lastEffort.note === 'near_limit')
  const half = plan([cs(10, 10), cs(10, 10), cs(10, null), cs(10, null)])
  check('half the working sets rated is enough; text says "2 of 4"', half.lastEffort?.note === 'near_limit' && /over 2 of 4 working sets/.test(half.lastEffort.text), J(half.lastEffort))
  const few = plan([cs(10, 10), cs(10, null), cs(10, null)])
  check('fewer than half rated → no effort read (but the RPE still shows)', few.lastEffort === null && few.lastHasRpe === true && few.lastSets === '60 kg × 10/10/10 @ RPE 10/–/–', few.lastSets)
  check('the effort note never touches the target (no decision → no target)', near.target === null && near.targetHeadline === null)
  check('thresholds exported as documented', S.NEAR_LIMIT_RPE === 9.5 && S.ROOM_TO_PUSH_RPE === 7)
}

// ─── programBalance.ts ──────────────────────────────────────────────────────
console.log('\nprogramBalance')
{
  const sets = n => Array.from({ length: n }, () => ({ type: 'normal' }))
  const routines = [
    { id: 'u', title: 'Upper', exercises: [
      { exercise_template_id: 'bench', title: 'Bench Press', sets: [{ type: 'warmup' }, ...sets(3)] },
      { exercise_template_id: 'ohp', title: 'Overhead Press', sets: sets(3) },
      { exercise_template_id: 'row', title: 'Barbell Row', sets: sets(2) },
    ] },
    { id: 'l', title: 'Lower', exercises: [
      { exercise_template_id: 'squat', title: 'Squat', sets: sets(4) },
      { exercise_template_id: 'unknown', title: 'Mystery', sets: sets(3) },
    ] },
  ]
  const tm = new Map([
    ['bench', { primary: 'chest', secondary: ['triceps', 'shoulders'] }],
    ['ohp', { primary: 'shoulders', secondary: ['triceps'] }],
    ['row', { primary: 'upper_back', secondary: ['biceps', 'lats'] }],
    ['squat', { primary: 'quadriceps', secondary: ['glutes', 'hamstrings'] }],
  ])
  check('workingSetCount excludes warm-ups', P.workingSetCount([{ type: 'warmup' }, { type: 'normal' }, { type: 'dropset' }]) === 2)
  check('passesPerWeek: 4 days / 2 routines = 2', P.passesPerWeek(4, 2) === 2)
  check('passesPerWeek: no target → 1', P.passesPerWeek(null, 3) === 1)
  const planned = P.plannedWeeklySets(routines, tm, 1)
  const get = slug => planned.find(p => p.slug === slug)
  check('chest 3 direct sets', get('chest').weeklySets === 3 && get('chest').directSets === 3)
  check('triceps 0.5 × 6 = 3 secondary', get('triceps').weeklySets === 3 && get('triceps').directSets === 0, J(get('triceps')))
  check('deltoids 3 primary + 1.5 secondary', get('deltoids').weeklySets === 4.5)
  check('upper-back: primary + secondary lats on the same slug counted once', get('upper-back').weeklySets === 2, J(get('upper-back')))
  check('unknown template ignored', !planned.some(p => p.sources.some(s => s.exerciseTitle === 'Mystery')))
  const doubled = P.plannedWeeklySets(routines, tm, 2)
  check('passes scale sets', doubled.find(p => p.slug === 'chest').weeklySets === 6)

  check('tier <4 below MED', P.tierFor(3.5) === 'below_med')
  check('tier 4 MED', P.tierFor(4) === 'med')
  check('tier 10.5 most efficient range', P.tierFor(10.5) === 'high_eff')
  check('tier 11 intermediate', P.tierFor(11) === 'intermediate')
  check('tier 19 lower, 30 lowest, 43 no data', P.tierFor(19) === 'lower_eff' && P.tierFor(30) === 'lowest_eff' && P.tierFor(43) === 'no_data')

  const ctx = { preference: null, restriction: null, experience: null }
  const m = (slug, s, d = s) => ({ slug, label: slug, weeklySets: s, directSets: d })
  check('below MED advises the gap to 4', P.readMuscle(m('chest', 2.5), ctx).setsToAdd === 1.5)
  check('priority under 10 → sets to 10', P.readMuscle(m('chest', 6), { ...ctx, preference: 'priority' }).setsToAdd === 4)
  check('non-priority 6 → no add', P.readMuscle(m('chest', 6), ctx).setsToAdd === null)
  check('excluded direct work never nags', P.readMuscle(m('abs', 3, 0), { ...ctx, preference: 'exclude_direct' }).status === 'excluded')
  check('excluded but trained directly → read normally', P.readMuscle(m('abs', 3, 3), { ...ctx, preference: 'exclude_direct' }).status === 'below_med')
  const restricted = P.readMuscle(m('lower-back', 1), { ...ctx, restriction: 'avoid' })
  check('restricted muscle is never told to add', restricted.status === 'restricted' && restricted.setsToAdd === null)
  check('10–20 in range', P.readMuscle(m('chest', 14), ctx).status === 'in_range')
  check('high and very high', P.readMuscle(m('chest', 25), ctx).status === 'high' && P.readMuscle(m('chest', 31), ctx).status === 'very_high')
  check('RP band label carried (heuristic)', P.readMuscle(m('chest', 14), ctx).rpBandLabel === 'Optimal growth')
  check('experience scales landmarks (novice MEV lower)', P.readMuscle(m('chest', 14), { ...ctx, experience: 'novice' }).landmarks.mev === 7)

  const reads = P.readProgramMuscles(planned, { preferences: new Map([['calves', 'priority']]), restrictions: new Map(), experience: null })
  check('all major muscles listed even at 0', ['hamstring', 'abs', 'biceps'].every(s => reads.some(r => r.slug === s)))
  check('priority muscle listed first even at 0', reads[0].slug === 'calves' && reads[0].status === 'untrained' && reads[0].setsToAdd === 4, J(reads[0]))

  const bal = P.readBalance(planned, routines.flatMap(r => r.exercises.map(e => e.title)))
  check('push = chest 3 + delts 4.5 + triceps 3', bal.pushPull.a === 10.5, J(bal))
  check('pull = upper-back 2 + biceps 1', bal.pushPull.b === 3)
  check('push-heavy at ratio 3.5 (shared verdict)', bal.pushPull.lean === 'a' && bal.pushPull.ratio === 3.5)
  check('quad : ham oriented quad ÷ ham — 4 : 2 = 2 → quad-heavy', bal.quadHam.a === 4 && bal.quadHam.b === 2 && bal.quadHam.ratio === 2 && bal.quadHam.lean === 'a', J(bal.quadHam))
  check('no knee-flexion exercise noted', !bal.hasKneeFlexion && bal.notes.some(n => n.text.includes('knee-flexion')))
  check('knee flexion: "Lying Leg Curl" yes, "Bicep Curl" no, "Nordic" yes', P.isKneeFlexionExercise('Lying Leg Curl (Machine)') && !P.isKneeFlexionExercise('Bicep Curl (Dumbbell)') && P.isKneeFlexionExercise('Nordic Hamstring Curl'))
  const balR = P.readBalance(planned, [], new Map([['upper-back', 'avoid']]))
  check('push-heavy note blames an avoid restriction on pulling', balR.notes[0].text.includes('limitation'))
  const onlyPush = P.readBalance([{ slug: 'chest', label: 'Chest', weeklySets: 6, directSets: 6, sources: [] }], [])
  check('pushing with zero pulling flagged, no ratio', onlyPush.pushPull.lean === 'a' && onlyPush.pushPull.ratio === null)
  check('no legs → no knee-flexion note', !onlyPush.notes.some(n => n.text.includes('knee-flexion')))
  const pullHeavy = P.readBalance([{ slug: 'chest', label: 'Chest', weeklySets: 4, directSets: 4, sources: [] }, { slug: 'upper-back', label: 'Back', weeklySets: 8, directSets: 8, sources: [] }], [])
  check('pull-heavy note is information, not a warning', pullHeavy.pushPull.lean === 'b' && pullHeavy.notes[0].tone === 'info')
  const byRoutine = P.plannedBalanceByRoutine(routines, tm)
  check('per-routine planned balance (one pass)', byRoutine[0].perPass.push === 10.5 && byRoutine[0].perPass.pull === 3 && byRoutine[1].perPass.quad === 4, J(byRoutine))
  check('per-exercise planned balance (warm-ups out)', byRoutine[0].exercises[0].sets === 3 && byRoutine[0].exercises[0].perPass.push === 6, J(byRoutine[0].exercises[0]))
}

// ─── muscleBalance.ts — the ONE push:pull / quad:ham ratio + verdict ───────
console.log('\nmuscleBalance')
{
  check('creditedMuscles: lats + upper_back on one slug credit Back once', J(MM.creditedMuscles('x', 'upper-back', ['upper-back', 'biceps', 'biceps'])) === J([{ slug: 'upper-back', role: 'primary', weight: 1 }, { slug: 'biceps', role: 'secondary', weight: 0.5 }]))
  const rdl = MM.templateMuscleCredit('hamstrings', ['glutes', 'lower_back', 'upper_back', 'lats'])
  check('templateMuscleCredit: RDL secondaries upper_back + lats → Back once', J(rdl.secondarySlugs) === J(['gluteal', 'lower-back', 'upper-back']), J(rdl))
  check('buildTemplateMuscleMap drops a secondary equal to the primary', J(MM.buildTemplateMuscleMap([{ id: 'p', primary_muscle_group: 'lats', secondary_muscle_groups: ['upper_back', 'biceps'] }]).get('p').secondarySlugs) === J(['biceps']))

  const r = (a, b) => B.readRatio('pushPull', a, b)
  check('owner case planned: 34.5 : 19.5 → 1.77 : 1 push-heavy', B.ratioText(r(34.5, 19.5)) === '1.77 : 1' && r(34.5, 19.5).lean === 'a')
  check('1.5 exactly is balanced (limit is "more than 1.5×")', r(15, 10).lean === 'balanced' && r(15.1, 10).lean === 'a')
  check('symmetric low limit: 0.67 balanced, 0.66 pull-heavy', r(6.7, 10).lean === 'balanced' && r(6.6, 10).lean === 'b')
  check('verdict read off the rounded ratio (1.504 → 1.50, balanced)', r(15.04, 10).ratio === 1.5 && r(15.04, 10).lean === 'balanced')
  check('one side empty → "push only" / "pull only", no ratio', B.ratioText(r(5, 0)) === 'push only' && B.ratioText(r(0, 5)) === 'pull only' && r(0, 5).ratio === null)
  check('nothing → "—" and no verdict', B.ratioText(r(0, 0)) === '—' && r(0, 0).lean === 'none')
  check('quad : ham label/orientation', B.ratioText(B.readRatio('quadHam', 9, 9)) === '1.00 : 1' && B.leanLabel(B.readRatio('quadHam', 20, 10)) === 'quad-heavy')
  check('tones: push-heavy warn, pull-heavy info, balanced success', B.leanTone(r(20, 10)) === 'warn' && B.leanTone(r(5, 10)) === 'info' && B.leanTone(r(10, 10)) === 'success')
  const totals = B.balanceTotals(s => ({ chest: 10, deltoids: 12, triceps: 12.5, 'upper-back': 8.5, biceps: 9.5, quadriceps: 9, hamstring: 9 })[s] ?? 0)
  check('balanceTotals sums the shared slug groups (traps count as pull)', totals.push === 34.5 && totals.pull === 18 && totals.quad === 9 && totals.ham === 9, J(totals))
  check('info text names the limit and the counting', B.balanceInfo('pushPull').includes('1.5×') && B.balanceInfo('pushPull').includes('0.5'))

  check('disagree: different verdicts', B.balanceDisagrees(r(19, 10), r(12, 10)))
  check('agree: same verdict, ratios within 1.2×', !B.balanceDisagrees(r(19, 10), r(17, 10)))
  check('disagree: same verdict, ratios ≥ 1.2× apart', B.balanceDisagrees(r(24, 10), r(19, 10)))
  check('no disagreement without done sets', !B.balanceDisagrees(r(19, 10), r(0, 0)))

  // Sources: two program routines + freeform sessions, over 28 days (4 weeks).
  const program = [
    { id: 'push', title: 'Push Day', perPass: { push: 12, pull: 0, quad: 0, ham: 0 }, exercises: [] },
    { id: 'pull', title: 'Pull Day', perPass: { push: 0, pull: 12, quad: 0, ham: 0 }, exercises: [] },
  ]
  const tpl = new Map([['bench', { primary: 'chest', secondaries: [] }], ['row', { primary: 'upper-back', secondaries: ['upper-back'] }]])
  const rows = []
  for (let i = 0; i < 4; i++) rows.push({ workoutId: `p${i}`, routineId: 'push', templateId: 'bench', workingSets: 12 })
  rows.push({ workoutId: 'q0', routineId: 'pull', templateId: 'row', workingSets: 12 })
  const sources = B.doneBalanceSources(rows, tpl, program)
  const pullSrc = sources.find(s => s.routineId === 'pull')
  check('doneBalanceSources: sessions and credited sets per routine (Back counted once)', pullSrc.doneSessions === 1 && pullSrc.doneTotals.pull === 12, J(pullSrc))
  const plannedBal = B.readMuscleBalance({ push: 12, pull: 12, quad: 0, ham: 0 })
  const doneBal = B.readMuscleBalance({ push: 12, pull: 3, quad: 0, ham: 0 })
  const why = B.explainBalanceGap({ pair: 'pushPull', planned: plannedBal.pushPull, done: doneBal.pushPull, sources, passesPerWeek: 1, windowDays: 28 })
  check('why: a skipped pull routine is named', why != null && why.includes('Pull Day') && why.includes('1×') && why.includes('4×') && why.includes('pulling'), why)
  const outside = B.doneBalanceSources([
    ...[0, 1, 2, 3].map(i => ({ workoutId: `p${i}`, routineId: 'push', templateId: 'bench', workingSets: 12 })),
    ...[0, 1, 2, 3].map(i => ({ workoutId: `q${i}`, routineId: 'pull', templateId: 'row', workingSets: 12 })),
    ...[0, 1, 2, 3].map(i => ({ workoutId: `f${i}`, routineId: null, templateId: 'row', workingSets: 6 })),
  ], tpl, program)
  const whyOut = B.explainBalanceGap({ pair: 'pushPull', planned: plannedBal.pushPull, done: B.readMuscleBalance({ push: 12, pull: 18, quad: 0, ham: 0 }).pushPull, sources: outside, passesPerWeek: 1, windowDays: 28 })
  check('why: extra pulling from sessions outside the program', whyOut != null && whyOut.startsWith('4 sessions outside your program') && whyOut.includes('pulling'), whyOut)
  check('why: none when planned and done agree', B.explainBalanceGap({ pair: 'pushPull', planned: plannedBal.pushPull, done: plannedBal.pushPull, sources, passesPerWeek: 1, windowDays: 28 }) === null)
  // The owner's real pattern: an exercise added to a routine's sessions that
  // the routine itself doesn't have (a lat pulldown on leg day).
  const legs = [{ id: 'legs', title: 'Lower B', perPass: { push: 0, pull: 1.5, quad: 0, ham: 6 }, exercises: [
    { templateId: 'rdl', title: 'Romanian Deadlift', sets: 3, perPass: { push: 0, pull: 1.5, quad: 0, ham: 3 } },
    { templateId: 'curl', title: 'Lying Leg Curl', sets: 3, perPass: { push: 0, pull: 0, quad: 0, ham: 3 } },
  ] }, { id: 'up', title: 'Upper', perPass: { push: 12, pull: 6, quad: 0, ham: 0 }, exercises: [] }]
  const tpl2 = new Map([
    ['rdl', { primary: 'hamstring', secondaries: ['gluteal', 'upper-back'], title: 'Romanian Deadlift' }],
    ['curl', { primary: 'hamstring', secondaries: [], title: 'Lying Leg Curl' }],
    ['lpd', { primary: 'upper-back', secondaries: ['biceps'], title: 'Lat Pulldown (Machine)' }],
    ['bench', { primary: 'chest', secondaries: ['triceps', 'deltoids'], title: 'Bench Press' }],
  ])
  const rows2 = []
  for (let i = 0; i < 4; i++) {
    rows2.push({ workoutId: `l${i}`, routineId: 'legs', templateId: 'rdl', workingSets: 3 }, { workoutId: `l${i}`, routineId: 'legs', templateId: 'curl', workingSets: 3 }, { workoutId: `l${i}`, routineId: 'legs', templateId: 'lpd', workingSets: 3 })
    rows2.push({ workoutId: `u${i}`, routineId: 'up', templateId: 'bench', workingSets: 6 })
  }
  const src2 = B.doneBalanceSources(rows2, tpl2, legs)
  check('per-exercise done volume carried (titles from the template)', src2.find(x => x.routineId === 'legs').doneExercises.some(e => e.title === 'Lat Pulldown (Machine)' && e.sets === 12))
  const why2 = B.explainBalanceGap({ pair: 'pushPull', planned: B.readRatio('pushPull', 12, 7.5), done: B.readRatio('pushPull', 12, 12), sources: src2, passesPerWeek: 1, windowDays: 28 })
  check('why: names the exercise added to a routine that the routine lacks', why2 != null && why2.includes('Lat Pulldown (Machine)') && why2.includes('Lower B') && why2.includes("isn't in that routine"), why2)
  const skipRows = rows2.filter(r => r.templateId !== 'curl' && r.templateId !== 'lpd')
  const why3 = B.explainBalanceGap({ pair: 'quadHam', planned: B.readRatio('quadHam', 9, 6), done: B.readRatio('quadHam', 9, 3), sources: B.doneBalanceSources(skipRows, tpl2, legs), passesPerWeek: 1, windowDays: 28 })
  check('why: names a routine exercise that was skipped', why3 != null && why3.includes('skipped Lying Leg Curl'), why3)
  const cmp = B.compareBalance({ planned: plannedBal, done: doneBal, sources, passesPerWeek: 1, windowDays: 28 })
  check('compareBalance: both pairs, why only where they differ', cmp.pushPull.disagree && cmp.pushPull.why && !cmp.quadHam.disagree && cmp.quadHam.why === null)
}

// ─── improvement.ts ─────────────────────────────────────────────────────────
console.log('\nimprovement')
{
  const row = (w, date, tid, weight, reps, type = 'normal', extra = {}) => ({ workout_id: w, date, exercise_template_id: tid, set_type: type, weight_kg: weight, reps, duration_seconds: null, distance_meters: null, ...extra })
  check('higherIsBetter false only for assistance', !I.higherIsBetter('assistedWeight') && I.higherIsBetter('reps'))
  check('session top: best e1RM, warm-up ignored', I.sessionTopValue([row('w', 'd', 't', 200, 1, 'warmup'), row('w', 'd', 't', 100, 5), row('w', 'd', 't', 90, 8)], 'est1rm') === 116.7)
  check('session top: dropset ignored', I.sessionTopValue([row('w', 'd', 't', 100, 5, 'dropset')], 'est1rm') === null)
  check('session top: >12 reps has no e1RM', I.sessionTopValue([row('w', 'd', 't', 40, 15)], 'est1rm') === null)
  check('session top: assisted = least assistance', I.sessionTopValue([row('w', 'd', 't', 30, 8), row('w', 'd', 't', 20, 6)], 'assistedWeight') === 20)
  check('session top: reps = max reps', I.sessionTopValue([row('w', 'd', 't', null, 8), row('w', 'd', 't', null, 11)], 'reps') === 11)

  check('windowStart 4 weeks back inclusive', I.windowStart('2026-09-27', 4) === '2026-08-31')
  const templates = [{ id: 'b', title: 'Bench', type: 'weight_reps' }, { id: 'p', title: 'Assisted Pull Up', type: 'bodyweight_assisted' }, { id: 'n', title: 'New', type: 'weight_reps' }, { id: 'f', title: 'Flat', type: 'weight_reps' }]
  const sets = [
    row('1', '2026-08-01', 'b', 80, 5), row('2', '2026-08-10', 'b', 80, 6), row('3', '2026-08-20', 'b', 85, 5), row('4', '2026-09-01', 'b', 90, 5), row('5', '2026-09-20', 'b', 90, 6),
    row('1', '2026-08-01', 'p', 30, 8), row('2', '2026-08-10', 'p', 30, 8), row('4', '2026-09-01', 'p', 25, 8), row('5', '2026-09-20', 'p', 20, 8),
    row('5', '2026-09-20', 'n', 50, 5),
    row('1', '2026-08-01', 'f', 50, 10), row('3', '2026-08-20', 'f', 50, 10), row('5', '2026-09-20', 'f', 50, 10),
  ]
  const changes = I.computeLiftChanges(sets, templates, '2026-09-27', 12)
  const ch = id => changes.find(c => c.templateId === id)
  const bench = ch('b')
  check('bench improved: start = better of first two, end = better of last two', bench.start === 96 && bench.end === 108 && bench.status === 'improved' && bench.changePct === 12.5, J(bench))
  check('assisted pull-up improved when assistance drops', ch('p').status === 'improved' && ch('p').changePct === 33.3, J(ch('p')))
  check('one session → insufficient', ch('n').status === 'insufficient' && ch('n').changePct === null)
  check('same numbers → flat', ch('f').status === 'flat' && ch('f').changePct === 0)
  const shortWin = I.computeLiftChanges(sets, templates, '2026-09-27', 4)
  check('4-week window only sees the last sessions (bench: 2 sessions → insufficient)', shortWin.find(c => c.templateId === 'b').status === 'insufficient', J(shortWin.find(c => c.templateId === 'b')))
  const sum = I.summarizeImprovement(changes)
  check('summary counts', sum.improved === 2 && sum.flat === 1 && sum.declined === 0 && sum.insufficient === 1 && sum.judged === 3, J(sum))
  const decl = I.liftChange([{ date: '2026-08-01', workoutId: 'a', value: 100 }, { date: '2026-08-05', workoutId: 'b', value: 100 }, { date: '2026-08-20', workoutId: 'c', value: 90 }, { date: '2026-08-25', workoutId: 'd', value: 95 }], 'est1rm', { templateId: 'x', title: 'X' })
  check('declined beyond the flat band', decl.status === 'declined' && decl.changePct === -5, J(decl))
  const tooClose = I.liftChange([{ date: '2026-08-01', workoutId: 'a', value: 1 }, { date: '2026-08-03', workoutId: 'b', value: 2 }, { date: '2026-08-05', workoutId: 'c', value: 3 }], 'est1rm', { templateId: 'x', title: 'X' })
  check('three sessions inside two weeks → insufficient', tooClose.status === 'insufficient')
  const main = I.mainLifts(changes, 5)
  check('main lifts: e1RM kinds only, judged only', J(main.map(m => m.templateId)) === '["b","f"]', J(main.map(m => m.templateId)))
  check('main lifts: preferred ids ranked first', I.mainLifts(changes, 5, new Set(['f']))[0].templateId === 'f')

  const bw = [{ date: '2026-07-10', kg: 90 }, { date: '2026-07-12', kg: 89 }, { date: '2026-08-01', kg: 88 }, { date: '2026-09-20', kg: 86 }, { date: '2026-09-25', kg: 85 }]
  const bwc = I.bodyweightOverWindow(bw, '2026-09-27', 12)
  check('bodyweight over window: first-14 vs last-14 day means', bwc && bwc.startKg === 89.5 && bwc.endKg === 85.5 && bwc.deltaKg === -4, J(bwc))
  check('bodyweight over window: overlapping stretches → null', I.bodyweightOverWindow([{ date: '2026-09-20', kg: 80 }, { date: '2026-09-25', kg: 81 }], '2026-09-27', 4) === null)
  check('bodyweight over window: one weigh-in → null', I.bodyweightOverWindow([{ date: '2026-09-20', kg: 80 }], '2026-09-27', 4) === null)
}

// ─── recovery.ts ────────────────────────────────────────────────────────────
console.log('\nrecovery')
{
  check('fmtHours 7.5 → 7h 30m', R.fmtHours(7.5) === '7h 30m')
  check('sleep: short night warns', R.sleepNote({ date: '2026-09-27', hours: 5.6 }, '2026-09-27', '2026-09-26')?.tone === 'warn')
  check('sleep: 6.5 h is under guideline, neutral', R.sleepNote({ date: '2026-09-27', hours: 6.5 }, '2026-09-27', '2026-09-26')?.tone === 'neutral')
  check('sleep: 7.2 h meets guideline', R.sleepNote({ date: '2026-09-26', hours: 7.2 }, '2026-09-27', '2026-09-26')?.tone === 'success')
  check('sleep: old night → null', R.sleepNote({ date: '2026-09-20', hours: 8 }, '2026-09-27', '2026-09-26') === null)
  check('sleep: none → null', R.sleepNote(null, '2026-09-27', '2026-09-26') === null)
  check('RHR +6 vs baseline warns', R.restingHrNote(62, 56)?.tone === 'warn' && R.restingHrNote(62, 56).text.includes('+6'))
  check('RHR in range', R.restingHrNote(57, 56)?.tone === 'success')
  check('RHR without baseline still states the value', R.restingHrNote(58, null)?.text.includes('58 bpm'))
  check('RHR missing → null', R.restingHrNote(null, 56) === null)

  const tm = new Map([['bench', { primary: 'chest', secondary: ['triceps'] }], ['fly', { primary: 'chest', secondary: [] }]])
  const row = (w, date, tid, type = 'normal') => ({ workout_id: w, date, exercise_template_id: tid, set_type: type, weight_kg: 50, reps: 8, duration_seconds: null, distance_meters: null })
  const sets = [
    row('a', '2026-09-20', 'bench'), row('a', '2026-09-20', 'bench'), row('a', '2026-09-20', 'bench'), row('a', '2026-09-20', 'bench'),
    row('b', '2026-09-25', 'fly'), row('b', '2026-09-25', 'fly', 'warmup'),
    row('c', '2026-09-26', 'fly'), row('c', '2026-09-26', 'fly'),
  ]
  const last = R.computeMuscleLastTrained(sets, tm, '2026-09-27')
  check('chest last trained on the latest workout with ≥2 sets', last.get('chest').lastDate === '2026-09-26' && last.get('chest').daysSince === 1, J(last.get('chest')))
  check('1 working set (warm-up excluded) doesn\'t count', last.get('chest').lastDate !== '2026-09-25')
  check('triceps: 4 × 0.5 = 2 secondary sets count', last.get('triceps').lastDate === '2026-09-20' && last.get('triceps').credit === 2)
  check('future-dated sets ignored', R.computeMuscleLastTrained([row('z', '2026-10-01', 'fly'), row('z', '2026-10-01', 'fly')], tm, '2026-09-27').size === 0)
  const rdlTm = new Map([['rdl', { primary: 'hamstrings', secondary: ['upper_back', 'lats'] }]])
  const rdl = R.computeMuscleLastTrained([row('r', '2026-09-26', 'rdl'), row('r', '2026-09-26', 'rdl'), row('r', '2026-09-26', 'rdl')], rdlTm, '2026-09-27')
  check('Back from upper_back + lats secondaries credited once (3 × 0.5 = 1.5 < 2 → not "trained")', !rdl.has('upper-back') && rdl.get('hamstring').credit === 3)
  check('buckets', R.recencyBucket(0) === 'today' && R.recencyBucket(2) === 'd1_2' && R.recencyBucket(4) === 'd3_4' && R.recencyBucket(7) === 'd5_7' && R.recencyBucket(14) === 'd8_14' && R.recencyBucket(30) === 'd15' && R.recencyBucket(null) === 'never')
  check('recency tones: recent green, within a week info, 8–14 days warn, older grey', R.RECENCY_TONE.today === 'success' && R.RECENCY_TONE.d1_2 === 'success' && R.RECENCY_TONE.d5_7 === 'info' && R.RECENCY_TONE.d8_14 === 'warn' && R.RECENCY_TONE.d15 === 'neutral' && R.RECENCY_TONE.never === 'neutral')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
