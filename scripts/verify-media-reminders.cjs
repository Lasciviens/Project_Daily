#!/usr/bin/env node
/** verify-media-reminders.cjs — release-reminder rules (src/features/media/reminders/reminderRules.ts). */
require('sucrase/register')
const R = require('../src/features/media/reminders/reminderRules.ts')
let n = 0
const ok = (a, e, label) => { const x = JSON.stringify(a), y = JSON.stringify(e); if (x !== y) { console.error(`FAIL ${label}\n  expected ${y}\n  actual   ${x}`); process.exit(1) } n++ }
const r = (o = {}) => ({ release_date: '2026-12-18', offsets: [30, 7, 1, 0], sent_offsets: [], ...o })

ok(R.daysUntil('2026-12-11', '2026-12-18'), 7, 'days until release')
ok(R.dueReminder(r(), '2026-11-18'), { offset: 30, daysLeft: 30, marks: [30] }, 'a month before')
ok(R.dueReminder(r({ sent_offsets: [30] }), '2026-11-25'), null, 'between reminders nothing is due')
ok(R.dueReminder(r(), '2026-11-25'), { offset: 30, daysLeft: 23, marks: [30] }, 'a missed month reminder still goes out, late')
ok(R.dueReminder(r({ sent_offsets: [30] }), '2026-12-11'), { offset: 7, daysLeft: 7, marks: [7] }, 'a week before')
ok(R.dueReminder(r({ sent_offsets: [30, 7, 1] }), '2026-12-18'), { offset: 0, daysLeft: 0, marks: [0] }, 'release day')
ok(R.dueReminder(r(), '2026-12-17'), { offset: 1, daysLeft: 1, marks: [30, 7, 1] }, 'missed mornings: only the nearest goes out, the older ones are marked')
ok(R.dueReminder(r({ offsets: [7] }), '2026-12-19'), null, 'after release nothing is due')
ok(R.dueReminder(r({ offsets: [7], sent_offsets: [7] }), '2026-12-12'), null, 'a sent reminder never repeats')
ok(R.reminderText('Dune 3', 7, '2026-12-18'), { title: '🎬 Dune 3 comes out in 1 week', body: 'Release date 18.12.2026' }, 'week text, DD.MM.YYYY')
ok(R.reminderText('Dune 3', 1, '2026-12-18').title, '🎬 Dune 3 comes out tomorrow', 'day text')
ok(R.reminderText('Dune 3', 0, '2026-12-18').title, '🎬 Dune 3 is out today', 'release-day text')
ok(R.reminderText('Dune 3', 30, '2026-12-18').title, '🎬 Dune 3 comes out in about a month', 'month text')
console.log(`verify-media-reminders: ${n} assertions passed`)
