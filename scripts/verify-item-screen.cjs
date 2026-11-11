#!/usr/bin/env node
/*
 * The item screen, steps 1 and 2 (docs/features/item-screen-plan.md) — its pure rules, against the real modules
 * through sucrase:
 *   src/shared/components/plan-modal/itemScreenRules.ts  Starts / Ends ↔ a day, a start and a length; the timeline's
 *                                                       drags and lanes; where each field goes (the marks); the red dot;
 *                                                       which rows show (screenParts); the URL row's link
 *   src/shared/components/plan-modal/planForm.ts         withEnd, withAllDaySwitch, the autosave's content key; the
 *                                                       URL and End Repeat problems (step 2)
 *   src/shared/components/plan-modal/planModal.config.ts the repeat's next dates with an End Repeat
 *   src/features/calendar/areas/calendarAreas.ts         Settings → Calendar's "Show where each field goes"
 * and a few source checks that keep the screen's data paths where they were (the heading, the autosave, the marks,
 * step 2's rows and the link).
 *
 *   Run:  node scripts/verify-item-screen.cjs
 */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const R = require('../src/shared/components/plan-modal/itemScreenRules')
const F = require('../src/shared/components/plan-modal/planForm')
const A = require('../src/features/calendar/areas/calendarAreas')
const C = require('../src/shared/components/plan-modal/planModal.config')
const REC = require('../src/features/daily/recurrence')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const src = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')

console.log('\n== 1. Starts and Ends, stored as a day, a start and a length ==')
{
  check('minutes and times both ways', R.minutesOf('17:30') === 1050 && R.timeOfMinutes(1050) === '17:30' && R.timeOfMinutes(1440 + 65) === '01:05' && R.timeOfMinutes(-30) === '23:30')
  check('the end is the start plus the length', same(R.endOf('2026-11-10', '17:30', 60), { date: '2026-11-10', time: '18:30' }))
  check('…past midnight it is the next day', same(R.endOf('2026-11-10', '22:00', 180), { date: '2026-11-11', time: '01:00' }))
  check('…a whole day ends at the same time the next day', same(R.endOf('2026-12-31', '09:00', 1440), { date: '2027-01-01', time: '09:00' }))
  check('an end picked the same day is the length', same(R.lengthToEnd({ date: '2026-11-10', time: '17:30' }, { date: '2026-11-10', time: '19:00' }), { duration: 90 }))
  check('an end picked the next day is the length across midnight', same(R.lengthToEnd({ date: '2026-11-10', time: '22:00' }, { date: '2026-11-11', time: '01:00' }), { duration: 180 }))
  check('an end before the start is refused (before)', same(R.lengthToEnd({ date: '2026-11-10', time: '17:30' }, { date: '2026-11-10', time: '17:00' }), { problem: 'before' }))
  check('an end at the start is refused (no length is "No end", not a zero)', same(R.lengthToEnd({ date: '2026-11-10', time: '17:30' }, { date: '2026-11-10', time: '17:30' }), { problem: 'before' }))
  check('more than 24 hours is refused (080: 1–1440 minutes)', same(R.lengthToEnd({ date: '2026-11-10', time: '17:30' }, { date: '2026-11-11', time: '18:00' }), { problem: 'too-long' }))
  check('exactly 24 hours is fine', same(R.lengthToEnd({ date: '2026-11-10', time: '17:30' }, { date: '2026-11-11', time: '17:30' }), { duration: 1440 }))
  check('every problem has its words', Object.keys(R.END_PROBLEM_TEXT).sort().join() === 'before,too-long')
}

console.log('\n== 2. The form: Ends, All-day, what an edit saves ==')
{
  const f = { date: '2026-11-10', time: '17:30' }
  check('withEnd writes the length and clears a held end', same(F.withEnd(f, { date: '2026-11-11', time: '00:30' }), { duration: 420, badEnd: null }))
  check('withEnd holds an end it can\'t store, with why', same(F.withEnd(f, { date: '2026-11-10', time: '16:00' }), { badEnd: { date: '2026-11-10', time: '16:00', problem: 'before' } }))
  check('withEnd does nothing without a start time', same(F.withEnd({ date: '2026-11-10', time: null }, { date: '2026-11-10', time: '10:00' }), {}))
  check('All-day on, on a calendar: all day there (withAllDay)', same(F.withAllDaySwitch({ googlePick: null }, true, 'calendar', '18:00'), { time: null, duration: null, googlePick: 'calendar', badEnd: null }))
  check('All-day on keeps Both', F.withAllDaySwitch({ googlePick: 'both' }, true, 'both', '18:00').googlePick === 'both')
  check('All-day on, on Google Tasks or nowhere: only the time goes', same(F.withAllDaySwitch({ googlePick: null }, true, 'tasks', '18:00'), { time: null, duration: null, badEnd: null })
    && same(F.withAllDaySwitch({ googlePick: 'none' }, true, 'none', '18:00'), { time: null, duration: null, badEnd: null }))
  check('All-day off: the next half hour and an hour, as Apple starts an event', same(F.withAllDaySwitch({ googlePick: null }, false, 'tasks', '18:00'), { time: '18:00', duration: 60, badEnd: null }))
  const base = F.buildInitialForm({ mode: 'task', today: '2026-11-10', nextTime: '18:00' })
  check('a new item still starts today (the section.eq.today readers)', base.date === '2026-11-10' && base.time === null)
  check('a new form holds no end', base.badEnd === null)
  check('opening or closing an optional row is no change to save', F.formContentKey(base) === F.formContentKey({ ...base, shown: ['notes'] }))
  check('any field is', F.formContentKey(base) !== F.formContentKey({ ...base, title: 'Gym' })
    && F.formContentKey(base) !== F.formContentKey({ ...base, badEnd: { date: '2026-11-10', time: '01:00', problem: 'before' } }))
}

console.log('\n== 3. The timeline ==')
{
  check('move keeps the length, in five-minute steps', same(R.dragTimes('move', 600, 60, 33), { start: 635, length: 60 }))
  check('move stops at the start of the day', same(R.dragTimes('move', 30, 60, -200), { start: 0, length: 60 }))
  check('move may run past midnight (the end is the next day)', same(R.dragTimes('move', 1380, 120, 40), { start: 1420, length: 120 }))
  check('move never starts at 24:00', R.dragTimes('move', 1400, 60, 200).start === 1435)
  check('the start grip keeps the end', same(R.dragTimes('start', 600, 60, -30), { start: 570, length: 90 }))
  check('…and leaves five minutes at least', same(R.dragTimes('start', 600, 60, 90), { start: 655, length: 5 }))
  check('the end grip keeps the start', same(R.dragTimes('end', 600, 60, 31), { start: 600, length: 90 }))
  check('…stops at midnight', same(R.dragTimes('end', 1380, 30, 300), { start: 1380, length: 60 }))
  check('…and at five minutes', same(R.dragTimes('end', 600, 60, -120), { start: 600, length: 5 }))
  check('an item with no length: the end grip gives it one, the start grip moves it', same(R.dragTimes('end', 600, null, 45), { start: 600, length: 45 })
    && same(R.dragTimes('start', 600, null, 45), { start: 645, length: null }))
  check('keys: arrows move five minutes, Shift + arrows change the end', same(R.nudgeTimes(600, 60, 1, false), { start: 605, length: 60 }) && same(R.nudgeTimes(600, 60, -1, true), { start: 600, length: 55 }))
  const spans = [
    { id: 'a', title: 'Standup', start: 570, end: 585 },
    { id: 'b', title: 'Deep work', start: 600, end: 690 },
    { id: 'c', title: 'Lunch', start: 660, end: 720 },
  ]
  const lanes = R.spanLanes(spans)
  check('things that overlap share the day in two lanes', lanes.two && lanes.lanes.get('b') === 0 && lanes.lanes.get('c') === 1 && lanes.lanes.get('a') === 0)
  check('a day without overlaps uses one lane', !R.spanLanes(spans.slice(0, 2)).two)
  check('what the item overlaps', same(R.overlapsOf(spans, 650, 30).map(s => s.id), ['b', 'c']) && R.overlapsOf(spans, 585, 15).length === 0)
  check('a point in time overlaps what it falls inside', same(R.overlapsOf(spans, 610, null).map(s => s.id), ['b']))
  check('it opens on the item, a whole day on 13:00', R.timelineCentre(600, 60) === 630 && R.timelineCentre(null, null) === 780)
}

console.log('\n== 4. Where each field goes (the marks) ==')
{
  const g = (field, target, app = 'google', dated = true, appleNotes) => R.fieldGoes(field, { target, calendarApp: app, dated, appleNotes })
  check('on Google Calendar: the title, the times, the place go there', ['title', 'time', 'place', 'repeat', 'calendar'].every(f => g(f, 'calendar') === 'google-calendar'))
  check('in an Apple area: to Apple Calendar', ['title', 'time', 'place', 'notes'].every(f => g(f, 'calendar', 'apple') === 'apple'))
  check('on Google Tasks: the title, notes, day, deadline and list go there, the place stays',
    ['title', 'notes', 'time', 'deadline', 'list'].every(f => g(f, 'tasks') === 'google-tasks') && g('place', 'tasks') === 'app')
  check('Both: the calendar for its fields, Google Tasks for the list and the deadline', g('title', 'both', 'apple') === 'apple' && g('list', 'both', 'apple') === 'google-tasks' && g('deadline', 'both') === 'google-tasks')
  check('not on Google: everything stays in the app', ['title', 'time', 'place', 'notes', 'calendar', 'deadline'].every(f => g(f, 'none') === 'app'))
  check('the app\'s own fields always stay', ['calendar', 'tasks', 'both', 'none'].every(t => g('own', t, 'apple') === 'app'))
  check('no day: no calendar (Google Calendar needs one)', g('title', 'calendar', 'google', false) === 'app')
  check('Apple\'s notes off (link only / none): the notes don\'t go there', g('notes', 'calendar', 'apple', true, false) === 'app' && g('notes', 'calendar', 'apple', true, true) === 'apple')
  check('every destination has its words', Object.keys(R.FIELD_GOES_TEXT).length === 4)
}

console.log('\n== 5. The Calendar row\'s red dot ==')
{
  const now = Date.parse('2026-11-10T12:00:00Z')
  const old = '2026-11-10T11:50:00Z', fresh = '2026-11-10T11:59:30Z'
  check('in an Apple area, no Apple copy two minutes after its change: refused', R.appleRefused({ icloud_area: null, updated_at: old }, true, now))
  check('just changed: not yet (the save sends it now)', !R.appleRefused({ icloud_area: null, updated_at: fresh }, true, now))
  check('Apple has it: no dot', !R.appleRefused({ icloud_area: 'personal', updated_at: old }, true, now))
  check('not meant for Apple: no dot', !R.appleRefused({ icloud_area: null, updated_at: old }, false, now))
  check('no row (a new item) or no time: no dot', !R.appleRefused(null, true, now) && !R.appleRefused({ icloud_area: null }, true, now))
}

console.log('\n== 5b. What an edit holds back until the screen closes ==')
{
  const saved = { date: '2026-11-10', time: '17:30' }
  check('a slot taken away (no day) waits for the screen to close', R.heldChange({ date: null, time: null, shown: [] }, saved) === 'Saves when you close it')
  check('…and no time (All-day on) too', R.heldChange({ date: '2026-11-10', time: null, shown: [] }, saved) === 'Saves when you close it')
  check('a time added, or any other change, saves by itself', R.heldChange({ date: '2026-11-10', time: '18:00', shown: [] }, saved) === null
    && R.heldChange({ date: '2026-11-10', time: '09:00', shown: [] }, { date: '2026-11-10', time: null }) === null)
  check('a new list\'s name being typed waits (each word would make a Google list)', R.heldChange({ date: '2026-11-10', time: '17:30', shown: ['list'] }, saved) === 'Saves when the list name is done')
  const auto = src('src/shared/components/plan-modal/useItemAutosave.ts')
  check('the timer never sends a held change; closing does (flush)', /if \(!dirty \|\| problem \|\| hold \|\| key === failedKey\) return/.test(auto) && !/hold/.test(auto.slice(auto.indexOf('const flush'), auto.indexOf('const line'))))
  const options = src('src/shared/components/plan-modal/OptionsSection.tsx')
  check('a new list\'s name is done on Enter or when the field is left', /if \(e\.key === 'Enter'\) \{ e\.preventDefault\(\); onDone\(\) \}/.test(options) && /onBlur=\{onDone\}/.test(options))
  const sheet = src('src/shared/components/plan-modal/UnifiedPlanModal.tsx')
  check('a failed save before closing asks "Close without saving your last change?", never traps the screen', /title: 'Close without saving your last change\?'/.test(sheet))
}

console.log('\n== 6. Settings → Calendar → "Show where each field goes" ==')
{
  check('shown by default', A.readCalendarSettings(null).showMarks === true && A.readCalendarSettings({}).showMarks === A.DEFAULT_SHOW_MARKS)
  check('a saved choice is read', A.readCalendarSettings({ showMarks: false }).showMarks === false)
  check('a wrong value falls back to the default', A.readCalendarSettings({ showMarks: 'no' }).showMarks === true)
  check('the calendars are read as before', same(A.readCalendarSettings({ notes: 'link' }).notes, 'link') && same(A.readCalendarSettings(null).areas, A.readCalendarPrefs(null).areas))
  const api = src('src/features/calendar/areas/calendarPrefsApi.ts')
  check('every save keeps it (a save of the calendars never drops it)', /const doc = \{ \.\.\.readCalendarPrefs\(prefs\), showMarks: prefs\.showMarks \}/.test(api)
    && /showMarks: next\.showMarks !== undefined && next\.showMarks !== base\.showMarks \? next\.showMarks : now\.showMarks/.test(api))
  const fn = src('supabase/functions/icloud-calendar/index.ts')
  check('the server\'s copy of the calendar settings doesn\'t know it (no migration, nothing sent again)', !/showMarks/.test(fn))
}

console.log('\n== 7. The screen keeps its data paths ==')
{
  const sheet = src('src/shared/components/plan-modal/UnifiedPlanModal.tsx')
  check('one heading wherever it opens: New Item / Edit Item', /const heading = editMode \|\| blocked \? 'Edit Item' : 'New Item'/.test(sheet) && !/config\?\.heading/.test(sheet))
  check('a new item has Add; an edit saves by itself through the one save', /\{saving \? 'Adding…' : 'Add'\}/.test(sheet)
    && /useItemAutosave\(\{ enabled: open && editMode && !blocked, form, problem, persist \}\)/.test(sheet) && /await save\.mutateAsync\(input as ItemInput\)/.test(sheet))
  check('each save after the first names the slot the first one made (never a second slot)', /liveIds\.current = \{ taskId: saved\.taskId \?\? base\?\.taskId \?\? null, blockId: saved\.blockId \?\? null \}/.test(sheet)
    && /const base = item \? \{ \.\.\.item, \.\.\.liveIds\.current \} : null/.test(sheet))
  check('an edit\'s save says "Saved" under the heading, not in a toast (unless a training week moved)', /: editMode \? '' : undefined/.test(sheet))
  check('closing sends what waits; a delete saves what waits first', /const done = await autosave\.flush\(\)/.test(sheet) && /if \(\(await autosave\.flush\(\)\)\.kind === 'failed'\) return/.test(sheet))
  const auto = src('src/shared/components/plan-modal/useItemAutosave.ts')
  check('one save at a time; a change made meanwhile goes right after', /if \(inFlight\.current\) \{ again\.current = true; return inFlight\.current \}/.test(auto) && /while \(ok && again\.current\)/.test(auto))
  const marks = src('src/shared/components/plan-modal/FieldMark.tsx')
  check('the marks are SVG files in the repo (Apple\'s, Google\'s) and the app\'s logo', /assets\/marks\/apple\.svg/.test(marks) && /assets\/marks\/google\.svg/.test(marks) && /logo\.svg/.test(marks)
    && fs.existsSync(path.join(__dirname, '../src/assets/marks/apple.svg')) && fs.existsSync(path.join(__dirname, '../src/assets/marks/google.svg')))
  check('the Calendar row\'s mark always shows; the others follow the setting', /<FieldMark always goes=/.test(src('src/shared/components/plan-modal/OptionsSection.tsx')) && /if \(!on && !always && !refused\) return null/.test(marks))
  const form = src('src/shared/components/plan-modal/ItemForm.tsx')
  check('Apple\'s headers, and no ✨ yet (step 4); no Invitees until they work', ['"Location"', '"Time"', '"Options"', '"Details"', '"Planning"'].every(h => form.includes(`title=${h}`))
    && !form.includes('title="Invitees"') && !/Sparkles|ai-proxy/.test(form))
  const time = src('src/shared/components/plan-modal/TimeSection.tsx')
  check('Repeat shows its next dates for every choice', /alwaysPreview/.test(time))
  check('the timeline reads the day as Daily does (buildDaySchedule), without this item', /buildDaySchedule\(/.test(src('src/shared/components/plan-modal/DayTimeline.tsx')))
}

console.log('\n== 8. Step 2: the calendar fields\' rows (193) ==')
{
  const g = (field, target, app = 'google', dated = true) => R.fieldGoes(field, { target, calendarApp: app, dated })
  check('the alerts and Show As go to the item\'s calendar, Apple\'s or Google\'s', ['alerts', 'showAs'].every(f => g(f, 'calendar') === 'google-calendar' && g(f, 'calendar', 'apple') === 'apple' && g(f, 'both', 'apple') === 'apple'))
  check('…a Google Task has neither, nor an item on no calendar', ['alerts', 'showAs'].every(f => g(f, 'tasks') === 'app' && g(f, 'none') === 'app' && g(f, 'calendar', 'google', false) === 'app'))
  check('the link and the travel time go only to Apple Calendar (Google has no field for them)',
    ['url', 'travel'].every(f => g(f, 'calendar', 'apple') === 'apple' && g(f, 'calendar') === 'app' && g(f, 'both') === 'app' && g(f, 'tasks') === 'app'))
  check('End Repeat goes where the repeat goes (Google Tasks: one task per day, so it stops them there)',
    g('repeatEnd', 'calendar') === 'google-calendar' && g('repeatEnd', 'calendar', 'apple') === 'apple' && g('repeatEnd', 'tasks') === 'google-tasks' && g('repeatEnd', 'none') === 'app')

  const parts = (f, ctx) => R.screenParts({ recurrence: 'none', scope: 'all', time: null, ...f }, { choiceShown: true, calendarHidden: false, target: 'none', ...ctx })
  check('a time: the rows a slot keeps show', parts({ time: '17:00' }).slotFields === true)
  check('a repeat: they show (its rule keeps them)', parts({ recurrence: 'weekly' }, { target: 'tasks' }).slotFields === true && parts({ recurrence: 'weekly' }).repeating === true)
  check('a whole day on a calendar: they show; on Google Tasks or nowhere: a task alone has nowhere to keep them',
    parts({}, { target: 'calendar' }).slotFields === true && parts({}, { target: 'both' }).slotFields === true
    && parts({}, { target: 'tasks' }).slotFields === false && parts({}, { target: 'none' }).slotFields === false)
  check('…the whole-day case only while the Calendar row shows (as the Location row before)', parts({}, { target: 'calendar', choiceShown: false }).slotFields === false)
  const day = parts({ recurrence: 'weekly', scope: 'day', time: '07:00' }, { occurrenceDate: '2026-11-12', target: 'calendar' })
  check('"This day" of a repeat: a slot (its fields show), no repeat (no End Repeat), no Calendar row', day.day && !day.repeating && day.slotFields && !day.showGoogle)
  check('a caller that hides the Calendar row hides it here too', parts({ time: '17:00' }, { calendarHidden: true }).showGoogle === false)

  check('the URL row offers to open only an https link the writers would use', R.openableUrl('https://example.com/a') === 'https://example.com/a'
    && R.openableUrl('example.com/a b') === 'https://example.com/a%20b' && R.openableUrl('http://example.com') === null
    && R.openableUrl('javascript:alert(1)') === null && R.openableUrl('https://user:pw@example.com') === null && R.openableUrl('') === null
    && R.openableUrl('https://example.com/\r\nX:1') === null && R.openableUrl(`https://example.com/${'a'.repeat(2050)}`) === null)
  check('…and names the host it opens as the browser reads it (punycode: a look-alike shows)', R.hostOf('https://xn--e1afmkfd.example/x') === 'xn--e1afmkfd.example'
    && R.hostOf(R.openableUrl('https://københavn.example/')) === 'xn--kbenhavn-54a.example' && R.hostOf('https://example.com:8443/') === 'example.com:8443')

  const seed = { mode: 'schedule', today: '2026-11-10', nextTime: '10:00', defaults: { date: '2026-11-10', startTime: '17:00' } }
  const f0 = F.buildInitialForm(seed)
  check('a link\'s problem is the URL row\'s', F.urlProblem({ url: 'http://example.com' }) === 'Only https:// links' && F.urlProblem({ url: '' }) === null && F.urlProblem({ url: 'example.com' }) === null)
  const rep = { ...f0, recurrence: 'weekly', weeklyDays: [2], date: '2026-11-10' }
  check('End Repeat\'s problem is the End Repeat row\'s: before the start, 0 times', F.repeatEndIssue({ ...rep, repeatEnd: { until: '2026-11-09' } }, { today: '2026-11-10' }) === 'The repeat ends before it starts'
    && F.repeatEndIssue({ ...rep, repeatEnd: { count: 0 } }, { today: '2026-11-10' }) === 'After 1 to 999 times' && F.repeatEndIssue({ ...rep, repeatEnd: { count: 5 } }, { today: '2026-11-10' }) === null)
  check('…never for a one-off or "This day" (they have no End Repeat)', F.repeatEndIssue({ ...f0, repeatEnd: { count: 0 } }, { today: '2026-11-10' }) === null
    && F.repeatEndIssue({ ...rep, scope: 'day', repeatEnd: { count: 0 } }, { today: '2026-11-10' }) === null)
  check('calendarFieldsProblem is the two together (the save refuses the same)', F.calendarFieldsProblem({ ...rep, url: 'http://x.example', repeatEnd: { count: 0 } }, { today: '2026-11-10' }) === 'Only https:// links')

  const weekly = { recurrence: 'weekly', weeklyDays: [2], monthWeekday: null, customKind: 'every', repeatEvery: '2', repeatUnit: 'week', repeatDates: [] }
  const p5 = C.repeatPreview(weekly, '2026-11-03', '2026-11-03', [], { count: 5 })
  check('after 5 times: the next dates as they will be, and the last (the 5th, as the database counts it)', same(p5.next, ['2026-11-03', '2026-11-10', '2026-11-17']) && p5.last === '2026-12-01'
    && p5.last === REC.countEndDay({ days_of_week: [2], repeat_kind: 'weekly', effective_from: '2026-11-03', repeat_count: 5 }))
  const pLate = C.repeatPreview(weekly, '2026-11-03', '2026-11-24', [], { count: 5 })
  check('…no date after the last', same(pLate.next, ['2026-11-24', '2026-12-01']))
  const pDay = C.repeatPreview(weekly, '2026-11-03', '2026-11-03', [], { until: '2026-11-12' })
  check('on a day: none after it, that day is the last', same(pDay.next, ['2026-11-03', '2026-11-10']) && pDay.last === '2026-11-12')
  const pNever = C.repeatPreview(weekly, '2026-11-03', '2026-11-03')
  check('never: three dates, no last', pNever.next.length === 3 && pNever.last === null)
  const fresh = R.endRepeatDefaults({ days_of_week: [2], repeat_kind: 'weekly', effective_from: '2026-11-03' }, '2026-11-03')
  check('a new repeat\'s first End Repeat: the 10th time, as a day and as 10 times', fresh.count === 10 && fresh.until === '2027-01-05')
  const oldRule = { days_of_week: [1, 2, 3, 4, 5], repeat_kind: 'weekly', effective_from: '2026-09-07', except_dates: ['2026-11-12'] }
  const old = R.endRepeatDefaults(oldRule, '2026-11-11')
  check('a repeat that began long ago: the first value is 10 times from today, never in the past (an edit saves it at once)',
    old.until > '2026-11-11' && REC.nextOccurrences(oldRule, '2026-11-11', 10).pop() === old.until && old.count > 10)
  check('…and the count names that same day as the database counts it (days taken out included)',
    REC.countEndDay({ ...oldRule, repeat_count: old.count }) === old.until)

  const rows = src('src/shared/components/plan-modal/CalendarFieldRows.tsx')
  const form = src('src/shared/components/plan-modal/ItemForm.tsx')
  const time = src('src/shared/components/plan-modal/TimeSection.tsx')
  const end = src('src/shared/components/plan-modal/EndRepeatRows.tsx')
  const sheet = src('src/shared/components/plan-modal/UnifiedPlanModal.tsx')
  check('every row changes its field through withCalendarField (an edit sends what the owner changed)',
    ['alerts', 'showAs', 'url', 'travelMinutes'].every(k => form.includes(`withCalendarField(form, '${k}'`)) && time.includes("withCalendarField(form, 'repeatEnd'"))
  check('Travel Time, Alert, Second Alert, Show As and URL show only where a slot or a repeat keeps them; End Repeat only under a repeat',
    (form.match(/\{slotFields && \(/g) || []).length === 3 && /\{repeating && \(\s*<EndRepeatRows/.test(time))
  check('the choices and words are itemCalendarFields\' (Apple\'s lists)', /alertChoices\(allDay\)/.test(rows) && /TRAVEL_CHOICES\.map/.test(rows) && /alertsOf\(next\)/.test(rows) && /repeatEndLabel\(end\)/.test(end))
  check('the link opened is only openableUrl\'s, in a new tab without the opener or referrer, after its address shows',
    /const href = openableUrl\(url\)/.test(rows) && /<a href=\{href\} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"/.test(rows)
    && rows.indexOf('hostOf(href)') < rows.indexOf('<a href={href}') && (rows.match(/<a /g) || []).length === 1)
  check('a link or an End Repeat that can\'t be saved stops the save (Add and the autosave) and says why', /: urlIssue \?\? endIssue/.test(sheet) && /if \(problem\) \{ toast\.error\(problem\); return \}/.test(sheet))
  check('Apple\'s mark is a quoted url() (a build inlines it as a data URI with \' in it)', /const mask = `url\("\$\{appleMark\}"\)`/.test(src('src/shared/components/plan-modal/FieldMark.tsx')))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
