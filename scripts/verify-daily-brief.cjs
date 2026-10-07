#!/usr/bin/env node
/*
 * Verification — briefRules.ts (Home → the rule-based daily brief).
 * Against the REAL un-mocked module via sucrase (no unit-test runner by convention).
 *
 * Run: node scripts/verify-daily-brief.cjs
 */
require('sucrase/register')

const { buildDailyBrief, greetingFor, pickFocusTask, feelsLike, rainOutlook, temperatureOutlook, dayOfYear, pickWishlistTitle, nokTryComment } = require('../src/features/home/briefRules')

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
  check('now + feels-like + wind on the first line', sec(b, 'day').lines[0].text === '-2° now, light snow · feels like -11° · wind 12 m/s NW', sec(b, 'day').lines[0].text)
  check('rest of today range', w.includes('Rest of today -4° to 1°.'), w)
  check('raining now, dry from', w.includes('Raining now, dry from 10:00.'), w)
  check('freezing and strong wind warnings', w.includes('Below freezing') && w.includes('Strong wind, 12 m/s'), w)
  check('greeting carries temperature', b.greeting === 'Good morning, -2°', b.greeting)

  const later = rainOutlook({ tempC: 12, label: 'Cloudy', precipMm: 0, windMs: 2, hours: hrs([['14:00', 0], ['15:00', 0], ['16:00', 0], ['17:00', 0.8], ['18:00', 1.4], ['19:00', 0]]) })
  check('rain from + until + amount', later.text === 'Rain from 17:00 until 19:00 (about 2 mm) — take a jacket.', later.text)
  const open = rainOutlook({ tempC: 12, label: 'Cloudy', precipMm: 0, windMs: 2, hours: hrs([['21:00', 0], ['22:00', 0.5], ['23:00', 0.4]]) })
  check('rain soon, to end of day: jacket, no "until"', open.text === 'Rain from 22:00 — take a jacket.', open.text)

  // When the rain falls decides the advice (owner, 07.10.2026: "Rain from 23:00 — take a jacket" made no sense).
  const afternoon = hrs([['14:00', 0], ['15:00', 0], ['16:00', 0], ['17:00', 0], ['18:00', 0], ['19:00', 0], ['20:00', 0], ['21:00', 0], ['22:00', 0], ['23:00', 0.9]])
  const late = rainOutlook({ tempC: 12, label: 'Cloudy', precipMm: 0, windMs: 2, hours: afternoon })
  check('late-evening rain: dry until then, no jacket', late.text === 'Rain from 23:00 — dry until then.' && late.tone === 'info', late.text)
  const eveSpan = rainOutlook({ tempC: 12, label: 'Cloudy', precipMm: 0, windMs: 2, hours: hrs([['13:00', 0], ['14:00', 0], ['15:00', 0], ['16:00', 0], ['17:00', 0], ['18:00', 0], ['19:00', 0], ['20:00', 0.8], ['21:00', 0.6], ['22:00', 0]]) })
  check('evening rain with an end: a span, dry until then', eveSpan.text === 'Rain 20:00–22:00 (about 1 mm) — dry until then.', eveSpan.text)
  const daytimeLater = rainOutlook({ tempC: 12, label: 'Cloudy', precipMm: 0, windMs: 2, hours: hrs([['08:00', 0], ['09:00', 0], ['10:00', 0], ['11:00', 0], ['12:00', 0], ['13:00', 0.6], ['14:00', 0]]) })
  check('daytime rain hours away: jacket if out then', daytimeLater.text === 'Rain from 13:00 until 14:00 — take a jacket if you\'re out then.', daytimeLater.text)
  const nowEvening = rainOutlook({ tempC: 12, label: 'Cloudy', precipMm: 0, windMs: 2, hours: hrs([['21:00', 0], ['22:00', 0], ['23:00', 0.7]]) })
  check('evening rain within 3 hours of now: still a jacket', nowEvening.text === 'Rain from 23:00 — take a jacket.', nowEvening.text)
  const pts2 = (arr) => arr.map(([time, precip]) => ({ time, precip, temp: 8 }))
  const overnight = { tempC: 8, label: 'Cloudy', precipMm: 0, windMs: 2,
    hours: pts2([['20:00', 0], ['21:00', 0], ['22:00', 0], ['23:00', 0]]),
    ahead: pts2([['20:00', 0], ['21:00', 0], ['22:00', 0], ['23:00', 0], ['00:00', 0], ['01:00', 0], ['02:00', 0], ['03:00', 0.5], ['04:00', 0.8], ['05:00', 0], ['06:00', 0], ['07:00', 0]]) }
  const ov = rainOutlook(overnight)
  check('no rain today, rain overnight: wet morning', ov && ov.text === 'Dry for the rest of today; rain overnight from 03:00, so expect wet streets in the morning.', ov && ov.text)
  const morn = rainOutlook({ ...overnight, ahead: pts2([['22:00', 0], ['23:00', 0], ['00:00', 0], ['01:00', 0], ['02:00', 0], ['03:00', 0], ['04:00', 0], ['05:00', 0], ['06:00', 0], ['07:00', 1.2], ['08:00', 0]]) })
  check('rain tomorrow morning: a jacket for the morning', morn && morn.text === 'Dry for the rest of today; rain tomorrow morning from 07:00 — a jacket for the morning.', morn && morn.text)
  const midday = rainOutlook({ ...overnight, ahead: pts2([['22:00', 0], ['23:00', 0], ['00:00', 0], ['01:00', 0], ['10:00', 2]]) })
  check('rain after 09:00 tomorrow is not an overnight line', midday.text === 'No rain expected for the rest of the day.', midday && midday.text)
  const ovDay = buildDailyBrief({ hour: 20, weather: overnight })
  check('overnight rain: the outlook does not claim "stays dry"', !texts(sec(ovDay, 'day')).includes('stays dry') && texts(sec(ovDay, 'day')).includes('rain overnight from 03:00'), texts(sec(ovDay, 'day')))
  const dry = rainOutlook({ tempC: 12, label: 'Clear', precipMm: 0, windMs: 2, hours: hrs([['12:00', 0], ['13:00', 0.05], ['14:00', 0]]) })
  check('dry afternoon says so', dry.text === 'No rain expected for the rest of the day.', dry && dry.text)
  check('too few hours → no rain line', rainOutlook({ tempC: 12, label: 'Clear', precipMm: 0, windMs: 2, hours: hrs([['23:00', 0]]) }) === null)
  const allDay = rainOutlook({ tempC: 9, label: 'Rain', precipMm: 1, windMs: 2, hours: hrs([['15:00', 1], ['16:00', 0.5]]) })
  check('raining all day', allDay.text.startsWith('Raining now and for the rest of the day'), allDay.text)

  // Temperature outlook: the next few hours as a range, then the trend and when.
  const pts = (arr) => arr.map(([time, temp, precip = 0]) => ({ time, temp, precip }))
  const cooling = pts([['15:00', 15], ['16:00', 14], ['17:00', 13], ['18:00', 13], ['19:00', 12], ['20:00', 11], ['21:00', 10], ['22:00', 9], ['23:00', 9]])
  check('outlook: near range then cooling', temperatureOutlook({ tempC: 15, label: 'Clear', precipMm: 0, windMs: 2, ahead: cooling }) === '13–14° for the next few hours, then cooling to 9° by 22:00.', temperatureOutlook({ tempC: 15, label: 'Clear', precipMm: 0, windMs: 2, ahead: cooling }))
  const warming = pts([['07:00', 4], ['08:00', 5], ['09:00', 6], ['10:00', 7], ['11:00', 9], ['12:00', 11], ['13:00', 12], ['14:00', 12]])
  check('outlook: warming by the hottest hour', temperatureOutlook({ tempC: 4, label: 'Fair', precipMm: 0, windMs: 1, ahead: warming }) === '5–7° for the next few hours, then warming to 12° by 13:00.', temperatureOutlook({ tempC: 4, label: 'Fair', precipMm: 0, windMs: 1, ahead: warming }))
  const steady = pts([['12:00', 10], ['13:00', 10], ['14:00', 11], ['15:00', 11], ['16:00', 10], ['17:00', 10]])
  check('outlook: steady says so', temperatureOutlook({ tempC: 10, label: 'Cloudy', precipMm: 0, windMs: 1, ahead: steady }) === '10–11° for the next few hours, then about the same until 17:00.', temperatureOutlook({ tempC: 10, label: 'Cloudy', precipMm: 0, windMs: 1, ahead: steady }))
  check('outlook: too few points → none', temperatureOutlook({ tempC: 10, label: 'Cloudy', precipMm: 0, windMs: 1, ahead: steady.slice(0, 3) }) === null)
  const dryDay = buildDailyBrief({ hour: 15, weather: { tempC: 15, label: 'Clear sky', precipMm: 0, windMs: 2, hours: cooling, ahead: cooling } })
  const dt = texts(sec(dryDay, 'day'))
  check('dry day: outlook carries "stays dry", no separate no-rain line', dt.includes('then cooling to 9° by 22:00, and it stays dry.') && !dt.includes('No rain expected'), dt)
  const wetDay = buildDailyBrief({ hour: 15, weather: { tempC: 15, label: 'Cloudy', precipMm: 0, windMs: 2, hours: pts([['15:00', 15], ['16:00', 14, 0.6], ['17:00', 13, 0.5], ['18:00', 13]]), ahead: cooling } })
  const wt = texts(sec(wetDay, 'day'))
  check('wet day: outlook + its own rain line', wt.includes('then cooling to 9° by 22:00.') && wt.includes('Rain from 16:00'), wt)

  const mild = buildDailyBrief({ hour: 9, weather: { tempC: 18, label: 'Clear sky', precipMm: 0, windMs: 2 } })
  check('mild calm day: one line, no feels-like or wind', texts(sec(mild, 'day')) === '18° now, clear sky', texts(sec(mild, 'day')))
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

console.log('\n10 · NOK → TRY: one rate line, a move only when it matters; no wishes section')
{
  const up = buildDailyBrief({ hour: 9, nokTry: { rate: 3.2144, changePct: 0.42 } })
  const m = sec(up, 'money')
  check('section title names the pair', m.title === 'NOK → TRY')
  check('the rate once, not twice (no 1,000 NOK restatement)', m.lines[0].text === '1 NOK = 3.21 TRY', m.lines[0].text)
  check('a 0.4% day is noise: no move line', m.lines.length === 1, texts(m))
  check('a 0.1% fall is noise too (the owner\'s example)', nokTryComment(-0.1) === null && nokTryComment(0.99) === null && nokTryComment(-0.04) === null)
  const big = buildDailyBrief({ hour: 9, nokTry: { rate: 5.1432, changePct: -1.34 } })
  check('a 1%+ move is said, toned', texts(sec(big, 'money')) === '1 NOK = 5.14 TRY | NOK down 1.3% against TRY since yesterday — your krone buys noticeably less lira.' && sec(big, 'money').lines[1].tone === 'warn', texts(sec(big, 'money')))
  check('a big rise toned success', nokTryComment(1.3).tone === 'success' && nokTryComment(1.3).text === 'NOK up 1.3% against TRY since yesterday — your krone buys noticeably more lira.')
  check('exactly 1% counts', nokTryComment(1) !== null && nokTryComment(-1) !== null)
  check('unknown change → just the rate', sec(buildDailyBrief({ hour: 9, nokTry: { rate: 5, changePct: NaN } }), 'money').lines.length === 1)
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
