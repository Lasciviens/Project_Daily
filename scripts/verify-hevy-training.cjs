#!/usr/bin/env node
/*
 * Verification — the Hevy side of Training (2026-09-27 audit fixes), against
 * the REAL un-mocked modules loaded through sucrase (no unit-test runner by
 * this repo's convention):
 *   routineForm.ts          — strict Hevy payloads for routines AND logged
 *                             workouts, start/end times, validation, sanitisers
 *   setFormat.ts            — one set formatter per exercise type
 *   trainingPlanModel.ts    — plan done/missed, next session incl. recurring
 *   bodyMeasurementFields.ts— explicit-null clears, refusal of an empty day
 *   workoutDates.ts         — local-day filing and range bounds
 *   exerciseGifResolver.ts  — an override needs no manifest; Hevy's picture
 *                             first, the GIF as fallback and animated demo (154)
 *   hevyAccountModel.ts     — the Hevy card's facts and count check (154)
 *   exerciseHistory.ts      — "History from Hevy" grouping and ranges (154)
 *   hevyEnums.ts            — Hevy's create enums and the two create forms (154)
 *   stravaMeta.ts           — OAuth callback parsing, every way Strava joins
 *
 *   Run:  node scripts/verify-hevy-training.cjs
 */
require('sucrase/register')
// The day-filing assertions are written for the owner's zone.
process.env.TZ = 'Europe/Oslo'

const rf = require('../src/features/training/routineForm')
const { formatSet, formatDurationShort, formatDistance, formatRpe, rpeSuffix, anyRpe } = require('../src/features/training/setFormat')
const { pickNextTrainingSession } = require('../src/features/training/trainingPlanModel')
const { sessionStatus } = require('../src/features/training/plan/sessionState')
// A plan with no task, read from its day (the calendar's old planStatus rule, now sessionState).
const planStatus = (date, today, activityOnDay) => sessionStatus({ date, today, activityOnDay, taskStatus: null }).state
const { buildMeasurementPayload, ALL_FIELDS } = require('../src/features/training/bodyMeasurementFields')
const { workoutLocalDay, localDayBoundsIso, workoutWindowFilter } = require('../src/features/training/workoutDates')
const { resolveExerciseGif, chooseExerciseMedia, isAnimatedImageUrl } = require('../src/features/training/exerciseGifResolver')
const { checkWorkoutsToast, hevyAccountFacts, hevyAccountWarning, hevySyncNotes, notInHevyQuestion, workoutCountGap, workoutsToOffer, missingWorkoutsMessage } = require('../src/features/training/hevyAccountModel')
const { groupExerciseHistory, historyStartDate } = require('../src/features/training/exerciseHistory')
const HE = require('../src/features/training/hevyEnums')
const { parseStravaCallback, takeStravaState } = require('../src/features/training/stravaMeta')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const keys = o => Object.keys(o).sort().join(',')

// ─── routineForm ────────────────────────────────────────────────────────────
console.log('\n== routineForm: sanitisers ==')
check('comma becomes a dot', rf.sanitizeDecimal('62,5') === '62.5')
check('only one decimal separator survives', rf.sanitizeDecimal('1.2.3') === '1.23')
check('letters are dropped', rf.sanitizeDecimal('8a0kg') === '80')
check('integers drop separators', rf.sanitizeInteger('1,5') === '15')

console.log('\n== routineForm: routine payload ==')
{
  const set = (o) => ({ ...rf.blankSet(), ...o })
  const form = {
    title: ' Push ', folder_id: '7', notes: '',
    exercises: [
      { _key: 'a', exercise_template_id: 'T1', title: 'Bench', notes: '', rest_seconds: '90', superset_id: '', use_rep_range: true,
        sets: [set({ weight_kg: '80', rep_range_start: '8', rep_range_end: '12' }), set({ weight_kg: '80', reps: '10' })] },
    ],
  }
  const create = rf.formToPayload(form)
  const ex = create.exercises[0]
  check('create: folder_id sent, trimmed title', create.folder_id === 7 && create.title === 'Push')
  check('exercise keys are exactly Hevy\'s (no index/title)', keys(ex) === 'exercise_template_id,notes,rest_seconds,sets,superset_id', keys(ex))
  check('a real rep range becomes { start, end } with reps null', ex.sets[0].rep_range && ex.sets[0].rep_range.start === 8 && ex.sets[0].reps === null)
  check('no range → rep_range key omitted entirely (null would be a 400)', !('rep_range' in ex.sets[1]) && ex.sets[1].reps === 10)
  check('routine sets carry no rpe or index', !('rpe' in ex.sets[1]) && !('index' in ex.sets[1]))
  const update = rf.formToPayload(form, 'R1')
  check('update: id sent, folder_id omitted (Hevy rejects it on PUT)', update.id === 'R1' && !('folder_id' in update))
}

console.log('\n== routineForm: workout payload ==')
{
  const set = (o) => ({ ...rf.blankSet(), ...o })
  const form = {
    title: 'Legs', description: '', startLocal: '2026-09-27T00:30', durationMin: '75',
    exercises: [
      { _key: 'a', exercise_template_id: 'SQ', title: 'Squat', notes: '', rest_seconds: '', superset_id: '', use_rep_range: false,
        sets: [set({ type: 'failure', weight_kg: '102,5'.replace(',', '.'), reps: '5', rpe: '9.5' }), set({ weight_kg: '100', reps: '8', rpe: '5' })] },
      { _key: 'b', exercise_template_id: 'PL', title: 'Plank', notes: '', rest_seconds: '', superset_id: '', use_rep_range: false,
        sets: [set({ duration_seconds: '60.4' })] },
    ],
  }
  const times = rf.workoutTimes(form.startLocal, form.durationMin)
  check('start is the LOCAL wall time (00:30 Oslo = 22:30Z the day before)', times && times.startIso === '2026-09-26T22:30:00.000Z', times && times.startIso)
  check('end = start + duration (was end = start, 0-minute workouts)', times && new Date(times.endIso) - new Date(times.startIso) === 75 * 60000)
  check('invalid start → null, no throw', rf.workoutTimes('', '60') === null)
  check('duration 0 → null', rf.workoutTimes(form.startLocal, '0') === null)
  check('duration > 24h → null', rf.workoutTimes(form.startLocal, '1441') === null)

  const p = rf.workoutFormToPayload(form, times)
  check('workout keys exactly Hevy\'s POST schema (no routine_id)', keys(p) === 'description,end_time,exercises,start_time,title', keys(p))
  check('empty description → null', p.description === null)
  const e0 = p.exercises[0]
  check('workout exercise keys: template, superset_id, notes, sets (no index/title/supersets_id)', keys(e0) === 'exercise_template_id,notes,sets,superset_id', keys(e0))
  check('workout set keys exactly Hevy\'s', keys(e0.sets[0]) === 'custom_metric,distance_meters,duration_seconds,reps,rpe,type,weight_kg', keys(e0.sets[0]))
  check('failure set type kept', e0.sets[0].type === 'failure')
  check('decimal weight kept', e0.sets[0].weight_kg === 102.5)
  check('valid RPE kept', e0.sets[0].rpe === 9.5)
  check('RPE outside Hevy\'s enum → null', e0.sets[1].rpe === null)
  check('duration seconds rounded to an integer', p.exercises[1].sets[0].duration_seconds === 60)
  check('plank has no reps/weight', p.exercises[1].sets[0].reps === null && p.exercises[1].sets[0].weight_kg === null)

  check('validation: ok form → null', rf.validateWorkoutForm(form) === null)
  check('validation: no title', /title/i.test(rf.validateWorkoutForm({ ...form, title: ' ' }) || ''))
  check('validation: cleared date', /date and time/i.test(rf.validateWorkoutForm({ ...form, startLocal: '' }) || ''))
  check('validation: no exercises', /at least one exercise/i.test(rf.validateWorkoutForm({ ...form, exercises: [] }) || ''))
  check('validation: exercise without sets named', /Squat/.test(rf.validateWorkoutForm({ ...form, exercises: [{ ...form.exercises[0], sets: [] }] }) || ''))

  const routine = { title: 'Pull', exercises: [{ exercise_template_id: 'RW', title: 'Row', notes: null, rest_seconds: null, supersets_id: null,
    sets: [{ type: 'normal', weight_kg: 60, reps: null, rep_range_start: 8, rep_range_end: 12, distance_meters: null, duration_seconds: null, custom_metric: null }] }] }
  const rows = rf.routineToWorkoutExercises(routine)
  check('routine prefill: bottom of the rep range becomes the starting reps', rows[0].sets[0].reps === '8' && rows[0].use_rep_range === false && rows[0].sets[0].rep_range_start === '')
}

// ─── setFormat ──────────────────────────────────────────────────────────────
console.log('\n== setFormat ==')
check('weight × reps', formatSet({ weight_kg: 80, reps: 8 }, 'weight_reps') === '80 kg × 8')
check('decimal weight, no trailing zeros', formatSet({ weight_kg: 62.5, reps: 5 }, 'weight_reps') === '62.5 kg × 5')
check('reps only', formatSet({ weight_kg: null, reps: 15 }, 'bodyweight_reps') === '15 reps')
check('weighted bodyweight shows +kg', formatSet({ weight_kg: 10, reps: 8 }, 'bodyweight_weighted') === '+10 kg × 8')
check('assisted shows assistance', formatSet({ weight_kg: 20, reps: 8 }, 'bodyweight_assisted') === '20 kg assist × 8')
check('duration (plank) — was "— × —"', formatSet({ weight_kg: null, reps: null, duration_seconds: 90 }, 'duration') === '1m 30s')
check('distance + time (run)', formatSet({ distance_meters: 2500, duration_seconds: 720 }, 'distance_duration') === '2.5 km · 12m')
check('weight + distance (carry)', formatSet({ weight_kg: 40, distance_meters: 30 }, 'short_distance_weight') === '40 kg · 30 m')
check('floors from custom_metric', formatSet({ custom_metric: 20, duration_seconds: 600 }, 'floors_duration') === '20 floors · 10m')
check('routine rep range', formatSet({ weight_kg: 60, reps: null, rep_range_start: 8, rep_range_end: 12 }, 'weight_reps') === '60 kg × 8–12')
check('unknown type shows what is there', formatSet({ weight_kg: 50, reps: 5, duration_seconds: 30 }) === '50 kg × 5 · 30s')
check('empty set → dash', formatSet({}, 'weight_reps') === '—')
check('duration helper hours', formatDurationShort(3900) === '1h 5m')
check('distance helper metres', formatDistance(400) === '400 m')
// RPE — Hevy logs 6–10 in half steps; one suffix for every screen and the coach.
check('RPE: whole number, no trailing ".0"', formatRpe(8) === '8' && formatRpe(8.5) === '8.5')
check('RPE suffix for one rated set', rpeSuffix(8) === ' @ RPE 8')
check('RPE suffix empty when not rated (null/undefined)', rpeSuffix(null) === '' && rpeSuffix(undefined) === '')
check('RPE suffix per set in order', rpeSuffix([8, 9, 10]) === ' @ RPE 8/9/10', rpeSuffix([8, 9, 10]))
check('RPE suffix collapses when every set is the same', rpeSuffix([9, 9, 9]) === ' @ RPE 9')
check('RPE suffix marks an unrated set inside a rated group', rpeSuffix([8, null, 9.5]) === ' @ RPE 8/–/9.5', rpeSuffix([8, null, 9.5]))
check('RPE suffix empty for a group with no rating', rpeSuffix([null, undefined]) === '')
check('formatSet itself never prints RPE (the table has its own column)', formatSet({ weight_kg: 80, reps: 8, rpe: 9 }, 'weight_reps') === '80 kg × 8')
check('anyRpe', anyRpe([{ rpe: null }, { rpe: 7 }]) && !anyRpe([{ rpe: null }, {}]))

// ─── trainingPlanModel ──────────────────────────────────────────────────────
console.log('\n== trainingPlanModel ==')
check('past plan on a trained day → done', planStatus('2026-09-20', '2026-09-27', true) === 'done')
check('past plan with nothing logged → missed', planStatus('2026-09-20', '2026-09-27', false) === 'missed')
check('today with a workout → done', planStatus('2026-09-27', '2026-09-27', true) === 'done')
check('today without → today', planStatus('2026-09-27', '2026-09-27', false) === 'today')
check('future → upcoming (a future "activity" never marks it done)', planStatus('2026-09-30', '2026-09-27', true) === 'upcoming')
{
  // 2026-09-27 is a Sunday.
  const templates = [{ id: 'R', title: 'Push (recurring)', start_time: '16:30', end_time: '17:30', days_of_week: [1, 3, 5], effective_from: '2026-09-01' }]
  const next = pickNextTrainingSession({ blocks: [], templates, today: '2026-09-27', nowHHMM: '12:00', lookaheadDays: 30 })
  check('recurring template is a next session (banner ignored these)', next && next.kind === 'recurring' && next.date === '2026-09-28' && next.startTime === '16:30')
  const withBlock = pickNextTrainingSession({ blocks: [{ id: 'B', title: 'Legs', date: '2026-09-27', start_time: '18:00:00', task_id: 't1' }], templates, today: '2026-09-27', nowHHMM: '12:00', lookaheadDays: 30 })
  check('an earlier one-off block wins', withBlock && withBlock.kind === 'block' && withBlock.id === 'B' && withBlock.taskId === 't1')
  const passed_ = pickNextTrainingSession({ blocks: [{ id: 'B', title: 'Legs', date: '2026-09-27', start_time: '09:00', task_id: null }], templates, today: '2026-09-27', nowHHMM: '12:00', lookaheadDays: 30 })
  check('a block whose time has passed today is skipped', passed_ && passed_.kind === 'recurring')
  const future = [{ ...templates[0], effective_from: '2026-10-05' }]
  const notYet = pickNextTrainingSession({ blocks: [], templates: future, today: '2026-09-27', nowHHMM: '12:00', lookaheadDays: 30 })
  check('never projected before effective_from', notYet && notYet.date === '2026-10-05', notYet && notYet.date)
  check('nothing planned → null', pickNextTrainingSession({ blocks: [], templates: [], today: '2026-09-27', nowHHMM: '12:00', lookaheadDays: 30 }) === null)
}
{
  const trained = pickNextTrainingSession({ blocks: [{ id: 'B', title: 'Legs', date: '2026-09-27', start_time: '18:00:00', task_id: 't1', task_status: 'done' }], templates: [], today: '2026-09-27', nowHHMM: '07:30', lookaheadDays: 30 })
  check('a block whose task is done (trained at 07:00) is not next', trained === null)
  const cancelled = pickNextTrainingSession({ blocks: [{ id: 'B', title: 'Legs', date: '2026-09-28', start_time: '18:00:00', task_id: 't1', task_status: 'cancelled' }, { id: 'C', title: 'Pull', date: '2026-09-29', start_time: null, task_id: null }], templates: [], today: '2026-09-27', nowHHMM: '07:30', lookaheadDays: 30 })
  check('a cancelled one is skipped for the next plan', cancelled?.id === 'C')
}

// ─── bodyMeasurementFields ──────────────────────────────────────────────────
console.log('\n== bodyMeasurementFields.buildMeasurementPayload ==')
{
  const blank = Object.fromEntries(ALL_FIELDS.map(f => [f.key, '']))
  const stored = { weight_kg: 80, fat_percent: 18, waist_cm: 84 }
  const r1 = buildMeasurementPayload('2026-09-27', { ...blank, weight_kg: '80.4', fat_percent: '18' }, stored)
  check('typed values are numbers', r1.error === null && r1.payload.weight_kg === 80.4 && r1.payload.fat_percent === 18)
  check('a stored value the user cleared is an explicit null (clears it)', r1.payload.waist_cm === null)
  check('empty and never stored → omitted (kept as is)', !('neck_cm' in r1.payload))
  const r2 = buildMeasurementPayload('2026-09-27', blank, stored)
  check('clearing a whole stored day is refused with a reason', !!r2.error && /Hevy/.test(r2.error))
  const r3 = buildMeasurementPayload('2026-09-27', blank, null)
  check('nothing entered on a new day → asks for a value', r3.error === 'Enter at least one value.')
  const r4 = buildMeasurementPayload('2026-09-27', { ...blank, weight_kg: '.' }, null)
  check('a lone "." counts as empty', r4.error === 'Enter at least one value.')
}

// ─── workoutDates ───────────────────────────────────────────────────────────
console.log('\n== workoutDates ==')
check('00:30 Oslo is filed under that LOCAL day (UTC slice said the day before)', workoutLocalDay({ start_time: '2026-09-26T22:30:00+00:00', hevy_created_at: '2026-09-27T10:00:00+00:00' }) === '2026-09-27')
check('start_time missing → hevy_created_at', workoutLocalDay({ start_time: null, hevy_created_at: '2026-09-20T10:00:00+00:00' }) === '2026-09-20')
{
  const b = localDayBoundsIso('2026-09-01', '2026-09-30')
  check('range starts at local midnight of the first day', b.fromISO === '2026-08-31T22:00:00.000Z', b.fromISO)
  check('range ends at the last ms of the last local day', b.toISO === '2026-09-30T21:59:59.999Z', b.toISO)
}
check('window filter covers the start_time and the null-start fallback', workoutWindowFilter('A', 'B') === 'and(start_time.gte.A,start_time.lte.B),and(start_time.is.null,hevy_created_at.gte.A,hevy_created_at.lte.B)')

// ─── exerciseGifResolver ────────────────────────────────────────────────────
console.log('\n== exerciseGifResolver without the manifest ==')
{
  const overrides = new Map([['tpl-1', 'https://fix.example/x.gif']])
  const r = resolveExerciseGif('tpl-1', 'Bench', overrides, null)
  check('a manual override shows even when the manifest failed to load', r && r.gifUrl === 'https://fix.example/x.gif' && r.overridden)
  check('no override and no manifest → null', resolveExerciseGif('tpl-2', 'Bench', overrides, undefined) === null)
}

// ─── Hevy's picture first (migration 154) ───────────────────────────────────
console.log('\n== chooseExerciseMedia: Hevy first ==')
{
  const hevy = 'https://d2l9nsnmtah87f.cloudfront.net/exercise-thumbnails/79D0BB3A.jpg'
  const gifUrl = 'https://cdn.jsdelivr.net/gh/x/bench.gif'
  const db = [{ name: 'Barbell Bench Press', tokens: new Set(['bench', 'press']), equipment: 'barbell', gifUrl, instructions: ['Lie down.'] }]
  const none = new Map()
  const a = chooseExerciseMedia('T1', 'Bench Press (Barbell)', hevy, none, db)
  check('thumbnail: Hevy\'s picture first, the matched GIF behind it', a.thumbs.map(t => t.source).join() === 'hevy,gifdb' && a.thumbs[0].url === hevy)
  check('popup: Hevy\'s picture is the main one, the matched GIF the "Animated demo" below', a.hevyUrl === hevy && a.demo && a.demo.source === 'gifdb' && a.demo.gifUrl === gifUrl)
  const animated = 'https://hevy.example/x/79D0BB3A.GIF?v=2'
  const b = chooseExerciseMedia('T1', 'Bench Press (Barbell)', animated, none, db)
  check('popup: no separate demo when Hevy\'s own picture already moves', b.hevyUrl === animated && b.demo === null)
  const fixed = 'https://fix.example/right.gif'
  const c = chooseExerciseMedia('T1', 'Bench Press (Barbell)', hevy, new Map([['T1', fixed]]), db)
  check('a Fix GIF override is the animated demo; Hevy\'s picture stays the thumbnail and the main picture', c.demo.source === 'override' && c.demo.gifUrl === fixed && c.thumbs[0].source === 'hevy' && c.hevyUrl === hevy && c.thumbs[1].url === fixed)
  check('a Fix GIF override shows even beside an animated Hevy picture', chooseExerciseMedia('T1', 'Bench Press (Barbell)', animated, new Map([['T1', fixed]]), db).demo.source === 'override')
  const d = chooseExerciseMedia('T2', 'Cable Y Raise', null, none, db)
  check('no Hevy picture and no GIF match → nothing to show', d.thumbs.length === 0 && d.demo === null && d.hevyUrl === null)
  const e = chooseExerciseMedia('T1', 'Bench Press (Barbell)', null, none, db)
  check('no Hevy picture → the GIF is the thumbnail and the only picture in the popup', e.thumbs.length === 1 && e.thumbs[0].source === 'gifdb' && e.demo.source === 'gifdb' && e.hevyUrl === null)
  const f = chooseExerciseMedia('T3', 'Zercher Lunge', hevy, none, [])
  check('Hevy\'s picture alone when no GIF matches (no empty demo)', f.hevyUrl === hevy && f.demo === null)
  check('a picture that isn\'t http(s) is ignored', chooseExerciseMedia('T1', 'Bench Press (Barbell)', 'javascript:x', none, db).thumbs[0].source === 'gifdb')
  check('GIF by extension only (query and hash ignored)', isAnimatedImageUrl('https://a/b.gif#x') && !isAnimatedImageUrl('https://a/gif.png') && !isAnimatedImageUrl(null))
}

// ─── The Hevy card (hevy_account) ───────────────────────────────────────────
console.log('\n== hevyAccountModel ==')
{
  check('facts: "@username · Hevy Pro · kg · km"', hevyAccountFacts({ username: 'lasci', is_pro: true, weight_unit: 'kg', distance_unit: 'kilometers' }).join(' · ') === '@lasci · Hevy Pro · kg · km')
  check('facts: unknown values are left out', hevyAccountFacts({ username: null, is_pro: null, weight_unit: 'lbs', distance_unit: 'miles' }).join(' · ') === 'lbs · mi')
  check('facts: no account row yet → nothing', hevyAccountFacts(null).length === 0)
  const g = workoutCountGap(312, 310)
  check('count gap: "Hevy has 312 workouts, the app has 310", 2 missing', g && g.text === 'Hevy has 312 workouts, the app has 310' && g.missing === 2 && g.extra === 0, g)
  const x = workoutCountGap(310, 312)
  check('count gap the other way: 2 here that Hevy no longer counts, none missing', x && x.extra === 2 && x.missing === 0)
  check('equal counts or an unknown one → no gap', workoutCountGap(5, 5) === null && workoutCountGap(null, 5) === null && workoutCountGap(5, undefined) === null)
  check('one workout is singular', workoutCountGap(1, 0).text === 'Hevy has 1 workout, the app has 0')
  check('missing-workouts toast: fetched', missingWorkoutsMessage({ added: 2, complete: true, not_in_hevy: 0, hevy_workout_count: 312 }) === 'Fetched 2 workouts from Hevy')
  check('missing-workouts toast: nothing missing, extras named', missingWorkoutsMessage({ added: 0, complete: true, not_in_hevy: 1, hevy_workout_count: 3 }) === 'Nothing was missing · 1 workout here is no longer in Hevy')
  check('missing-workouts toast: an incomplete list says so', /stopped early/.test(missingWorkoutsMessage({ added: 1, complete: false, not_in_hevy: null, hevy_workout_count: null })))
  check('any gap has a button: "Fetch missing workouts" when Hevy has more', g.action === 'Fetch missing workouts')
  check('…and "Check workouts with Hevy" when the app has more', x.action === 'Check workouts with Hevy')
  const q = notInHevyQuestion([
    { id: 'a', title: 'Upper A', start_time: '2026-10-13T16:00:00Z' }, { id: 'b', title: 'Legs', start_time: '2026-10-05T16:00:00Z' },
    { id: 'c', title: null, start_time: '2026-09-30T16:00:00Z' }, { id: 'd', title: 'Pull', start_time: null },
  ])
  check('delete question: names three (DD.MM.YYYY) and counts the rest', q.title === 'Delete the 4 workouts Hevy no longer has?' && q.message.startsWith('13.10.2026 Upper A, 05.10.2026 Legs, 30.09.2026 and 1 more:'), q)
  check('delete question: a mixed check also says what it fetched', notInHevyQuestion([{ id: 'a', title: 'Upper A', start_time: null }], 3).message.startsWith('Fetched 3 workouts from Hevy. Upper A:'))
  const offered = { added: 0, complete: true, not_in_hevy: 1, not_in_hevy_workouts: [{ id: 'a', title: 'Upper A', start_time: null }], hevy_workout_count: 1 }
  check('no toast when the delete question follows (it would cover the question)', checkWorkoutsToast(offered) === undefined)
  check('the toast when nothing is offered', checkWorkoutsToast({ ...offered, not_in_hevy: 0, not_in_hevy_workouts: [] }) === 'Nothing was missing')
  check('nothing offered from an incomplete listing', workoutsToOffer({ ...offered, complete: false }).length === 0 && /stopped early/.test(checkWorkoutsToast({ ...offered, complete: false })))
  check('…and its result reads "4 workouts deleted" (the flow adds Undo)', q.done === '4 workouts deleted')
  check('one workout: singular question and result', notInHevyQuestion([{ id: 'a', title: 'Upper A', start_time: null }]).done === '1 workout deleted'
    && notInHevyQuestion([{ id: 'a', title: 'Upper A', start_time: null }]).title === 'Delete the workout Hevy no longer has?')
  check('account warning: the stored reason with its time', hevyAccountWarning({ last_error: 'user info: Hevy answered 404', last_error_at: '2026-10-14T13:05:00Z' }) === "Couldn't read the Hevy account (14.10.2026 15:05): user info: Hevy answered 404")
  check('account warning: none after a good read', hevyAccountWarning({ last_error: null, last_error_at: null }) === null && hevyAccountWarning(null) === null)
  check('Sync toast notes: library, new exercises, account (with why)',
    hevySyncNotes({ exercise_templates: null, templates_added: null, account_checked: false, account_error: 'count: Hevy answered 500' })
      === ' · exercise library not read · new exercises not checked · Hevy account not read (count: Hevy answered 500)')
  check('Sync toast notes: nothing to add when all was read, or from a function older than 154',
    hevySyncNotes({ exercise_templates: 412, templates_added: 0, account_checked: true, account_error: null }) === '' && hevySyncNotes({}) === '')
}

// ─── History from Hevy ──────────────────────────────────────────────────────
console.log('\n== exerciseHistory ==')
{
  const set = (w, start, type, kg, reps) => ({ workout_id: w, workout_title: `W ${w}`, workout_start_time: start, workout_end_time: null,
    weight_kg: kg, reps, distance_meters: null, duration_seconds: null, rpe: null, custom_metric: null, set_type: type })
  const groups = groupExerciseHistory([
    set('a', '2026-10-01T16:00:00Z', 'warmup', 40, 10), set('a', '2026-10-01T16:00:00Z', 'normal', 80, 8),
    set('b', '2026-10-08T16:00:00Z', 'normal', 82.5, 8), set('a', '2026-10-01T16:00:00Z', 'failure', 80, 6),
  ])
  check('grouped by workout, newest first', groups.map(g => g.workoutId).join() === 'b,a')
  check('a workout keeps Hevy\'s set order, with each set type', groups[1].sets.map(s => s.set_type).join() === 'warmup,normal,failure')
  const now = new Date('2026-10-14T12:00:00')
  check('3 months starts at local midnight three months back', new Date(historyStartDate('3m', now)).getTime() === new Date('2026-07-14T00:00:00').getTime())
  check('1 year starts a year back', new Date(historyStartDate('1y', now)).getTime() === new Date('2025-10-14T00:00:00').getTime())
  check('All sends no start date', historyStartDate('all', now) === undefined)
}

// ─── Hevy's enums and the create forms ──────────────────────────────────────
console.log('\n== hevyEnums ==')
{
  check('8 exercise types, 9 equipment categories, 20 muscle groups (Hevy\'s OpenAPI, 14.10.2026)',
    HE.HEVY_EXERCISE_TYPES.length === 8 && HE.HEVY_EQUIPMENT.length === 9 && HE.HEVY_MUSCLE_GROUPS.length === 20)
  check('the create enum says bodyweight_assisted_reps (the synced templates say bodyweight_assisted)', HE.HEVY_EXERCISE_TYPES.includes('bodyweight_assisted_reps') && !HE.HEVY_EXERCISE_TYPES.includes('bodyweight_assisted'))
  check('every create choice has a friendly label', [...HE.HEVY_EXERCISE_TYPES].every(t => !t.includes('_') ? true : !HE.exerciseTypeLabel(t).includes('_'))
    && HE.equipmentLabel('resistance_band') === 'Resistance band' && HE.muscleLabel('upper_back') === 'Upper back' && HE.muscleLabel('chest') === 'Chest')
  const form = { title: '  Cable Y Raise ', exerciseType: 'weight_reps', equipment: 'machine', muscleGroup: 'shoulders', otherMuscles: ['upper_back', 'shoulders', 'upper_back', 'not_a_muscle'] }
  const ok = HE.customExercisePayload(form)
  check('payload: Hevy\'s field names, trimmed title', ok.payload && keys(ok.payload) === 'equipment_category,exercise_type,muscle_group,other_muscles,title' && ok.payload.title === 'Cable Y Raise')
  check('payload: the main muscle never repeats in other_muscles; duplicates and unknowns dropped', ok.payload.other_muscles.join() === 'upper_back')
  check('refused: no name', HE.customExercisePayload({ ...form, title: '   ' }).error === 'Give the exercise a name.')
  check('refused: a type outside the enum', !!HE.customExercisePayload({ ...form, exerciseType: 'bodyweight_assisted' }).error)
  check('refused: no equipment / no main muscle', !!HE.customExercisePayload({ ...form, equipment: '' }).error && !!HE.customExercisePayload({ ...form, muscleGroup: '' }).error)
  check('refused: a name over the cap', !!HE.customExercisePayload({ ...form, title: 'x'.repeat(HE.HEVY_TITLE_MAX + 1) }).error)
  check('folder title trimmed; empty refused', HE.routineFolderTitle('  Push Pull  ').title === 'Push Pull' && !!HE.routineFolderTitle(' ').error)
}

// ─── stravaMeta.parseStravaCallback ─────────────────────────────────────────
console.log('\n== parseStravaCallback ==')
{
  const a = parseStravaCallback('', '#/settings?tab=integrations&from=strava&state=&code=abc&scope=read,activity:read_all')
  check('appended with "&"', a && a.code === 'abc' && a.scope === 'read,activity:read_all')
  const b = parseStravaCallback('', '#/settings?tab=integrations&from=strava?state=&code=abc&scope=read')
  check('appended with a second "?" (junk lands on the sacrificial param)', b && b.code === 'abc' && b.scope === 'read')
  const c = parseStravaCallback('?state=&code=xyz&scope=read', '#/settings?tab=integrations&from=strava')
  check('put in the real query before the hash', c && c.code === 'xyz')
  const d = parseStravaCallback('', '#/settings?tab=integrations&from=strava&error=access_denied')
  check('a denied consent is reported, not exchanged', d && d.error === 'access_denied' && d.code === null)
  check('a plain Connections visit is no callback', parseStravaCallback('', '#/settings?tab=integrations') === null)
  const e = parseStravaCallback('', '#/settings?tab=subscriptions&from=strava?state=strava-ab12&code=abc&scope=read')
  check('the state comes back with the code', e && e.state === 'strava-ab12')
  check('state matches the one this tab sent', takeStravaState('strava-ab12', () => 'strava-ab12') === true)
  check('a code with no state is refused', takeStravaState(null, () => 'strava-ab12') === false)
  check('a code with another state is refused', takeStravaState('strava-zz', () => 'strava-ab12') === false)
  check('a code when this tab never pressed Connect is refused', takeStravaState('strava-ab12', () => null) === false)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
