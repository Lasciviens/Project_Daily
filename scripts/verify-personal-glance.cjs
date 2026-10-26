#!/usr/bin/env node
/*
 * Verification — the Personal page's day summary (owner, 26.10.2026: "a daily
 * summary for anything I plan or do … easy, understandable and clear"):
 *   1. the Training band's week (daily/personalGlance.trainingWeekGlance):
 *      THE session count and streak rules (progressAggregate), only sessions
 *      up to the shown day, the 4-week average, the Monday–Sunday marks;
 *   2. the day line's facts (dayLineItems) and the "≈" lengths (aboutMinutes);
 *   3. the Food summary (daily/foodGlance): eaten totals up to today (a
 *      planned row never counts), what is planned on a day to come, meals by slot;
 *   4. the Watching card's watches (media/yearReview.watchesBetween): each
 *      watch on its own local day, the year review's runtime rule, unknown
 *      dates never counted, newest first;
 *   5. the board itself (TodaySummary): the bands, six cards, no fourth column.
 *
 *   Run:  node scripts/verify-personal-glance.cjs
 */
require('sucrase/register')
process.env.TZ = 'Europe/Oslo'
const fs = require('fs')
const path = require('path')
const assert = require('assert')
const G = require('../src/features/daily/personalGlance.ts')
const F = require('../src/features/daily/foodGlance.ts')
const { watchesBetween } = require('../src/features/media/yearReview.ts')

let n = 0
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++ }

// ── 1. The Training band's week ─────────────────────────────────────────────
{
  // Wed 28.10.2026; its week runs Mon 26.10 – Sun 01.11.
  const s = (id, date) => ({ id, date })
  const sessions = [
    s('a', '2026-10-26'), s('b', '2026-10-28'), s('c', '2026-10-30'),          // this week (c is after the shown day)
    s('d', '2026-10-20'), s('e', '2026-10-22'),                                  // the week before: 2
    s('f', '2026-10-13'), s('g', '2026-10-14'), s('h', '2026-10-15'),            // 3
    s('i', '2026-10-06'),                                                        // 1
    s('j', '2026-09-29'), s('k', '2026-10-01'),                                  // 2
  ]
  const w = G.trainingWeekGlance({ day: '2026-10-28', today: '2026-10-28', sessions, plannedDays: new Set(['2026-10-27', '2026-10-29']), target: 4 })
  eq(w.sessions, 2, 'this week counts only sessions up to the shown day (Friday\'s is not there yet)')
  eq(w.target, 4, 'the weekly target is the owner\'s own')
  eq(w.average, 2, 'average of the 4 full weeks before: (2 + 3 + 1 + 2) / 4')
  eq(w.streakWeeks, 5, 'streak: this week (it has sessions) and the 4 before it')
  eq(w.week.map(d => d.letter).join(''), 'MTWTFSS', 'Monday to Sunday')
  eq(w.week.map(d => d.mark), ['trained', 'missed', 'trained', 'planned', 'none', 'none', 'none'],
    'marks: trained · planned and passed (missed) · planned still to come · nothing')
  eq(w.week.filter(d => d.shown).map(d => d.date), ['2026-10-28'], 'the shown day is marked')
  const empty = G.trainingWeekGlance({ day: '2026-10-28', today: '2026-10-28', sessions: [], plannedDays: new Set(), target: 0 })
  eq([empty.sessions, empty.target, empty.average, empty.streakWeeks], [0, null, null, 0], 'no sessions: zeros, no average, no target of 0')
  const past = G.trainingWeekGlance({ day: '2026-10-14', today: '2026-10-28', sessions, plannedDays: new Set(), target: null })
  eq(past.sessions, 2, 'a past day reads as it was then (13 and 14 October)')
}

// ── 2. The day line and "≈" lengths ─────────────────────────────────────────
eq(G.aboutMinutes(42.4), '≈ 42 min', 'under an hour: minutes')
eq(G.aboutMinutes(60), '≈ 1 h', 'a whole hour')
eq(G.aboutMinutes(310), '≈ 5 h 10 min', 'hours and minutes')
eq(G.dayLineItems({
  tasks: { done: 3, total: 5 }, trainedMinutes: 41, steps: 8944.4, kcal: 1840, watched: { episodes: 2, films: 1 }, readMinutes: 12, renewals: ['Netflix'],
}), ['3 of 5 tasks done', 'trained 41 min', '8,944 steps', '1,840 kcal', '2 episodes + 1 film', 'read 12 min', 'Netflix renews'], 'the day line, in its fixed order')
eq(G.dayLineItems({ tasks: { done: 0, total: 0 }, trainedMinutes: 0, steps: null, kcal: 0, watched: { episodes: 0, films: 0 }, readMinutes: 0 }), [],
  'an empty day: nothing (the line says "nothing logged yet")')
eq(G.dayLineItems({ watched: { episodes: 1, films: 0 } }), ['1 episode'], 'one episode: singular')
eq(G.pickBySeed([], 'x'), null, 'no picks from an empty watchlist')
eq(G.pickBySeed(['a', 'b', 'c'], '2026-10-26:0:film'), G.pickBySeed(['a', 'b', 'c'], '2026-10-26:0:film'), 'the same pick all day')

// ── 3. The Food summary ─────────────────────────────────────────────────────
{
  const meal = (o) => ({ title: 'x', meal_slot: 'lunch', calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, ...o })
  const meals = [
    meal({ id: 1, source: 'log', meal_slot: 'breakfast', calories: 500, protein_g: 30 }),
    meal({ id: 2, source: 'log', meal_slot: 'lunch', calories: 700, protein_g: 40, exact: { calories: 700.4, protein_g: 40.4, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0 } }),
    meal({ id: 3, source: 'plan', meal_slot: 'dinner', calories: 800, protein_g: 50 }),
  ]
  const today = F.dayFoodTotals(meals, '2026-10-26', '2026-10-26')
  eq([today.calories, today.protein_g, today.planned], [1200, 70, false], 'up to today: what was EATEN (the planned dinner never counts)')
  const ahead = F.dayFoodTotals(meals, '2026-10-27', '2026-10-26')
  eq([ahead.calories, ahead.planned], [800, true], 'a day to come: what is planned for it, labelled planned')
  eq(F.mealsBySlot(meals).map(g => [g.name, g.kcal, g.items.length]), [['Breakfast', 500, 1], ['Lunch', 700, 1], ['Dinner', 0, 1]],
    'meals in the day\'s order, each with its eaten kcal (a planned meal has none)')
  eq([F.litres(2000), F.litres(1580), F.litres(2500)], ['2', '1.58', '2.50'], 'litres as the water tracker writes them')
}

// ── 4. The Watching card's watches ──────────────────────────────────────────
{
  const movies = [
    { tmdbId: 1, title: 'Film A', poster: null, runtime: 120, genres: [], watchedAt: '2026-10-25T19:00:00Z', plays: 2, watches: ['2026-10-25T19:00:00Z', '2026-09-01T19:00:00Z'] },
    { tmdbId: 2, title: 'Film B', poster: null, runtime: null, genres: [], watchedAt: '2026-10-20T19:00:00Z', plays: 1 },
    { tmdbId: 3, title: 'Film C', poster: null, runtime: 90, genres: [], watchedAt: '', plays: 1 },
  ]
  const shows = new Map([['s1', { tmdbId: 10, title: 'Show', poster: null, runtime: 30, genres: [] }], ['s2', { tmdbId: 11, title: 'No runtime', poster: null, runtime: null, genres: [] }]])
  const eps = [
    { showId: 's1', season: 1, episode: 1, watchedAt: '2026-10-26T21:30:00Z', plays: 1 },
    { showId: 's1', season: 1, episode: 2, watchedAt: '2026-10-26T21:30:00Z', plays: 1 },
    { showId: 's2', season: 2, episode: 3, watchedAt: '2026-10-24T22:30:00Z', plays: 1 },          // 00:30 Oslo on 25.10
    { showId: 's1', season: 1, episode: 3, watchedAt: '1970-01-01T00:00:00.000Z', plays: 1 },
  ]
  const w = watchesBetween('2026-10-20', '2026-10-26', movies, eps, shows)
  eq(w.map(x => `${x.title}${x.episode ? ` E${x.episode}` : ''}@${x.day}`),
    ['Show E2@2026-10-26', 'Show E1@2026-10-26', 'Film A@2026-10-25', 'No runtime E3@2026-10-25', 'Film B@2026-10-20'],
    'newest first; one moment: the higher episode first; each on its local (Oslo) day; the September watch and unknown dates left out')
  eq(w.map(x => x.minutes), [30, 30, 120, 40, 100], 'the year review\'s runtime rule: a film\'s runtime else 100, a show\'s episode run time else 40')
}

// ── 5. The board ────────────────────────────────────────────────────────────
{
  // The code only (its comments explain the rule in words).
  const src = fs.readFileSync(path.join(__dirname, '../src/features/daily/components/TodaySummary.tsx'), 'utf8').replace(/^\s*\/\/.*$/gm, '')
  const cards = (src.match(/<div className="min-w-0"><[A-Z]\w+Card\b/g) || []).length
  eq(cards, 6, 'six cards in fixed slots')
  eq(/@\[36rem\]:grid-cols-2 @\[55rem\]:grid-cols-3/.test(src) && !/grid-cols-4|auto-fill/.test(src), true, 'explicit 1 / 2 / 3 columns, never a fourth or auto-fill')
  eq(/<TrainingBand\b/.test(src) && /<FoodBand\b/.test(src), true, 'the Training and Food bands above the cards')
  const page = fs.readFileSync(path.join(__dirname, '../src/features/daily/pages/DailyPage.tsx'), 'utf8')
  eq(/subtitle=\{[\s\S]{0,200}<DayLine\b/.test(page), true, 'the day line sits under the date in the page header (shown at every width)')
  const kit = fs.readFileSync(path.join(__dirname, '../src/features/daily/components/summary/cellKit.tsx'), 'utf8')
  const cardsDir = path.join(__dirname, '../src/features/daily/components/summary')
  const users = fs.readdirSync(cardsDir).filter(f => /\.tsx$/.test(f) && f !== 'cellKit.tsx' && /StatBox/.test(fs.readFileSync(path.join(cardsDir, f), 'utf8')))
  eq(/export function StatBox/.test(kit) && users.length >= 5, true, 'every new card is made of the one box (cellKit.StatBox)')
}

console.log(`verify-personal-glance: ${n} checks passed`)
