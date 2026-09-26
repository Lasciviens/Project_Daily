#!/usr/bin/env node
/*
 * Verification — briefRules.ts (Home → the rule-based daily brief).
 * Against the REAL un-mocked module via sucrase (no unit-test runner by convention).
 *
 * Run: node scripts/verify-daily-brief.cjs
 */
require('sucrase/register')

const { buildDailyBrief, greetingFor, pickFocusTask } = require('../src/features/home/briefRules')

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

console.log('\n5 · Schedule')
{
  const b = buildDailyBrief({ hour: 10, schedule: { next: { title: 'Standup', startLabel: '10:30', startHour: 10.5, inProgress: false }, remainingCount: 3, freeHours: 5.4 } })
  const t = texts(sec(b, 'schedule'))
  check('next line', t.includes('Next: 10:30 Standup'), t)
  check('more blocks after', t.includes('2 more blocks after that.'), t)
  check('free hours rounded', t.includes('About 5h unbooked'), t)
  check('headline = next up', b.headline.text === 'Next up at 10:30: Standup.', b.headline.text)
  const now = buildDailyBrief({ hour: 10, schedule: { next: { title: 'Gym', startLabel: '09:30', startHour: 9.5, inProgress: true }, remainingCount: 1 } })
  check('in-progress headline', now.headline.text === 'In progress: Gym.')
}

console.log('\n6 · Training')
{
  const today = buildDailyBrief({ hour: 8, training: { today: { title: 'Push', startTime: '18:00:00' } } })
  check('training today with time', texts(sec(today, 'training')).includes('Training today at 18:00: Push'))
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
  check('kcal left', t.includes('1200 / 2200 kcal — 1000 left.'), t)
  check('protein to go', t.includes('Protein 90 g — 70 g to go.'), t)
  check('water behind pace', t.includes('Water 0.5 L of 3.0 L — behind pace.'), t)
  const over = buildDailyBrief({ hour: 21, nutrition: { kcal: 2500, kcalTarget: 2200, proteinG: 170, proteinTarget: 160 } })
  check('over target warns', texts(sec(over, 'nutrition')).includes('300 over target') && sec(over, 'nutrition').lines[0].tone === 'warn')
  const none = buildDailyBrief({ hour: 15, nutrition: { kcal: 0, kcalTarget: 2200, proteinG: 0, proteinTarget: 160 } })
  check('nothing logged by afternoon warns', sec(none, 'nutrition').lines[0].tone === 'warn')
  check('zero target → no section', !sec(buildDailyBrief({ hour: 9, nutrition: { kcal: 0, kcalTarget: 0, proteinG: 0, proteinTarget: 0 } }), 'nutrition'))
}

console.log('\n8 · Weather, watch, wishes, currency')
{
  const b = buildDailyBrief({
    hour: 8,
    weather: { tempC: -2.4, label: 'Light snow', precipMm: 0.6, windMs: 12, highC: 1, lowC: -4 },
    watch: [{ title: 'Severance', episodeLabel: 'S2E3' }, { title: 'Andor' }, { title: 'Dark' }],
    wishes: [{ label: '❄️ This winter', count: 3 }, { label: 'Spring', count: 0 }],
    currency: [{ pair: 'NOK/TRY', rate: 3.214, changePct: 1.2 }, { pair: 'Gold', rate: 2650.4, changePct: -0.2 }],
  })
  const w = texts(sec(b, 'day'))
  check('temperature and range', w.startsWith('-2°, light snow · -4° to 1°'), w)
  check('rain, freezing, wind advice', w.includes('take a jacket') && w.includes('Below freezing') && w.includes('Strong wind, 12 m/s'), w)
  check('greeting carries temperature', b.greeting === 'Good morning, -2°', b.greeting)
  check('watch shows two + more', texts(sec(b, 'watch')) === 'Severance — S2E3 | Andor | +1 more in progress.')
  check('wishes skip empty periods', texts(sec(b, 'wishes')) === '❄️ This winter · 3 things')
  const c = sec(b, 'money').lines
  check('currency 2 decimals + tone on ≥1%', c[0].text === 'NOK/TRY 3.21 (+1.2%)' && c[0].tone === 'success', c[0].text)
  check('large rate no decimals, small move untoned', c[1].text === 'Gold 2650 (-0.2%)' && !c[1].tone, c[1].text)
}

console.log('\n9 · Determinism and section order')
{
  const input = { hour: 9, tasks: { open: [task('A')], doneToday: 0 }, weather: { tempC: 10, label: 'Cloudy', precipMm: 0, windMs: 2 }, currency: [{ pair: 'EUR/USD', rate: 1.1, changePct: 0 }] }
  check('same input → same output', JSON.stringify(buildDailyBrief(input)) === JSON.stringify(buildDailyBrief(input)))
  check('actionable sections first', buildDailyBrief(input).sections.map(s => s.id).join(',') === 'tasks,day,money')
}

console.log(`\n${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
