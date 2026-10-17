#!/usr/bin/env node
/* Verification — supplement schedules (migration 160), the app's side:
 * the dose rules (src/features/supplements/supplementDoses.ts: a schedule's
 * days, each dose's state, due reminders, the last 28 days, the stock, the
 * words a dose line shows, when a Take is stamped), the schedule popup's form
 * (scheduleForm.ts), the reminder push and its link (supplementReminder.ts,
 * copied verbatim into push-send), phone-gateway's log_supplement hook and
 * the two popup kinds. The SQL copy of the dose rules is compared with
 * supplementDoses.ts on a database by verify-db-supplement-schedules.mjs.
 * Run: node scripts/verify-supplement-doses.cjs */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const D = require('../src/features/supplements/supplementDoses')
const F = require('../src/features/supplements/scheduleForm')
const P = require('../src/features/supplements/supplementReminder')

let passed = 0, failed = 0
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`) }
}
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')

const base = {
  id: 'k', title: 'Kreatin', library_ingredient_id: null, recipe_id: null, dose_amount: 5, dose_unit: 'g',
  calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, times: ['08:00:00', '20:00:00'], days_of_week: [0, 1, 2, 3, 4, 5, 6],
  repeat_kind: 'weekly', repeat_interval: null, repeat_unit: null, repeat_dates: null, effective_from: '2026-10-01', except_dates: [],
  ends_on: null, remind: 'until_taken', remind_every_min: 60, remind_until: '22:00:00', paused_from: null, paused_until: null,
  notes: null, stock_amount: null, stock_set_at: null, refill_days: 7, created_at: '', updated_at: '',
}
const S = p => ({ ...base, ...p })
// The home clock at a local wall time (the device's zone: these tests read it back the same way).
const at = (date, hhmm) => {
  const [y, m, d] = date.split('-').map(Number), [h, mi] = hhmm.split(':').map(Number)
  const ms = new Date(y, m - 1, d, h, mi).getTime()
  return { date, minutes: h * 60 + mi, ms }
}
const iso = (date, hhmm) => new Date(at(date, hhmm).ms).toISOString()
const NONE = { taken: [], states: [] }

console.log('labels and times')
check('"5 g", "2.5 g", "1000 IU"', [D.doseLabel(5, 'g'), D.doseLabel(2.5, 'g'), D.doseLabel(1000, 'IU')], ['5 g', '2.5 g', '1000 IU'])
check('count units are plural above one (the diary\'s rule): "2 capsules", "1 capsule", "0.5 tablet"', [D.doseLabel(2, 'capsule'), D.doseLabel(1, 'capsule'), D.doseLabel(0.5, 'tablet')], ['2 capsules', '1 capsule', '0.5 tablet'])
check('a recipe counts portions, or its own portion word (157): "3 pieces", "2 glasses", "1.5 cups"',
  [D.doseLabel(1, 'serving'), D.doseLabel(2, 'serving'), D.doseLabel(3, 'serving', 'piece'), D.doseLabel(2, 'serving', 'glass'), D.doseLabel(1.5, 'serving', 'cup'), D.doseLabel(2, 'serving', ' ')],
  ['1 portion', '2 portions', '3 pieces', '2 glasses', '1.5 cups', '2 portions'])
check('a dose line carries the recipe\'s word', D.dosesOn([S({ dose_unit: 'serving', dose_amount: 3, portion_label: 'piece', times: ['08:00'] })], '2026-10-16', { taken: [], states: [] }, at('2026-10-16', '09:00'))[0].label, '3 pieces')
check('two decimals at most', D.doseLabel(0.3333, 'g'), '0.33 g')
const sql = read('supabase/migrations/160_supplement_schedules.sql')
const sqlUnits = (sql.match(/when p_unit in \(([^)]*)\) then public\.supplement_plural/) || [, ''])[1].split(',').map(s => s.trim().replace(/'/g, ''))
check('160\'s supplement_dose_label pluralises the same count units', sqlUnits, [...D.COUNT_UNITS])
check('hhmm reads PostgREST times and typed ones', [D.hhmm('08:00:00'), D.hhmm('8:5'), D.hhmm('20:30')], ['08:00', '08:05', '20:30'])
check('minutes since midnight', [D.minutesOf('00:00'), D.minutesOf('22:00:00')], [0, 1320])

console.log('a schedule\'s days')
check('every day from its start, not before', [D.scheduleOn(S({}), '2026-09-30'), D.scheduleOn(S({}), '2026-10-01')], [false, true])
check('not after its end', [D.scheduleOn(S({ ends_on: '2026-10-10' }), '2026-10-10'), D.scheduleOn(S({ ends_on: '2026-10-10' }), '2026-10-11')], [true, false])
const paused = S({ paused_from: '2026-10-20', paused_until: '2026-10-22' })
check('none while paused (from … until, both days in)', ['2026-10-19', '2026-10-20', '2026-10-22', '2026-10-23'].map(d => D.scheduleOn(paused, d)), [true, false, false, true])
check('an open pause lasts until resumed', ['2026-10-19', '2027-05-01'].map(d => D.scheduleOn(S({ paused_from: '2026-10-20' }), d)), [true, false])
check('isPaused: a pause still on (or ahead), not one that ended', [D.isPaused(paused, '2026-10-21'), D.isPaused(paused, '2026-10-23'), D.isPaused(S({}), '2026-10-21')], [true, false, false])
check('Resume: a pause from before today ends yesterday (its days stay paused, not missed); one from today goes',
  [D.resumePause({ paused_from: '2026-10-10' }, '2026-10-16'), D.resumePause({ paused_from: '2026-10-16' }, '2026-10-16')],
  [{ from: '2026-10-10', until: '2026-10-15' }, { from: null, until: null }])
check('the repeat rule is recurrence.ts\'s (weekdays)', ['2026-10-16', '2026-10-17'].map(d => D.scheduleOn(S({ days_of_week: [1, 2, 3, 4, 5] }), d)), [true, false])

console.log('a dose\'s state')
const facts = {
  taken: [
    { id: 'e2', supplement_schedule_id: 'k', date: '2026-10-15', dose_time: '08:00:00', created_at: '2026-10-15T07:00:00Z' },
    { id: 'e1', supplement_schedule_id: 'k', date: '2026-10-15', dose_time: '08:00:00', created_at: '2026-10-15T06:15:00Z' },
  ],
  states: [{ schedule_id: 'k', dose_date: '2026-10-15', dose_time: '20:00:00', skipped_at: '2026-10-15T19:00:00Z', snoozed_until: null, last_reminded_at: null, reminders_sent: 0 }],
}
const day15 = D.dosesOn([S({})], '2026-10-15', facts, at('2026-10-16', '09:00'))
check('taken (its oldest line), skipped', day15.map(d => [d.time, d.status, d.entryId]), [['08:00', 'taken', 'e1'], ['20:00', 'skipped', null]])
check('a past day\'s open dose is missed', D.dosesOn([S({})], '2026-10-14', NONE, at('2026-10-16', '09:00')).map(d => d.status), ['missed', 'missed'])
check('today: due from its minute, upcoming before', [at('2026-10-16', '07:59'), at('2026-10-16', '08:00'), at('2026-10-16', '23:59')].map(n => D.dosesOn([S({})], '2026-10-16', NONE, n).map(d => d.status).join(',')),
  ['upcoming,upcoming', 'due,upcoming', 'due,due'])
check('a later day is upcoming', D.dosesOn([S({})], '2026-10-17', NONE, at('2026-10-16', '23:00')).map(d => d.status), ['upcoming', 'upcoming'])
check('doses sort by time, then name', D.dosesOn([S({ id: 'b', title: 'B', times: ['08:00'] }), S({ id: 'a', title: 'A', times: ['08:00', '07:00'] })], '2026-10-16', NONE, at('2026-10-16', '06:00')).map(d => `${d.time} ${d.title}`),
  ['07:00 A', '08:00 A', '08:00 B'])
check('the key names the dose', day15[0].key, 'k|2026-10-15|08:00')

console.log('times changed after a dose was taken or skipped')
const line = (time, id = time) => ({ id, supplement_schedule_id: 'k', date: '2026-10-16', dose_time: `${time}:00`, created_at: `2026-10-16T${time}:30Z` })
const rec = (lines, skips = []) => ({ lines: new Map(lines.map(l => [D.hhmm(l.dose_time), l])), skips: new Map(skips.map(t => [t, { skipped_at: 'x', dose_time: t }])) })
const pair = (times, r) => Object.fromEntries([...D.resolveDay(times, r)].map(([t, v]) => [t, v.line ? `line ${v.line.id}` : 'skip']))
check('own time first; a line at an old time goes to the first dose with nothing (08:00 → 07:30)', pair(['07:30'], rec([line('08:00')])), { '07:30': 'line 08:00' })
check('several: paired in time order; a dose with nothing left stays open', pair(['07:30', '12:00', '20:00'], rec([line('21:00'), line('08:00')])), { '07:30': 'line 08:00', '12:00': 'line 21:00' })
check('a dose\'s own line stays its own; the others share what is left', pair(['07:30', '12:00'], rec([line('07:30'), line('08:00')])), { '07:30': 'line 07:30', '12:00': 'line 08:00' })
check('a skip at an old time moves the same way; one left over goes nowhere', pair(['07:30'], rec([line('09:00')], ['08:00'])), { '07:30': 'skip' })
const moved = S({ times: ['07:30'] })
const movedFacts = { taken: [line('08:00', 'e1')], states: [{ schedule_id: 'k', dose_date: '2026-10-15', dose_time: '08:00', skipped_at: 'x', snoozed_until: null, last_reminded_at: null, reminders_sent: 0 }] }
check('moved 08:00 → 07:30 after taking it: today taken (no reminder), yesterday still skipped',
  [D.dosesOn([moved], '2026-10-16', movedFacts, at('2026-10-16', '09:00')).map(d => `${d.status} ${d.entryId}`), D.remindersDue([moved], movedFacts, at('2026-10-16', '09:00')).length,
    D.dosesOn([moved], '2026-10-15', movedFacts, at('2026-10-16', '09:00')).map(d => d.status)],
  [['taken e1'], 0, ['skipped']])

console.log('reminders')
const due = (s, f, n) => D.remindersDue([S(s)], f, n).map(d => d.time)
const st = (p) => ({ taken: [], states: [{ schedule_id: 'k', dose_date: '2026-10-16', dose_time: '08:00', skipped_at: null, snoozed_until: null, last_reminded_at: null, reminders_sent: 0, ...p }] })
check('at the dose\'s time, not before', [due({}, NONE, at('2026-10-16', '07:59')), due({}, NONE, at('2026-10-16', '08:00'))], [[], ['08:00']])
check('until taken: again 55 minutes on (the job runs every 15)', [
  due({}, st({ last_reminded_at: iso('2026-10-16', '08:00') }), at('2026-10-16', '08:54')),
  due({}, st({ last_reminded_at: iso('2026-10-16', '08:00') }), at('2026-10-16', '08:55'))], [[], ['08:00']])
check('once: never again', due({ remind: 'once' }, st({ last_reminded_at: iso('2026-10-16', '08:00') }), at('2026-10-16', '12:00')), [])
check('off: never', due({ remind: 'off' }, NONE, at('2026-10-16', '08:00')), [])
check('snoozed: nothing until it ends, then at once', [
  due({}, st({ last_reminded_at: iso('2026-10-16', '09:00'), snoozed_until: iso('2026-10-16', '09:30') }), at('2026-10-16', '09:15')),
  due({}, st({ last_reminded_at: iso('2026-10-16', '09:00'), snoozed_until: iso('2026-10-16', '09:30') }), at('2026-10-16', '09:30'))], [[], ['08:00']])
check('skipped or taken: none', [
  due({}, st({ skipped_at: iso('2026-10-16', '08:10') }), at('2026-10-16', '09:00')),
  due({}, { taken: [{ id: 'x', supplement_schedule_id: 'k', date: '2026-10-16', dose_time: '08:00', created_at: iso('2026-10-16', '08:10') }], states: [] }, at('2026-10-16', '09:00'))], [[], []])
check('the window ends at remind_until', [due({ times: ['08:00'] }, NONE, at('2026-10-16', '21:59')), due({ times: ['08:00'] }, NONE, at('2026-10-16', '22:00'))], [['08:00'], []])
check('a dose after the window still gets its quarter hour', [due({ times: ['22:30'] }, NONE, at('2026-10-16', '22:44')), due({ times: ['22:30'] }, NONE, at('2026-10-16', '22:45'))], [['22:30'], []])

console.log('the last 28 days and the stock')
const hist = D.doseHistory(S({ times: ['08:00'], effective_from: '2026-10-10' }), {
  taken: [{ id: 't', supplement_schedule_id: 'k', date: '2026-10-11', dose_time: '08:00', created_at: '' }],
  states: [{ schedule_id: 'k', dose_date: '2026-10-12', dose_time: '08:00', skipped_at: 'x', snoozed_until: null, last_reminded_at: null, reminders_sent: 0 }],
}, at('2026-10-16', '07:00'))
check('10.–15.10: 1 taken, 1 skipped, 4 missed; today\'s open dose isn\'t missed yet', hist, { taken: 1, skipped: 1, missed: 4 })
const stocked = S({ times: ['08:00'], stock_amount: 500, stock_set_at: '2026-10-01T00:00:00Z' })
check('500 g, 5 g a day, 60 taken: 200 g ≈ 40 days', D.stockLeft(stocked, 60, '2026-10-16'), { left: 200, days: 40, refill: false })
check('within refill_days: time to buy more', D.stockLeft(stocked, 95, '2026-10-16'), { left: 25, days: 5, refill: true })
check('nothing left: refill, never below 0', D.stockLeft(stocked, 120, '2026-10-16'), { left: 0, days: 0, refill: true })
check('no stock kept: null', D.stockLeft(S({}), 3, '2026-10-16'), null)
check('doses a day: two times every day = 2; weekdays ≈ 1.43', [D.dosesPerDay(S({}), '2026-10-16'), Math.round(D.dosesPerDay(S({ times: ['08:00', '20:00'], days_of_week: [1, 2, 3, 4, 5] }), '2026-10-16') * 100) / 100], [2, 1.43])

console.log('what a dose line says')
const one = (p, n) => D.doseWhen({ ...D.dosesOn([S({ times: ['08:00'] })], p.date ?? '2026-10-16', p.facts ?? NONE, n)[0] }, n)
check('"due now", "due 25 min ago", "due 2 h ago"', [one({}, at('2026-10-16', '08:00')), one({}, at('2026-10-16', '08:25')), one({}, at('2026-10-16', '10:59'))],
  ['due now', 'due 25 min ago', 'due 2 h ago'])
check('"in 40 min", "in 3 h"; a later day says nothing', [one({}, at('2026-10-16', '07:20')), one({}, at('2026-10-16', '04:30')), one({ date: '2026-10-17' }, at('2026-10-16', '09:00'))],
  ['in 40 min', 'in 3 h', ''])
check('"snoozed until 09:30"', one({ facts: st({ snoozed_until: iso('2026-10-16', '09:30') }) }, at('2026-10-16', '09:00')), 'snoozed until 09:30')
check('"taken 08:12", "missed"', [
  one({ facts: { taken: [{ id: 't', supplement_schedule_id: 'k', date: '2026-10-16', dose_time: '08:00', created_at: iso('2026-10-16', '08:12') }], states: [] } }, at('2026-10-16', '09:00')),
  one({ date: '2026-10-15' }, at('2026-10-16', '09:00'))], ['taken 08:12', 'missed'])
check('Take stamps: now today, its own time another day, `at` when given', [
  D.takenAtFor({ date: '2026-10-16', time: '08:00' }, undefined, '2026-10-16'),
  D.takenAtFor({ date: '2026-10-15', time: '08:00' }, undefined, '2026-10-16'),
  D.takenAtFor({ date: '2026-10-16', time: '08:00' }, '07:45', '2026-10-16')], [null, iso('2026-10-15', '08:00'), iso('2026-10-16', '07:45')])
check('Take all due takes only due doses', D.dueDoses(D.dosesOn([S({})], '2026-10-16', NONE, at('2026-10-16', '12:00'))).map(d => d.time), ['08:00'])

console.log('the schedule popup\'s form')
const fresh = F.newScheduleForm('2026-10-16', 'Kreatin')
check('a new one: one dose at 08:00, every day from today, reminders every hour until 22:00 (decision 10)',
  [fresh.times, fresh.repeat.recurrence, fresh.start, fresh.remind, fresh.every, fresh.until], [['08:00'], 'daily', '2026-10-16', 'until_taken', 60, '22:00'])
check('it can\'t be saved without a dose', F.scheduleProblem(fresh), null)
const row = F.scheduleRowFromForm({ ...fresh, amount: '5', unit: 'g' })
check('its row: every day (weekly, all seven), from today, no end', [row.days_of_week, row.repeat_kind, row.effective_from, row.ends_on, row.dose_amount, row.remind_until],
  [[0, 1, 2, 3, 4, 5, 6], 'weekly', '2026-10-16', null, 5, '22:00'])
check('"after N days" is the start + N − 1 (a loading phase: 7 days)', F.scheduleRowFromForm({ ...fresh, ends: 'days', endDays: '7' }).ends_on, '2026-10-22')
check('problems: no name, no dose, an end before the start, a pause end before its start', [
  F.scheduleProblem({ ...fresh, title: ' ' }), F.scheduleProblem({ ...fresh, amount: '0' }),
  F.scheduleProblem({ ...fresh, ends: 'date', endDate: '2026-10-15' }), F.scheduleProblem({ ...fresh, pausedFrom: '2026-10-20', pausedUntil: '2026-10-19' })],
  ['Name what you take.', 'Give the dose (more than 0).', 'The last day is on or after the first.', 'The pause ends on or after it starts.'])
check('Weekly with no day is refused (the planner\'s own check)', F.scheduleProblem({ ...fresh, repeat: { ...fresh.repeat, recurrence: 'weekly', weeklyDays: [] } }), 'Pick at least one day.')
const saved = S({ times: ['20:00:00', '08:00:00'], days_of_week: [1, 3, 5], ends_on: '2026-12-31', notes: 'with water', stock_amount: 500, remind_until: '21:30:00' })
const back = F.scheduleRowFromForm(F.scheduleToForm(saved))
check('a saved schedule opens and saves back unchanged', [back.times, back.days_of_week, back.repeat_kind, back.ends_on, back.notes, back.stock_amount, back.remind_until, back.effective_from],
  [['08:00', '20:00'], [1, 3, 5], 'weekly', '2026-12-31', 'with water', 500, '21:30', '2026-10-01'])
check('a recipe\'s dose is in portions; a food\'s macros come from the food', [
  F.scheduleRowFromForm({ ...fresh, source: { kind: 'recipe', id: 'r' }, unit: 'g', calories: '120' }).dose_unit,
  F.scheduleRowFromForm({ ...fresh, source: { kind: 'food', id: 'f' }, calories: '120' }).calories,
  F.scheduleRowFromForm({ ...fresh, calories: '12' }).calories], ['serving', 0, 12])
check('"+ time": 08:00 → 20:00, then 21:00', [F.nextTime(['08:00']), F.nextTime(['08:00', '20:00']), F.nextTime([])], ['20:00', '21:00', '08:00'])

console.log('the reminder push and its link')
const r1 = P.supplementReminder([{ schedule_id: 's1', title: 'Kreatin', dose_label: '5 g', dose_date: '2026-10-16', dose_time: '08:00:00' }])
check('one dose: "Kreatin 5 g not taken yet (08:00)", opening its sheet; it replaces the last reminder and alerts again', [r1.title, r1.url, r1.tag, r1.renotify],
  ['💊 Kreatin 5 g not taken yet (08:00)', '#/recipes?dose=s1&day=2026-10-16&at=08%3A00', 'supplement-reminder', true])
const r2 = P.supplementReminder([
  { schedule_id: 's1', title: 'Kreatin', dose_label: '5 g', dose_date: '2026-10-16', dose_time: '08:00:00' },
  { schedule_id: 's2', title: 'Omega-3', dose_label: '2 capsules', dose_date: '2026-10-16', dose_time: '09:00:00' }])
check('several: one notification listing them, opening the day\'s doses', [r2.title, r2.body, r2.url],
  ['💊 2 supplements not taken yet', 'Kreatin 5 g (08:00) · Omega-3 2 capsules (09:00)', '#/recipes?dose=due&day=2026-10-16'])
check('none: no push', P.supplementReminder([]), null)
const parse = u => P.parseDoseLink(new URLSearchParams(u.split('?')[1]))
check('the card reads both links back', [parse(r1.url), parse(r2.url)], [{ date: '2026-10-16', scheduleId: 's1', time: '08:00' }, { date: '2026-10-16', scheduleId: null, time: null }])
check('not a dose link: null', [P.parseDoseLink(new URLSearchParams('tab=today')), P.parseDoseLink(new URLSearchParams('dose=s1&day=16.10.2026'))], [null, null])
const block = s => (s.match(/\/\/ <supplement-reminders>\n([\s\S]*?)\/\/ <\/supplement-reminders>/) || [])[1]
const pushSend = read('supabase/functions/push-send/index.ts')
check('push-send carries supplementReminder.ts\'s block verbatim', !!block(pushSend) && block(pushSend) === block(read('src/features/supplements/supplementReminder.ts')), true)
check('push-send: the supplements trigger claims, sends one push, and only for the cron',
  [/body\.trigger === 'supplements'/.test(pushSend), /if \(!viaCron\) return json\(\{ ok: false, error: 'forbidden' \}, 403\)/.test(pushSend),
    /rpc\('supplement_reminders_claim'/.test(pushSend), /sendToAll\(userId, msg\)/.test(pushSend)], [true, true, true, true])
check('push-sw passes the payload\'s tag and renotify on (a newer reminder replaces the last and still alerts)',
  [/tag: d\.tag/.test(read('public/push-sw.js')), /renotify: d\.renotify === true/.test(read('public/push-sw.js')), r2.renotify], [true, true, true])

console.log('phone-gateway and the popups')
const gw = read('supabase/functions/phone-gateway/index.ts')
const logCase = (gw.match(/case 'log_supplement': \{[\s\S]*?\n {6}\}/) || [''])[0]
check('log_supplement takes today\'s matching dose first (supplement_dose_for_log → supplement_take), else the plain line',
  [/rpc\('supplement_dose_for_log'/.test(logCase), /rpc\('supplement_take'/.test(logCase), /p_user_id: userId/.test(logCase), /insertFoodLog\(userId/.test(logCase),
    logCase.indexOf("rpc('supplement_take'") < logCase.indexOf('insertFoodLog(')], [true, true, true, true, true])
const reg = read('src/shared/modals/registry.ts')
check('both popups are entity modal kinds', ['supplement-schedule', 'supplement-dose'].map(k => reg.includes(`'${k}': L('${k}'`)), [true, true])

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
