#!/usr/bin/env node
/*
 * Verification — Training → Progress decision-table filters
 * (src/features/training/progress/decisionFilters.ts) and the per-exercise
 * metadata the progress model hands them (progressModel.ts:
 * musclesByTemplateId, routineIdsByTemplateId).
 *
 *   1. muscleRoleFor — primary / secondary / none; Hevy's lats + upper back
 *      are one Back slug, so a lat pulldown trains Back as its primary only.
 *   2. The model's metadata — each exercise's primary + secondary slugs from
 *      the templates; routine membership by id, in routine order, incl. a
 *      lift trained in a routine lately that the routine no longer lists;
 *      two routines sharing a name stay apart (titles stay deduplicated).
 *   3. Options — muscles from every decision (primary or secondary), main
 *      muscles first then A–Z; routines in routine-list order, only ones
 *      holding a listed exercise, duplicate names numbered.
 *   4. effectiveFilters — a pick no longer offered filters nothing; one
 *      routine has nothing to choose between.
 *   5. applyDecisionFilters — Muscle keeps primary OR secondary, Routine
 *      keeps that routine's exercises (by id, never by name), and every
 *      filter combines with AND (search, evidence, window); order is kept.
 *   6. filtersActive / NO_FILTERS — what "Clear filters" resets.
 *
 * Proves everything against the REAL un-mocked modules (loaded via sucrase —
 * this repo has no unit-test runner by convention). No decision logic is
 * exercised here beyond what computeProgressModel already produces.
 *
 *   Run:  node scripts/verify-progress-filters.cjs
 */
require('sucrase/register')

const {
  NO_FILTERS, DATE_WINDOWS, filtersActive, muscleRoleFor, muscleOptions, routineOptions, showsRoutineFilter,
  effectiveFilters, withinDateWindow, applyDecisionFilters,
} = require('../src/features/training/progress/decisionFilters')
const { filterByTab } = require('../src/features/training/progress/decisionTabs')
const { computeProgressModel } = require('../src/features/training/progressModel')
const { templateMuscleCredit } = require('../src/features/training/muscleMap')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const ids = list => list.map(d => d.exerciseTemplateId).sort().join()

// ── Fixture: a three-routine current program, one routine outside it ──────
const today = '2026-10-07'
function rows(workoutId, date, templateId, routineId, weightKg, repsArr) {
  return repsArr.map((reps, i) => ({
    workout_id: workoutId, date, exercise_template_id: templateId, set_type: 'normal',
    weight_kg: weightKg, reps, duration_seconds: null, distance_meters: null,
    routine_id: routineId, rpe: null, set_index: i + 1, workout_title: routineId,
  }))
}
const tpl = (id, title, primary, secondary) => ({ id, title, type: 'weight_reps', primary_muscle_group: primary, secondary_muscle_groups: secondary })
const templates = [
  tpl('bench', 'Bench Press (Barbell)', 'chest', ['triceps', 'shoulders']),
  tpl('pushdown', 'Triceps Pushdown', 'triceps', []),
  tpl('pulldown', 'Lat Pulldown (Cable)', 'lats', ['upper_back', 'biceps']),
  tpl('curl', 'Bicep Curl (Dumbbell)', 'biceps', ['forearms']),
  tpl('inclineCurl', 'Incline Curl', 'biceps', []),
  tpl('squat', 'Squat (Barbell)', 'quadriceps', ['glutes', 'hamstrings', 'lower_back']),
  tpl('carry', "Farmer's Walk", 'full_body', ['forearms', 'traps']),
  tpl('legPress', 'Leg Press', 'quadriceps', []),
]
const sets = [
  // Bench: six sessions over five weeks (strong trend evidence), in Upper A.
  ...['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06'].flatMap((d, i) => rows(`ua${i}`, d, 'bench', 'upperA', 60, [8, 8, 8])),
  ...rows('ua4', '2026-09-29', 'pushdown', 'upperA', 25, [10, 10, 10]), ...rows('ua5', '2026-10-06', 'pushdown', 'upperA', 25, [12, 11, 10]),
  // Pulldown: last trained five weeks ago.
  ...rows('old1', '2026-08-20', 'pulldown', 'upperA', 50, [10, 10, 10]), ...rows('old2', '2026-08-27', 'pulldown', 'upperA', 50, [11, 10, 10]),
  // Curl: one session so far (INSUFFICIENT_DATA).
  ...rows('ua5', '2026-10-06', 'curl', 'upperA', 12, [10, 10, 10]),
  // Incline curl: swapped into Upper A last week; Upper A doesn't list it.
  ...rows('ua6', '2026-10-01', 'inclineCurl', 'upperA', 10, [10, 10, 10]),
  ...rows('lb1', '2026-09-24', 'squat', 'lowerB', 100, [5, 5, 5]), ...rows('lb2', '2026-10-01', 'squat', 'lowerB', 100, [6, 5, 5]),
  ...rows('lb1', '2026-09-24', 'carry', 'lowerB', 30, [1, 1]), ...rows('lb2', '2026-10-01', 'carry', 'lowerB', 32, [1, 1]),
  // Leg press: only ever in a routine outside the current program.
  ...rows('x1', '2026-10-02', 'legPress', 'oldRoutine', 150, [10, 10, 10]),
]
const ex = (id, title) => ({ exercise_template_id: id, title, index: 0, sets: [] })
// Routine-list order (the Program tab's): Lower B, Upper A, then a second "Upper A".
const routines = [
  { id: 'lowerB', title: 'Lower B', exercises: [ex('squat', 'Squat'), ex('carry', 'Carry')] },
  { id: 'upperA', title: 'Upper A', exercises: [ex('bench', 'Bench'), ex('pushdown', 'Pushdown'), ex('pulldown', 'Pulldown'), ex('curl', 'Curl')] },
  { id: 'upperA2', title: 'Upper A', exercises: [ex('bench', 'Bench')] },
  { id: 'oldRoutine', title: 'Old', exercises: [ex('legPress', 'Leg press')] },
]
const model = computeProgressModel({
  history: { sets, templates },
  currentProgram: [{ routine_id: 'lowerB' }, { routine_id: 'upperA' }, { routine_id: 'upperA2' }],
  routines, targetOverrides: [], sleepPoints: [], bodyweight: [], targetDays: 3, today,
})
const data = { titleById: model.titleById, musclesByTemplateId: model.musclesByTemplateId, routineIdsByTemplateId: model.routineIdsByTemplateId, today }
const all = model.decisions
const byId = id => all.find(d => d.exerciseTemplateId === id)
const run = patch => applyDecisionFilters(all, { ...NO_FILTERS, ...patch }, data)

console.log('\n1 · muscleRoleFor')
{
  const bench = templateMuscleCredit('chest', ['triceps', 'shoulders'])
  check('1: the primary muscle reads primary', muscleRoleFor(bench, 'chest') === 'primary')
  check('1: a secondary muscle reads secondary', muscleRoleFor(bench, 'triceps') === 'secondary' && muscleRoleFor(bench, 'deltoids') === 'secondary')
  check('1: a muscle the exercise does not train reads null', muscleRoleFor(bench, 'biceps') === null)
  check('1: no template data → null (never a guess)', muscleRoleFor(undefined, 'chest') === null)
  const pulldown = templateMuscleCredit('lats', ['upper_back', 'biceps'])
  check('1: lats + upper back are one Back — primary only, never also secondary', muscleRoleFor(pulldown, 'upper-back') === 'primary' && !pulldown.secondarySlugs.includes('upper-back'))
  const carry = templateMuscleCredit('full_body', ['forearms', 'traps'])
  check('1: a full-body exercise has no primary slug; its secondaries still count', carry.primarySlug === null && muscleRoleFor(carry, 'forearm') === 'secondary' && muscleRoleFor(carry, 'trapezius') === 'secondary')
}

console.log('\n2 · The model carries the per-exercise metadata')
{
  check('2: the program scope is unchanged — current-program exercises only, the swapped-in lift included', ids(all) === 'bench,carry,curl,inclineCurl,pulldown,pushdown,squat', ids(all))
  const bench = model.musclesByTemplateId.get('bench')
  check('2: muscles per exercise come from the templates (primary + secondaries as body slugs)', bench && bench.primarySlug === 'chest' && bench.secondarySlugs.join() === 'triceps,deltoids')
  check('2: squat → quadriceps + glutes, hamstrings, lower back', model.musclesByTemplateId.get('squat').secondarySlugs.join() === 'gluteal,hamstring,lower-back')
  check('2: routine membership is by id, in routine order — bench is in both "Upper A" routines', (model.routineIdsByTemplateId.get('bench') ?? []).join() === 'upperA,upperA2')
  check('2: a lift trained in Upper A lately (not listed there) belongs to Upper A', (model.routineIdsByTemplateId.get('inclineCurl') ?? []).join() === 'upperA')
  check('2: a routine outside the current program is never a membership', !model.routineIdsByTemplateId.has('legPress'))
  check('2: titles stay deduplicated (two routines named "Upper A" → one title)', (model.routineTitlesByTemplateId.get('bench') ?? []).join() === 'Upper A')
  check('2: every listed exercise has at least one routine', all.every(d => (model.routineIdsByTemplateId.get(d.exerciseTemplateId) ?? []).length > 0))
}

console.log('\n3 · Options')
const muscles = muscleOptions(all, model.musclesByTemplateId)
const routineOpts = routineOptions(all, model.activeRoutines, model.routineIdsByTemplateId)
{
  const slugs = muscles.map(m => m.slug)
  const expected = ['biceps', 'chest', 'deltoids', 'forearm', 'gluteal', 'hamstring', 'lower-back', 'quadriceps', 'trapezius', 'triceps', 'upper-back']
  check('3: exactly the muscles the listed exercises train, primary or secondary, each once',
    [...slugs].sort().join() === expected.join() && new Set(slugs).size === slugs.length, slugs.join())
  check('3: a muscle no listed exercise trains is not offered (nothing trains abs or calves)', !slugs.includes('abs') && !slugs.includes('calves'))
  check('3: full_body is no muscle — the farmer\'s walk adds only its secondaries (forearms, traps)',
    muscleOptions([byId('carry')], model.musclesByTemplateId).map(m => m.slug).sort().join() === 'forearm,trapezius')
  const firstMinor = muscles.findIndex(m => !m.major)
  check('3: main muscles first, then the rest', firstMinor > 0 && muscles.slice(0, firstMinor).every(m => m.major) && muscles.slice(firstMinor).every(m => !m.major))
  const labels = muscles.map(m => m.label)
  const sortedWithin = list => list.every((m, i) => i === 0 || list[i - 1].label.localeCompare(m.label) <= 0)
  check('3: each group A–Z by label', sortedWithin(muscles.filter(m => m.major)) && sortedWithin(muscles.filter(m => !m.major)), labels.join(' | '))
  check('3: labels are the app\'s muscle names', labels.includes('Back (lats / upper)') && labels.includes('Shoulders') && labels.includes('Forearms'))
  check('3: routines in routine-list order (the Program tab\'s), not A–Z', routineOpts.map(r => r.id).join() === 'lowerB,upperA,upperA2')
  check('3: two routines with the same name stay apart', routineOpts.map(r => r.label).join(' | ') === 'Lower B | Upper A | Upper A (2)')
  check('3: a current routine with no listed exercise is not offered',
    routineOptions(all, [...model.activeRoutines, { id: 'empty', title: 'Arms' }], model.routineIdsByTemplateId).every(r => r.id !== 'empty'))
  check('3: a blank routine name reads "Untitled routine"',
    routineOptions([byId('squat')], [{ id: 'lowerB', title: '  ' }], model.routineIdsByTemplateId)[0].label === 'Untitled routine')
  check('3: the Routine filter shows from two routines', !showsRoutineFilter([]) && !showsRoutineFilter(routineOpts.slice(0, 1)) && showsRoutineFilter(routineOpts.slice(0, 2)))
}

console.log('\n4 · effectiveFilters')
{
  const kept = { ...NO_FILTERS, muscle: 'triceps', routineId: 'upperA' }
  check('4: offered picks are kept as they are (same object)', effectiveFilters(kept, muscles, routineOpts) === kept)
  const staleMuscle = effectiveFilters({ ...NO_FILTERS, muscle: 'abs' }, muscles, routineOpts)
  check('4: a muscle no longer offered filters nothing', staleMuscle.muscle === 'any')
  const staleRoutine = effectiveFilters({ ...NO_FILTERS, routineId: 'oldRoutine' }, muscles, routineOpts)
  check('4: a routine no longer offered filters nothing', staleRoutine.routineId === 'any')
  check('4: with one routine there is nothing to choose — the pick is ignored', effectiveFilters({ ...NO_FILTERS, routineId: 'lowerB' }, muscles, routineOpts.slice(0, 1)).routineId === 'any')
  const mixed = effectiveFilters({ ...NO_FILTERS, query: 'curl', muscle: 'abs', routineId: 'upperA' }, muscles, routineOpts)
  check('4: only the stale part resets — search and a valid routine stay', mixed.query === 'curl' && mixed.routineId === 'upperA' && mixed.muscle === 'any')
}

console.log('\n5 · applyDecisionFilters')
{
  check('5: no filters → every decision, in the order given', run({}).map(d => d.exerciseTemplateId).join() === all.map(d => d.exerciseTemplateId).join())
  check('5: Triceps keeps its primary (pushdown) and secondary (bench) exercises', ids(run({ muscle: 'triceps' })) === 'bench,pushdown')
  check('5: Biceps keeps the curls (primary) and the pulldown (secondary)', ids(run({ muscle: 'biceps' })) === 'curl,inclineCurl,pulldown')
  check('5: Back keeps the pulldown — lats and upper back are one muscle', ids(run({ muscle: 'upper-back' })) === 'pulldown')
  check('5: Forearms reaches secondaries only (curl, farmer\'s walk)', ids(run({ muscle: 'forearm' })) === 'carry,curl')
  check('5: a muscle nothing trains → empty', run({ muscle: 'abs' }).length === 0)
  check('5: Routine keeps only that routine\'s exercises', ids(run({ routineId: 'lowerB' })) === 'carry,squat')
  check('5: Upper A includes the lift swapped in lately', ids(run({ routineId: 'upperA' })) === 'bench,curl,inclineCurl,pulldown,pushdown')
  check('5: a routine is picked by id, not name — the second "Upper A" holds only bench', ids(run({ routineId: 'upperA2' })) === 'bench')
  check('5: Muscle AND Routine combine', ids(run({ muscle: 'biceps', routineId: 'upperA' })) === 'curl,inclineCurl,pulldown' && ids(run({ muscle: 'biceps', routineId: 'lowerB' })) === '')
  check('5: Muscle AND search combine (case-insensitive)', ids(run({ muscle: 'biceps', query: 'CURL' })) === 'curl,inclineCurl')
  check('5: search alone matches a part of the name, ignoring surrounding spaces', ids(run({ query: '  press ' })) === 'bench')
  const strongLevel = byId('bench').evidence.progress
  check('5: the fixture has two evidence levels (bench: six sessions over five weeks)', strongLevel !== 'limited' && byId('squat').evidence.progress === 'limited', strongLevel)
  check('5: Evidence keeps exactly that level', ids(run({ evidence: strongLevel })) === 'bench' && !run({ evidence: 'limited' }).some(d => d.exerciseTemplateId === 'bench'))
  check('5: Evidence AND Routine combine', ids(run({ evidence: 'limited', routineId: 'upperA2' })) === '')
  check('5: the 4-week window drops the pulldown (last trained five weeks ago)', !run({ window: '4w' }).some(d => d.exerciseTemplateId === 'pulldown') && run({ window: '8w' }).some(d => d.exerciseTemplateId === 'pulldown'))
  check('5: Window AND Muscle combine — Back has nothing in the last 4 weeks', run({ muscle: 'upper-back', window: '4w' }).length === 0)
  check('5: all five at once', ids(run({ query: 'bench', evidence: strongLevel, window: '4w', muscle: 'deltoids', routineId: 'upperA2' })) === 'bench')
  check('5: filters narrow a tab\'s list, never add to it', ids(applyDecisionFilters(filterByTab(all, 'recent', today), { ...NO_FILTERS, routineId: 'upperA' }, data)) === 'bench,curl,inclineCurl,pushdown')
  const reversed = [...all].reverse()
  check('5: the given order is kept (sorting is the table\'s job)', applyDecisionFilters(reversed, { ...NO_FILTERS, muscle: 'biceps' }, data).map(d => d.exerciseTemplateId).join() === reversed.filter(d => ['curl', 'inclineCurl', 'pulldown'].includes(d.exerciseTemplateId)).map(d => d.exerciseTemplateId).join())
  const undated = { exerciseTemplateId: 'x', evidence: { progress: 'limited' }, currentState: { latest: null } }
  check('5: an exercise with no session date is never hidden by the window', withinDateWindow(undated, '4w', today) && withinDateWindow(byId('bench'), 'all', today))
  check('5: an exercise missing from the metadata never matches a muscle or routine', applyDecisionFilters([undated], { ...NO_FILTERS, muscle: 'chest' }, data).length === 0 && applyDecisionFilters([undated], { ...NO_FILTERS, routineId: 'upperA' }, data).length === 0)
}

console.log('\n6 · filtersActive / NO_FILTERS')
{
  check('6: NO_FILTERS is inactive', !filtersActive(NO_FILTERS))
  check('6: a blank search is not a filter', !filtersActive({ ...NO_FILTERS, query: '   ' }))
  check('6: each filter on its own counts as active',
    ['query', 'evidence', 'window', 'muscle', 'routineId'].every(k => filtersActive({ ...NO_FILTERS, [k]: { query: 'x', evidence: 'strong', window: '4w', muscle: 'chest', routineId: 'upperA' }[k] })))
  check('6: the default window is the whole loaded history (6 months)', NO_FILTERS.window === 'all' && DATE_WINDOWS.find(w => w.id === 'all').label === 'Last 6 months')
}

console.log(`\n${failed === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
