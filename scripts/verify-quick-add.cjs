#!/usr/bin/env node
/*
 * Quick add (src/features/items/quickAdd.ts) — "Gym 17:30 1h every Mon Wed Fri"
 * read into an item's parts, the same in the Add sheet's title and Home's quick
 * add (owner, 15.10.2026). Rule-based; a bare number is never read.
 *
 *   Run:  node scripts/verify-quick-add.cjs
 */
require('sucrase/register')
const { parseQuickAdd } = require('../src/features/items/quickAdd')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
// Thursday 15.10.2026.
const TODAY = '2026-10-15'
const p = text => parseQuickAdd(text, TODAY)
function expect(text, want) {
  const got = p(text)
  const keys = ['title', 'date', 'time', 'durationMinutes', 'repeat']
  const ok = got && keys.every(k => same(got[k], want[k]))
  check(`${JSON.stringify(text)} → ${JSON.stringify(want)}`, ok, JSON.stringify(got))
}

console.log('\n== 1. The owner\'s example and the parts one by one ==')
expect('Gym 17:30 1h every Mon Wed Fri', { title: 'Gym', time: '17:30', durationMinutes: 60, repeat: { kind: 'weekly', daysOfWeek: [1, 3, 5] } })
expect('Dentist tomorrow at 9:15', { title: 'Dentist', date: '2026-10-16', time: '09:15' })
expect('Call mum today', { title: 'Call mum', date: TODAY })
expect('Run 7:05 45 min', { title: 'Run', time: '07:05', durationMinutes: 45 })
expect('Walk 5pm for 1.5h', { title: 'Walk', time: '17:00', durationMinutes: 90 })
expect('Walk 5:30 pm', { title: 'Walk', time: '17:30' })
expect('Lunch 12am', { title: 'Lunch', time: '00:00' })
expect('Read 90m', { title: 'Read', durationMinutes: 90 })
expect('Read 1h30', { title: 'Read', durationMinutes: 90 })
expect('Read 1,5h', { title: 'Read', durationMinutes: 90 })
expect('Study 2 hours', { title: 'Study', durationMinutes: 120 })
expect('Meeting 14:00-15:30', { title: 'Meeting', time: '14:00', durationMinutes: 90 })
expect('Meeting from 9:00 to 10:00', { title: 'Meeting', time: '09:00', durationMinutes: 60 })
expect('Night shift 22:00 - 06:00', { title: 'Night shift', time: '22:00', durationMinutes: 480 })

console.log('\n== 2. Dates ==')
expect('Pay rent 20.10', { title: 'Pay rent', date: '2026-10-20' })
expect('Pay rent 01.10', { title: 'Pay rent', date: '2027-10-01' })   // passed this year → next year
expect('Pay rent 15.10', { title: 'Pay rent', date: TODAY })          // today is not "passed"
expect('Trip 03.11.2027', { title: 'Trip', date: '2027-11-03' })
expect('Trip on 5.11', { title: 'Trip', date: '2026-11-05' })
expect('Haircut friday', { title: 'Haircut', date: '2026-10-16' })
expect('Haircut thursday', { title: 'Haircut', date: TODAY })          // the next one, today included
expect('Haircut next thursday', { title: 'Haircut', date: '2026-10-22' })
expect('Haircut mon', { title: 'Haircut', date: '2026-10-19' })
expect('Picnic on sat', { title: 'Picnic', date: '2026-10-17' })
expect('Picnic on sunday', { title: 'Picnic', date: '2026-10-18' })
expect('Report tmrw', { title: 'Report', date: '2026-10-16' })
check('31.02 is no date', p('Party 31.02') === null)
check('a date at the end of the year rolls to January', same(parseQuickAdd('Party 02.01', '2026-12-30').date, '2027-01-02'))

console.log('\n== 3. Repeats ==')
expect('Water plants every Sunday', { title: 'Water plants', repeat: { kind: 'weekly', daysOfWeek: [0] } })
expect('Stretch every day', { title: 'Stretch', repeat: { kind: 'weekly', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] } })
expect('Stretch daily 7:00', { title: 'Stretch', time: '07:00', repeat: { kind: 'weekly', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] } })
expect('Standup weekdays 9:00 15m', { title: 'Standup', time: '09:00', durationMinutes: 15, repeat: { kind: 'weekly', daysOfWeek: [1, 2, 3, 4, 5] } })
expect('Standup every weekday', { title: 'Standup', repeat: { kind: 'weekly', daysOfWeek: [1, 2, 3, 4, 5] } })
expect('Brunch every weekend', { title: 'Brunch', repeat: { kind: 'weekly', daysOfWeek: [0, 6] } })
expect('Gym every Mon, Wed and Fri', { title: 'Gym', repeat: { kind: 'weekly', daysOfWeek: [1, 3, 5] } })
expect('Gym every mon/wed/fri', { title: 'Gym', repeat: { kind: 'weekly', daysOfWeek: [1, 3, 5] } })
expect('Bins every 2 weeks', { title: 'Bins', repeat: { kind: 'interval', interval: 2, unit: 'week' } })
expect('Bins every 2 weeks on Tue Thu', { title: 'Bins', repeat: { kind: 'interval', interval: 2, unit: 'week', daysOfWeek: [2, 4] } })
expect('Bins every other week', { title: 'Bins', repeat: { kind: 'interval', interval: 2, unit: 'week' } })
expect('Pills every 3 days', { title: 'Pills', repeat: { kind: 'interval', interval: 3, unit: 'day' } })
expect('Pay bills every month', { title: 'Pay bills', repeat: { kind: 'monthly' } })
expect('Pay bills monthly', { title: 'Pay bills', repeat: { kind: 'monthly' } })
expect('Review every 2 months', { title: 'Review', repeat: { kind: 'interval', interval: 2, unit: 'month' } })
expect('Clean every week', { title: 'Clean', repeat: { kind: 'weekly' } })
expect('Clean every week on sat', { title: 'Clean', repeat: { kind: 'weekly', daysOfWeek: [6] } })
expect('Clean every 1 week', { title: 'Clean', repeat: { kind: 'weekly' } })
expect('Clean every 1 day', { title: 'Clean', repeat: { kind: 'weekly', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] } })
expect('Yoga every Tue from 20.10', { title: 'Yoga', date: '2026-10-20', repeat: { kind: 'weekly', daysOfWeek: [2] } })

console.log('\n== 4. Never read: a bare number, words that are only titles ==')
for (const t of ['Buy 3 eggs', 'Call 112', 'Meet at 5', 'Update to version 1.2', 'Room 17.30', 'Weekly report', 'Daily standup notes',
  'Buy sun cream', 'Sat down', 'Read every book', 'Plan next steps', 'Run 5 m', "Today's plan", 'Sell 2 monitors', 'Gym 25:00']) {
  check(`${JSON.stringify(t)} reads nothing`, p(t) === null, JSON.stringify(p(t)))
}
check('a bare number next to a read time stays in the title',
  same(p('Buy 3 eggs 17:00'), { title: 'Buy 3 eggs', read: ['17:00'], time: '17:00' }), JSON.stringify(p('Buy 3 eggs 17:00')))
check('the first time wins; a second one stays text', p('Call 9:00 or 10:00').time === '09:00' && p('Call 9:00 or 10:00').title === 'Call or 10:00')
check('a length out of range (over 24 h) is not read', p('Hike 25h') === null)

console.log('\n== 5. What the "Read as" line shows and the title it leaves ==')
{
  const r = p('Gym 17:30 1h every Mon Wed Fri')
  check('read lists the words as typed, in order', same(r.read, ['17:30', '1h', 'every Mon Wed Fri']), JSON.stringify(r.read))
  check('only parts left: an empty title', p('tomorrow 17:30').title === '' && p('tomorrow 17:30').date === '2026-10-16')
  check('punctuation around read words is tidied', p('Gym, tomorrow').title === 'Gym' && p('Gym - 17:30').title === 'Gym')
  check('empty text reads nothing', p('') === null && p('   ') === null)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
