#!/usr/bin/env node
/*
 * Verification — Personal → Diary (src/features/diary/diaryTimeline.ts,
 * owner 29.10.2026): the day's rows from each feature's own data, in time
 * order, a meal at its usual hour, nothing from another day, reading one row
 * per book. Runs the real module through sucrase under Europe/Oslo.
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
const rows = buildDiary({
  ...base,
  meals: [
    { id: 'm1', meal_slot: 'breakfast', title: 'Oats', calories: 380 },
    { id: 'm2', meal_slot: 'breakfast', title: 'Coffee', calories: 5 },
    { id: 'm3', meal_slot: 'dinner', title: 'Pizza', calories: 900.4 },
  ],
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
  tasksDone: [{ id: 't1', title: 'Pay rent', completed_at: '2026-10-28T09:12:00Z' }],
  planned: [
    { id: 'p1', title: 'Gym', start_time: '17:30:00', task_status: 'done' },
    { id: 'p2', title: 'Anytime thing', start_time: null },
  ],
  lastPlayed: { title: 'Hades', last_played_at: '2026-10-28T19:00:00Z' },
})
eq(rows.map(r => `${r.when} ${r.kind} ${r.title}`), [
  'Breakfast food Oats, Coffee',
  '10:12 task Pay rent',
  '17:30 training Lower B',
  '17:30 planned Gym',
  'Dinner food Pizza',
  '20:00 game Hades',
  '21:15 watched Game of Thrones',
  '22:05 reading Dune',
], 'the day in time order: meals at their usual hour, Oslo clock times, nothing from another day')
eq(rows.find(r => r.kind === 'food' && r.when === 'Dinner').detail, '900 kcal', 'a meal says its calories, rounded once')
eq(rows.find(r => r.kind === 'watched').detail, 'S03E04', 'an episode says its code')
eq(rows.find(r => r.kind === 'reading').detail, '25 min', 'reading: one row per book, its minutes added up, from its first page turn')
eq(rows.some(r => r.kind === 'reading' && r.title === 'A book'), false, 'a book read under a minute is left out')
eq(rows.find(r => r.kind === 'planned').detail, 'Planned · done', 'a planned item says what became of it')
eq(rows.some(r => r.title === 'Anytime thing'), false, 'a plan with no time is not a moment of the day')
eq(buildDiary({ ...base, lastPlayed: { title: 'Hades', last_played_at: '2026-10-27T19:00:00Z' } }).length, 0, 'a game last played on another day is not in this day')
eq(buildDiary(base), [], 'an empty day has no rows')

// Night owl: 00:30 Oslo on the 28th is the 27th in UTC.
eq(buildDiary({ ...base, workouts: [{ id: 'n', title: 'Night', start_time: '2026-10-27T23:30:00Z', minutes: 20 }] }).map(r => r.when), ['00:30'],
  'a workout at 00:30 Oslo time is on its local day')

console.log(`\nverify-diary-timeline: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
