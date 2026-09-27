#!/usr/bin/env node
/*
 * Verification — the shared AI-coach context and the limitation/restriction
 * helpers it relies on (muscleMap.ts), run through sucrase against the real
 * modules (no unit-test framework in this repo by convention).
 *
 * Covers:
 *   1. resolveMovementPattern / movementPatternLabel — free-text patterns
 *      never render 'undefined' or a blank name.
 *   2. restrictionsBySlug — active only, monitor excluded, free text resolved,
 *      worst case wins, every limitation reaching a muscle listed.
 *   3. weeklySetGap — add/cut/none against landmarks.
 *   4. computeProgressModel — the current-program gate, incl. saved routines
 *      that no longer exist (stale program).
 *   5. formatPtSnapshot / buildCoachJson — program, decisions, limitation
 *      names and the 'no program' state reach both coaches.
 *   7. Missed current-program sessions (and their skip reasons) reach both
 *      coaches, and the PT prompt documents the "Missed:" line.
 *
 * Run: node scripts/verify-coach-context.cjs
 */
require('sucrase/register')
const {
  resolveMovementPattern, movementPatternLabel, restrictionsBySlug, limitedSlugsFromLimitations, weeklySetGap, MUSCLE_LANDMARKS,
} = require('../src/features/training/muscleMap')
const { computeProgressModel } = require('../src/features/training/progressModel')
const { formatPtSnapshot, buildCoachJson, limitationName, PT_SYSTEM_PROMPT } = require('../src/features/training/coach/coachFormat')
const { summarizeWorkingSets, sessionsFromHistory } = require('../src/features/training/coach/coachModel')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`) }
}

console.log('\n1 · Free-text movement patterns')
check('exact key resolves to itself', resolveMovementPattern('squat') === 'squat')
check('"heavy_hip_hinge" reads as hinge', resolveMovementPattern('heavy_hip_hinge') === 'hinge')
check('"overhead press" reads as vertical_press', resolveMovementPattern('Overhead press') === 'vertical_press')
check('"unilateral_balance_left" matches nothing', resolveMovementPattern('unilateral_balance_left') === null)
check('enum label for a key', movementPatternLabel('hinge') === 'Hinge (deadlift pattern)')
check('free text made readable', movementPatternLabel('unilateral_balance_left') === 'Unilateral balance left', movementPatternLabel('unilateral_balance_left'))
check('empty value never blank', movementPatternLabel('') === 'Unnamed limitation')
check('coach name shows what free text is read as', limitationName('heavy_hip_hinge') === 'Heavy hip hinge [= Hinge (deadlift pattern)]', limitationName('heavy_hip_hinge'))
check('no "undefined" anywhere', !/undefined/.test(limitationName('whatever_this_is')))

console.log('\n2 · restrictionsBySlug')
{
  const lims = [
    { id: 'a', movement_pattern: 'heavy_hip_hinge', severity: 'limit', active: true },
    { id: 'b', movement_pattern: 'squat', severity: 'avoid', active: true },
    { id: 'c', movement_pattern: 'vertical_press', severity: 'monitor', active: true },
    { id: 'd', movement_pattern: 'horizontal_press', severity: 'avoid', active: false },
  ]
  const r = restrictionsBySlug(lims)
  check('free-text hinge flags hamstrings', r.get('hamstring')?.weight === 'limit')
  check('worst case wins on lower back (hinge avoid-slug vs squat)', r.get('lower-back')?.weight === 'avoid')
  check('both limitations listed for gluteal', (r.get('gluteal')?.items.length) === 2)
  check('monitor flags nothing (deltoids)', !r.has('deltoids'))
  check('inactive flags nothing (chest)', !r.has('chest'))
  const flat = limitedSlugsFromLimitations(lims)
  check('limitedSlugsFromLimitations agrees', flat.get('quadriceps') === 'avoid' && flat.get('hamstring') === 'limit' && flat.size === r.size)
}

console.log('\n3 · weeklySetGap')
{
  const L = MUSCLE_LANDMARKS.chest // mev 8, mav 20, mrv 22
  const add = weeklySetGap(3, L)
  check('below MEV → add', add?.kind === 'add' && add.sets === 5 && add.sessions === 2, add)
  check('inside range → null', weeklySetGap(12, L) === null)
  const cut = weeklySetGap(26, L)
  check('above MRV → cut', cut?.kind === 'cut' && cut.sets === 4, cut)
  check('no landmarks → null', weeklySetGap(5, undefined) === null)
}

// ── A small history: two Push sessions of bench under routine r1 ──
const set = (workout, date, weight, reps, i) => ({
  workout_id: workout, date, exercise_template_id: 'bench', set_type: 'normal', weight_kg: weight, reps,
  duration_seconds: null, distance_meters: null, routine_id: 'r1', rpe: null, set_index: i, workout_title: 'Push',
})
const history = {
  sets: [
    set('w1', '2026-09-14', 60, 8, 0), set('w1', '2026-09-14', 60, 8, 1), set('w1', '2026-09-14', 60, 8, 2),
    set('w2', '2026-09-21', 60, 10, 0), set('w2', '2026-09-21', 60, 10, 1), set('w2', '2026-09-21', 60, 10, 2),
    { ...set('w2', '2026-09-21', 20, 10, -1), set_type: 'warmup' },
  ],
  templates: [{ id: 'bench', title: 'Bench Press', type: 'weight_reps', primary_muscle_group: 'chest', secondary_muscle_groups: ['triceps'] }],
}
const routine = (id, title) => ({
  id, title, exercises: [{ exercise_template_id: 'bench', title: 'Bench Press', rest_seconds: 120,
    sets: [0, 1, 2].map(i => ({ type: 'normal', reps: null, rep_range_start: 8, rep_range_end: 10, weight_kg: 60, index: i })) }],
})
const base = { history, routines: [routine('r1', 'Push')], targetOverrides: [], sleepPoints: [], bodyweight: [], targetDays: 3, today: '2026-09-23' }

console.log('\n4 · computeProgressModel gate')
{
  const none = computeProgressModel({ ...base, currentProgram: [] })
  check('no saved program → needsCurrentProgram, not stale', none.needsCurrentProgram && !none.staleProgram && none.decisions.length === 0)
  check('suggests the routine trained in the last 28 days', none.suggestedRoutines.map(r => r.id).join() === 'r1')
  const stale = computeProgramModelWith([{ routine_id: 'gone' }])
  check('saved routine no longer exists → stale, no decisions', stale.needsCurrentProgram && stale.staleProgram && stale.decisions.length === 0)
  const ok = computeProgramModelWith([{ routine_id: 'r1' }, { routine_id: 'gone' }])
  check('one live saved routine → decisions run', !ok.needsCurrentProgram && ok.decisions.length === 1)
  check('activeRoutines only lists existing routines', ok.activeRoutines.map(r => r.id).join() === 'r1')
}
function computeProgramModelWith(currentProgram) {
  return computeProgressModel({ ...base, currentProgram })
}

console.log('\n5 · Coach snapshot + JSON')
{
  check('warm-ups excluded from set summaries', summarizeWorkingSets(history.sets.filter(s => s.workout_id === 'w2')) === '3×10@60kg')
  const sessions = sessionsFromHistory(history)
  check('sessions newest first', sessions.map(s => s.workoutId).join() === 'w2,w1')

  const progress = computeProgressModel({ ...base, currentProgram: [{ routine_id: 'r1' }] })
  const data = {
    today: '2026-09-23',
    profile: { goal: 'hypertrophy', experience_level: 'intermediate', equipment_access: 'gym', training_days_per_week: 3, notes: null },
    limitations: [{ id: 'l1', movement_pattern: 'heavy_hip_hinge', severity: 'limit', note: 'lower back', active: true }],
    progress, routines: base.routines, sessions, sessionsThisWeek: 1,
    weeklyMuscleSets: [{ slug: 'chest', sets: 3, landmarks: MUSCLE_LANDMARKS.chest, restriction: null }],
    sleep: [{ date: '2026-09-23', total: 7.2, deep: 1, rem: 1.5 }],
    steps: [{ date: '2026-09-23', value: 8000 }], activeKcal: [], bodyweight: [{ date: '2026-09-20', kg: 80, fatPct: 18 }, { date: '2026-09-23', kg: 79.5, fatPct: null }],
  }
  const text = formatPtSnapshot(data)
  if (process.env.SHOW) console.log(text, JSON.stringify(buildCoachJson(data, 30)))
  check('PROGRAM line names the real routines', /PROGRAM: Push · bu hafta 1 antrenman \(hedef 3\)/.test(text), text.split('\n').find(l => l.startsWith('PROGRAM')))
  check('a Karar line per current-program exercise', /Karar: Bench Press: [A-Z_]+ "/.test(text), text)
  check('limitation name resolved, never undefined', text.includes('Kısıtlama: Heavy hip hinge [= Hinge (deadlift pattern)] (limit) — lower back') && !/undefined/.test(text))
  check('latest session with previous numbers', text.includes('Bench Press: 3×10@60kg (önceki: 3×8@60kg)'), text)
  check('a load increase with no known step uses the engine headline, not the old load', /sonraki: Ready to increase from 60 kg/.test(text), text.split('\n').find(l => l.includes('Karar')))
  check('no hard-coded split in the snapshot', !/bro-split|Back\/Chest/.test(text))
  check('weight trend line', text.includes("KİLO: 79.5kg (2026-09-20'den beri -0.5kg)"))

  const json = buildCoachJson(data, 30)
  check('JSON carries the program', json.program.selected === true && json.program.routines[0].t === 'Push')
  check('JSON carries the engine decisions', Array.isArray(json.progress) && json.progress[0].n === 'Bench Press' && typeof json.progress[0].action === 'string')
  check('JSON limitation readable', json.limitations[0].pattern.startsWith('Heavy hip hinge'))
  check('JSON body fat only where known', json.bodyfat_pct.length === 1)

  const noProgram = { ...data, progress: computeProgressModel({ ...base, currentProgram: [] }) }
  check('no program → snapshot says so, no Karar lines', /PROGRAM: seçilmemiş/.test(formatPtSnapshot(noProgram)) && !/Karar:/.test(formatPtSnapshot(noProgram)))
  check('no program → JSON program.selected false, no progress', buildCoachJson(noProgram, 30).program.selected === false && !('progress' in buildCoachJson(noProgram, 30)))
}

console.log('\n6 · RPE (Hevy) in both coaches — compact, context only')
{
  // The same history with the w2 working sets rated 8/9/10 (and a rated warm-up).
  const rpeOf = { 0: 8, 1: 9, 2: 10, [-1]: 5 }
  const rated = { ...history, sets: history.sets.map(x => (x.workout_id === 'w2' ? { ...x, rpe: rpeOf[x.set_index] } : x)) }
  check('set summary lists working-set RPE in order (warm-up rating left out)', summarizeWorkingSets(rated.sets.filter(x => x.workout_id === 'w2')) === '3×10@60kg @ RPE 8/9/10', summarizeWorkingSets(rated.sets.filter(x => x.workout_id === 'w2')))
  check('set summary unchanged without RPE', summarizeWorkingSets(history.sets.filter(x => x.workout_id === 'w1')) === '3×8@60kg')
  const progressRated = computeProgressModel({ ...base, history: rated, currentProgram: [{ routine_id: 'r1' }] })
  const progressPlain = computeProgressModel({ ...base, currentProgram: [{ routine_id: 'r1' }] })
  const mk = (h, progress) => ({
    today: '2026-09-23', profile: null, limitations: [], progress, routines: base.routines, sessions: sessionsFromHistory(h), sessionsThisWeek: 1,
    weeklyMuscleSets: [], sleep: [], steps: [], activeKcal: [], bodyweight: [],
  })
  const text = formatPtSnapshot(mk(rated, progressRated))
  check('snapshot workout line carries RPE, previous session unrated', text.includes('Bench Press: 3×10@60kg @ RPE 8/9/10 (önceki: 3×8@60kg)'), text)
  check('Karar "son:" carries RPE', /son: 60 kg × 10\/10\/10 @ RPE 8\/9\/10 ·/.test(text), text.split('\n').find(l => l.includes('Karar')))
  check('RPE never changes the Karar action', progressRated.decisions[0].currentAction === progressPlain.decisions[0].currentAction)
  const json = buildCoachJson(mk(rated, progressRated), 30)
  check('JSON progress.last carries RPE', json.progress[0].last === '60 kg × 10/10/10 @ RPE 8/9/10', json.progress[0].last)
  check('JSON workout sets carry RPE', json.workouts[0].ex[0].s === '3×10@60kg @ RPE 8/9/10', json.workouts[0].ex[0].s)
  check('JSON explains the RPE suffix once', /RPE/.test(json.about) && /never overrides/.test(json.about))
  check('PT prompt documents the RPE suffix (snapshot contract)', PT_SYSTEM_PROMPT.includes('@ RPE 8/9/10') && /never overrides a Karar/.test(PT_SYSTEM_PROMPT))
}

console.log('\n7 · Missed current-program sessions (plan/skippedRoutines.ts, migration 112)')
{
  const { missedLine } = require('../src/features/training/coach/coachFormat')
  const progress = computeProgressModel({ ...base, currentProgram: [{ routine_id: 'r1' }] })
  const missed = [
    { kind: 'overdue', routineId: 'r1', title: 'Push Day', lastTrained: '2026-09-14', daysSince: 9, dueDate: '2026-09-21', weekStart: '2026-09-21' },
    { kind: 'skipped', routineId: 'r2', title: 'Legs', lastTrained: '2026-09-10', daysSince: 13, dueDate: '2026-09-17', weekStart: '2026-09-14', skip: { id: 's', routine_id: 'r2', week_start: '2026-09-14', reason: 'Sick — flu' } },
  ]
  const data = {
    today: '2026-09-23', profile: null, limitations: [], progress, routines: base.routines, sessions: sessionsFromHistory(history), sessionsThisWeek: 1,
    weeklyMuscleSets: [], sleep: [], steps: [], activeKcal: [], bodyweight: [], missedSessions: missed,
  }
  check('overdue line', missedLine(missed[0]) === 'Missed: Push Day — not done in 9 days (due 2026-09-21)', missedLine(missed[0]))
  check('skipped line carries the reason', missedLine(missed[1]).endsWith('· skipped: Sick — flu'), missedLine(missed[1]))
  const text = formatPtSnapshot(data)
  check('snapshot lists them under PROGRAM', /PROGRAM: [^\n]*\n  Missed: Push Day/.test(text), text.split('\n').slice(0, 6).join(' | '))
  const json = buildCoachJson(data, 30)
  check('JSON program.missed with status and reason', json.program.missed?.length === 2 && json.program.missed[1].status === 'skipped' && json.program.missed[1].reason === 'Sick — flu', JSON.stringify(json.program.missed))
  const none = buildCoachJson({ ...data, missedSessions: [] }, 30)
  check('nothing missed → no missed key, no Missed line', !('missed' in none.program) && !/Missed:/.test(formatPtSnapshot({ ...data, missedSessions: undefined })))
  check('PT prompt documents the Missed line (snapshot contract)', PT_SYSTEM_PROMPT.includes('"Missed:" lines under PROGRAM') && PT_SYSTEM_PROMPT.includes('skipped: <reason>'))
}

console.log('\n8 · Push:pull balance — the same numbers the app shows (plan/muscleBalance.ts)')
{
  const { coachBalance } = require('../src/features/training/coach/coachModel')
  const { balanceLines } = require('../src/features/training/coach/coachFormat')
  // A pull exercise added to the Push routine's sessions that the routine
  // doesn't have — Back credited once although Hevy lists lats + upper_back.
  const pull = (w, date, i) => ({ ...set(w, date, 50, 10, i), exercise_template_id: 'lpd' })
  const h = {
    sets: [...history.sets, pull('w1', '2026-09-14', 3), pull('w1', '2026-09-14', 4), pull('w2', '2026-09-21', 3), pull('w2', '2026-09-21', 4)],
    templates: [...history.templates, { id: 'lpd', title: 'Lat Pulldown (Machine)', type: 'weight_reps', primary_muscle_group: 'lats', secondary_muscle_groups: ['upper_back', 'biceps'] }],
  }
  const b = coachBalance({ history: h, templates: [], routines: base.routines, programRoutineIds: ['r1'], trainingDaysPerWeek: 1, scheduledTrainingDays: 0, today: '2026-09-23' })
  check('planned from the program: bench 3 sets → push 6, no pull', b.planned.pushPull.a === 6 && b.planned.pushPull.lean === 'a' && b.planned.pushPull.ratio === null, b.planned.pushPull)
  // done 30 d: bench 6 sets × 2 credit = 12 push; pulldown 4 sets × (Back 1 + biceps 0.5) = 6 pull → per week ×7/30
  check('done over 30 days, Back credited once', b.done.pushPull.a === 2.8 && b.done.pushPull.b === 1.4 && b.done.pushPull.ratio === 2, b.done.pushPull)
  check('why names the added exercise', /Lat Pulldown \(Machine\)/.test(b.comparison.pushPull.why ?? ''), b.comparison.pushPull.why)
  const lines = balanceLines(b)
  check('snapshot BALANCE lines: planned + done + Why', lines[0].startsWith('BALANCE (weekly sets; planned = current program, done = last 30 days)') && /Push : pull: planned push only \(push-heavy\) · done 2\.00 : 1 \(push-heavy\)/.test(lines[1]) && lines[2].trim().startsWith('Why:'), lines)
  const progress = computeProgressModel({ ...base, currentProgram: [{ routine_id: 'r1' }] })
  const data = { today: '2026-09-23', profile: null, limitations: [], progress, routines: base.routines, sessions: [], sessionsThisWeek: 0, weeklyMuscleSets: [], sleep: [], steps: [], activeKcal: [], bodyweight: [], balance: b }
  check('snapshot carries the BALANCE block', formatPtSnapshot(data).includes('BALANCE (weekly sets'))
  const json = buildCoachJson(data, 30)
  check('JSON balance: rule, planned, done_30d, why', /1\.5×/.test(json.balance.rule) && json.balance.planned.push_pull.lean === 'push-heavy' && json.balance.done_30d.push_pull.ratio === '2.00 : 1' && json.balance.why.length === 1, json.balance)
  check('no balance → no block, no key', !formatPtSnapshot({ ...data, balance: undefined }).includes('BALANCE') && !('balance' in buildCoachJson({ ...data, balance: undefined }, 30)))
  check('PT prompt documents BALANCE (snapshot contract)', PT_SYSTEM_PROMPT.includes('- BALANCE:') && PT_SYSTEM_PROMPT.includes('never compute your own ratio'))
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
