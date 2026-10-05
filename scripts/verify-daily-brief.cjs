#!/usr/bin/env node
/*
 * Verification — briefRules.ts (Home → the rule-based daily brief).
 * Against the REAL un-mocked module via sucrase (no unit-test runner by convention).
 *
 * Run: node scripts/verify-daily-brief.cjs
 */
require('sucrase/register')

const { buildDailyBrief, greetingFor, pickFocusTask, feelsLike, rainOutlook, dayOfYear, pickWishlistTitle, nokTryComment } = require('../src/features/home/briefRules')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const task = (title, priority = 'medium', overdue = false, dueTime = null) => ({ title, priority, overdue, dueTime })
const sec = (b, id) => b.sections.find(s => s.id === id)
const texts = (s) => (s ? s.lines.map(l => l.text).join(' | ') : '')

console.log('\n1 · Greeting by hour')
check('04 → Up late', greetingFor(4) === 'Up late')
check('08 → Good morning', greetingFor(8) === 'Good morning')
check('13 → Good afternoon', greetingFor(13) === 'Good afternoon')
check('19 → Good evening', greetingFor(19) === 'Good evening')
check('23 → Winding down', greetingFor(23) === 'Winding down')

console.log('\n2 · Focus task: overdue > priority > due time')
check('overdue beats high', pickFocusTask([task('A', 'high'), task('B', 'low', true)]).title === 'B')
check('high beats medium', pickFocusTask([task('A', 'medium'), task('B', 'high')]).title === 'B')
check('earlier due time wins a tie', pickFocusTask([task('A', 'high', false, '15:00'), task('B', 'high', false, '09:00')]).title === 'B')
check('empty list → null', pickFocusTask([]) === null)

console.log('\n3 · Empty input stays honest')
{
  const b = buildDailyBrief({ hour: 9 })
  check('no sections', b.sections.length === 0)
  check('neutral headline', b.headline.text === 'Nothing to report yet.')
  check('greeting without temperature', b.greeting === 'Good morning')
}

console.log('\n4 · Tasks')
{
  const b = buildDailyBrief({ hour: 9, tasks: { open: [task('Pay rent', 'high', true), task('Email')], doneToday: 1 } })
  const t = texts(sec(b, 'tasks'))
  check('counts open/overdue/high/done', t.includes('2 open tasks · 1 overdue · 1 high priority · 1 done'), t)
  check('focus on the overdue task', t.includes('Start with “Pay rent” (overdue)'), t)
  check('overdue drives the headline', b.headline.tone === 'danger' && b.headline.text.startsWith('1 task overdue'), b.headline.text)
  const clear = buildDailyBrief({ hour: 9, tasks: { open: [], doneToday: 3 } })
  check('all clear line', texts(sec(clear, 'tasks')) === 'All clear — 3 tasks done today.')
}

console.log('\n5 · Schedule (one line)')
{
  const b = buildDailyBrief({ hour: 10, schedule: { next: { title: 'Standup', startLabel: '10:30', startHour: 10.5, inProgress: false }, remainingCount: 3 } })
  const s = sec(b, 'schedule')
  check('next + more today on one line', texts(s) === 'Next: 10:30 Standup · 2 more today', texts(s))
  check('a single line, no free-hours filler', s.lines.length === 1)
  check('headline = next up', b.headline.text === 'Next up at 10:30: Standup.', b.headline.text)
  const now = buildDailyBrief({ hour: 10, schedule: { next: { title: 'Gym', startLabel: '09:30', startHour: 9.5, inProgress: true }, remainingCount: 1 } })
  check('in-progress headline', now.headline.text === 'In progress: Gym.')
  check('nothing else after 22:00 → no section', !sec(buildDailyBrief({ hour: 22.5, schedule: { next: null, remainingCount: 0 } }), 'schedule'))
}

console.log('\n6 · Training')
{
  const today = buildDailyBrief({ hour: 8, training: { today: { title: 'Push', startTime: '18:00:00' } } })
  check('training today with time', texts(sec(today, 'training')).includes('Training today at 18:00: Push'))
  check('headline names the session', today.headline.text === 'Training today at 18:00: Push.', today.headline.text)
  const long = buildDailyBrief({ hour: 8, training: { daysSinceLastWorkout: 5 } })
  check('warn after 4+ days', sec(long, 'training').lines[0].tone === 'warn' && texts(sec(long, 'training')).includes('5 days since'))
  const rest = buildDailyBrief({ hour: 8, training: { daysSinceLastWorkout: 1, next: { title: 'Legs', date: '2026-09-27', dayLabel: 'tomorrow' } } })
  const rt = texts(sec(rest, 'training'))
  check('rest day yesterday', rt.includes('last workout yesterday'), rt)
  check('next planned', rt.includes('Next planned: Legs, tomorrow.'), rt)
  const week = buildDailyBrief({ hour: 8, training: { weekSessions: 3, weekTarget: 3 } })
  check('weekly target reached', texts(sec(week, 'training')).includes('Weekly target reached (3/3)'))
}

console.log('\n7 · Nutrition')
{
  const b = buildDailyBrief({ hour: 15, nutrition: { kcal: 1200, kcalTarget: 2200, proteinG: 90, proteinTarget: 160, waterMl: 500, waterTarget: 3000 } })
  const t = texts(sec(b, 'nutrition'))
  check('kcal + protein on one line', t.startsWith('1200 / 2200 kcal (1000 left) · protein 70 g to go.'), t)
  check('water behind pace', t.includes('Water 0.5 L of 3.0 L — behind pace.'), t)
  const over = buildDailyBrief({ hour: 21, nutrition: { kcal: 2500, kcalTarget: 2200, proteinG: 170, proteinTarget: 160 } })
  check('over target warns', texts(sec(over, 'nutrition')) === '2500 kcal (300 over target) · protein target hit.' && sec(over, 'nutrition').lines[0].tone === 'warn', texts(sec(over, 'nutrition')))
  const none = buildDailyBrief({ hour: 15, nutrition: { kcal: 0, kcalTarget: 2200, proteinG: 0, proteinTarget: 160 } })
  check('nothing logged by afternoon warns', sec(none, 'nutrition').lines[0].tone === 'warn')
  check('zero target → no section', !sec(buildDailyBrief({ hour: 9, nutrition: { kcal: 0, kcalTarget: 0, proteinG: 0, proteinTarget: 0 } }), 'nutrition'))
}

console.log('\n8 · Weather')
{
  const hrs = (arr) => arr.map(([time, precip, temp = 5]) => ({ time, precip, temp }))
  check('feels-like: cold + wind', Math.round(feelsLike(2, 8)) === -4, String(feelsLike(2, 8)))
  check('feels-like: not above 10°', feelsLike(14, 8) === null)
  check('feels-like: not in calm air', feelsLike(2, 1) === null)

  const b = buildDailyBrief({
    hour: 8,
    weather: { tempC: -2.4, label: 'Light snow', precipMm: 0.6, windMs: 12, windDir: 'NW', highC: 1, lowC: -4, hours: hrs([['08:00', 0.6], ['09:00', 0.4], ['10:00', 0], ['11:00', 0]]) },
  })
  const w = texts(sec(b, 'day'))
  check('now + feels-like + wind on the first line', sec(b, 'day').lines[0].text === '-2°, light snow · feels like -11° · wind 12 m/s NW', sec(b, 'day').lines[0].text)
  check('rest of today range', w.includes('Rest of today -4° to 1°.'), w)
  check('raining now, dry from', w.includes('Raining now, dry from 10:00.'), w)
  check('freezing and strong wind warnings', w.includes('Below freezing') && w.includes('Strong wind, 12 m/s'), w)
  check('greeting carries temperature', b.greeting === 'Good morning, -2°', b.greeting)

  const later = rainOutlook({ tempC: 12, label: 'Cloudy', precipMm: 0, windMs: 2, hours: hrs([['14:00', 0], ['15:00', 0], ['16:00', 0], ['17:00', 0.8], ['18:00', 1.4], ['19:00', 0]]) })
  check('rain from + until + amount', later.text === 'Rain from 17:00 until 19:00 (about 2 mm) — take a jacket.', later.text)
  const open = rainOutlook({ tempC: 12, label: 'Cloudy', precipMm: 0, windMs: 2, hours: hrs([['21:00', 0], ['22:00', 0.5], ['23:00', 0.4]]) })
  check('rain to end of day has no "until"', open.text === 'Rain from 22:00 — take a jacket.', open.text)
  const dry = rainOutlook({ tempC: 12, label: 'Clear', precipMm: 0, windMs: 2, hours: hrs([['12:00', 0], ['13:00', 0.05], ['14:00', 0]]) })
  check('dry afternoon says so', dry.text === 'No rain expected for the rest of the day.', dry && dry.text)
  check('too few hours → no rain line', rainOutlook({ tempC: 12, label: 'Clear', precipMm: 0, windMs: 2, hours: hrs([['23:00', 0]]) }) === null)
  const allDay = rainOutlook({ tempC: 9, label: 'Rain', precipMm: 1, windMs: 2, hours: hrs([['15:00', 1], ['16:00', 0.5]]) })
  check('raining all day', allDay.text.startsWith('Raining now and for the rest of the day'), allDay.text)

  const mild = buildDailyBrief({ hour: 9, weather: { tempC: 18, label: 'Clear sky', precipMm: 0, windMs: 2 } })
  check('mild calm day: one line, no feels-like or wind', texts(sec(mild, 'day')) === '18°, clear sky', texts(sec(mild, 'day')))
  const eve = buildDailyBrief({ hour: 19, weather: { tempC: 8, label: 'Cloudy', precipMm: 0, windMs: 1, highC: 9, lowC: 6, tomorrow: { label: 'Rain', minC: 4, maxC: 9, precipMm: 6.2 } } })
  const et = texts(sec(eve, 'day'))
  check('evening shows tomorrow, rain not repeated', et.includes('Tomorrow 4° to 9°, rain (about 6 mm).'), et)
  const evDry = buildDailyBrief({ hour: 19, weather: { tempC: 8, label: 'Cloudy', precipMm: 0, windMs: 1, tomorrow: { label: 'Cloudy', minC: 4, maxC: 9, precipMm: 2 } } })
  check('tomorrow adds rain when the label has none', texts(sec(evDry, 'day')).includes('Tomorrow 4° to 9°, cloudy, rain (about 2 mm).'), texts(sec(evDry, 'day')))
  check('morning hides tomorrow', !texts(sec(buildDailyBrief({ hour: 9, weather: { tempC: 8, label: 'Cloudy', precipMm: 0, windMs: 1, tomorrow: { label: 'Rain', minC: 4, maxC: 9, precipMm: 6 } } }), 'day')).includes('Tomorrow'))
}

console.log('\n9 · Watch: next episode + a daily wishlist pick')
{
  const wl = [
    { title: 'Dune: Part Two', tmdbId: 693134, mediaType: 'movie', releaseDate: '2024-02-27' },
    { title: 'Severance', tmdbId: 95396, mediaType: 'tv', releaseDate: '2022-02-17' },
    { title: 'Future Film', tmdbId: 1, mediaType: 'movie', releaseDate: '2027-05-01' },
    { title: 'No Date', tmdbId: 2, mediaType: 'movie', releaseDate: null },
  ]
  check('day of year (leap year)', dayOfYear('2028-03-01') === 61 && dayOfYear('2026-03-01') === 60 && dayOfYear('2026-12-31') === 365)
  const p1 = pickWishlistTitle(wl, '2026-10-05')
  check('pick skips unreleased and undated', p1 && (p1.tmdbId === 693134 || p1.tmdbId === 95396), p1 && p1.title)
  check('same day → same pick', pickWishlistTitle(wl, '2026-10-05').tmdbId === p1.tmdbId)
  check('next day → the other title', pickWishlistTitle(wl, '2026-10-06').tmdbId !== p1.tmdbId)
  check('input order does not matter', pickWishlistTitle([...wl].reverse(), '2026-10-05').tmdbId === p1.tmdbId)
  check('nothing released → null', pickWishlistTitle([wl[2], wl[3]], '2026-10-05') === null)

  const b = buildDailyBrief({ hour: 20, today: '2026-10-05', watch: {
    next: { title: 'Andor', tmdbId: 83867, season: 2, episode: 4, episodeTitle: 'Ghost', airDate: '2025-04-29' },
    wishlist: [wl[0]],
  } })
  const s = sec(b, 'watch')
  check('section is labelled "Watch"', s.title === 'Watch')
  check('continue line with SxxEyy + title', s.lines[0].text === 'Continue Andor: S02E04 “Ghost”', s.lines[0].text)
  check('continue line opens the tv popup', s.lines[0].media.tmdbId === 83867 && s.lines[0].media.mediaType === 'tv')
  check('wishlist line labelled with year + kind', s.lines[1].text === 'From your wishlist: Dune: Part Two (2024, film)', s.lines[1].text)
  check('wishlist line opens the movie popup', s.lines[1].media.mediaType === 'movie')

  const fut = buildDailyBrief({ hour: 9, today: '2026-10-05', watch: { next: { title: 'Andor', tmdbId: 1, season: 3, episode: 1, airDate: '2026-10-06' } } })
  check('future episode: airs tomorrow', texts(sec(fut, 'watch')) === 'Next episode: Andor S03E01 airs tomorrow.', texts(sec(fut, 'watch')))
  const far = buildDailyBrief({ hour: 9, today: '2026-10-05', watch: { next: { title: 'Andor', tmdbId: 1, season: 3, episode: 1, airDate: '2027-01-14' } } })
  check('future episode: DD.MM.YYYY', texts(sec(far, 'watch')).includes('airs 14.01.2027'), texts(sec(far, 'watch')))
  const caught = buildDailyBrief({ hour: 9, today: '2026-10-05', watch: { next: { title: 'Andor', tmdbId: 1, season: null, episode: null, caughtUp: true } } })
  check('caught up says so', texts(sec(caught, 'watch')) === 'Caught up on Andor — no new episode yet.')
  check('nothing to say → no section', !sec(buildDailyBrief({ hour: 9, today: '2026-10-05', watch: { next: null, wishlist: [] } }), 'watch'))
}

console.log('\n10 · NOK → TRY with a comment; no wishes section')
{
  const up = buildDailyBrief({ hour: 9, nokTry: { rate: 3.2144, changePct: 0.42 } })
  const m = sec(up, 'money')
  check('section title names the pair', m.title === 'NOK → TRY')
  check('rate + 1,000 NOK amount', m.lines[0].text === '1 NOK = 3.21 TRY · 1,000 NOK ≈ 3,214 TRY', m.lines[0].text)
  check('small rise: plain comment, untoned', m.lines[1].text === 'NOK up 0.4% against TRY since yesterday — your krone buys a bit more lira.' && !m.lines[1].tone, m.lines[1].text)
  check('big rise toned success', nokTryComment(1.3).tone === 'success' && nokTryComment(1.3).text.includes('noticeably more'))
  check('fall says less, big fall warns', nokTryComment(-0.6).text.startsWith('NOK down 0.6%') && nokTryComment(-1.5).tone === 'warn')
  check('flat → about the same', nokTryComment(0.04).text === 'About the same as yesterday.' && nokTryComment(-0.04).text === 'About the same as yesterday.')
  check('no rate → no section', !sec(buildDailyBrief({ hour: 9, nokTry: { rate: 0, changePct: 0 } }), 'money'))
  check('wishes input is ignored', !buildDailyBrief({ hour: 9, wishes: [{ label: 'Winter', count: 3 }] }).sections.some(s => s.id === 'wishes'))
}

console.log('\n11 · Determinism and section order')
{
  const input = { hour: 9, tasks: { open: [task('A')], doneToday: 0 }, weather: { tempC: 10, label: 'Cloudy', precipMm: 0, windMs: 2 }, nokTry: { rate: 3.2, changePct: 0 }, nutrition: { kcal: 0, kcalTarget: 2000, proteinG: 0, proteinTarget: 150 } }
  check('same input → same output', JSON.stringify(buildDailyBrief(input)) === JSON.stringify(buildDailyBrief(input)))
  check('actionable sections first', buildDailyBrief(input).sections.map(s => s.id).join(',') === 'tasks,day,nutrition,money')
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
