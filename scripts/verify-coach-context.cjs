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
 *   8. coachBalance / balanceLines — push:pull and quad:hamstring, planned vs
 *      done, from the same pipeline as the Program tab and Muscles card.
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
const { formatPtSnapshot, buildCoachJson, limitationName } = require('../src/features/training/coach/coachFormat')
const { ptVerdicts, formatPtVerdicts } = require('../src/features/training/coach/coachFacts')
// The snapshot's other half of the contract is the `coach_assessment` job's instructions (they run in the `claude` function).
const PT_SYSTEM_PROMPT = require('fs').readFileSync(require('path').join(__dirname, '../supabase/claude-src/job-coach.ts'), 'utf8')
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
// The same bench at the top of its range twice in a row (S3) — "Add weight".
const historyReady = { ...history, sets: [...history.sets, ...[0, 1, 2].map(i => ({ ...set('w3', '2026-09-22', 60, 10, i) }))] }
const baseReady = { ...base, history: historyReady }

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
  check('PROGRAM line names the real routines', /PROGRAM: Push · this week 1 workouts \(target 3\)/.test(text), text.split('\n').find(l => l.startsWith('PROGRAM')))
  check('a Decision line per current-program exercise', /Decision: Bench Press: [A-Z_]+ "/.test(text), text)
  check('limitation name resolved, never undefined', text.includes('Limitation: Heavy hip hinge [= Hinge (deadlift pattern)] (limit) — lower back') && !/undefined/.test(text))
  check('latest session with previous numbers', text.includes('Bench Press: 3×10@60kg (previous: 3×8@60kg)'), text)
  check('one session at the top of the range is "Repeat" (S3: 2 in a row), its next is the floor', /Decision: Bench Press: REPEAT_AT_TOP "Repeat" · latest: 60 kg × 10\/10\/10 · next: 60 kg × 10\/10\/10/.test(text), text.split('\n').find(l => l.includes('Decision')))
  const readyText = formatPtSnapshot({ ...data, progress: computeProgressModel({ ...baseReady, currentProgram: [{ routine_id: 'r1' }] }) })
  check('a load increase with no known step uses the engine headline, not the old load', /Decision: Bench Press: READY_TO_INCREASE "Add weight" · .*next: Add weight from 60 kg/.test(readyText), readyText.split('\n').find(l => l.includes('Decision')))
  check('no hard-coded split in the snapshot', !/bro-split|Back\/Chest/.test(text))
  check('weight trend line', text.includes("WEIGHT: 79.5kg (-0.5kg since 2026-09-20)"))

  const json = buildCoachJson(data, 30)
  check('JSON carries the program', json.program.selected === true && json.program.routines[0].t === 'Push')
  check('JSON carries the engine decisions', Array.isArray(json.progress) && json.progress[0].n === 'Bench Press' && typeof json.progress[0].action === 'string')
  check('JSON limitation readable', json.limitations[0].pattern.startsWith('Heavy hip hinge'))
  check('JSON body fat only where known', json.bodyfat_pct.length === 1)

  const noProgram = { ...data, progress: computeProgressModel({ ...base, currentProgram: [] }) }
  check('no program → snapshot says so, no Decision lines', /PROGRAM: none selected/.test(formatPtSnapshot(noProgram)) && !/Decision:/.test(formatPtSnapshot(noProgram)))
  check('no program → JSON program.selected false, no progress', buildCoachJson(noProgram, 30).program.selected === false && !('progress' in buildCoachJson(noProgram, 30)))
}

console.log('\n5b · The request is cut by bytes before it is sent (the function takes 16 KB; an accent takes two bytes)')
{
  const { fitRequestBytes, fitLines } = require('../src/features/training/coach/coachFormat')
  const bytes = (i) => Buffer.byteLength(JSON.stringify({ action: 'run', job: 'coach_assessment', input: i }))
  const turkish = Array.from({ length: 400 }, (_, i) => `  satır ${i}: şğüöçı İ ışık yağmur ${'ğ'.repeat(12)}`).join('\n')
  const big = { feeling: 'tired', note: 'ş'.repeat(300), snapshot: fitLines(turkish, 8000), verdicts: 'RECOVERY: normal'.padEnd(1500, 'ü'), previous: 'ç'.repeat(2000) }
  check('the worst case of the limits in characters (accented text) is over 16 KB in bytes — the problem is real', bytes(big) > 16384, bytes(big))
  const fit = fitRequestBytes(big, 15 * 1024)
  check('fitRequestBytes brings it under 15 KB, so the 16 KB request limit holds', bytes(fit) <= 15 * 1024, bytes(fit))
  check('the verdicts, the note and the feeling are never cut', fit.verdicts === big.verdicts && fit.note === big.note && fit.feeling === big.feeling)
  check('the snapshot loses whole lines from its end (never mid-line), and keeps its start', fit.snapshot.length < big.snapshot.length && big.snapshot.startsWith(fit.snapshot) && (big.snapshot[fit.snapshot.length] === '\n' || fit.snapshot.length === big.snapshot.length), fit.snapshot.slice(-30))
  const small = { feeling: 'normal', snapshot: 'a\nb', verdicts: 'v' }
  check('a request that already fits is returned as it is', fitRequestBytes(small, 15 * 1024) === small)
  const tight = fitRequestBytes({ ...big, snapshot: 'x'.repeat(600), previous: 'ç'.repeat(2000), verdicts: 'v'.repeat(1500) }, 2500)
  check('under a very small budget the previous assessment goes first, then the snapshot shrinks', bytes(tight) <= 2500 && !('previous' in tight), bytes(tight))
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
  check('snapshot workout line carries RPE, previous session unrated', text.includes('Bench Press: 3×10@60kg @ RPE 8/9/10 (previous: 3×8@60kg)'), text)
  check('Decision "latest:" carries RPE', /latest: 60 kg × 10\/10\/10 @ RPE 8\/9\/10 ·/.test(text), text.split('\n').find(l => l.includes('Decision')))
  check('RPE never changes the Karar action', progressRated.decisions[0].currentAction === progressPlain.decisions[0].currentAction)
  const json = buildCoachJson(mk(rated, progressRated), 30)
  check('JSON progress.last carries RPE', json.progress[0].last === '60 kg × 10/10/10 @ RPE 8/9/10', json.progress[0].last)
  check('JSON workout sets carry RPE', json.workouts[0].ex[0].s === '3×10@60kg @ RPE 8/9/10', json.workouts[0].ex[0].s)
  check('JSON explains the RPE suffix once', /RPE/.test(json.about) && /never overrides/.test(json.about))
  check('PT prompt documents the RPE suffix (snapshot contract)', PT_SYSTEM_PROMPT.includes('@ RPE 8/9/10') && /never changes a target/.test(PT_SYSTEM_PROMPT))
}

console.log('\n7 · Missed: this week\'s sessions as the This week strip reads them (plan/weekInputs.weekMissed, 213)')
{
  const { missedLine } = require('../src/features/training/coach/coachFormat')
  const { weekMissed } = require('../src/features/training/plan/weekInputs')
  const SS = require('../src/features/training/plan/sessionState')
  const progress = computeProgressModel({ ...base, currentProgram: [{ routine_id: 'r1' }] })
  const at = (r, title, date, f = {}, extra = {}) => ({ key: `${r}@${date}`, title, routineId: r, date, taskId: `t-${r}`,
    status: SS.sessionStatus({ date, today: '2026-09-23', taskStatus: 'open', taskRoutineId: r, firstDate: date, ...f }), ...extra })
  const week = SS.planWeek({ order: ['r1', 'r2', 'r3'], today: '2026-09-23', monday: '2026-09-21', trainedToday: false, sessions: [
    at('r1', 'Push Day', '2026-09-21'),
    at('r2', 'Legs', '2026-09-22', { taskStatus: 'cancelled', skipReason: 'Sick — flu' }),
    at('r3', 'Pull Day', '2026-09-25'),
  ] })
  const missed = weekMissed(week, '2026-09-23')
  const data = {
    today: '2026-09-23', profile: null, limitations: [], progress, routines: base.routines, sessions: sessionsFromHistory(history), sessionsThisWeek: 1,
    weeklyMuscleSets: [], sleep: [], steps: [], activeKcal: [], bodyweight: [], missedSessions: missed,
  }
  check('the week\'s missed: the open one whose day passed and the skipped one — never one still ahead', missed.length === 2 && missed.every(m => m.title !== 'Pull Day'), JSON.stringify(missed))
  check('open line: planned day and until when, DD.MM.YYYY', missedLine(missed[0]) === 'Missed: Push Day — planned 21.09.2026, still open until 27.09.2026', missedLine(missed[0]))
  check('skipped line carries the reason', missedLine(missed[1]) === 'Missed: Legs — planned 22.09.2026 · skipped: Sick — flu', missedLine(missed[1]))
  const text = formatPtSnapshot(data)
  check('snapshot lists them under PROGRAM', /PROGRAM: [^\n]*\n  Missed: Push Day/.test(text), text.split('\n').slice(0, 6).join(' | '))
  const json = buildCoachJson(data, 30)
  check('JSON program.missed with status and reason', json.program.missed?.length === 2 && json.program.missed[1].status === 'skipped' && json.program.missed[1].reason === 'Sick — flu', JSON.stringify(json.program.missed))
  const none = buildCoachJson({ ...data, missedSessions: [] }, 30)
  check('nothing missed → no missed key, no Missed line', !('missed' in none.program) && !/Missed:/.test(formatPtSnapshot({ ...data, missedSessions: undefined })))
  check('PT prompt documents the Missed line (snapshot contract)', PT_SYSTEM_PROMPT.includes('- MISSED:') && PT_SYSTEM_PROMPT.includes('PROGRAM'))
  const coachData = require('fs').readFileSync(require('path').join(__dirname, '../src/features/training/coach/coachData.ts'), 'utf8')
  check('the coach reads the plan\'s week (buildTrainingWeek → weekMissed), never a rhythm of its own', /weekMissed\(buildTrainingWeek\(/.test(coachData) && !/missedSessionsFrom/.test(coachData))
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
  check('planned from the program: bench 3 sets × (chest 1 + triceps 0.5) → push 4.5, no pull', b.planned.pushPull.a === 4.5 && b.planned.pushPull.lean === 'a' && b.planned.pushPull.ratio === null, b.planned.pushPull)
  // done 30 d: bench 6 sets × 1.5 = 9 push; pulldown 4 sets × (Back 1 + biceps 0.5) = 6 pull → per week × 7/30
  check('done over 30 days, Back credited once', b.done.pushPull.a === 2.1 && b.done.pushPull.b === 1.4 && b.done.pushPull.ratio === 1.5 && b.done.pushPull.lean === 'balanced', b.done.pushPull)
  check('why names the added exercise', /Lat Pulldown \(Machine\)/.test(b.comparison.pushPull.why ?? ''), b.comparison.pushPull.why)
  const lines = balanceLines(b)
  check('snapshot BALANCE lines: planned + done + Why', lines[0].startsWith('BALANCE (weekly sets; planned = current program, done = last 30 days)') && /Push : pull: planned push only \(push-heavy\) · done 1\.50 : 1 \(balanced\)/.test(lines[1]) && lines[2].trim().startsWith('Why:') && lines.length === 3, lines)
  const progress = computeProgressModel({ ...base, currentProgram: [{ routine_id: 'r1' }] })
  const data = { today: '2026-09-23', profile: null, limitations: [], progress, routines: base.routines, sessions: [], sessionsThisWeek: 0, weeklyMuscleSets: [], sleep: [], steps: [], activeKcal: [], bodyweight: [], balance: b }
  check('snapshot carries the BALANCE block', formatPtSnapshot(data).includes('BALANCE (weekly sets'))
  const json = buildCoachJson(data, 30)
  check('JSON balance: rule, planned, done_30d, why', /1\.5×/.test(json.balance.rule) && json.balance.planned.push_pull.lean === 'push-heavy' && json.balance.done_30d.push_pull.ratio === '1.50 : 1' && json.balance.why.length === 1, json.balance)
  check('no balance → no block, no key', !formatPtSnapshot({ ...data, balance: undefined }).includes('BALANCE') && !('balance' in buildCoachJson({ ...data, balance: undefined }, 30)))
  check('PT prompt documents BALANCE (snapshot contract)', PT_SYSTEM_PROMPT.includes('- IMBALANCE:') && PT_SYSTEM_PROMPT.includes('never compute a ratio of your own'))
}

console.log('\n9 · The PT assessment\'s verdicts (coachFacts.ts: code decides, the model explains)')
{
  const progress = computeProgressModel({ ...base, currentProgram: [{ routine_id: 'r1' }] })
  const night = (date, total) => ({ date, total, deep: 1, rem: 1.5 })
  const mk = (over) => ({ today: '2026-09-23', profile: null, limitations: [], progress, routines: base.routines, sessions: [], sessionsThisWeek: 0, weeklyMuscleSets: [], sleep: [], steps: [], activeKcal: [], bodyweight: [], ...over })
  const gate = (sleep, feeling = 'normal') => ptVerdicts(mk({ sleep }), feeling).recovery
  check('no sleep data: the gate says so, no hours', gate([]).gate === 'no_sleep_data' && gate([]).lastNightHours === null)
  check('7.2 h: normal', gate([night('2026-09-22', 7), night('2026-09-23', 7.2)]).gate === 'normal')
  check('5.5 h: technique day, with its reason', gate([night('2026-09-22', 7), night('2026-09-23', 5.5)]).gate === 'technique_day' && /under 6 h/.test(gate([night('2026-09-23', 5.5)]).reason))
  check('under 5 h two nights running: rest day', gate([night('2026-09-22', 4.5), night('2026-09-23', 4.8)]).gate === 'rest_day')
  check('under 5 h after a good night: technique day, not rest', gate([night('2026-09-22', 7), night('2026-09-23', 4.8)]).gate === 'technique_day')
  check('"very tired" with a night below the average: technique day; "normal" with the same night: normal', gate([night('2026-09-20', 8), night('2026-09-22', 8), night('2026-09-23', 6.5)], 'very tired').gate === 'technique_day' && gate([night('2026-09-20', 8), night('2026-09-22', 8), night('2026-09-23', 6.5)]).gate === 'normal')
  { const { feelingOf, PT_FEELINGS } = require('../src/features/training/coach/coachFacts')
    check('the stored feelings are English; rows saved in Turkish before 22.11.2026 still read (mapped), anything else is not a feeling', PT_FEELINGS.join() === 'undertrained,normal,tired,very tired' && feelingOf('az çalıştım') === 'undertrained' && feelingOf('yorgunum') === 'tired' && feelingOf('çok yorgunum') === 'very tired' && feelingOf('normal') === 'normal' && feelingOf('very tired') === 'very tired' && feelingOf('constructor') === null && feelingOf(5) === null && feelingOf('') === null)
    check('a legacy "çok yorgunum" is the same gate input as "very tired"', gate([night('2026-09-20', 8), night('2026-09-22', 8), night('2026-09-23', 6.5)], feelingOf('çok yorgunum')).gate === 'technique_day') }
  check('last night from another day is named', gate([night('2026-09-21', 7)]).lastNightDate === '2026-09-21')
  const heavy = ptVerdicts(mk({ weeklyMuscleSets: [
    { slug: 'chest', sets: 24, landmarks: { mev: 8, mav: 16, mrv: 22 }, restriction: null },
    { slug: 'hamstring', sets: 2, landmarks: { mev: 6, mav: 12, mrv: 16 }, restriction: null },
    { slug: 'quadriceps', sets: 1, landmarks: { mev: 6, mav: 12, mrv: 16 }, restriction: 'limit' },
    { slug: 'biceps', sets: 9, landmarks: { mev: 6, mav: 14, mrv: 20 }, restriction: null },
  ] }), 'normal')
  check('S18/S31: a muscle over its weekly ceiling is no longer a deload cue on its own', !heavy.deloadCue && !('overreach' in heavy), heavy.deloadReasons)
  check('below the minimum: only an unrestricted muscle is listed', heavy.belowMinimum.length === 1 && heavy.belowMinimum[0].sets === 2, heavy.belowMinimum)
  check('nothing over, nothing under: no cue, none listed', !ptVerdicts(mk({}), 'normal').deloadCue && ptVerdicts(mk({}), 'normal').belowMinimum.length === 0)
  const text = formatPtVerdicts(heavy)
  check('the text has one labelled line per verdict, in a fixed order', ['RECOVERY:', 'OVERREACH:', 'PRIORITY:', 'BELOW MINIMUM VOLUME:', 'IMBALANCE:', 'MISSED:'].every((l, i) => text.split('\n')[i].startsWith(l)), text)
  check('OVERREACH says none for high volume alone; BELOW MINIMUM names the gap', /OVERREACH: none/.test(text) && /BELOW MINIMUM VOLUME: .* 2\/6/.test(text), text)

  // S31 triggers (offer, never force).
  { const { weeksSinceEasyWeek, DELOAD_AFTER_WEEKS } = require('../src/features/training/coach/coachFacts')
    // Weekly sessions, Mondays, before Monday 23.11.2026 (today Wednesday 25.11.2026).
    const weeksBack = (n, perWeek) => Array.from({ length: n }, (_, w) => Array.from({ length: perWeek }, (_, k) => shiftDays('2026-11-16', -7 * w + k))).flat()
    function shiftDays(date, days) { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
    check('S31(a): 7 full weeks of 3 sessions (target 3) → 7 weeks without an easy week', weeksSinceEasyWeek(weeksBack(7, 3), '2026-11-25', 3) === 7)
    const withEasy = weeksBack(7, 3).filter(d => !(d >= '2026-10-26' && d < '2026-11-02')).concat(['2026-10-27'])
    check('S32: a week with half or fewer of the planned sessions (1 of 3, week of 26.10) is easy and ends the run', weeksSinceEasyWeek(withEasy, '2026-11-25', 3) === 3, weeksSinceEasyWeek(withEasy, '2026-11-25', 3))
    check('S31(a): no weekly target → not judged (null)', weeksSinceEasyWeek(weeksBack(7, 3), '2026-11-25', null) === null)
    const sessions = weeksBack(DELOAD_AFTER_WEEKS, 3).map((date, i) => ({ workoutId: `w${i}`, date, title: 'Push', routineId: 'r1', exercises: [] }))
    const long = ptVerdicts(mk({ today: '2026-11-25', sessions, profile: { training_days_per_week: 3 } }), 'normal')
    check('S31(a): 6 weeks without an easy week → deload cue, with its reason', long.deloadCue && long.deloadReasons[0] === '6 weeks without an easy week', long.deloadReasons)
    check('...and the verdict line names it', /OVERREACH: deload cue \(6 weeks without an easy week\)/.test(formatPtVerdicts(long)), formatPtVerdicts(long))
    const short = ptVerdicts(mk({ today: '2026-11-25', sessions: sessions.slice(0, 9), profile: { training_days_per_week: 3 } }), 'normal')
    check('3 weeks in → no cue', !short.deloadCue && short.weeksSinceEasy === 3, short)
    const flat = (id) => ({ ...progress.decisions[0], exerciseTemplateId: id, currentAction: 'WATCH_FOR_PLATEAU' })
    const stalledProgress = { ...progress, decisions: [flat('a'), flat('b')], titleById: new Map([['a', 'Bench'], ['b', 'Row']]) }
    const stalled = ptVerdicts(mk({ progress: stalledProgress }), 'normal')
    check('S31(b): two lifts not rising at their load → deload cue', stalled.deloadCue && stalled.stalledLifts.join() === 'Bench,Row' && /2 lifts not rising/.test(stalled.deloadReasons.join()), stalled.deloadReasons)
    const oneFlat = { ...progress, decisions: [flat('a')], titleById: new Map([['a', 'Bench']]) }
    check('S31: one stalled lift alone → no cue; with "very tired" → cue', !ptVerdicts(mk({ progress: oneFlat }), 'normal').deloadCue && ptVerdicts(mk({ progress: oneFlat }), 'very tired').deloadCue)
  }
  const ready = computeProgressModel({ ...baseReady, currentProgram: [{ routine_id: 'r1' }] })
  check('PRIORITY is the first lift ready to increase, with the engine\'s own target', /PRIORITY: Bench Press — READY_TO_INCREASE "Add weight"/.test(formatPtVerdicts(ptVerdicts(mk({ progress: ready }), 'normal'))), formatPtVerdicts(ptVerdicts(mk({ progress: ready }), 'normal')))
  { const fs = require('fs'), path = require('path')
    const fmt = fs.readFileSync(path.join(__dirname, '../src/features/training/coach/coachFormat.ts'), 'utf8')
    const facts = fs.readFileSync(path.join(__dirname, '../src/features/training/coach/coachFacts.ts'), 'utf8')
    check('the Decision word and PRIORITY title come from actionLabel(action, metricKind) ("Less assist" on an assisted lift); the job names every word incl. Check sets',
      fmt.includes('actionLabel(r.currentAction, r.metricKind)') && facts.includes('actionLabel(pick.currentAction, pick.metricKind)')
      && ['Add reps', 'Repeat', 'Add weight', 'Less assist', 'Almost', 'New weight', 'Step back', 'Check', 'Check sets', 'Lighter', 'First time'].every(w => PT_SYSTEM_PROMPT.includes(w))) }
  check('one session at the top (Repeat) is not a priority to push', /PRIORITY: none/.test(formatPtVerdicts(ptVerdicts(mk({}), 'normal'))))
  check('every figure is a number, never "undefined" or "NaN"', !/undefined|NaN/.test(text))
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
