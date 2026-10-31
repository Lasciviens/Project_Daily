#!/usr/bin/env node
/*
 * Verification — Personal → Diary (src/features/diary/diaryTimeline.ts,
 * owner 29.10.2026): the day's rows from each feature's own data, in time
 * order, a meal at its usual hour, nothing from another day, reading one row
 * per book, one row per thing (a slot and its task, a session and its
 * workout), Missed read as Daily reads it. Runs the real module through
 * sucrase under Europe/Oslo.
 *
 *   Run:  node scripts/verify-diary-timeline.cjs
 */
process.env.TZ = 'Europe/Oslo'
require('sucrase/register')
const { buildDiary } = require('../src/features/diary/diaryTimeline')

let passed = 0, failed = 0
function eq(got, want, name) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name} — got ${g}, want ${w}`) }
}

const DAY = '2026-10-28'
const base = { day: DAY, meals: [], workouts: [], watches: [], reading: [], bookTitles: new Map(), tasksDone: [], planned: [], lastPlayed: null }
const meal = (id, meal_slot, title, calories) => ({ id, source: 'log', meal_slot, title, calories, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0 })
const rows = buildDiary({
  ...base,
  meals: [meal('m1', 'breakfast', 'Oats', 380), meal('m2', 'breakfast', 'Coffee', 5), meal('m3', 'dinner', 'Pizza', 900.4)],
  workouts: [
    { id: 'w1', title: 'Lower B', start_time: '2026-10-28T16:30:00Z', minutes: 52 },
    { id: 'w0', title: 'Yesterday late', start_time: '2026-10-27T22:30:00Z', minutes: 30 },
  ],
  watches: [
    { at: '2026-10-28T20:15:00Z', day: DAY, kind: 'episode', title: 'Game of Thrones', season: 3, episode: 4, tmdbId: 1399 },
    { at: '2026-10-27T20:15:00Z', day: '2026-10-27', kind: 'movie', title: 'Other day', tmdbId: 2 },
  ],
  reading: [
    { book_id: 'b1', started_at: '2026-10-28T21:40:00Z', duration_seconds: 600 },
    { book_id: 'b1', started_at: '2026-10-28T21:05:00Z', duration_seconds: 900 },
    { book_id: 'b2', started_at: '2026-10-28T09:00:00Z', duration_seconds: 20 },
  ],
  bookTitles: new Map([['b1', 'Dune']]),
  tasksDone: [
    { id: 't1', title: 'Pay rent', completed_at: '2026-10-28T09:12:00Z', source_type: 'manual' },
    { id: 't2', title: 'Call the dentist', completed_at: '2026-10-28T14:02:00Z', source_type: 'manual' },
    { id: 't3', title: 'Lower B', completed_at: '2026-10-28T17:25:00Z', source_type: 'training_session', hevy_workout_id: 'w1' },
    { id: 't4', title: 'Game of Thrones S03E04', completed_at: '2026-10-28T21:10:00Z', source_type: 'tv_series' },
  ],
  planned: [
    { id: 'p1', title: 'Lower B', start_time: '17:30:00', task_id: 't3', task_status: 'done', task_workout_id: 'w1' },
    { id: 'p2', title: 'Anytime thing', start_time: null },
    { id: 'p3', title: 'Call the dentist', start_time: '13:00:00', task_id: 't2', task_status: 'done' },
    { id: 'p4', title: 'Stretch', start_time: '08:00:00', task_id: 't5', task_status: 'cancelled', task_closed_reason: 'missed' },
    { id: 'p5', title: 'Haircut', start_time: '11:00:00', task_id: 't6', task_status: 'cancelled' },
    { id: 'p6', title: 'Groceries', start_time: '19:00:00', task_id: 't7', task_status: 'open' },
  ],
  lastPlayed: { title: 'Hades', last_played_at: '2026-10-28T19:00:00Z' },
})
eq(rows.map(r => `${r.when}|${r.kind}|${r.title}|${r.detail ?? ''}`), [
  '|food|Breakfast · Oats, Coffee|385 kcal',
  '08:00|planned|Stretch|missed',
  '10:12|task|Pay rent|',
  '11:00|planned|Haircut|skipped',
  '13:00|task|Call the dentist|',
  '17:30|training|Lower B|52 min',
  '|food|Dinner · Pizza|900 kcal',
  '19:00|planned|Groceries|',
  '20:00|game|Hades|',
  '21:15|watched|Game of Thrones|S03E04',
  '22:05|reading|Dune|25 min',
], 'the day in time order: meals at their usual hour, Oslo clock times, nothing from another day, one row per thing')
eq(rows.filter(r => r.title === 'Lower B').length, 1, 'a planned session that synced shows once, as Trained (not also Planned and Done)')
eq(rows.filter(r => r.title === 'Call the dentist').map(r => r.when), ['13:00'], 'a done task with its slot that day shows once, at the slot')
eq(rows.some(r => r.title === 'Game of Thrones S03E04'), false, 'a done episode task already shown as Watched is not shown again as Done')
eq(rows.find(r => r.title === 'Stretch').detail, 'missed', "a repeat's day that passed unticked reads Missed, never Skipped (dayItems)")
eq(rows.some(r => r.title === 'Anytime thing'), false, 'a plan with no time is not a moment of the day')
eq(rows.some(r => r.kind === 'reading' && r.title === 'A book'), false, 'a book read under a minute is left out')
eq(new Set(rows.map(r => r.key)).size, rows.length, 'every row has its own key')

// Food's own meal reading (foodGlance.mealsBySlot): exact values added, rounded once; its names; every food listed.
const exact = v => ({ calories: v, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0 })
const snacks = buildDiary({ ...base, meals: [{ ...meal('s1', 'snack', 'Apple', 100), exact: exact(100.4) }, { ...meal('s2', 'snack', 'Nuts', 100), exact: exact(100.4) }, meal('s3', 'snack', 'Bar', 0), meal('s4', 'snack', 'Tea', 0), meal('s5', 'snack', 'Plum', 0)] })
eq(snacks.map(r => [r.title, r.detail]), [['Snacks · Apple, Nuts, Bar, Tea, Plum', '201 kcal']], 'meals: Food\'s names and kcal (exact values, rounded once), every food listed')
eq(buildDiary({ ...base, meals: [meal('l1', 'lunch', 'Kyllingfilet, rå · 180 g', 200), meal('l2', 'lunch', 'Rice · 1×', 100)] })[0].title, 'Lunch · Kyllingfilet, rå, Rice', 'a food is listed by its name, without the amount')
eq(buildDiary({ ...base, watches: [1, 2].map(() => ({ at: '2026-10-28T20:15:00Z', day: DAY, kind: 'movie', title: 'Dune', tmdbId: 9 })) }).reduce((s, r) => s.add(r.key), new Set()).size, 2, 'two plays at the same moment are two rows')
eq(buildDiary({ ...base, watches: [{ at: '2026-10-28T20:15:00Z', day: DAY, kind: 'movie', title: 'Dune', tmdbId: 9 }] })[0].detail, null, 'a film says nothing the icon already says')
eq(buildDiary({ ...base, lastPlayed: { title: 'Hades', last_played_at: '2026-10-27T19:00:00Z' } }).length, 0, 'a game last played on another day is not in this day')
eq(buildDiary(base), [], 'an empty day has no rows')

// Food log times (181; owner, 31.10.2026: "log times for food section so I can see on my diary"): a meal shows at
// the time it was logged — one row per time — and a log from before 181 at its meal's usual hour with no time.
{
  const at = (m, t) => ({ ...m, eaten_time: t })
  const timed = buildDiary({ ...base,
    meals: [at(meal('b1', 'breakfast', 'Oats', 300), '08:12:00'), at(meal('b2', 'breakfast', 'Coffee', 5), '08:12:00'),
      at(meal('s1', 'snack', 'Apple', 80), '10:30:00'), at(meal('s2', 'snack', 'Bar', 200), '16:05:00'), meal('d1', 'dinner', 'Pizza', 900)],
    workouts: [{ id: 'w', title: 'Upper A', start_time: '2026-10-28T09:00:00Z', minutes: 50 }] })
  eq(timed.map(r => `${r.when}|${r.kind}|${r.title}|${r.detail}`), [
    '08:12|food|Breakfast · Oats, Coffee|305 kcal',
    '10:00|training|Upper A|50 min',
    '10:30|food|Snacks · Apple|80 kcal',
    '16:05|food|Snacks · Bar|200 kcal',
    '|food|Dinner · Pizza|900 kcal',
  ], 'a meal at the time it was logged (logged together: one row), two snacks at two times two rows in time order, an older log at its meal\'s usual hour')
  eq(new Set(timed.map(r => r.key)).size, timed.length, 'every timed meal has its own key')
}

// Night owl: 00:30 Oslo on the 28th is the 27th in UTC.
eq(buildDiary({ ...base, workouts: [{ id: 'n', title: 'Night', start_time: '2026-10-27T23:30:00Z', minutes: 20 }] }).map(r => r.when), ['00:30'],
  'a workout at 00:30 Oslo time is on its local day')

console.log(`\nverify-diary-timeline: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
