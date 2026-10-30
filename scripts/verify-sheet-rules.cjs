#!/usr/bin/env node
/*
 * The Add sheet (one item, migration 155) — its pure rules, against the real
 * modules through sucrase:
 *   src/features/items/sheetRules.ts            Google default / problems / labels,
 *                                               section from the date, saved rows → one item,
 *                                               Home's quick add → an item
 *   src/shared/components/plan-modal/planForm.ts the sheet's form: seeded from defaults or
 *                                               an item, saved as ItemInput, quick add in the title
 *
 *   Run:  node scripts/verify-sheet-rules.cjs
 */
require('sucrase/register')
const R = require('../src/features/items/sheetRules')
const F = require('../src/shared/components/plan-modal/planForm')
const { parseQuickAdd } = require('../src/features/items/quickAdd')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const TODAY = '2026-10-15' // a Thursday
const weekly = { kind: 'weekly', daysOfWeek: [1, 3, 5], startsOn: TODAY }

console.log('\n== 1. Google: the default, the problems, the labels ==')
{
  check('a time → Google Calendar', R.defaultGoogleTarget({ time: '17:30', repeat: null }) === 'calendar')
  check('no time → Google Tasks', R.defaultGoogleTarget({ time: null, repeat: null }) === 'tasks')
  check('a repeat with no time → Google Calendar (an all-day series)', R.defaultGoogleTarget({ time: null, repeat: weekly }) === 'calendar')
  check('never Both by default', ['tasks', 'calendar'].includes(R.defaultGoogleTarget({ time: '9:00', repeat: weekly })))
  check('Tasks for a repeat is allowed (156: one Google Task per day)', R.googleTargetProblem({ repeat: weekly, google: 'tasks' }) === null)
  check('Both for a repeat only warns', same(R.googleTargetProblem({ repeat: weekly, google: 'both' }), { level: 'warning', message: 'Shows twice in Google Calendar' }))
  check('Both warns "Shows twice in Google Calendar"',
    same(R.googleTargetProblem({ repeat: null, google: 'both' }), { level: 'warning', message: 'Shows twice in Google Calendar' }))
  check('Calendar / Tasks / Not on Google: no problem',
    ['calendar', 'none'].every(g => R.googleTargetProblem({ repeat: weekly, google: g }) === null)
    && R.googleTargetProblem({ repeat: null, google: 'tasks' }) === null)
  check('a picked choice wins while it fits', R.effectiveGoogleTarget({ time: '9:00', repeat: null }, 'tasks') === 'tasks')
  check('…Tasks for a repeat is kept (156)', R.effectiveGoogleTarget({ time: null, repeat: weekly }, 'tasks') === 'tasks')
  check('nothing picked → the default', R.effectiveGoogleTarget({ time: null, repeat: null }, null) === 'tasks')
  check('labels say busy / free / all day — never "Auto"',
    R.googleTargetLabel({ time: '17:30', durationMinutes: 60, repeat: null }, 'calendar') === 'Google Calendar · busy'
    && R.googleTargetLabel({ time: '17:30', durationMinutes: null, repeat: null }, 'calendar') === 'Google Calendar · free'
    && R.googleTargetLabel({ time: null, durationMinutes: null, repeat: null }, 'calendar') === 'Google Calendar · all day'
    && R.googleTargetLabel({ time: null, durationMinutes: null, repeat: null }, 'none') === 'Not on Google'
    && R.googleTargetLabel({ time: null, durationMinutes: null, repeat: null }, 'both') === 'Google Tasks + Calendar')
  check('a repeat on Google Tasks reads "Google Tasks · one per day"',
    R.googleTargetLabel({ time: null, durationMinutes: null, repeat: weekly }, 'tasks') === 'Google Tasks · one per day'
    && R.googleTargetLabel({ time: null, durationMinutes: null, repeat: null }, 'tasks') === 'Google Tasks')
  const choices = R.googleChoices({ time: null, durationMinutes: null, repeat: weekly })
  check('the menu: four choices, none disabled for a repeat; Tasks is "Google Tasks · one per day"',
    same(choices.map(c => c.target), ['calendar', 'tasks', 'both', 'none'])
    && choices.every(c => !c.disabled) && choices[1].label === 'Google Tasks · one per day'
    && choices[2].hint === 'Shows twice in Google Calendar')
  check('…an all-day repeat says so', choices[0].hint === 'An all-day repeating event')
  check('…nothing disabled without a repeat', R.googleChoices({ time: '9:00', durationMinutes: 30, repeat: null }).every(c => !c.disabled))
  // Its area on Apple Calendar (2b-2): the event is in Apple Calendar, Google Tasks stays Google Tasks.
  const one = { time: '17:30', durationMinutes: 60, repeat: null }
  check('an item in an area on Apple says "Apple Calendar"; Tasks stays "Google Tasks"; none is "Only in this app"',
    R.googleTargetLabel(one, 'calendar', 'apple') === 'Apple Calendar · busy'
    && R.googleTargetLabel(one, 'both', 'apple') === 'Google Tasks + Apple Calendar'
    && R.googleTargetLabel({ ...one, repeat: weekly }, 'both', 'apple') === 'Apple Calendar + Google Tasks · one per day'
    && R.googleTargetLabel(one, 'tasks', 'apple') === 'Google Tasks'
    && R.googleTargetLabel(one, 'none', 'apple') === 'Only in this app')
  const appleChoices = R.googleChoices(one, 'apple')
  check('…its menu names Apple Calendar, and Both shows twice nowhere (two apps)',
    appleChoices[0].label === 'Apple Calendar' && appleChoices[2].hint === 'In Apple Calendar and as a Google Task'
    && R.googleTargetProblem({ repeat: null, google: 'both' }, 'apple') === null)
  check('…Google areas read exactly as before', R.googleTargetLabel(one, 'calendar') === 'Google Calendar · busy' && R.googleChoices(one)[0].label === 'Google Calendar')
}

console.log('\n== 2. The section follows the date ==')
{
  check('no date → Inbox', R.sectionForItem({ date: null }, TODAY) === 'inbox')
  check('today → Today', R.sectionForItem({ date: TODAY }, TODAY) === 'today')
  check('another day → Backlog (never a retired section)',
    R.sectionForItem({ date: '2026-10-16' }, TODAY) === 'backlog' && R.sectionForItem({ date: '2026-10-01' }, TODAY) === 'backlog')
}

console.log('\n== 3. Saved rows → one item (itemFromRows) ==')
const task = {
  id: 't1', title: 'Gym', description: null, domain: 'personal', priority: 'medium', due_date: TODAY, due_time: null,
  source_type: 'manual', source_id: null, google_tasklist_id: null, google_sync_enabled: true,
}
const block = {
  id: 'b1', date: TODAY, title: 'Gym', start_time: '17:30:00', duration_minutes: 60, category: 'training', notes: null,
  source_type: null, source_id: null, google_calendar_event_id: null,
}
const plan = {
  id: 's1', title: 'Gym', start_time: '17:30:00', end_time: '18:30:00', category: 'training', days_of_week: [1, 3, 5],
  effective_from: '2026-10-01', repeat_kind: 'weekly', repeat_interval: null, repeat_unit: null, repeat_dates: null, google_calendar_event_id: 'ev1',
}
{
  const a = R.itemFromRows(task, null, null)
  check('a task alone: its due day and time are the item\'s, no length',
    a.date === TODAY && a.time === null && a.durationMinutes === null && a.deadline === null && a.taskId === 't1' && a.scope === 'item')
  check('…a task with a due time reads it as the time ("do it at 14:00")', R.itemFromRows({ ...task, due_time: '14:00:00' }, null, null).time === '14:00')
  check('…on Google Tasks before 155 (it syncs)', a.google === 'tasks')
  const b = R.itemFromRows({ ...task, google_sync_enabled: false }, { ...block, task_id: 't1', google_calendar_event_id: 'ev' }, null)
  check('a task with its slot: the slot\'s day, time and length', b.date === TODAY && b.time === '17:30' && b.durationMinutes === 60 && b.blockId === 'b1')
  check('…the same due day is no deadline', b.deadline === null)
  check('…on Calendar before 155 (its slot has an event)', b.google === 'calendar')
  const c = R.itemFromRows({ ...task, due_date: '2026-10-20', due_time: '12:00:00' }, block, null)
  check('a due day other than the slot\'s is the deadline', same(c.deadline, { date: '2026-10-20', time: '12:00' }) && c.date === TODAY)
  check('a slot that doesn\'t block (busy = false) has no length', R.itemFromRows(null, { ...block, busy: false }, null).durationMinutes === null)
  check('a slot with no start time: no time, no length (anytime)',
    R.itemFromRows(null, { ...block, start_time: null }, null).time === null && R.itemFromRows(null, { ...block, start_time: null }, null).durationMinutes === null)
  const d = R.itemFromRows(null, { ...block, category: 'work', source_type: 'movie', source_id: 'm1' }, null)
  check('a block of its own: domain from its category, its source, not on Google',
    d.domain === 'work' && same(d.source, { type: 'movie', id: 'm1' }) && d.google === 'none' && d.taskId === null)
  const e = R.itemFromRows(null, null, plan)
  check('a repeat: its start, time, length and rule (scope all)',
    e.date === '2026-10-01' && e.time === '17:30' && e.durationMinutes === 60 && e.scope === 'all'
    && same(e.repeat, { kind: 'weekly', daysOfWeek: [1, 3, 5], startsOn: '2026-10-01' }) && e.google === 'calendar')
  check('a repeat across midnight keeps its length', R.itemFromRows(null, null, { ...plan, start_time: '23:30:00', end_time: '00:30:00' }).durationMinutes === 60)
  check('a repeat with no time (155): anytime', R.itemFromRows(null, null, { ...plan, start_time: null, end_time: null }).time === null)
  check('a saved choice (155) wins over where it is now',
    R.itemFromRows({ ...task, google_target: 'none' }, null, null).google === 'none'
    && R.storedGoogleTarget({ ...task, google_target: 'both' }) === 'both' && R.storedGoogleTarget(task) === null)
  check('Both before 155: a Calendar event and a Google Task', R.presentGoogleTarget(task, { ...block, google_calendar_event_id: 'x' }) === 'both')
  check('an interval repeat keeps N and unit',
    same(R.itemFromRows(null, null, { ...plan, repeat_kind: 'interval', repeat_interval: 2, repeat_unit: 'week' }).repeat,
      { kind: 'interval', daysOfWeek: [1, 3, 5], interval: 2, unit: 'week', startsOn: '2026-10-01' }))
}

console.log('\n== 4. The form: a new item ==')
const seed = (o = {}) => F.buildInitialForm({ mode: 'task', today: TODAY, nextTime: '16:00', ...o })
{
  const t = seed()
  check('Add (task): today, no time, no length, no repeat, Google follows the default',
    t.date === TODAY && t.time === null && t.duration === null && t.recurrence === 'none' && t.googlePick === null && t.shown.length === 0)
  const s = seed({ mode: 'schedule', defaults: { title: 'Watch', duration: 45, category: 'media' } })
  check('planning a slot: the next half hour and its length', s.time === '16:00' && s.duration === 45 && s.category === 'media' && s.title === 'Watch')
  const r = seed({ mode: 'recurring', defaults: { title: 'Training', category: 'training', recurrence: 'weekly' } })
  check('a repeating plan: weekly, a time and an hour', r.recurrence === 'weekly' && r.time === '16:00' && r.duration === 60)
  check('a repeat with no days of its own starts on its day\'s weekday (never Mon–Fri)',
    same(seed({ mode: 'recurring' }).weeklyDays, [4]) && same(r.weeklyDays, [4])
    && same(seed({ mode: 'recurring', defaults: { recurrence: 'weekly', daysOfWeek: [1, 3] } }).weeklyDays, [1, 3]))
  check('"No date" takes the time and length with it; a date alone changes nothing else',
    same(F.withDate(null), { date: null, time: null, duration: null }) && same(F.withDate(TODAY), { date: TODAY }))
  check('removing the time removes its length', same(F.withTime(null), { time: null, duration: null }) && same(F.withTime('09:00'), { time: '09:00' }))
  // "All day" (owner, 16.10.2026): no time, no length, on Google Calendar — Both stays Both.
  check('All day: no time, no length, Google Calendar', same(F.withAllDay({ googlePick: null }), { time: null, duration: null, googlePick: 'calendar' })
    && same(F.withAllDay({ googlePick: 'tasks' }), { time: null, duration: null, googlePick: 'calendar' }))
  check('All day keeps Both', F.withAllDay({ googlePick: 'both' }).googlePick === 'both')
  check('…and an item with no time on Calendar reads as an all-day event', R.effectiveGoogleTarget({ time: null, repeat: null }, 'calendar') === 'calendar' && R.hasGoogleCalendar('calendar') && R.hasGoogleCalendar('both') && !R.hasGoogleCalendar('tasks'))
  check('a day from the caller (Daily\'s day, a purchase\'s date)',
    seed({ defaults: { date: '2026-10-20' } }).date === '2026-10-20' && seed({ defaults: { dueDate: '2026-10-21' } }).date === '2026-10-21')
  check('section Inbox from the caller: no date', seed({ defaults: { section: 'inbox' } }).date === null)
  check('"Add to Google Calendar" from the caller picks Calendar', seed({ defaults: { gcal: true } }).googlePick === 'calendar')
  check('notes and a work domain open their rows', same(seed({ defaults: { notes: 'x', domain: 'work' } }).shown, ['notes', 'area']))
  check('a training source gives the training colour', seed({ mode: 'schedule', source: { sourceType: 'training_session', taskSourceType: 'training_session' } }).category === 'training')
}

console.log('\n== 5. The form: a saved item ==')
{
  const old = R.itemFromRows({ ...task, google_sync_enabled: true }, null, null)
  check('an older row where the default puts it keeps following the default',
    F.buildInitialForm({ mode: 'task', item: old, today: TODAY, nextTime: '16:00' }).googlePick === null)
  const off = R.itemFromRows({ ...task, google_sync_enabled: false }, null, null)
  check('…one that isn\'t keeps where it is (not on Google)', F.buildInitialForm({ mode: 'task', item: off, today: TODAY, nextTime: '16:00' }).googlePick === 'none')
  check('a saved choice is the pick', F.buildInitialForm({ mode: 'task', item: old, storedGoogle: 'tasks', today: TODAY, nextTime: '16:00' }).googlePick === 'tasks')
  const rep = F.buildInitialForm({ mode: 'recurring', item: R.itemFromRows(null, null, plan), occurrenceDate: TODAY, category: 'training', today: TODAY, nextTime: '16:00' })
  check('a repeat opens as its rule (Mon Wed Fri), its start, its time', rep.recurrence === 'weekly' && same(rep.weeklyDays, [1, 3, 5]) && rep.date === '2026-10-01' && rep.time === '17:30')
  const day = F.switchScope(rep, 'day')
  check('This day shows the day; All days the start again', day.scope === 'day' && day.date === TODAY && F.switchScope(day, 'all').date === '2026-10-01')
  check('no day to switch to: nothing changes', F.switchScope(F.buildInitialForm({ mode: 'recurring', item: R.itemFromRows(null, null, plan), today: TODAY, nextTime: '16:00' }), 'day').scope === 'all')
}

console.log('\n== 6. Saving: the form as ItemInput ==')
{
  const ctx = { googleConnected: true, today: TODAY }
  const f = { ...seed({ defaults: { title: 'Gym' } }), time: '17:30', duration: 60 }
  const a = F.inputFromForm(f, ctx)
  check('a new timed item: today, 17:30 for 60, on Calendar, scope item, no ids',
    a.title === 'Gym' && a.date === TODAY && a.time === '17:30' && a.durationMinutes === 60 && a.google === 'calendar'
    && a.scope === 'item' && a.taskId === null && a.repeat === null && a.deadline === null)
  check('a length without a time is not saved', F.inputFromForm({ ...f, time: null }, ctx).durationMinutes === null)
  check('a length over a day is clamped', F.inputFromForm({ ...f, duration: 5000 }, ctx).durationMinutes === 1440)
  check('no Google on this device: a new item is not on Google', F.inputFromForm(f, { ...ctx, googleConnected: false }).google === 'none')
  const editTask = R.itemFromRows({ ...task, google_sync_enabled: true }, null, null)
  check('…an edit keeps what it had', F.inputFromForm({ ...f, time: null }, { ...ctx, googleConnected: false, item: editTask }).google === 'tasks')
  check('the Google Tasks list goes only with Tasks',
    F.inputFromForm({ ...f, time: null }, { ...ctx, googleTaskListId: 'L1' }).googleTaskList === 'L1'
    && F.inputFromForm(f, { ...ctx, googleTaskListId: 'L1' }).googleTaskList === null)
  check('a deadline and a window', same(F.inputFromForm({ ...f, deadlineDate: '2026-10-20', deadlineTime: '12:00', startDate: '2026-10-16' }, ctx).deadline, { date: '2026-10-20', time: '12:00' })
    && F.inputFromForm({ ...f, startDate: '2026-10-16' }, ctx).startDate === '2026-10-16')
  const rep = { ...f, recurrence: 'weekly', weeklyDays: [1, 3, 5] }
  const r = F.inputFromForm(rep, ctx)
  check('a new repeat starts on the sheet\'s date', same(r.repeat, { kind: 'weekly', daysOfWeek: [1, 3, 5], startsOn: TODAY }) && r.date === TODAY)
  check('a repeat with Tasks picked saves Google Tasks — one per day (156)', F.inputFromForm({ ...rep, googlePick: 'tasks' }, ctx).google === 'tasks')
  const savedPlan = R.itemFromRows(null, null, plan)
  const edit = F.buildInitialForm({ mode: 'recurring', item: savedPlan, occurrenceDate: TODAY, today: TODAY, nextTime: '16:00' })
  const all = F.inputFromForm({ ...edit, time: '18:00' }, { ...ctx, item: savedPlan, occurrenceDate: TODAY })
  check('editing the rule: scope all, the plan\'s id, its saved start kept (weekly)',
    all.scope === 'all' && all.scheduleBlockId === 's1' && all.repeat.startsOn === '2026-10-01' && all.occurrenceDate === null)
  const monthly = F.inputFromForm({ ...edit, recurrence: 'monthly', monthWeekday: null, date: '2026-10-13' }, { ...ctx, item: savedPlan })
  check('…a choice that counts from its start (Monthly) saves the start shown', monthly.repeat.startsOn === '2026-10-13' && monthly.repeat.kind === 'monthly')
  const one = F.inputFromForm(F.switchScope(edit, 'day'), { ...ctx, item: savedPlan, occurrenceDate: TODAY })
  check('This day: scope day, that day, no repeat', one.scope === 'day' && one.occurrenceDate === TODAY && one.date === TODAY && one.repeat === null)
  const src = F.inputFromForm(f, { ...ctx, source: { sourceType: 'tv_episode', sourceId: 'e1', taskSourceType: 'tv_series', episodeInfo: { seasonNumber: 2, episodeNumber: 5 } } })
  check('a caller\'s source: the task\'s type, and the slot\'s own with its episode',
    same(src.source, { type: 'tv_series', id: 'e1' }) && same(src.blockSource, { type: 'tv_episode', id: 'e1', seasonNumber: 2, episodeNumber: 5 }))
  check('a training session with no routine keeps its type (no id)',
    same(F.inputFromForm(f, { ...ctx, source: { sourceType: 'training_session', taskSourceType: 'training_session' } }).source, { type: 'training_session', id: null }))
  check('an edit with no caller source keeps the item\'s', same(F.inputFromForm(f, { ...ctx, item: R.itemFromRows(null, { ...block, source_type: 'movie', source_id: 'm1' }) }).source, { type: 'movie', id: 'm1' }))
}

console.log('\n== 7. Quick add in the title fills the chips; Keep text puts them back ==')
{
  const start = { ...seed(), duration: null }
  const p1 = parseQuickAdd('Gym 17:30', TODAY)
  const s1 = F.applyQuickAdd(start, {}, null, p1, TODAY)
  check('a read time fills the time chip', s1.form.time === '17:30' && s1.form.duration === null && same(s1.base, { time: { time: null } }))
  const p2 = parseQuickAdd('Gym 17:30 1h every Mon Wed Fri', TODAY)
  const s2 = F.applyQuickAdd(s1.form, s1.base, p1, p2, TODAY)
  check('typing on: the length and the repeat follow', s2.form.duration === 60 && s2.form.recurrence === 'weekly' && same(s2.form.weeklyDays, [1, 3, 5]))
  const hand = { ...s2.form, time: '18:00' }
  const p3 = parseQuickAdd('Gym 17:30 1h every Mon Wed Fri!', TODAY)
  const s3 = F.applyQuickAdd(hand, s2.base, p2, p3, TODAY)
  check('a chip changed by hand stays while the text still says the same', s3.form.time === '18:00')
  const p4 = parseQuickAdd('Gym 1h every Mon Wed Fri', TODAY)
  const s4 = F.applyQuickAdd(s3.form, s3.base, p3, p4, TODAY)
  check('a part the text no longer says goes back to what the chip held', s4.form.time === null && s4.form.duration === 60)
  const kept = F.keepQuickText(s4.form, s4.base, 'Gym 1h every Mon Wed Fri')
  check('Keep text: every part back, the title as typed',
    kept.duration === null && kept.recurrence === 'none' && kept.time === null && kept.title === 'Gym 1h every Mon Wed Fri')
  const undated = { ...seed(), date: null }
  const r = F.applyQuickAdd(undated, {}, null, parseQuickAdd('Water plants every Sunday', TODAY), TODAY)
  check('a repeat on an undated item starts today', r.form.date === TODAY && same(r.form.weeklyDays, [0]))
  check('…and Keep text takes the date back too', F.keepQuickText(r.form, r.base, 'x').date === null)
  const t = F.applyQuickAdd(undated, {}, null, parseQuickAdd('Call mum 18:00', TODAY), TODAY)
  check('a time read on an undated item puts it on today (a time needs a day)…', t.form.time === '18:00' && t.form.date === TODAY)
  const t2 = F.applyQuickAdd(t.form, t.base, parseQuickAdd('Call mum 18:00', TODAY), parseQuickAdd('Call mum', TODAY), TODAY)
  check('…and taking the time out of the text takes the day back', t2.form.time === null && t2.form.date === null)
  check('every 2 weeks named no day: the start\'s weekday',
    same(F.applyQuickAdd(seed(), {}, null, parseQuickAdd('Bins every 2 weeks', TODAY), TODAY).form.weeklyDays, [4]))
}

console.log('\n== 8. The "Read as" line and Home\'s quick add ==')
{
  check('Read as: the day, the time span, the repeat in words',
    same(R.readAsParts(parseQuickAdd('Gym tomorrow 17:30 1h every Mon Wed Fri', TODAY), TODAY),
      ['Fri 16.10.2026', '17:30–18:30', 'Every week on Mon, Wed and Fri']))
  check('a length alone reads as a length', same(R.readAsParts(parseQuickAdd('Read 90m', TODAY), TODAY), ['1h 30m']))
  check('slot labels cross midnight', R.slotLabel('23:30', 90) === '23:30–01:00' && R.slotLabel('09:00', null) === '09:00')
  const h = R.itemFromQuickAdd('Gym 17:30 1h every Mon Wed Fri', parseQuickAdd('Gym 17:30 1h every Mon Wed Fri', TODAY), TODAY, true)
  check('Home: the read parts, on today, on Calendar (a time and a repeat)',
    h.title === 'Gym' && h.date === TODAY && h.time === '17:30' && h.durationMinutes === 60 && h.google === 'calendar'
    && same(h.repeat, { kind: 'weekly', daysOfWeek: [1, 3, 5], startsOn: TODAY }))
  const plain = R.itemFromQuickAdd('Buy 3 eggs', null, TODAY, true)
  check('Home: plain text is a to-do for today on Google Tasks', plain.title === 'Buy 3 eggs' && plain.date === TODAY && plain.time === null && plain.google === 'tasks')
  check('Home: Keep text saves the words as typed', R.itemFromQuickAdd('Gym 17:30', null, TODAY, true).title === 'Gym 17:30')
  check('Home: no Google here → not on Google', R.itemFromQuickAdd('Buy milk', null, TODAY, false).google === 'none')
  check('Home: nothing but parts → nothing to save', R.itemFromQuickAdd('tomorrow 17:30', parseQuickAdd('tomorrow 17:30', TODAY), TODAY, true) === null)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
