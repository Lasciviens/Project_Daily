#!/usr/bin/env node
/*
 * Verification — one item (migration 155): src/features/items/itemRules.ts
 * against the REAL un-mocked module via sucrase (no unit-test runner by
 * convention), plus static checks on the data layer around it.
 *   1. the Google default (owner, 15.10.2026) — never 'both', never 'Auto';
 *   2. Google choices that can't be saved, and the "Shows twice" warning;
 *   3. the To-Do section follows the day (today → Today, another day →
 *      Backlog, no day → Inbox; a screen with sections and an old item's own
 *      section win);
 *   4. stored rows → the sheet (itemFromRows): a task with its slot, an old
 *      row's ACTUAL Google presence, an all-day presence, a no-length time,
 *      a deadline, a repeating rule, a day of a repeat, an old standalone slot;
 *   5. what a save, a repeat's day and the conversion say (DD.MM.YYYY, HH:MM);
 *   6. the data layer: one RPC per write, the named "migration 155 not
 *      applied", hooks on useMutationWithFeedback, deletes through the one
 *      delete flow, Google after the save in the background.
 *
 *   Run:  node scripts/verify-item-rules.cjs
 */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const R = require('../src/features/items/itemRules')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const TODAY = '2026-10-15'
const item = (over) => ({ title: 'Gym', domain: 'personal', priority: 'medium', date: null, time: null, durationMinutes: null, google: 'tasks', ...over })

console.log('\n1 · The Google default')
check('a time → Google Calendar', R.defaultGoogleTarget(item({ date: TODAY, time: '14:00' })) === 'calendar')
check('a repeat → Google Calendar (with or without a time)', R.defaultGoogleTarget(item({ repeat: { kind: 'weekly', daysOfWeek: [0], startsOn: TODAY } })) === 'calendar')
check('a day, no time → Google Tasks', R.defaultGoogleTarget(item({ date: TODAY })) === 'tasks')
check('no day → Google Tasks', R.defaultGoogleTarget(item({})) === 'tasks')
check('never both by default', ['tasks', 'calendar'].includes(R.defaultGoogleTarget(item({ date: TODAY, time: '09:00', durationMinutes: 30 }))))

console.log('\n2 · Google choices that can\'t be saved, and the warning')
const p = R.googleTargetProblem
check('Tasks for a repeat → allowed since 156 ("one per day": each day\'s task is a Google Task)',
  p(item({ google: 'tasks', repeat: { kind: 'weekly', daysOfWeek: [1], startsOn: TODAY } })) === null)
check('Both for a repeat → only the warning', eq(p(item({ google: 'both', repeat: { kind: 'weekly', daysOfWeek: [1], startsOn: TODAY } })),
  { level: 'warning', message: 'Shows twice in Google Calendar' }))
check('Calendar with no day: not a chip problem, but the save says so', p(item({ google: 'calendar' })) === null
  && /Google Calendar needs a day/.test(R.itemInputProblem(item({ google: 'calendar' })) ?? ''))
check('…one day of a repeat (scope day, no repeat in the save) may be on Calendar',
  R.itemInputProblem(item({ google: 'calendar', scope: 'day', scheduleBlockId: 'p', occurrenceDate: TODAY, date: TODAY })) === null)
check('Both → the warning "Shows twice in Google Calendar"', eq(p(item({ google: 'both', date: TODAY })), { level: 'warning', message: 'Shows twice in Google Calendar' }))
check('Calendar for a repeat with no time → fine (an all-day series)', p(item({ google: 'calendar', repeat: { kind: 'weekly', daysOfWeek: [0], startsOn: TODAY } })) === null)
check('Not on Google → fine', p(item({ google: 'none' })) === null)
const q = R.itemInputProblem
check('an empty title stops the save', q(item({ title: '  ' })) === 'A title is needed')
check('a time with no day stops the save', q(item({ time: '14:00' })) === 'A time needs a day')
check('a weekly repeat with no day stops the save', q(item({ google: 'calendar', repeat: { kind: 'weekly', daysOfWeek: [], startsOn: TODAY } })) === 'Pick at least one day')
check('a length over 24 h stops the save', q(item({ date: TODAY, time: '10:00', durationMinutes: 1441 })) === 'A length is 1 minute to 24 hours')
check('one day of a repeat needs which day', q(item({ scope: 'day', scheduleBlockId: 'p' })) === 'Which day of the repeat?')
check('a repeat on Google Tasks saves (156)', q(item({ google: 'tasks', repeat: { kind: 'weekly', daysOfWeek: [1], startsOn: TODAY } })) === null)
check('…and says it is one per day', /on Google Tasks, one per day/.test(R.describeSaved(
  item({ google: 'tasks', repeat: { kind: 'weekly', daysOfWeek: [1], startsOn: TODAY } }), { taskId: null, blockId: null, scheduleBlockId: 's', created: true })))
check('…one day of it says plainly where it is', R.describeSaved(
  item({ google: 'tasks', date: TODAY, scope: 'day', occurrenceDate: TODAY, scheduleBlockId: 's', repeat: { kind: 'weekly', daysOfWeek: [4], startsOn: TODAY } }),
  { taskId: 't', blockId: 'b', scheduleBlockId: 's', occurrenceDate: TODAY }).endsWith('· on Google Tasks'))
check('a good item has no problem', q(item({ date: TODAY, time: '17:30', durationMinutes: 60, google: 'calendar' })) === null)

console.log('\n3 · The section follows the day')
const s = R.sectionForItem
check('today → Today', s({ date: TODAY }, TODAY) === 'today')
check('another day → Backlog (never the retired Tomorrow)', s({ date: '2026-10-16' }, TODAY) === 'backlog' && s({ date: '2026-10-14' }, TODAY) === 'backlog')
check('no day → Inbox', s({ date: null }, TODAY) === 'inbox')
check('a screen with sections (the Tasks tab) decides', s({ date: TODAY, section: 'backlog' }, TODAY) === 'backlog')
check('an existing item with no day keeps its section', s({ date: null }, TODAY, 'today') === 'today')
check('…a retired one reads Backlog', s({ date: null }, TODAY, 'this_week') === 'backlog')

console.log('\n4 · Stored rows → the sheet')
const task = (over) => ({
  id: 't1', title: 'Dentist', description: 'bring card', domain: 'personal', section: 'backlog', status: 'open', priority: 'high',
  due_date: '2026-10-20', due_time: '09:00:00', source_type: 'manual', source_id: null, google_sync_enabled: false, google_task_id: null,
  google_tasklist_id: null, ...over,
})
const blk = (over) => ({ id: 'b1', date: '2026-10-20', title: 'Dentist', start_time: '09:00:00', duration_minutes: 45, category: 'other', google_calendar_event_id: 'evB', ...over })
const a = R.itemFromRows(task(), blk(), null)
check('a task with its slot: day, HH:MM, length, priority, notes', a.taskId === 't1' && a.blockId === 'b1' && a.date === '2026-10-20' && a.time === '09:00'
  && a.durationMinutes === 45 && a.priority === 'high' && a.notes === 'bring card' && a.scope === 'item')
check('an old row (google_target NULL) opens with its ACTUAL presence — on Calendar through its slot', a.google === 'calendar')
check('…on Google Tasks', R.itemFromRows(task({ google_sync_enabled: true }), null, null).google === 'tasks')
check('…on both', R.itemFromRows(task({ google_sync_enabled: true }), blk(), null).google === 'both')
check('…nowhere', R.itemFromRows(task(), blk({ google_calendar_event_id: null }), null).google === 'none')
check('…on Calendar through its Apple copy too (its area on Apple, 2b-2: moved off Google)', R.itemFromRows(task(), blk({ google_calendar_event_id: null, icloud_area: 'personal' }), null).google === 'calendar'
  && R.itemFromRows(null, null, { ...{ id: 'p0', title: 'x', days_of_week: [1], start_time: null, end_time: null, effective_from: '2026-10-18', repeat_kind: 'weekly' }, google_calendar_event_id: null, icloud_area: 'training', google_target: null }).google === 'calendar')
check('a saved choice wins over the presence', R.itemFromRows(task({ google_target: 'tasks', google_sync_enabled: true }), blk(), null).google === 'tasks')
check('a slot with no length → no length shown', R.itemFromRows(task(), blk({ busy: false, duration_minutes: 15, start_time: '14:00:00' }), null).durationMinutes === null)
const pres = R.itemFromRows(task({ due_time: null }), blk({ start_time: null, busy: false }), null)
check('an all-day presence → a day, no time', pres.time === null && pres.date === '2026-10-20' && pres.durationMinutes === null)
check('a task with no slot: its time from due_time', R.itemFromRows(task({ due_time: '16:00:00' }), null, null).time === '16:00')
check('a due day other than the slot\'s is the deadline (the slot holds the day)',
  eq(R.itemFromRows(task({ due_date: '2026-10-25', due_time: '12:00:00' }), blk(), null).deadline, { date: '2026-10-25', time: '12:00' })
  && R.itemFromRows(task({ due_date: '2026-10-25', due_time: '12:00:00' }), blk(), null).date === '2026-10-20')
check('…a due time other than the slot\'s on the same day is the deadline too', eq(R.itemFromRows(task({ due_time: '17:00:00' }), blk(), null).deadline, { date: '2026-10-20', time: '17:00' }))
check('…the same day and time (or no due time) is no deadline', R.itemFromRows(task(), blk(), null).deadline === null && R.itemFromRows(task({ due_time: null }), blk(), null).deadline === null)
check('…a task with no slot is on its due day and time (never a deadline)', R.itemFromRows(task(), null, null).deadline === null && R.itemFromRows(task(), null, null).date === '2026-10-20')
check('a list and a source ride along', eq(R.itemFromRows(task({ google_tasklist_id: 'l1', source_type: 'movie', source_id: 'm1' }), null, null).source, { type: 'movie', id: 'm1' })
  && R.itemFromRows(task({ google_tasklist_id: 'l1' }), null, null).googleTaskList === 'l1')
check('a training session with no routine keeps its source type (no id)', eq(R.itemFromRows(task({ source_type: 'training_session' }), null, null).source, { type: 'training_session', id: '' }))
const plan = {
  id: 'p1', title: 'Water plants', days_of_week: [0], start_time: null, end_time: null, effective_from: '2026-10-18', except_dates: [],
  repeat_kind: 'weekly', repeat_interval: null, repeat_unit: null, repeat_dates: null, category: 'other', color: 'blue',
  google_calendar_event_id: 'evP', busy: false, google_target: null, domain: null, priority: 'low', notes: null,
}
const r = R.itemFromRows(null, null, plan)
check('a repeating rule: scope all, its repeat, no time, its start day', r.scheduleBlockId === 'p1' && r.scope === 'all' && r.time === null
  && eq(r.repeat, { kind: 'weekly', daysOfWeek: [0], startsOn: '2026-10-18' }) && r.date === '2026-10-18' && r.priority === 'low')
check('…an old rule on Google → Calendar; off Google → none', r.google === 'calendar' && R.itemFromRows(null, null, { ...plan, google_calendar_event_id: null }).google === 'none')
const timedPlan = R.itemFromRows(null, null, { ...plan, start_time: '17:30:00', end_time: '18:30:00', busy: true })
check('…a timed rule: its time and length', timedPlan.time === '17:30' && timedPlan.durationMinutes === 60)
check('…crossing midnight: 23:00–01:00 is 120 minutes', R.itemFromRows(null, null, { ...plan, start_time: '23:00:00', end_time: '01:00:00', busy: true }).durationMinutes === 120)
check('…every 2 weeks reads back as interval', eq(R.itemFromRows(null, null, { ...plan, repeat_kind: 'interval', repeat_interval: 2, repeat_unit: 'week', days_of_week: [2, 4] }).repeat,
  { kind: 'interval', daysOfWeek: [2, 4], interval: 2, unit: 'week', startsOn: '2026-10-18' }))
const day = R.itemFromRows(task({ id: 't9' }), blk({ id: 'b9', schedule_block_id: 'p1', occurrence_date: '2026-10-25', date: '2026-10-26' }), null)
check('a day of a repeat that is its own item opens as that item (scope item: its save never touches the rule)',
  day.scope === 'item' && day.scheduleBlockId === null && day.date === '2026-10-26' && day.taskId === 't9' && day.blockId === 'b9')
check('a rule with no length (busy false) reads no length, not its nominal 15 minutes',
  R.itemFromRows(null, null, { ...plan, start_time: '14:00:00', end_time: '14:15:00', busy: false }).durationMinutes === null)
check('a rule\'s own domain, priority and notes (155)', R.itemFromRows(null, null, { ...plan, domain: 'work', notes: 'n' }).domain === 'work'
  && R.itemFromRows(null, null, { ...plan, domain: 'work', notes: 'n' }).notes === 'n')
const old = R.itemFromRows(null, blk({ id: 'b5', category: 'work', title: 'Old meeting' }), null)
check('an old standalone slot: its own title, domain from its category, its event → Calendar', old.taskId === null && old.blockId === 'b5'
  && old.domain === 'work' && old.google === 'calendar' && old.title === 'Old meeting')

console.log('\n5 · What it says')
const saved = (over) => ({ taskId: 't', blockId: 'b', scheduleBlockId: null, created: true, ...over })
check('"Added · 15.10.2026 17:30–18:30 · on Google Calendar"',
  R.describeSaved(item({ date: TODAY, time: '17:30', durationMinutes: 60, google: 'calendar' }), saved({})) === 'Added · 15.10.2026 17:30–18:30 · on Google Calendar',
  R.describeSaved(item({ date: TODAY, time: '17:30', durationMinutes: 60, google: 'calendar' }), saved({})))
check('an edit says Saved; no length → just the time', R.describeSaved(item({ taskId: 't', date: TODAY, time: '14:00', google: 'calendar' }), saved({ created: false })) === 'Saved · 15.10.2026 14:00 · on Google Calendar')
check('no day → "No date"; Google Tasks named', R.describeSaved(item({}), saved({})) === 'Added · No date · on Google Tasks')
check('Not on Google says nothing about Google', R.describeSaved(item({ date: TODAY, google: 'none' }), saved({})) === 'Added · 15.10.2026')
check('a deadline is said', R.describeSaved(item({ date: TODAY, deadline: { date: '2026-10-20', time: '12:00' }, google: 'none' }), saved({})) === 'Added · 15.10.2026 · due 20.10.2026 12:00')
check('a repeat: its summary', R.describeSaved(item({ google: 'calendar', repeat: { kind: 'weekly', daysOfWeek: [0], startsOn: '2026-10-18' } }), saved({ taskId: null, blockId: null, scheduleBlockId: 'p' }))
  === 'Added · Every week on Sun · on Google Calendar', R.describeSaved(item({ google: 'calendar', repeat: { kind: 'weekly', daysOfWeek: [0], startsOn: '2026-10-18' } }), saved({ taskId: null, blockId: null, scheduleBlockId: 'p' })))
check('one day of a repeat: "Saved for 25.10.2026 only"', R.describeSaved(item({ scope: 'day', scheduleBlockId: 'p', occurrenceDate: '2026-10-25', date: '2026-10-26', time: '08:00', google: 'calendar', repeat: { kind: 'weekly', daysOfWeek: [0], startsOn: '2026-10-18' } }), saved({ created: false, occurrenceDate: '2026-10-25' }))
  === 'Saved for 25.10.2026 only · 26.10.2026 08:00 · on Google Calendar')
check('an end past midnight wraps', R.endOf('23:30', 90) === '01:00')
check('repeat days: "Done for 15.10.2026", "Skipped …", "… open again"', R.describeRepeatDay('done', TODAY) === 'Done for 15.10.2026'
  && R.describeRepeatDay('skip', TODAY) === 'Skipped 15.10.2026' && R.describeRepeatDay('undo', TODAY) === '15.10.2026 open again')
check('conversion lines', R.describeConverted(4) === 'Converted 4 old slots into items' && /Nothing to convert/.test(R.describeConverted(0))
  && R.describeConvertUndone({ undone: 3, kept: 1 }) === 'Conversion undone: 3 items are slots again · 1 kept (changed since)')
const all = [R.describeSaved(item({ date: TODAY, time: '17:30', durationMinutes: 60, google: 'calendar' }), saved({})), R.describeRepeatDay('done', TODAY)]
check('no month names, no ISO dates, no "/" in what it says', all.every(t => !/\d{4}-\d{2}-\d{2}|\/|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec/.test(t)))

console.log('\n6 · The data layer')
const api = read('src/features/items/itemApi.ts')
const hooks = read('src/features/items/useItems.ts')
check('every write is one RPC (no table writes in itemApi)', !/\.(insert|update|upsert|delete)\(/.test(api)
  && ['app_save_item', 'app_repeat_day', 'app_convert_apply', 'app_convert_undo', 'app_item_drop_block'].every(n => api.includes(`rpc('${n}'`)))
check('a database without 155 says so by name', /migration 155 not applied/.test(api) && /PGRST202/.test(api))
const sheet = read('src/features/items/sheetRules.ts')
check('the sheet\'s helpers re-export the ONE implementation (no second copy)',
  /export \{\s*defaultGoogleTarget, googleTargetProblem, sectionForItem, itemFromRows, storedGoogleTarget, presentGoogleTarget,/.test(sheet)
  && !/export function (defaultGoogleTarget|googleTargetProblem|sectionForItem|itemFromRows|storedGoogleTarget|presentGoogleTarget)\b/.test(sheet))
check('the sheet\'s delete is the data layer\'s (useDeleteItem)', /useDeleteItem\(\)/.test(read('src/features/items/useSheetDelete.ts'))
  && !/action: 'skip'/.test(read('src/features/items/useSheetDelete.ts')))
check('the read-back state reads the run\'s outcome only (never the sync token)', /select\('last_run_at, last_clean_at, last_error, last_applied'\)/.test(api) && !/sync_token/.test(api))
check('every hook mutation goes through useMutationWithFeedback', !/useMutation\(/.test(hooks) && (hooks.match(/useMutationWithFeedback</g) ?? []).length >= 5)
check('deletes go through the one delete flow (useRowsDelete hooks / confirmDelete)', /useDeleteTask\(\)/.test(hooks) && /useDeleteScheduleBlock\(\)/.test(hooks) && /confirmDelete</.test(hooks))
check('Google follows the save in the background (the save resolves when the database answers)', /void settleItemGoogle\(answer, input\.google\)/.test(hooks))
check('keys only from qk; groups for invalidation', !/queryKey: \[/.test(hooks) && /invalidates: \['taskGraph', qk\.items\.all\]/.test(hooks))
check('the success line comes from describeSaved (a caller may say more: describe, 28.10.2026)', /successMessage: \(saved, input\) => own\?\.describe\?\.\(input, saved\.after\) \?\? describeSaved\(input, saved\)/.test(hooks))
check('components never get supabase from here (no supabase import in the hooks)', !/integrations\/supabase/.test(hooks))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
