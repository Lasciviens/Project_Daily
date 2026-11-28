#!/usr/bin/env node
/*
 * The item screen, steps 1–3 and the cleanup (docs/features/item-screen-plan.md) — its pure rules, against the real modules
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
  const g = (field, target, app = 'apple', dated = true, appleNotes) => R.fieldGoes(field, { target, calendarApp: app, dated, appleNotes })
  check('on the calendar: the title, the times, the place go to Apple Calendar', ['title', 'time', 'place', 'repeat', 'calendar', 'notes'].every(f => g(f, 'calendar') === 'apple'))
  check('an area that is off: nothing goes to a calendar (its Google Task still takes its fields)',
    ['title', 'time', 'place', 'calendar'].every(f => g(f, 'calendar', 'none') === 'app') && g('title', 'both', 'none') === 'google-tasks')
  check('on Google Tasks: the title, notes, day, deadline and list go there, the place stays',
    ['title', 'notes', 'time', 'deadline', 'list'].every(f => g(f, 'tasks') === 'google-tasks') && g('place', 'tasks') === 'app')
  check('Both: the calendar for its fields, Google Tasks for the list and the deadline', g('title', 'both', 'apple') === 'apple' && g('list', 'both', 'apple') === 'google-tasks' && g('deadline', 'both') === 'google-tasks')
  check('not on Google: everything stays in the app', ['title', 'time', 'place', 'notes', 'calendar', 'deadline'].every(f => g(f, 'none') === 'app'))
  check('the app\'s own fields always stay', ['calendar', 'tasks', 'both', 'none'].every(t => g('own', t, 'apple') === 'app'))
  check('no day: no calendar (a calendar needs one)', g('title', 'calendar', 'apple', false) === 'app')
  check('Apple\'s notes off (link only / none): the notes don\'t go there', g('notes', 'calendar', 'apple', true, false) === 'app' && g('notes', 'calendar', 'apple', true, true) === 'apple')
  check('every destination has its words — Apple Calendar, Google Tasks, the app (no Google Calendar)', Object.keys(R.FIELD_GOES_TEXT).sort().join() === 'app,apple,google-tasks')
  // A card's banner (owner, 24.11.2026: "Use them as banner instead"): each place once, calendars first, the rows named.
  const card = [{ goes: 'app', row: 'Priority' }, { goes: 'apple', row: 'Date' }, { goes: 'apple', row: 'Starts' }, { goes: 'apple', row: 'Starts' }, { goes: 'google-tasks', row: null }]
  check('a card\'s banner draws each place once, the calendars first, the app last', same(R.cardMarkPlaces(card), ['apple', 'google-tasks', 'app']) && same(R.cardMarkPlaces([]), []))
  check('…and says it in words, naming each row once (a row with no name: the place alone)',
    R.cardMarksText(card) === 'Goes to Apple Calendar: Date, Starts · Goes to Google Tasks · Stays in the app: Priority' && R.cardMarksText([]) === '')
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
  check('a new item has Add; an edit saves by itself through the one save (while a ✨ fill waits, the screen as it was before it)', /\{saving \? 'Adding…' : 'Add'\}/.test(sheet)
    && /useItemAutosave\(\{\s*enabled: open && editMode && !blocked, form: fill\.before\?\.form \?\? form, problem: fill\.before \? fill\.before\.problem : problem, persist,\s*\}\)/.test(sheet) && /await save\.mutateAsync\(input as ItemInput\)/.test(sheet))
  check('each save after the first names the slot the first one made (never a second slot)', /liveIds\.current = \{ taskId: saved\.taskId \?\? base\?\.taskId \?\? null, blockId: saved\.blockId \?\? null \}/.test(sheet)
    && /const base = item \? \{ \.\.\.item, \.\.\.liveIds\.current \} : null/.test(sheet))
  check('an edit\'s save says "Saved" under the heading, not in a toast (unless a training week moved)', /: editMode \? '' : undefined/.test(sheet))
  check('closing sends what waits; a delete saves what waits first', /const done = await autosave\.flush\(\)/.test(sheet) && /if \(\(await autosave\.flush\(\)\)\.kind === 'failed'\) return/.test(sheet))
  const auto = src('src/shared/components/plan-modal/useItemAutosave.ts')
  check('one save at a time; a change made meanwhile goes right after', /if \(inFlight\.current\) \{ again\.current = true; return inFlight\.current \}/.test(auto) && /while \(ok && again\.current\)/.test(auto))
  const marks = src('src/shared/components/plan-modal/FieldMark.tsx')
  check('the marks are SVG files in the repo (Apple\'s, Google\'s) and the app\'s logo', /assets\/marks\/apple\.svg/.test(marks) && /assets\/marks\/google\.svg/.test(marks) && /logo\.svg/.test(marks)
    && fs.existsSync(path.join(__dirname, '../src/assets/marks/apple.svg')) && fs.existsSync(path.join(__dirname, '../src/assets/marks/google.svg')))
  check('the Calendar row\'s mark always shows, in its row; the others follow the setting and go to their card\'s banner',
    /<FieldMark always goes=/.test(src('src/shared/components/plan-modal/OptionsSection.tsx'))
    && /const toCard = !!register && !always && !refused/.test(marks) && /if \(toCard \|\| \(!on && !always && !refused\)\) return null/.test(marks))
  const rows = src('src/shared/components/plan-modal/ItemRows.tsx')
  check('every titled card draws its rows\' marks as one banner, tucked behind it (isolate, -z-10), adding no height',
    /<section className="relative isolate flex flex-col gap-1\.5">/.test(rows) && /\{title && <CardBanner marks=\{marks\} \/>\}/.test(rows)
    && /mark-banner absolute -top-2 right-3 -z-10/.test(marks) && /if \(!on \|\| !places\.length\) return null/.test(marks))
  check('…the banner comes after the card\'s heading (read and tabbed to after it)',
    rows.indexOf('<h3 className="section-label') > 0 && rows.indexOf('<h3 className="section-label') < rows.indexOf('<CardBanner marks='))
  const formSrc = src('src/shared/components/plan-modal/ItemForm.tsx')
  check('…the untitled title card has no banner of its own (only a grey sliver showed): its mark — and the untitled category fields\' — join the next card\'s (Location, else Time)',
    /<Section marksTo=\{titleMarks\.register\}>/.test(formSrc) && (formSrc.match(/<Section marksTo=\{titleMarks\.register\}>/g) || []).length === 2
    && /<Section title="Location" carried=\{titleMarks\.marks\}>/.test(formSrc)
    && /<Section title="Time" carried=\{slotFields \? undefined : titleMarks\.marks\}>/.test(formSrc)
    && /const marks = carried\?\.length \? \[\.\.\.carried, \.\.\.own\.marks\] : own\.marks/.test(rows) && /const register = marksTo \?\? \(title \? own\.register : null\)/.test(rows))
  check('…a tap on the banner says where the rows go; its fade-in and hover fade only under useMotion()', /onClick=\{e => show\(e\.currentTarget, text\)\}/.test(marks)
    && /motion && 'mark-banner-motion motion-pop-in'/.test(marks))
  const css = src('src/index.css')
  check('…its look is tokens only, light and dark (opacity, shadow); the dark shadow is a light halo (a black one is lost on the dark sheet); the hover transition only in .mark-banner-motion',
    (css.match(/--mark-banner-opacity:/g) || []).length === 2 && (css.match(/--mark-banner-shadow:/g) || []).length === 2
    && /\.mark-banner \{ opacity: var\(--mark-banner-opacity\); \}/.test(css) && /\.mark-banner-motion \{ transition: opacity 150ms ease-out; \}/.test(css)
    && /drop-shadow\([^)]*var\(--mark-banner-shadow\)\)/.test(css) && /--mark-banner-shadow:\s+rgba\(203, 213, 225, 0\.4\)/.test(css))
  const form = src('src/shared/components/plan-modal/ItemForm.tsx')
  check('Apple\'s headers, and no ✨ yet (step 4); no Invitees until they work', ['"Location"', '"Time"', '"Options"', '"Details"', '"Planning"'].every(h => form.includes(`title=${h}`))
    && !form.includes('title="Invitees"') && !/Sparkles/.test(form))
  const time = src('src/shared/components/plan-modal/TimeSection.tsx')
  check('Repeat shows its next dates for every choice', /alwaysPreview/.test(time))
  check('the timeline reads the day as Daily does (buildDaySchedule), without this item', /buildDaySchedule\(/.test(src('src/shared/components/plan-modal/DayTimeline.tsx')))
}

console.log('\n== 8. Step 2: the calendar fields\' rows (193) ==')
{
  const g = (field, target, app = 'apple', dated = true) => R.fieldGoes(field, { target, calendarApp: app, dated })
  check('the alerts and Show As go to the item\'s calendar (Apple Calendar)', ['alerts', 'showAs'].every(f => g(f, 'calendar') === 'apple' && g(f, 'both') === 'apple'))
  check('…a Google Task has neither, nor an item on no calendar', ['alerts', 'showAs'].every(f => g(f, 'tasks') === 'app' && g(f, 'none') === 'app' && g(f, 'calendar', 'apple', false) === 'app' && g(f, 'calendar', 'none') === 'app'))
  check('the link and the travel time go to Apple Calendar only',
    ['url', 'travel'].every(f => g(f, 'calendar') === 'apple' && g(f, 'both') === 'apple' && g(f, 'calendar', 'none') === 'app' && g(f, 'tasks') === 'app'))
  check('End Repeat goes where the repeat goes (Google Tasks: one task per day, so it stops them there)',
    g('repeatEnd', 'calendar') === 'apple' && g('repeatEnd', 'tasks') === 'google-tasks' && g('repeatEnd', 'none') === 'app')

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
  check('the "Opens <host>" line always shows the whole host (break-all), so a long look-alike can\'t hide the real domain',
    /<p className="[^"]*break-all[^"]*">Opens <bdi/.test(rows))
  check('a host longer than DNS allows is never offered to open, and a huge paste is refused before it is parsed',
    R.openableUrl('https://' + 'a'.repeat(63) + '.' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(63) + '.example/') === null
    && 'problem' in require('../src/features/items/itemCalendarFields').cleanItemUrl('https://example.com/' + 'x'.repeat(10000)))
  const form = src('src/shared/components/plan-modal/ItemForm.tsx')
  const time = src('src/shared/components/plan-modal/TimeSection.tsx')
  const end = src('src/shared/components/plan-modal/EndRepeatRows.tsx')
  const sheet = src('src/shared/components/plan-modal/UnifiedPlanModal.tsx')
  check('every row changes its field through withCalendarField (an edit sends what the owner changed)',
    ['alerts', 'showAs', 'url', 'travelMinutes'].every(k => form.includes(`withCalendarField(form, '${k}'`)) && time.includes("withCalendarField(form, 'repeatEnd'"))
  check('Travel Time, Alert, Second Alert, Show As and URL show only where a slot or a repeat keeps them; End Repeat only under a repeat',
    (form.match(/\{slotFields && \(/g) || []).length === 3 && /\{repeating && \(\s*<EndRepeatRows/.test(time))
  check('the choices and words are itemCalendarFields\' (Apple\'s lists)', /alertChoices\(allDay\)/.test(rows) && /TRAVEL_CHOICES\.map/.test(rows) && /alertsOf\(\{/.test(rows) && /repeatEndLabel\(end\)/.test(end))
  check('the link opened is only openableUrl\'s, in a new tab without the opener or referrer, after its address shows',
    /const href = openableUrl\(url\)/.test(rows) && /<a href=\{href\} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"/.test(rows)
    && rows.indexOf('hostOf(href)') < rows.indexOf('<a href={href}') && (rows.match(/<a /g) || []).length === 1)
  check('a link or an End Repeat that can\'t be saved stops the save (Add and the autosave) and says why', /\?\? urlProblem\(f\) \?\? repeatEndIssue\(f, \{ item, today \}\)/.test(sheet) && /if \(problem\) \{ toast\.error\(problem\); return \}/.test(sheet))
  check('Apple\'s mark is a quoted url() (a build inlines it as a data URI with \' in it)', /const mask = `url\("\$\{appleMark\}"\)`/.test(src('src/shared/components/plan-modal/FieldMark.tsx')))
}

console.log('\n== 9. The cleanup after steps 1 and 2 (11.11.2026) ==')
{
  // A saved weekly repeat's Ends row shows times only: an end at or before the start is the next day.
  check('no day shown: an end before the start is the next day', same(R.endOnWheel('2026-11-12', '22:00', '00:30', false), { date: '2026-11-13', time: '00:30' }))
  check('…the start itself is a whole day later', same(R.endOnWheel('2026-11-12', '22:00', '22:00', false), { date: '2026-11-13', time: '22:00' }))
  check('…a later end stays on the day', same(R.endOnWheel('2026-11-12', '22:00', '23:15', false), { date: '2026-11-12', time: '23:15' }))
  check('the day shown: the wheel keeps the day picked', same(R.endOnWheel('2026-11-12', '22:00', '00:30', true), { date: '2026-11-12', time: '00:30' }))
  check('a weekly repeat 22:00 → 00:30 is stored as 150 minutes', same(F.withEnd({ date: '2026-11-12', time: '22:00' }, R.endOnWheel('2026-11-12', '22:00', '00:30', false)), { duration: 150, badEnd: null }))

  const g = (field, target, app = 'apple') => R.fieldGoes(field, { target, calendarApp: app, dated: true })
  check('a timed Google Task: its day goes to Google Tasks, its time of day stays in the app', g('time', 'tasks') === 'google-tasks' && g('clock', 'tasks') === 'app' && g('clock', 'none') === 'app')
  check('…on a calendar the time goes there', g('clock', 'calendar') === 'apple' && g('clock', 'both') === 'apple' && g('clock', 'calendar', 'none') === 'app')
  const time = src('src/shared/components/plan-modal/TimeSection.tsx')
  check('the time rows (All-day, Starts with a time, Ends, Time Zone) carry the clock\'s mark; the Date row the day\'s',
    /label="All-day" mark=\{clockMark\}/.test(time) && /label="Starts" mark=\{form\.time \? clockMark : timeMark\}/.test(time) && /label="Ends" mark=\{clockMark\}/.test(time)
    && /label="Time Zone" mark=\{clockMark\}/.test(time) && /label="Date" mark=\{timeMark\}/.test(time))

  const IR = require('../src/features/items/itemRules')
  check('the Date row names the section the save files it in: an undated edit keeps its own',
    IR.sectionForItem({ date: null }, '2026-11-11', 'backlog') === 'backlog' && IR.sectionForItem({ date: null }, '2026-11-11', 'this_week') === 'backlog'
    && IR.sectionForItem({ date: null }, '2026-11-11', null) === 'inbox' && IR.sectionForItem({ date: '2026-11-11' }, '2026-11-11', 'backlog') === 'today')
  check('…and the screen asks it with the task\'s section', /sectionForItem\(\{ date: form\.date \}, today, savedSection\)/.test(time) && /savedSection=\{task\?\.section\}/.test(src('src/shared/components/plan-modal/UnifiedPlanModal.tsx')))

  const tl = src('src/shared/components/plan-modal/DayTimeline.tsx')
  check('an all-day item gets the compact band, not the hour-by-hour timeline', /export function AllDayBand/.test(tl) && /<AllDayBand day=\{timelineDay\}/.test(time) && /\{form\.time \? \(\s*<DayTimeline/.test(time) && !/allDay/.test(tl.slice(tl.indexOf('export function DayTimeline'), tl.indexOf('export function AllDayBand'))))
  check('the Repeat panel doesn\'t say the summary its row already says', /\.\.\.\(alwaysPreview \? \[\] : \[<span key="s"/.test(src('src/shared/components/plan-modal/fields.tsx')))

  const types = src('src/shared/components/plan-modal/planModal.types.ts')
  const callers = require('child_process').execSync("grep -rln \"heading: '\" src --include=*.ts --include=*.tsx || true", { cwd: path.join(__dirname, '..') }).toString()
  check('config.heading is gone: no field, no reader, no caller', !/\bheading\?:/.test(types)
    && !/config\?\.heading/.test(src('src/shared/components/plan-modal/PlanEntityModals.tsx'))
    && !/(training|media|games|work|wishes|todo|daily|shop)\/.*\.tsx?/.test(callers.split('\n').filter(f => !/statsDrill|YearDrill/.test(f)).join('\n')))

  const form = src('src/shared/components/plan-modal/ItemForm.tsx')
  check('a new item\'s title takes the focus on a touch screen too (the dialog leaves it there)', /if \(!autoFocus\) return\s*\n\s*const id = window\.setTimeout\(\(\) => \{ if \(document\.activeElement !== ref\.current\) ref\.current\?\.focus/.test(form))

  // Undo changes: the form as it opened, every changed field marked so the save sends it back.
  const opened = F.buildInitialForm({ mode: 'task', today: '2026-11-11', nextTime: '18:00' })
  const now = { ...opened, title: 'Changed', place: { name: 'Jernbanetorget' }, placeTouched: true, url: 'https://example.com', calendarTouched: ['url'], shown: ['notes', 'list'] }
  const back = F.revertedForm(opened, now)
  check('Undo changes puts every value back', F.formValuesKey(back) === F.formValuesKey(opened) && back.title === opened.title && back.place === opened.place)
  check('…and keeps what was touched, so the save sends those fields back', back.placeTouched && back.calendarTouched.includes('url') && !back.shown.includes('list'))
  check('touching alone is no change of values', F.formValuesKey({ ...opened, labelsTouched: true, calendarTouched: ['alerts'] }) === F.formValuesKey(opened))
  const sheet = src('src/shared/components/plan-modal/UnifiedPlanModal.tsx')
  check('…offered after a save, never after a This day / All days switch, and sent at once (held or not)',
    /autosave\.savedOnce && form\.scope === openedForm\.scope/.test(sheet) && /void autosave\.saveNow\(back, problemOf\(back\)\)/.test(sheet))

  // Back, a failed save, Stay: the entry goes back, so the next Back closes the screen again.
  const hist = src('src/shared/hooks/useHistoryDismiss.ts')
  check('a close that stayed open (false) puts its history entry back', /rearmIfStayed\(overlay, overlay\.close\(\)\)/.test(hist)
    && /if \(stayedOpen !== false \|\| !overlay\.alive \|\| stack\.includes\(overlay\)\) return/.test(hist) && /overlay\.alive = false/.test(hist))
  check('…the item screen answers false on Stay, and ModalShell hands the answer on', /if \(!leave\) return false/.test(sheet) && /onClose=\{requestClose\}/.test(sheet)
    && /const close = \(\) => \(dismissible \? onClose\(\) : undefined\)/.test(src('src/shared/modals/ModalShell.tsx')))

  // A problem is said once the typing pauses or the field is left — a link being typed never flashes "Not saved".
  const auto = src('src/shared/components/plan-modal/useItemAutosave.ts')
  check('the autosave says a problem only for a form left unchanged for the wait, or when a field is left',
    /dirty && problem \? \(key === judgedKey \? \{ kind: 'blocked', reason: problem \} : \{ kind: 'idle' \}\)/.test(auto)
    && /setJudgedKey\(key\), AUTOSAVE_DELAY_MS/.test(auto) && /onBlur=\{autosave\.settle\}/.test(sheet))

  // An all-day item's alerts (193).
  const CF = require('../src/features/items/itemCalendarFields')
  check('all day, a timed alert reads as the day it falls on (what the calendars write)', same(CF.alertsForKind([30], true), [0]) && same(CF.alertsForKind([30, 1440], true), [0, 1440])
    && same(CF.alertsForKind([5, 10], true), [0]) && same(CF.alertsForKind([1440], true), [1440]) && CF.alertsForKind(null, true) === null && same(CF.alertsForKind([30], false), [30]))
  check('a saved all-day item with a timed alert opens on the choice it is', same(F.buildInitialForm({ mode: 'task', today: '2026-11-11', nextTime: '18:00',
    item: { taskId: 't', blockId: 'b', scheduleBlockId: null, title: 'Day', date: '2026-11-12', time: null, durationMinutes: null, google: 'calendar', alerts: [30] } }).alerts, [0]))
  check('the All-day switch drops an alert within the day (none left: Default), keeps a day or more before', same(CF.alertsOnAllDaySwitch([30]), null)
    && same(CF.alertsOnAllDaySwitch([0, 1440]), [1440]) && same(CF.alertsOnAllDaySwitch([]), []) && CF.alertsOnAllDaySwitch(null) === null)
  const on = F.withAllDaySwitch({ googlePick: null, alerts: [30], calendarTouched: [] }, true, 'calendar', '18:00')
  check('…and marks it touched so an edit sends it', on.alerts === null && same(on.calendarTouched, ['alerts']))
  check('…nothing to change: nothing touched', !('alerts' in F.withAllDaySwitch({ googlePick: null, alerts: [1440], calendarTouched: [] }, true, 'calendar', '18:00')))

  // The agenda's and Training's week: a repeat's end.
  const rule = { days_of_week: [1, 3], effective_from: '2026-11-02', repeat_until: '2026-12-31' }
  check('a repeat with an end says "until" it, and "last time" on its last day', CF.repeatEndNote(rule, '2026-11-11') === 'until 31.12.2026' && CF.repeatEndNote(rule, '2026-12-31') === 'last time'
    && CF.repeatEndNote({ days_of_week: [1] }, '2026-11-11') === null && CF.repeatEndNote(null) === null)
  check('…on the agenda\'s repeat rows and Training\'s weekly schedule', /function RepeatMark/.test(src('src/features/daily/components/DayAgendaRows.tsx'))
    && /repeatEndNote\(t\)/.test(src('src/features/training/components/program/WeeklyScheduleCard.tsx')))

  // The red dot reads the queue's own answer for the item's row.
  const nowD = new Date('2026-11-11T12:00:00Z')
  const row = { icloud_area: null, updated_at: '2026-11-11T11:00:00Z' }
  const dot = (send, extra = {}) => R.appleDot({ wanted: true, row, send, now: nowD, ...extra })
  check('sent or kept now: no dot', dot({ item: { status: 'sent', error: null, retryAt: null }, problem: null, busy: false }) === null
    && dot({ item: { status: 'kept', error: null, retryAt: null }, problem: null, busy: false }) === null)
  check('failed: the dot says the queue\'s own reason', /Apple refused the password · Settings → Subscriptions/.test(dot({ item: { status: 'failed', error: 'Apple did not accept the Apple ID or app-specific password', retryAt: null }, problem: null, busy: false })))
  check('not queued, or its calendar doesn\'t go there: the dot says so', /nothing is queued/.test(dot({ item: { status: 'not-queued', error: null, retryAt: null }, problem: null, busy: false }))
    && /doesn't go there/.test(dot({ item: { status: 'none', error: null, retryAt: null }, problem: null, busy: false })))
  check('the send itself failed: why', /no connection to the server/.test(dot({ item: null, problem: 'Failed to fetch', busy: false })))
  check('another send was running: the row\'s guess, with the account\'s newest reason', /iCloud error 500/.test(dot({ item: null, problem: null, busy: true }, { notSent: { count: 2, reason: 'iCloud answered 500 when an event was written' } }))
    && dot({ item: null, problem: null, busy: true }, { row: { icloud_area: null, updated_at: '2026-11-11T11:59:30Z' } }) === null)
  check('Apple has it, or it isn\'t meant for Apple: no dot', R.appleDot({ wanted: true, row: { icloud_area: 'personal' }, send: null, now: nowD }) === null
    && R.appleDot({ wanted: false, row, send: { item: { status: 'failed', error: 'x', retryAt: null }, problem: null, busy: false }, now: nowD }) === null)
  check('…asked once per version of the row, named so it goes first', /useAppleItemSend\(appleRef, liveRow\?\.updated_at\)/.test(sheet)
    && /drainICloudNow\(\{ items: \[ref as DrainItemRef\] \}\)/.test(src('src/features/calendar/areas/useAppleItemSend.ts')))
}

console.log('\n== 10. Step 3: one screen for everything ==')
{
  const sheet = src('src/shared/components/plan-modal/UnifiedPlanModal.tsx')
  // The training session's Edit tab (owner's answer 2).
  const SR = require('../src/features/training/sessionRef')
  check('a planned session\'s Edit tab opens its task, its block, or the weekly plan on that day (This day | All days)',
    same(SR.sessionItemRequest({ kind: 'task', taskId: 't1', blockId: 'b1' }), { kind: 'task', id: 't1' })
    && same(SR.sessionItemRequest({ kind: 'block', blockId: 'b1' }), { kind: 'time-block', id: 'b1' })
    && same(SR.sessionItemRequest({ kind: 'weekly', templateId: 'p1', date: '2026-11-12' }), { kind: 'schedule-block', id: 'p1', occurrenceDate: '2026-11-12', startScope: 'day', defaults: { date: '2026-11-12' } }))
  const view = src('src/features/training/components/session/TrainingSessionView.tsx')
  check('…inside the session popup, through the same adapters; closing or leaving the tab saves what waits first',
    /<ItemScreenEmbedContext\.Provider value=\{editHandle\}>/.test(view) && /<ItemScreenFor request=\{editRequest\} onClose=\{onClose\} \/>/.test(view)
    && /editing && editHandle\.current \? editHandle\.current\.requestClose\(\) : onClose\(\)/.test(view) && /const done = await editHandle\.current\.flush\(\)/.test(view))
  check('the screen embedded draws no chrome of its own and hands the host its close and flush',
    /if \(embedRef\) \{/.test(sheet) && /embedRef\.current = \{ requestClose, flush: autosave\.flush \}/.test(sheet))

  // Games' two copies, and nobody else, mount the screen directly no more.
  const mounts = require('child_process').execSync("grep -rln '<UnifiedPlanModal' src --include=*.tsx || true", { cwd: path.join(__dirname, '..') }).toString().trim().split('\n').filter(Boolean)
  check('only the plan-modal folder mounts UnifiedPlanModal (Games\' two copies open it through useEntityModal)',
    // Since 211 both plan a game through THE Plan helper (usePlanThis → useEntityModal; verify-plan-this).
    mounts.every(f => f.startsWith('src/shared/components/plan-modal/')) && /<PlanThingButton thing=\{\{ kind: 'game'/.test(src('src/features/games/components/GameDetailModal.tsx'))
    && /planSession: \(g\) => \{ void planThis\(\{ kind: 'game'/.test(src('src/features/games/test-game/TestGamePage.tsx')), mounts.join(', '))

  // The quick adds: the one parser, the one item save; Open takes the text to the item screen.
  const S = require('../src/features/items/sheetRules')
  const Q = require('../src/features/items/quickAdd')
  const work = S.itemFromQuickAdd('Review 14:00', Q.parseQuickAdd('Review 14:00', '2026-11-11'), '2026-11-11', false, false, 'work')
  check('Work\'s quick add makes a Work item, read as typed', work.domain === 'work' && work.time === '14:00' && work.title === 'Review' && work.date === '2026-11-11')
  check('…the search bar\'s a Personal one, as before', S.itemFromQuickAdd('Call Ola', null, '2026-11-11', false).domain === 'personal')
  const quick = src('src/features/items/useQuickAdd.ts')
  check('Work\'s and the search bar\'s quick add go through useQuickAdd (one item save), never a bare task create',
    /useQuickAdd\('work'\)/.test(src('src/features/work/components/WorkToolbar.tsx')) && /useQuickAdd\('personal'\)/.test(src('src/shared/components/CommandPalette.tsx'))
    && !/useCreateTask/.test(src('src/shared/components/CommandPalette.tsx')) && !/useCreateTask/.test(src('src/features/work/pages/WorkPage.tsx'))
    && /save\.mutateAsync\(input\)/.test(quick))
  check('…Open takes the text to the item screen, whose title reads it (defaults.typed)', /typed: t/.test(quick)
    && /const read = parseQuickAdd\(text, today\)\n\s*const applied = applyQuickAdd\(f, \{\}, null, read, today\)/.test(sheet))

  // Waiting for, Parent and List: rows; a single task's menu opens the screen at the row.
  const rows = src('src/shared/components/plan-modal/TaskRows.tsx')
  check('Waiting for saves through the one status action; Parent through ParentPicker (useSetParentTask, Google\'s one level)',
    /act\.setStatus\(task, on \? 'waiting' : 'open', \{ waitingFor: on \? shown\.trim\(\) : '' \}\)/.test(rows) && /<ParentPicker task=\{task\}/.test(rows) && /useSetParentTask\(\)/.test(src('src/features/todo/components/ParentPicker.tsx')))
  check('…only on an edit of a task (not a repeat\'s rule or its day)', /taskId=\{repeating \|\| day \? null : taskId\}/.test(src('src/shared/components/plan-modal/ItemForm.tsx'))
    && /taskId=\{scheduleBlock \? null : task\?\.id\}/.test(sheet))
  const item = src('src/features/todo/components/ToDoItem.tsx')
  check('"Set parent…" and "Move to list…" open the screen at the row; Work\'s Waiting chip too',
    /onSetParent: \(\) => act\.edit\(task, 'parent'\)/.test(item) && /opensListRow\(task, googleConnected\) \? act\.edit\(task, 'list'\) : setPickingList\(true\)/.test(item)
    && /onEdit\(task, 'waiting'\)/.test(src('src/features/work/components/WorkTaskCard.tsx'))
    && !fs.existsSync(path.join(__dirname, '../src/features/todo/components/SetParentTaskSheet.tsx')))
  check('the List row opens only where the screen shows it: a task on Google Tasks, Google here',
    R.opensListRow({ google_target: 'tasks' }, true) && R.opensListRow({ google_target: 'both' }, true) && R.opensListRow({ google_target: null, google_sync_enabled: true }, true)
    && !R.opensListRow({ google_target: 'tasks' }, false) && !R.opensListRow({ google_target: 'calendar' }, true) && !R.opensListRow({ google_target: 'none' }, true))
  check('the screen opens at the row it was asked for (config.openRow: an editor, or the List row\'s own list)',
    /useState<PanelKey \| null>\(config\?\.openRow && config\.openRow !== 'list' \? config\.openRow : null\)/.test(src('src/shared/components/plan-modal/ItemForm.tsx'))
    && /openOnMount=\{config\?\.openRow === 'list'\}/.test(src('src/shared/components/plan-modal/ItemForm.tsx')))

  // The Google event editor went with Google Calendar (25.11.2026): nothing opens or edits a Google Calendar event.
  check('no Google Calendar event editor is left', !require('fs').existsSync(require('path').join(__dirname, '../src/features/calendar/components/EditCalendarEventModal.tsx'))
    && !/EditCalendarEventModal/.test(src('src/features/daily/components/DayAgenda.tsx')))
}

console.log('\n== 11. The category at the top and its add-on fields (owner, 27.11.2026; 215) ==')
{
  const form = src('src/shared/components/plan-modal/ItemForm.tsx')
  const planning = src('src/shared/components/plan-modal/PlanningSection.tsx')
  const det = src('src/shared/components/plan-modal/DetailsSection.tsx')
  const sheet = src('src/shared/components/plan-modal/UnifiedPlanModal.tsx')
  // "bring category to top on the task screen": in the title card, right under the title (and its Read as line).
  const title = form.indexOf('<Section marksTo={titleMarks.register}>')
  const cat = form.indexOf('<CategoryRow form={form}')
  const titleEnd = form.indexOf('</Section>', title)
  check('the Category row is in the title card, under the title and its Read as line — for every item (not only a timed one)',
    title > 0 && cat > form.indexOf('<TitleField', title) && cat > form.indexOf('<ReadAsLine', title) && cat < titleEnd
    && /const showCategory = !isScheduleFieldHidden\('category', config\)/.test(form) && !/const showCategory = !!form\.time/.test(form))
  check('…and only there: Planning has no Category of its own (moved, never copied)',
    !/Category/.test(planning.replace(/\/\/.*$/gm, '')) && (form.match(/<CategoryRow /g) || []).length === 1)
  check('…one line: a row whose 8 categories open in the shared field list under it (owner, 28.11.2026)',
    /<SelectRow<TimeBlockCategory> label="Category" mark=\{mark\} value=\{form\.category\} options=\{CATEGORY_CHOICES\}/.test(det)
    && /const CATEGORY_CHOICES = CATEGORIES\.map\(c => \(\{ value: c, label: CATEGORY_LABELS\[c\] \}\)\)/.test(det))
  check('the category\'s add-on fields come right after it (the next card), from the registry, never for a repeat\'s rule',
    form.indexOf('{details && (') > titleEnd && form.indexOf('{details && (') < form.indexOf('{slotFields && (')
    && /const details = showCategory && !\(repeating && !day\) \? detailsOf\(form\.category\) : null/.test(form))
  // Every way in renders the one form: Add, Edit, quick add (defaults.typed) and the training session's Edit tab (itemScreenEmbed).
  const forms = require('child_process').execSync("grep -rln '<ItemForm' src --include=*.tsx || true", { cwd: path.join(__dirname, '..') }).toString().trim().split('\n').filter(Boolean)
  const others = require('child_process').execSync("grep -rln '<CategoryRow\\|<DetailsSection' src --include=*.tsx || true", { cwd: path.join(__dirname, '..') }).toString().trim().split('\n').filter(Boolean)
  check('…every way the screen opens draws them (Add, Edit, a quick add\'s Open, the training session\'s Edit tab): one ItemForm, rendered only by UnifiedPlanModal',
    same(forms, ['src/shared/components/plan-modal/UnifiedPlanModal.tsx']) && same(others, ['src/shared/components/plan-modal/ItemForm.tsx'])
    && /if \(embedRef\) \{[\s\S]*?\{body\}/.test(sheet) && /const text = !item && defaults\?\.typed\?\.trim\(\)/.test(sheet))
  check('…a training session keeps its category hidden (its day and time are the session\'s, 142 — v21.2)',
    /hideScheduleFields: \[\.\.\.new Set\(\[\.\.\.\(config\?\.hideScheduleFields \?\? \[\]\), 'category'\]/.test(src('src/shared/components/plan-modal/PlanEntityModals.tsx')))
  // A form through the screen's own rules: a category change starts its own fields and marks them touched.
  const f0 = F.buildInitialForm({ mode: 'schedule', today: '2026-11-27', nextTime: '19:00', defaults: { category: 'daily' } })
  const toMedia = { ...f0, ...F.withDetails(f0, { category: 'media' }) }
  check('a new item picked Media: Movie first, nothing filled, touched (so it is saved)',
    toMedia.category === 'media' && toMedia.details.type === 'movie' && toMedia.detailsTouched && toMedia.details.with.length === 0)
  check('…the section has no heading: the Category row right above names it', /\{details && \(\n\s*\/\/[^\n]*\n\s*<Section marksTo=\{titleMarks\.register\}>/.test(form))
  const filled = { ...toMedia, ...F.withDetails(toMedia, { details: { with: ['Ola'], seats: 'H1', type: 'cinema' } }) }
  const toGames = { ...filled, ...F.withCategory(filled, 'games') }
  check('…another category keeps the values on the screen (switching back finds them); the save keeps only what fits',
    toGames.details.seats === 'H1' && same(F.detailsOf(toGames), { category: 'games', with: ['Ola'] })
    && F.detailsOf({ ...toGames, ...F.withCategory(toGames, 'media') }).seats === 'H1')
  const cinema = { ...toMedia, ...F.withDetails(toMedia, { details: { type: 'cinema', with: ['Ola'], cost: '149,50', seats: 'H12', booking: 'AB12' } }) }
  check('…a cinema trip saves its type, with who, cost, seats and booking as the database keeps them',
    same(F.detailsOf(cinema), { category: 'media', type: 'cinema', with: ['Ola'], cost: { amount: 149.5, currency: 'NOK' }, seats: 'H12', booking: 'AB12' }))
  check('…a movie at home keeps no cost, seats or booking (cinema only)',
    same(F.detailsOf({ ...cinema, details: { ...cinema.details, type: 'movie' } }), { category: 'media', type: 'movie', with: ['Ola'] }))
  check('…a cost that isn\'t an amount stops the save', F.detailsProblem({ ...cinema, details: { ...cinema.details, cost: '12,345' } }) === 'Cost is an amount like 149 or 149.50'
    && F.detailsProblem(cinema) === null && /\?\? detailsProblem\(f\)\)/.test(sheet))
  const input = F.inputFromForm({ ...cinema, title: 'Cinema', link: { kind: 'movie', id: '00000000-0000-4000-8000-000000000001' }, linkTouched: true },
    { googleConnected: false, today: '2026-11-27' })
  check('the save sends the details and the picked movie with the item (one save: p_details, p_link)',
    input.details?.type === 'cinema' && same(input.link, { kind: 'movie', id: '00000000-0000-4000-8000-000000000001' }))
  const edit = { taskId: 't1', title: 'Old task', domain: 'personal', priority: 'medium', date: null, time: null, durationMinutes: null, google: 'none' }
  const fe = F.buildInitialForm({ mode: 'task', today: '2026-11-27', nextTime: '19:00', item: edit })
  check('an edit of an older item that never had details sends none (absent = keep)', !('details' in F.inputFromForm({ ...fe, notes: 'x' }, { item: edit, googleConnected: false, today: '2026-11-27' })))
  const withD = { ...edit, details: { category: 'games', on: 'RP6' } }
  const fg = F.buildInitialForm({ mode: 'task', today: '2026-11-27', nextTime: '19:00', item: withD, link: { kind: 'game', id: '00000000-0000-4000-8000-000000000002' } })
  check('…one with details opens in its category with them (a slotless item keeps its category there) and sends them back',
    fg.category === 'games' && fg.details.on === 'RP6' && same(F.inputFromForm(fg, { item: withD, googleConnected: false, today: '2026-11-27' }).details, { category: 'games', on: 'RP6' }))
  check('…the saved link is never re-sent unless another was picked or it was taken off (210: absent = keep)', !('link' in F.inputFromForm(fg, { item: withD, googleConnected: false, today: '2026-11-27' })))
  // One source for the category (review, 27.11.2026): a repeat whose category changed to Games, its day's details saved
  // under Media — the day opens as Games with the old values kept, and saves only Games' fields.
  const dayItem = { ...edit, details: { category: 'media', type: 'cinema', with: ['Ola'], seats: 'H1' } }
  const fd = F.buildInitialForm({ mode: 'task', today: '2026-11-27', nextTime: '19:00', item: dayItem, category: 'games' })
  check('a repeat\'s category changed and its day\'s details have the old one: the repeat\'s decides, the old values stay on the screen, the save keeps what fits',
    fd.category === 'games' && fd.details.seats === 'H1' && fd.details.type === 'cinema'
    && same(F.inputFromForm(fd, { item: dayItem, googleConnected: false, today: '2026-11-27' }).details, { category: 'games', with: ['Ola'] }))
  // A link taken off (215): the ×, a category that can't hold it, a type that can't.
  const linkedForm = F.buildInitialForm({ mode: 'task', today: '2026-11-27', nextTime: '19:00', item: withD, link: { kind: 'game', id: '00000000-0000-4000-8000-000000000002' } })
  const off = { ...linkedForm, link: null, linkTouched: true, detailsTouched: true }
  const offInput = F.inputFromForm(off, { item: withD, googleConnected: false, today: '2026-11-27' })
  check('an edit\'s × takes the game off: the save sends link null (215\'s "none") with the details', offInput.link === null && offInput.details !== undefined)
  const toWork = { ...linkedForm, ...F.withCategory(linkedForm, 'work') }
  check('…a category that can\'t hold the game takes it off too; one that can keeps it', toWork.link === null && toWork.linkTouched
    && F.withCategory(linkedForm, 'games').link === undefined)
  const shopLinked = { ...linkedForm, link: { kind: 'shop_item', id: '00000000-0000-4000-8000-000000000003' } }
  check('…a shop thing (no category\'s) stays whatever the category', F.withCategory(shopLinked, 'media').link === undefined)
  const movieForm = { ...toMedia, link: { kind: 'movie', id: '00000000-0000-4000-8000-000000000001' } }
  check('…Media\'s type TV takes a movie off; Cinema keeps it', F.withMediaType(movieForm, 'tv').link === null && F.withMediaType(movieForm, 'cinema').link === undefined)
  check('a new item\'s × sends nothing (no saved link to take off)', !('link' in F.inputFromForm({ ...toMedia, title: 'x', link: null, linkTouched: true }, { googleConnected: false, today: '2026-11-27' })))
  check('a TMDB title is added to the library inside the save, never on pick (a cancelled screen leaves nothing behind)',
    /const added = await withTitleAdded\(f\)/.test(sheet) && /const f = await withTitleAdded\(form\)/.test(sheet)
    && !/useLibraryEntryForPlan/.test(src('src/shared/components/plan-modal/DetailsSection.tsx')))
  check('the Linked chip follows a link taken off here', /const linked = form\.linkTouched \? screenLinkOf\(null, form\.link\)/.test(sheet))
  check('a cinema trip\'s Cinema is the item\'s one place: its row in the category\'s fields, Location keeping only Travel Time',
    /\{!cinema && <PlaceRow/.test(form) && /label="Cinema"/.test(src('src/shared/components/plan-modal/DetailsSection.tsx'))
    && F.detailsOf({ ...filled, place: { name: 'Ringen kino' } }).cinema === 'Ringen kino')
  check('…a saved cinema with no slot opens as its place', F.buildInitialForm({ mode: 'task', today: '2026-11-27', nextTime: '19:00',
    item: { ...edit, details: { category: 'media', type: 'cinema', cinema: 'Ringen kino' } } }).place?.name === 'Ringen kino')
  check('a saved cost shows as typed with a comma ("149,50")', F.costText(149.5) === '149,50' && F.costText(149) === '149')
  const rep = F.buildInitialForm({ mode: 'recurring', today: '2026-11-27', nextTime: '19:00', defaults: { category: 'media' } })
  check('a repeat\'s rule sends no details (it has no task of its own)', !('details' in F.inputFromForm({ ...rep, title: 'x' }, { googleConnected: false, today: '2026-11-27' })))
}


console.log('\n== 12. The screen\'s look on a phone (owner, 27.11.2026: "Things dont stand where they have to") ==')
{
  const G = require('../src/shared/components/plan-modal/wheelGeometry')
  const O = require('../src/shared/components/fieldOptionsRoom')
  // The wheel: a row in the band at every row height (text size, zoom) — 14:15 shows 14 and 15, never 18 : 20.
  const at = (row, view) => ({ first: view / 2 - row / 2, row, view })
  const geos = [at(32, 160), at(40, 200), at(25.6, 128), at(35.2, 176), { first: 64, row: 32, view: 160 }]
  check('the wheel: each row\'s offset puts that row back in the band, at every row height and column height',
    geos.every(g => Array.from({ length: 24 }, (_, i) => i).every(i => G.wheelIndexAt(G.wheelTopOf(i, g), g, 24) === i)))
  check('…14:15 is 14 and 15 (index 3 of the five-minute steps) in the band, with the text 125 % larger too',
    [at(32, 160), at(40, 200)].every(g => G.wheelIndexAt(G.wheelTopOf(14, g), g, 24) === 14 && G.wheelIndexAt(G.wheelTopOf(3, g), g, 12) === 3))
  check('…an offset between two rows reads the nearer one; past the ends the first or last', G.wheelIndexAt(32 * 5 + 15, at(32, 160), 24) === 5 && G.wheelIndexAt(32 * 5 + 17, at(32, 160), 24) === 6
    && G.wheelIndexAt(-40, at(32, 160), 24) === 0 && G.wheelIndexAt(99999, at(32, 160), 24) === 23)
  const wheel = src('src/shared/components/plan-modal/TimeWheel.tsx')
  check('…the wheel measures its rows (no pixel constant), centres its band in CSS, and its bold row is the one read from the offset',
    !/const ROW = /.test(wheel) && /function geometryOf\(el: HTMLDivElement\)/.test(wheel) && /top-1\/2 h-8 w-36 -translate-x-1\/2 -translate-y-1\/2/.test(wheel)
    && (wheel.match(/h-\[calc\(50%-1rem\)\]/g) || []).length === 2 && /i === shown \? 'font-medium text-fg'/.test(wheel))
  check('…its offset is set with snapping off (no re-snap to another row) and set again after layout only while it opens — until it first settles or the owner touches it',
    /el\.style\.scrollSnapType = 'none'\n\s*el\.scrollTop = top/.test(wheel) && /new ResizeObserver\(again\)/.test(wheel)
    && /if \(!opening\.current \|\| turning\.current\) return/.test(wheel) && /settled = window\.setTimeout\(stop, 400\)/.test(wheel)
    && /const touch = \(\) => \{ turning\.current = true; opening\.current = false \}/.test(wheel))
  check('…after that a change from outside (a key, a tap, the timeline) glides it under useMotion — never cut short by a re-place',
    /if \(ready\) opening\.current = false\n\s*place\(index, ready && motion\)/.test(wheel) && /if \(smooth\) \{ el\.scrollTo\(\{ top, behavior: 'smooth' \}\); return \}/.test(wheel))

  // A field's list: under its field, sized to what the keyboard leaves; above only when even three rows don't fit.
  const vis = { top: 0, bottom: 520, safeTop: 59 }
  const fo = src('src/shared/components/FieldOptions.tsx') + src('src/shared/components/useOptionsRoom.ts')
  check('a list under a field with room for three rows stays under it, sized to the room above the keyboard',
    O.optionsMaxHeight({ top: 300, bottom: 340 }, vis, 8) === 520 - 12 - 348 - 4 && O.optionsMaxHeight({ top: 100, bottom: 140 }, vis, 8) === O.OPTIONS_CAP)
  check('…with less room under it than three rows, the larger side — above it, never into the status bar',
    O.optionsMaxHeight({ top: 300, bottom: 340 }, { ...vis, bottom: 400 }, 8) === 300 - 8 - (59 + 12) - 4 && O.optionsMaxHeight({ top: 300, bottom: 340 }, { top: 0, bottom: 400, safeTop: 0 }, 8) === 300 - 8 - 12 - 4)
  check('…and never a negative height', O.optionsMaxHeight({ top: 20, bottom: 515 }, vis, 8) === 0)
  check('…with too little room under it the field is scrolled up just enough for three rows, never past the status bar',
    O.optionsLift({ top: 300, bottom: 340 }, { ...vis, bottom: 400 }, 8) === 340 + 8 + O.OPTIONS_FLOOR + 12 + 4 - 400
    && O.optionsLift({ top: 100, bottom: 140 }, vis, 8) === 0 && O.optionsLift({ top: 80, bottom: 120 }, { ...vis, bottom: 200 }, 8) === 80 - 59 - 12)
  check('…FieldOptions scrolls the field up (at most twice) before it sizes the list', /const lift = optionsLift\(\{ top: r\.top, bottom: r\.bottom \}, visible, gap, want\)/.test(fo) && /lift > 0 && lifted < 2 \? scrollerOf\(el\) : null/.test(fo))
  check('…a list that wants more (a select\'s choices) moves its row up enough for them, still at most OPTIONS_CAP',
    O.optionsLift({ top: 300, bottom: 340 }, { ...vis, bottom: 600 }, 8, 260) === 340 + 8 + 260 + 12 + 4 - 600
    && O.optionsLift({ top: 300, bottom: 340 }, { ...vis, bottom: 600 }, 8, 9999) === 340 + 8 + O.OPTIONS_CAP + 12 + 4 - 600)
  const listSites = ['DetailsSection.tsx', 'PlaceRow.tsx', 'LabelsRow.tsx'].map(f => src(`src/shared/components/plan-modal/${f}`)).join('\n')
  check('…every list on the screen is a FieldOptions (no anchored ComboboxOptions of its own); it sets --anchor-max-height and its own max-height (Headless UI freezes the var into px) and reads the safe area at each measure',
    !/<ComboboxOptions/.test(listSites) && (listSites.match(/<FieldOptions field=\{field\}/g) || []).length === 5
    && /\{ \['--anchor-max-height' as string\]: `\$\{room\}px`, maxHeight: `\$\{room\}px` \}/.test(fo) && /style=\{roomStyle\(room\)\}/.test(fo)
    && !/let safeTop/.test(fo) && /safeTop: readSafeTop\(\)/.test(fo))

  // The phone's typing hints: no contact AutoFill on any typed field of the screen.
  const hints = require('../src/shared/components/plan-modal/fieldStyles').typingHints
  const h = hints('with', 'words')
  const prose = hints('notes', 'sentence', 'enter')
  check('typingHints: no AutoFill, a name that is no contact\'s; short values without autocorrect, prose with it; a search is type="search"',
    h.autoComplete === 'off' && h.name === 'item-with' && h.autoCorrect === 'off' && h.spellCheck === false && h.autoCapitalize === 'words'
    && hints('q-movie', 'search').type === 'search' && hints('q-movie', 'search').enterKeyHint === 'search' && !('type' in h)
    && prose.autoComplete === 'off' && prose.autoCorrect === 'on' && prose.spellCheck === true && prose.autoCapitalize === 'sentences' && prose.enterKeyHint === 'enter'
    && hints('list').autoCorrect === 'on' && hints('list').enterKeyHint === 'done')
  const screen = ['ItemForm', 'ItemFill', 'DetailsSection', 'PlaceRow', 'LabelsRow', 'OptionsSection', 'TaskRows', 'CalendarFieldRows', 'EndRepeatRows']
    .map(f => [f, src(`src/shared/components/plan-modal/${f}.tsx`)])
  const tags = screen.flatMap(([f, code]) => (code.match(/<(?:input|ComboboxInput|textarea)\b[\s\S]*?\/>/g) || []).map(t => [f, t]))
  const bare = tags.filter(([, t]) => !/typingHints|\{\.\.\.props\}/.test(t)).map(([f, t]) => `${f}: ${t.slice(0, 60)}`)
  check('…every typed field of the screen takes them, the title, Notes and ✨\'s sentence too', tags.length >= 15 && tags.filter(([, t]) => t.startsWith('<textarea')).length === 3 && bare.length === 0, bare.join(' | '))
  const words = tags.flatMap(([, t]) => [...t.matchAll(/(?:placeholder|aria-label|title)=(?:"([^"]*)"|\{([^}]*)\})/g)].map(m => m[1] ?? m[2]))
  check('…no field\'s words say "name" (iOS guesses contact fields from words too — untested on a device)', words.length > 10 && !words.some(w => /\bname\b/i.test(w)), words.filter(w => /\bname\b/i.test(w)).join(' | '))
  const det = src('src/shared/components/plan-modal/DetailsSection.tsx')
  check('With\'s placeholder is one short word in a field sized in em (it held "Add a nam" at 16px)',
    /placeholder="Add" maxLength=\{DETAIL_LIMITS\.name \+ 10\}/.test(det) && /input-bare w-\[3em\] pb-0 text-right text-lead transition-\[width\] focus:w-\[8em\]/.test(det) && !/Add a name/.test(det)
    && /placeholder="Title" maxLength=\{100\}/.test(src('src/shared/components/plan-modal/OptionsSection.tsx')))

  // Starts / Ends: the pills grow for their text, never cut ("Wed 25.11.2026" ran into 14:15).
  const rows = src('src/shared/components/plan-modal/ItemRows.tsx')
  check('the Starts / Ends pills are at least one width (in em: their text\'s, not the Display scale\'s) and grow for a wider text, never a fixed width that cuts it',
    /wide \? 'min-w-\[9\.6em\]' : 'min-w-\[4\.5em\]'/.test(rows) && /'inline-flex h-\[2\.125em\] shrink-0 [^']*px-\[0\.5em\] text-lead/.test(rows) && !/w-\[8\.5rem\]/.test(rows))

  // The timeline: whole hour labels, centred on their lines; the now line under the item's bar.
  const tl = src('src/shared/components/plan-modal/DayTimeline.tsx')
  check('the timeline: room for 00:00 and 24:00, labels centred over their ticks, one a scroller\'s edge would cut hidden — with its tick',
    /const INSET = 20/.test(tl) && /width: DAY_MINUTES \* PPM \+ 2 \* INSET/.test(tl) && /data-hour="" className="peer absolute top-0 -translate-x-1\/2/.test(tl)
    && /data-\[cut='1'\]:invisible/.test(tl) && /new IntersectionObserver\(/.test(tl) && /absolute bottom-0 top-\[16px\] w-px bg-line peer-data-\[cut='1'\]:invisible/.test(tl))
  check('…the now line over the day\'s other things and under the item\'s own bar (drawn between them)',
    tl.indexOf('{spans.map(s => {') > 0 && tl.indexOf('{spans.map(s => {') < tl.indexOf('rounded-full bg-danger') && tl.indexOf('rounded-full bg-danger') < tl.indexOf('role="slider"'))
  check('…the day strip\'s thumb maps the same 1440 minutes as its ticks (the room before 00:00 left out)',
    /const from = Math\.min\(Math\.max\(0, el\.scrollLeft - INSET\), day\)/.test(tl) && /const f = s\.clientWidth \/ day/.test(tl))
  check('…its browser audit exists (clipped, overlapping, covered, cut placeholders, outside the screen, the wheel)',
    fs.existsSync(path.join(__dirname, 'audit-item-screen.mjs')) && /function inspect\(\)/.test(src('scripts/audit-item-screen.mjs')) && /function wheels\(\)/.test(src('scripts/audit-item-screen.mjs'))
    && /function keyboardList\(/.test(src('scripts/audit-item-screen.mjs')))
}


console.log('\n== 13. Every dropdown on the item screen is the shared field list (owner, 28.11.2026: "apply that to all dropdowns in task screen") ==')
{
  const pm = n => src(`src/shared/components/plan-modal/${n}`)
  const fs_ = require('fs')
  const screenFiles = fs_.readdirSync(path.join(__dirname, '../src/shared/components/plan-modal')).filter(f => f.endsWith('.tsx'))
    .map(f => [`plan-modal/${f}`, pm(f)]).concat([['todo/components/ParentPicker.tsx', src('src/features/todo/components/ParentPicker.tsx')]])
  const raw = screenFiles.filter(([f, c]) => f !== 'plan-modal/fields.tsx' && /<(ComboboxOptions|ListboxOptions|MenuItems|Listbox|Menu|select)\b|ChoiceRow|<ChipSelect\b/.test(c)).map(([f]) => f)
  check('no item-screen file draws a list of its own: no raw ComboboxOptions / ListboxOptions / Menu / native select / in-group choice rows', raw.length === 0, raw.join(', '))
  const fields = pm('fields.tsx')
  check('…RecurrenceField\'s chips are the field list on the item screen (lists), a native select only on other screens',
    /lists \? <SelectChip<T> \{\.\.\.props\} \/> : <ChipSelect<T> \{\.\.\.props\} \/>/.test(fields) && (fields.match(/<ChoiceSelect lists=\{lists\}/g) || []).length === 2
    && /alwaysPreview end=\{form\.repeatEnd\} lists/.test(pm('TimeSection.tsx')))
  const rowsOf = [['Category', 'DetailsSection.tsx'], ['Travel Time', 'CalendarFieldRows.tsx'], ['Alert', 'CalendarFieldRows.tsx'], ['Second Alert', 'CalendarFieldRows.tsx'],
    ['Calendar', 'OptionsSection.tsx'], ['List', 'OptionsSection.tsx'], ['Time Zone', 'TimeSection.tsx'], ['End Repeat', 'EndRepeatRows.tsx']]
  const missing = rowsOf.filter(([l, f]) => !new RegExp(`<SelectRow(<[A-Za-z]+>)? label="${l}"`).test(pm(f))).map(([l]) => l)
  check('…Category, Travel Time, Alert, Second Alert, Calendar, List, Time Zone and End Repeat are SelectRows', missing.length === 0, missing.join(', '))
  check('…a cost\'s currency is a SelectChip; the Parent search\'s matches a FieldOptions', /<SelectChip<DetailCurrency> label="Currency"/.test(pm('DetailsSection.tsx'))
    && /<FieldOptions field=\{field\} align="start"/.test(src('src/features/todo/components/ParentPicker.tsx')))
  const fsel = src('src/shared/components/FieldSelect.tsx'), rows = pm('ItemRows.tsx')
  check('FieldSelect is a Headless UI Listbox in the shared list: the same room (useOptionsRoom), look (FIELD_LIST) and anchor as FieldOptions',
    /<Listbox value=\{value\} onChange=\{onChange\}/.test(fsel) && /<ListboxOptions static modal=\{false\} aria-label=\{label\} anchor=\{\{ to: `bottom \$\{align\}`, gap: 6, padding: OPTIONS_MARGIN \}\}/.test(fsel)
    && /data-field-list="" style=\{roomStyle\(room\)\} className=\{cx\(FIELD_LIST/.test(fsel) && /data-field-list="" style=\{roomStyle\(room\)\} className=\{cx\(FIELD_LIST, className\)\}/.test(src('src/shared/components/FieldOptions.tsx'))
    && /const room = useOptionsRoom\(button, 6, want\)/.test(fsel))
  check('…a row\'s list says it is a list (⇕) and opens from the whole row; "Move to list…" opens the List row\'s list',
    /<ChevronsUpDown aria-hidden/.test(rows) && /export function SelectRow</.test(rows) && /openOnMount=\{config\?\.openRow === 'list'\}/.test(pm('ItemForm.tsx')))

  // App-wide (owner, 28.11.2026: "Also make sure it is on design md so this is our default from now on"): a raw choice list
  // only where one is today (THEME §8's migration backlog); new code uses FieldOptions / FieldSelect.
  const TODAY_RAW = [
    'src/features/devRequests/components/PropertyPills.tsx', 'src/features/games/test-game/components/TgDropdown.tsx',
    'src/features/games/test-game/components/TgMultiDropdown.tsx', 'src/features/home/components/CurrencyConverter.tsx',
    'src/features/home/components/ruter/StopSearchInput.tsx', 'src/features/recipes/components/AssignMealModal.tsx',
    'src/features/recipes/components/LibraryTabFilters.tsx', 'src/features/recipes/components/RecipeModalFoodLink.tsx',
    'src/features/recipes/components/foodLogKit.tsx', 'src/features/supplements/components/WhatField.tsx',
    'src/features/training/components/ExerciseProgressChart.tsx', 'src/features/training/components/RelativeStrengthChart.tsx',
    'src/features/training/components/RoutineFormParts.tsx', 'src/shared/components/CommandPalette.tsx',
    'src/shared/components/FieldOptions.tsx', 'src/shared/components/FieldSelect.tsx',
  ]
  const found = require('child_process').execSync("grep -rlE '<(ComboboxOptions|ListboxOptions)\\b' src --include=*.tsx || true", { cwd: path.join(__dirname, '..') })
    .toString().trim().split('\n').filter(Boolean)
  const added = found.filter(f => !TODAY_RAW.includes(f))
  check('no new raw ComboboxOptions / ListboxOptions anywhere (today\'s are THEME\'s backlog; new ones use FieldOptions / FieldSelect)', added.length === 0, added.join(', '))
  const theme = src('docs/design/THEME.md'), ui = src('.claude/rules/ui.md')
  check('…THEME says it is the default, quoting the owner, and lists the backlog; ui.md carries the rule',
    theme.includes('Also make sure it is on design md so this is our default from now on') && theme.includes('I almodt want everything to use that type dropdown')
    && TODAY_RAW.filter(f => !/FieldOptions|FieldSelect/.test(f)).every(f => theme.includes(path.basename(f, '.tsx'))) && /FieldSelect/.test(ui))
}

console.log('\n== 14. A picked show\'s next episode by default (owner, 28.11.2026: "when I select the tv serie it should by default bring next episode") ==')
{
  const E = require('../src/features/items/episodeDefault')
  const next = { caughtUp: false, season: 2, episode: 6, episodeTitle: 'x', airDate: '2024-01-01', released: true, watchedCount: 13, totalEpisodes: 24, lastWatched: { season: 2, episode: 5 } }
  check('the next episode fills in when it is one: not all watched, aired, TMDB\'s data there', same(E.episodeDefault(next), { season: 2, episode: 6 }))
  check('…never when all is watched, nothing has aired, TMDB\'s data is missing, or there is no answer',
    E.episodeDefault({ ...next, caughtUp: true, season: null, episode: null }) === null && E.episodeDefault({ ...next, released: false }) === null
    && E.episodeDefault({ ...next, airDate: null }) === null && E.episodeDefault(undefined) === null && E.episodeDefault(null) === null)
  const det = src('src/shared/components/plan-modal/DetailsSection.tsx')
  check('…only after a pick in the Show search on this visit: an item that opens with a show and no episode stays a whole-show plan (opening writes nothing)',
    /if \(p\.link\.kind === 'tv' && 'id' in p\.link\) setPicked\(/.test(det) && /fill=\{picked\?\.id === link\.id\}/.test(det)
    && /useState\(\(\) => !pickedNow \|\| \(link\.season != null && link\.episode != null\)\)/.test(det))
  check('…from the app\'s one rule (useNextEpisode), once per pick, never over an episode the owner set or cleared',
    /useNextEpisode\(decided \? null : link\.id, entry\?\.tv_series\.tmdb_id \?\? null, entry\?\.tv_series\.number_of_episodes \?\? null\)/.test(det)
    && /key=\{`\$\{link\.id\}:\$\{picked\?\.id === link\.id \? picked\.n : 0\}`\}/.test(det) && /const own = \(l: ItemLink\) => \{\n\s*setDecided\(true\)/.test(det))
  check('…filled, it is saved as a picked episode (the link\'s season and episode: the plan becomes that episode\'s)',
    /onChange\(\{ kind: 'tv', id: link\.id, season: filled\.season, episode: filled\.episode \}\)/.test(det))
  check('…no device memory any more (nothing per item kept, nothing for sign-out to clear)',
    !/localStorage|episodeCleared/.test(src('src/features/items/episodeDefault.ts')) && !/episodeCleared/.test(src('src/security/accountState.ts')) && !/itemKey/.test(det))
  check('…the audit opens a whole-show plan and fails on any save it sends, then picks the show and wants S2 E6 saved',
    /async function showDefault\(/.test(src('scripts/audit-item-screen.mjs')) && /SHOW opening a whole-show plan sent/.test(src('scripts/audit-item-screen.mjs')))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
