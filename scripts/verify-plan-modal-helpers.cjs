#!/usr/bin/env node
/*
 * Verification — UnifiedPlanModal pure helpers added/changed by the
 * Tasks/Schedule model fix (migration 077).
 *
 * Proves, against the REAL un-mocked module (loaded via sucrase — the repo
 * has no unit-test runner by convention):
 *   1. inferRecurrenceMode — the inverse of daysForRecurrence, needed to EDIT
 *      an existing recurring schedule_blocks row (which only ever stores
 *      days_of_week, never the mode originally picked).
 *   2. minutesBetweenWrapping — schedule_blocks stores start_time/end_time,
 *      not a duration; the recurring editor derives one, including the
 *      midnight-wrapping case (23:30 → 00:30 next day = 60 min, never
 *      negative).
 *   3. defaultScheduleCategory — the Task editor's "Add to schedule" section
 *      picks the same category the contextual planning flows (Training/
 *      Projects/Media) already hand-pick at their own call sites.
 *   4. Round trip — daysForRecurrence(inferRecurrenceMode(days)) reproduces
 *      the same days_of_week set for daily/weekdays, so editing a recurring
 *      block and saving without touching Repeat is a no-op on that column.
 *
 *   Run:  node scripts/verify-plan-modal-helpers.cjs
 */
require('sucrase/register')

const {
  inferRecurrenceMode, minutesBetweenWrapping, defaultScheduleCategory, daysForRecurrence,
  blockSourceTypeForTask, taskSourceTypeForBlock, needsGoogleTaskDedupe, shouldCreateLinkedTask,
  needsGoogleTasksFallback, hasValidRecurrenceSelection, clampDurationMinutes,
} = require('../src/shared/components/plan-modal/planModal.config')
const { buildInitialForm: buildSheetForm } = require('../src/shared/components/plan-modal/planForm')
const { itemFromRows, effectiveGoogleTarget } = require('../src/features/items/sheetRules')
// The Add sheet (one item, 155) seeds its form from the saved rows read as one item.
const buildInitialForm = (defaults, task, timeBlock, scheduleBlock) => {
  const item = task || timeBlock || scheduleBlock ? itemFromRows(task, timeBlock, scheduleBlock) : null
  const mode = scheduleBlock ? 'recurring' : timeBlock ? 'schedule' : 'task'
  return buildSheetForm({ mode, defaults, item, today: '2026-10-14', nextTime: '16:00' })
}
// "On Google Calendar" as the sheet will save it (the chip's target).
const onCalendar = f => {
  const t = effectiveGoogleTarget({ time: f.time, repeat: f.recurrence !== 'none' ? {} : null }, f.googlePick)
  return t === 'calendar' || t === 'both'
}
const { shouldSkipPendingCreate } = require('../src/features/todo/api/googleTasksOutboxRules')
const { classifyCalendarPushFailure } = require('../src/features/daily/api/scheduleSyncRules')
const { CalendarApiError, isCalendarNotFound, blockEventId } = require('../src/features/calendar/api/calendarApi')
const { GoogleTasksApiError, isGoogleTaskNotFound } = require('../src/features/todo/api/googleTasksApi')
const { projectOneOffBlocksForDay, projectRecurringBlocksForDay, projectCalendarEventForDay } = require('../src/features/daily/components/dayAgendaProjection')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

console.log('\n== 1. inferRecurrenceMode ==')
{
  check('all 7 days -> daily', inferRecurrenceMode([0, 1, 2, 3, 4, 5, 6]) === 'daily')
  check('all 7 days, unsorted/dup -> daily', inferRecurrenceMode([3, 1, 6, 0, 4, 2, 5, 5]) === 'daily')
  check('exactly Mon-Fri -> weekdays', inferRecurrenceMode([1, 2, 3, 4, 5]) === 'weekdays')
  check('Mon-Fri unsorted -> weekdays', inferRecurrenceMode([5, 4, 3, 2, 1]) === 'weekdays')
  check('Mon/Wed/Fri (3 days) -> weekly', inferRecurrenceMode([1, 3, 5]) === 'weekly')
  check('weekend only (2 days) -> weekly, not daily/weekdays', inferRecurrenceMode([0, 6]) === 'weekly')
  check('single day -> weekly', inferRecurrenceMode([2]) === 'weekly')
  check('empty array -> weekly (never daily/weekdays on no data)', inferRecurrenceMode([]) === 'weekly')
  check('6 of 7 days (not full week) -> weekly, not daily', inferRecurrenceMode([0, 1, 2, 3, 4, 5]) === 'weekly')
}

console.log('\n== 2. minutesBetweenWrapping ==')
{
  check('same-day range', minutesBetweenWrapping('09:00', '10:30') === 90)
  check('exactly one hour', minutesBetweenWrapping('14:00', '15:00') === 60)
  check('midnight wrap (23:30 -> 00:30 next day)', minutesBetweenWrapping('23:30', '00:30') === 60,
    String(minutesBetweenWrapping('23:30', '00:30')))
  check('midnight wrap never negative', minutesBetweenWrapping('23:00', '01:00') >= 0)
  check('start === end -> full day wrap (1440), never 0',
    minutesBetweenWrapping('08:00', '08:00') === 1440,
    String(minutesBetweenWrapping('08:00', '08:00')))
  check('one minute before midnight to midnight', minutesBetweenWrapping('23:59', '00:00') === 1)
}

console.log('\n== 3. defaultScheduleCategory ==')
{
  check('training_session source -> training',
    defaultScheduleCategory('personal', 'training_session') === 'training')
  check('project_item source -> projects',
    defaultScheduleCategory('personal', 'project_item') === 'projects')
  check('movie source -> media', defaultScheduleCategory('personal', 'movie') === 'media')
  check('tv_series source -> media', defaultScheduleCategory('personal', 'tv_series') === 'media')
  check('no source, domain=work -> work', defaultScheduleCategory('work', undefined) === 'work')
  check('no source, domain=media -> media', defaultScheduleCategory('media', undefined) === 'media')
  check('no source, domain=personal -> other', defaultScheduleCategory('personal', undefined) === 'other')
  check('no source, domain=personal, source null -> other', defaultScheduleCategory('personal', null) === 'other')
  check('a real source always wins over domain',
    defaultScheduleCategory('work', 'movie') === 'media')
}

console.log('\n== 4. Round trip: daysForRecurrence(inferRecurrenceMode(days)) ==')
{
  const daily = [0, 1, 2, 3, 4, 5, 6]
  check('daily round-trips', JSON.stringify(daysForRecurrence(inferRecurrenceMode(daily), [])) === JSON.stringify(daily))

  const weekdays = [1, 2, 3, 4, 5]
  check('weekdays round-trips', JSON.stringify(daysForRecurrence(inferRecurrenceMode(weekdays), [])) === JSON.stringify(weekdays))

  const custom = [1, 3, 5]
  const mode = inferRecurrenceMode(custom)
  check('a custom weekly set infers as weekly', mode === 'weekly')
  check('a custom weekly set round-trips when its own days are passed through',
    JSON.stringify(daysForRecurrence(mode, custom)) === JSON.stringify(custom))
}

console.log('\n== 5. blockSourceTypeForTask / taskSourceTypeForBlock (source-fallback mapping) ==')
{
  // task 'tv_series' -> block is now deliberately undefined, NOT
  // 'tv_episode' — a generic fallback (no episodeInfo, no season/episode
  // numbers) can't back up an episode-specific claim. The reverse (block
  // 'tv_episode' -> task 'tv_series') is lossless and stays mapped: a real
  // episode block always rolls up cleanly to a show-level task.
  check('task tv_series has NO generic block equivalent (would overclaim episode identity)',
    blockSourceTypeForTask('tv_series') === undefined)
  check('block tv_episode -> task tv_series', taskSourceTypeForBlock('tv_episode') === 'tv_series')

  // Everything else is a straight pass-through in both directions.
  for (const shared of ['training_session', 'movie', 'project_item', 'calendar', 'manual']) {
    check(`task->block passes "${shared}" through unchanged`, blockSourceTypeForTask(shared) === shared)
    check(`block->task passes "${shared}" through unchanged`, taskSourceTypeForBlock(shared) === shared)
  }

  // task-only values (no time_blocks source_type equivalent) map to undefined
  // — silently dropping them (never crashing, never inventing a fake block
  // source) is the correct behavior for a value the CHECK constraint rejects.
  check('task "media" has no block equivalent', blockSourceTypeForTask('media') === undefined)
  check('task "ai" has no block equivalent', blockSourceTypeForTask('ai') === undefined)
  check('undefined/null input -> undefined (no source at all)',
    blockSourceTypeForTask(undefined) === undefined && blockSourceTypeForTask(null) === undefined
    && taskSourceTypeForBlock(undefined) === undefined && taskSourceTypeForBlock(null) === undefined)
}

console.log('\n== 6. needsGoogleTaskDedupe — "one task = one Google entry" on EDIT (tri-state) ==')
{
  // The real bug: editing an ALREADY Google-synced task into a
  // calendar-linked schedule used to skip the dedupe entirely (it only ran
  // at create time). Signature now takes the real TimeBlockCalendarStatus
  // ('linked'/'not_linked'/'unknown'), not a boolean — dedupe may proceed
  // ONLY on a CONFIRMED 'linked', never on 'not_linked' or 'unknown'.
  check("calendarStatus='linked' + sync enabled -> needs dedupe",
    needsGoogleTaskDedupe('linked', true) === true)
  check("calendarStatus='not_linked' -> no dedupe (nothing confirmed linked)",
    needsGoogleTaskDedupe('not_linked', true) === false)
  check("calendarStatus='unknown' -> NEVER dedupe, even if sync enabled",
    needsGoogleTaskDedupe('unknown', true) === false)
  check('never synced to Google -> nothing to dedupe even if linked',
    needsGoogleTaskDedupe('linked', false) === false)
}

console.log('\n== 7. The sheet seeds Google from the REAL rows, not a blind default ==')
{
  // Real bug (v9): opening an already-calendar-linked standalone block used to
  // seed gcal=false, so an unrelated Save unlinked a real Google Calendar
  // event nobody touched. Since one item (155) the sheet's Google chip seeds
  // from where the rows are (sheetRules.itemFromRows / presentGoogleTarget).
  const linkedBlock = {
    id: 'b1', date: '2026-08-22', title: 'Gym', start_time: '18:00:00',
    duration_minutes: 60, color: 'accent', category: 'training',
    google_calendar_event_id: 'gcal_evt_1', notes: null,
    created_at: '', updated_at: '',
  }
  const unlinkedBlock = { ...linkedBlock, google_calendar_event_id: null }

  check('editing a calendar-linked block stays on Calendar',
    onCalendar(buildInitialForm(undefined, undefined, linkedBlock, undefined)))
  check('editing a non-linked block stays off Google',
    buildInitialForm(undefined, undefined, unlinkedBlock, undefined).googlePick === 'none')
  check('CREATE falls back to defaults.gcal',
    buildInitialForm({ gcal: true }, undefined, undefined, undefined).googlePick === 'calendar')
  check('CREATE, no defaults -> follows the default (no pick)',
    buildInitialForm(undefined, undefined, undefined, undefined).googlePick === null)
  // A repeating plan's own series (147) seeds it the same way, so saving an
  // untouched plan never removes its event from Google Calendar.
  const plan = { id: 's1', user_id: 'u', title: 'Upper A', days_of_week: [1, 4], start_time: '17:00:00', end_time: '18:00:00',
    color: 'blue', category: 'training', effective_from: '2026-09-01', created_at: '', updated_at: '' }
  check('editing a repeating plan on Google Calendar stays on it',
    onCalendar(buildInitialForm(undefined, undefined, undefined, { ...plan, google_calendar_event_id: 'abc' })))
  check('editing a repeating plan not on it (or from before 147) stays off it',
    buildInitialForm(undefined, undefined, undefined, { ...plan, google_calendar_event_id: null }).googlePick === 'none'
    && buildInitialForm(undefined, undefined, undefined, plan).googlePick === 'none')
}

console.log('\n== 8. shouldSkipPendingCreate — the outbox drain half of the dedupe-ordering fix ==')
{
  // The exact scenario needsGoogleTaskDedupe(true, true) said "yes, opt out"
  // for in §6: sync was enabled, no google_task_id yet (a 'create' is still
  // pending/undrained). Once the opt-out patch lands, that pending create
  // must become a no-op — this is what stops it firing anyway.
  check('pending create (no google_task_id), opted out since -> skip',
    shouldSkipPendingCreate({ google_sync_enabled: false, google_task_id: null }, false) === true)
  // Already created for real — the original guard's whole purpose (don't
  // duplicate after a partial earlier failure).
  check('already created (has google_task_id), still enabled -> skip',
    shouldSkipPendingCreate({ google_sync_enabled: true, google_task_id: 'gtask_1' }, false) === true)
  // The normal, legitimate path — nothing here should ever block a real create.
  check('genuinely new + still enabled -> proceed (do NOT skip)',
    shouldSkipPendingCreate({ google_sync_enabled: true, google_task_id: null }, false) === false)
  // force_recreate (migration 078) bypasses ONLY the "already has an id"
  // guard — this is Reopen's normal case (un-cancel sets google_sync_enabled
  // TRUE in the same write, so opt-out never applies here anyway).
  check('force_recreate bypasses the "already has an id" guard (Reopen — id is dead)',
    shouldSkipPendingCreate({ google_sync_enabled: true, google_task_id: 'dead_gtask' }, true) === false)
  check('force_recreate task is always sync-enabled anyway (un-cancel sets it in the same write)',
    shouldSkipPendingCreate({ google_sync_enabled: true, google_task_id: null }, true) === false)
  // THE REGRESSION THIS PASS FIXES: force_recreate must NEVER bypass the
  // opt-out guard. Sequence: Reopen enqueues a force_recreate 'create',
  // then — before it drains — the task opts back out (e.g. gains a
  // calendar-linked schedule). That 'create' must stay dead regardless of
  // the force_recreate flag; the flag only ever means "this id is stale",
  // never "ignore the current opt-out".
  check('force_recreate does NOT bypass opt-out — google_sync_enabled=false always skips',
    shouldSkipPendingCreate({ google_sync_enabled: false, google_task_id: 'dead_gtask' }, true) === true)
  check('force_recreate + opted out + no id either -> still skip',
    shouldSkipPendingCreate({ google_sync_enabled: false, google_task_id: null }, true) === true)
}

console.log('\n== 9. shouldCreateLinkedTask — the TrainingCalendar duplicate-task guard ==')
{
  // The real bug: TrainingCalendar opened a task-linked plan block via
  // `timeBlock` (not `task`), which seeds alsoCreateTask=true (buildInitialForm
  // has no idea a task already exists for it) — Save then created a SECOND
  // task and re-pointed the block's task_id at it, orphaning the original.
  check('block is ALREADY task-linked -> never create a second task, even if the form checkbox is on',
    shouldCreateLinkedTask(true, 'existing_task_id') === false)
  check('standalone block, checkbox on -> create (the normal, intended path)',
    shouldCreateLinkedTask(true, null) === true)
  check('standalone block, checkbox on, undefined existing id -> create',
    shouldCreateLinkedTask(true, undefined) === true)
  check('checkbox off -> never create regardless of link state',
    shouldCreateLinkedTask(false, null) === false && shouldCreateLinkedTask(false, 'existing_task_id') === false)
}

console.log('\n== 10. needsGoogleTasksFallback — the CREATE-side mirror of needsGoogleTaskDedupe (tri-state) ==')
{
  // The real bug: saveTask's plain create and both of saveSchedule's
  // "Also add to Tasks" branches passed skipGoogleTasks=willBeCalendarEvent
  // to useCreateTask SPECULATIVELY, before the calendar link was even
  // attempted. Fallback may proceed ONLY on a CONFIRMED 'not_linked' —
  // 'unknown' must NEVER trigger it (that would risk a SECOND
  // representation the moment the calendar link turns out to have
  // actually succeeded after all).
  check("skipped Google Tasks, calendarStatus='not_linked' -> must fall back",
    needsGoogleTasksFallback(true, 'not_linked') === true)
  check("skipped Google Tasks, calendarStatus='linked' -> no fallback needed",
    needsGoogleTasksFallback(true, 'linked') === false)
  check("skipped Google Tasks, calendarStatus='unknown' -> NEVER fall back",
    needsGoogleTasksFallback(true, 'unknown') === false)
  check('never skipped (no calendar intent at all) -> nothing to fall back from',
    needsGoogleTasksFallback(false, 'not_linked') === false)
}

console.log('\n== 11. classifyCalendarPushFailure / isCalendarNotFound — real typed errors, never string matching ==')
{
  // The real bug: updateTimeBlock used to swallow EVERY push failure the
  // same way (log + do nothing), so a caller checking the block's own
  // google_calendar_event_id column right after a 404 still saw "confirmed
  // linked" — editing a calendar-linked task then dedupe-deleted its real
  // Google Task, leaving NEITHER Google representation. Only a CONFIRMED
  // 404 (the real HTTP status on a real CalendarApiError — never a string
  // match against the message) may report 'not_linked'.
  check('status=404, message is JUST "Not Found" (no digits at all) -> still not_linked',
    classifyCalendarPushFailure(new CalendarApiError(404, 'Not Found')) === 'not_linked')
  check('isCalendarNotFound agrees', isCalendarNotFound(new CalendarApiError(404, 'Not Found')) === true)
  // Google's errors guide: deleting an already-deleted event answers 410 Gone,
  // "no further action needed" — an event deleted in Google Calendar first
  // used to make the app refuse to delete its block until Google purged it.
  check('status=410 (already deleted) -> gone too', isCalendarNotFound(new CalendarApiError(410, 'Resource has been deleted')) === true
    && classifyCalendarPushFailure(new CalendarApiError(410, 'Gone')) === 'not_linked')
  // A re-link after an unlink must not reuse the first id (Google keeps the
  // cancelled event under it): attempt N gets its own base32hex id.
  {
    const ids = [0, 1, 2].map(n => blockEventId('3F2A9C1E-0B4D-4E5F-8A6B-7C8D9E0F1A2B', n))
    check('block event ids: the uuid without dashes, then <hex>v1, <hex>v2 (all base32hex, 5-1024 chars)',
      ids[0] === '3f2a9c1e0b4d4e5f8a6b7c8d9e0f1a2b' && ids[1] === ids[0] + 'v1' && ids[2] === ids[0] + 'v2'
      && ids.every(id => /^[0-9a-v]{5,1024}$/.test(id)), JSON.stringify(ids))
  }
  check('status=404 with a message that also happens to contain "404" -> not_linked either way',
    classifyCalendarPushFailure(new CalendarApiError(404, 'Error 404: gone')) === 'not_linked')

  // Everything else must be 'unknown', NEVER 'not_linked' — an unconfirmed
  // failure must never be treated as proof the link is gone.
  check('status=500 -> unknown, NOT not_linked', classifyCalendarPushFailure(new CalendarApiError(500, 'Internal error')) === 'unknown')
  check('status=429 (rate limit) -> unknown', classifyCalendarPushFailure(new CalendarApiError(429, 'Too many requests')) === 'unknown')
  check('status=401 -> unknown', classifyCalendarPushFailure(new CalendarApiError(401, 'Unauthorized')) === 'unknown')
  check('status=403 -> unknown', classifyCalendarPushFailure(new CalendarApiError(403, 'Forbidden')) === 'unknown')
  check('a plain network Error (no status at all) -> unknown',
    classifyCalendarPushFailure(new Error('NetworkError when attempting to fetch resource.')) === 'unknown')
  // The exact inverse trap this whole fix closes: a message that CONTAINS
  // "404" as a substring but is NOT a CalendarApiError (so has no real
  // status) must NOT classify as not_linked — proves classification is on
  // the typed status, never a string match.
  check('a plain Error whose MESSAGE happens to contain "404" is still unknown (no real status to trust)',
    classifyCalendarPushFailure(new Error('a coincidental 404 in some other unrelated text')) === 'unknown')
}

console.log('\n== 12. GoogleTasksApiError / isGoogleTaskNotFound — the Tasks-API mirror of §11 ==')
{
  check('status=404, bare "Not Found" message -> isGoogleTaskNotFound true',
    isGoogleTaskNotFound(new GoogleTasksApiError(404, 'Not Found')) === true)
  check('status=500 -> isGoogleTaskNotFound false', isGoogleTaskNotFound(new GoogleTasksApiError(500, 'Server error')) === false)
  check('a plain Error whose message contains "404" -> isGoogleTaskNotFound false (no real status)',
    isGoogleTaskNotFound(new Error('looks like a 404 but is not')) === false)
}

console.log('\n== 13. hasValidRecurrenceSelection / daysForRecurrence — no more silent Mon-Fri fallback ==')
{
  // The real bug: daysForRecurrence used to substitute Mon-Fri when
  // weeklyDays was empty, so unchecking every day and hitting Save quietly
  // became "every weekday" instead of being rejected.
  check('weekly with zero days -> INVALID (must block Save)', hasValidRecurrenceSelection('weekly', []) === false)
  check('weekly with at least one day -> valid', hasValidRecurrenceSelection('weekly', [2]) === true)
  check("'daily' needs no days at all -> always valid", hasValidRecurrenceSelection('daily', []) === true)
  check("'weekdays' needs no days at all -> always valid", hasValidRecurrenceSelection('weekdays', []) === true)
  check("'none' (one-off CREATE only) -> always valid", hasValidRecurrenceSelection('none', []) === true)

  check('daysForRecurrence no longer invents Mon-Fri for an empty weekly selection',
    JSON.stringify(daysForRecurrence('weekly', [])) === JSON.stringify([]))
  check('daysForRecurrence still returns the real days when weekly days ARE picked',
    JSON.stringify(daysForRecurrence('weekly', [2, 4])) === JSON.stringify([2, 4]))
}

console.log('\n== 14. DayAgenda cross-midnight projection ==')
{
  // The exact scenario from the review: a Monday 23:00-01:00 (Tuesday)
  // one-off block. Monday's OWN page must show only the Monday portion
  // (60 min, clipped at midnight); Tuesday's page must show the spillover
  // tail (60 min) as its own row — never both full 120 minutes on either
  // day, and never missing from Tuesday entirely.
  const mondayBlock = { id: 'blk1', title: 'Late call', start_time: '23:00:00', duration_minutes: 120, task_id: null }

  const mondayProjection = projectOneOffBlocksForDay([mondayBlock], [])
  check('Monday shows its own block, clipped to 60 min (23:00-24:00)',
    mondayProjection.length === 1 && mondayProjection[0].startHour === 23 && mondayProjection[0].endHour === 24
    && !mondayProjection[0].spillover)

  const tuesdayProjection = projectOneOffBlocksForDay([], [mondayBlock])
  check('Tuesday shows a spillover row for the 00:00-01:00 tail',
    tuesdayProjection.length === 1 && tuesdayProjection[0].startHour === 0 && tuesdayProjection[0].endHour === 1
    && tuesdayProjection[0].spillover === true && tuesdayProjection[0].canonicalId === 'blk1')
  check('the spillover row has its OWN id, distinct from the canonical block id (no collision)',
    tuesdayProjection[0].id !== 'blk1')

  // A same-day (non-crossing) block must regress to exactly the old
  // behavior: no spillover row generated anywhere.
  const daytimeBlock = { id: 'blk2', title: 'Standup', start_time: '09:00:00', duration_minutes: 30, task_id: null }
  check('a normal same-day block produces no spillover on the NEXT day',
    projectOneOffBlocksForDay([], [daytimeBlock]).length === 0)
  check('a normal same-day block projects unchanged on its own day',
    projectOneOffBlocksForDay([daytimeBlock], []).length === 1
    && projectOneOffBlocksForDay([daytimeBlock], [])[0].startHour === 9
    && projectOneOffBlocksForDay([daytimeBlock], [])[0].endHour === 9.5)

  // The same scenario for a RECURRING template — Monday-only, 23:00-01:00.
  const recurringTemplate = { id: 'rec1', title: 'Late shift', start_time: '23:00:00', end_time: '01:00:00', days_of_week: [1] } // Monday=1

  const mondayRecurring = projectRecurringBlocksForDay('2026-08-24', [recurringTemplate])
  check('Monday (dayOfWeek=1) shows the template clipped to 23:00-24:00',
    mondayRecurring.length === 1 && mondayRecurring[0].startHour === 23 && mondayRecurring[0].endHour === 24 && !mondayRecurring[0].spillover)

  const tuesdayRecurring = projectRecurringBlocksForDay('2026-08-25', [recurringTemplate])
  check('Tuesday (dayOfWeek=2) shows the spillover tail 00:00-01:00',
    tuesdayRecurring.length === 1 && tuesdayRecurring[0].startHour === 0 && tuesdayRecurring[0].endHour === 1 && tuesdayRecurring[0].spillover === true)

  const wednesdayRecurring = projectRecurringBlocksForDay('2026-08-26', [recurringTemplate])
  check('Wednesday (not Monday or Tuesday) shows nothing at all',
    wednesdayRecurring.length === 0)

  // Overlap detection downstream (DayAgenda's own pairwise check) works off
  // startHour/endHour directly — proving a spillover row's clipped range
  // (0-1) genuinely overlaps a real 00:30 event is enough to prove the
  // projection feeds that check correctly.
  const spillover = tuesdayProjection[0]
  const earlyTuesdayEvent = { startHour: 0.5, endHour: 1.5 }
  const overlaps = spillover.startHour < earlyTuesdayEvent.endHour && spillover.endHour > earlyTuesdayEvent.startHour
  check('a Tuesday 00:30 event is detected as overlapping the spillover row', overlaps === true)
}

console.log('\n== 15. projectCalendarEventForDay (Google Calendar cross-midnight) ==')
{
  // Built via local-time Date construction (never a hardcoded 'Z'/offset
  // string) so this test is timezone-agnostic — exactly what the review
  // flagged as the real bug: startHour/endHour used to come straight from
  // each instant's OWN .getHours(), which is correct per-instant but not
  // as an [start,end) pair once assembled for a single day.
  const day1 = '2026-08-24'
  const day2 = '2026-08-25'
  const crossMidnightEvent = {
    start: { dateTime: new Date(`${day1}T23:00:00`).toISOString() },
    end:   { dateTime: new Date(`${day2}T01:00:00`).toISOString() },
  }

  const onDay1 = projectCalendarEventForDay(day1, crossMidnightEvent)
  check('day1 shows only its own 23:00-24:00 portion, not a negative range',
    onDay1 && onDay1.startHour === 23 && onDay1.endHour === 24 && onDay1.spillover === false)

  const onDay2 = projectCalendarEventForDay(day2, crossMidnightEvent)
  check('day2 shows the spillover tail 00:00-01:00',
    onDay2 && onDay2.startHour === 0 && onDay2.endHour === 1 && onDay2.spillover === true)

  const dayAfter = '2026-08-26'
  check('a day the event never touches at all returns null (defensive, not a negative range)',
    projectCalendarEventForDay(dayAfter, crossMidnightEvent) === null)

  const sameDayEvent = {
    start: { dateTime: new Date(`${day1}T09:00:00`).toISOString() },
    end:   { dateTime: new Date(`${day1}T09:30:00`).toISOString() },
  }
  const sameDayProjected = projectCalendarEventForDay(day1, sameDayEvent)
  check('a normal same-day event projects unchanged (no spillover)',
    sameDayProjected && sameDayProjected.startHour === 9 && sameDayProjected.endHour === 9.5 && !sameDayProjected.spillover)

  check('an all-day event (no dateTime) returns null — handled separately by the caller',
    projectCalendarEventForDay(day1, { start: { date: day1 }, end: { date: day2 } }) === null)
}

console.log('\n== 16. clampDurationMinutes ==')
{
  check('a normal value passes through unchanged', clampDurationMinutes(90) === 90)
  check('zero is clamped up to the 1-minute floor', clampDurationMinutes(0) === 1)
  check('a negative custom entry is clamped up to 1, never left negative', clampDurationMinutes(-30) === 1)
  check('a >24h custom entry (1500) is clamped down to 1440 (the single-spillover-day ceiling)', clampDurationMinutes(1500) === 1440)
  check('exactly 1440 (24h) passes through unchanged — the ceiling is inclusive', clampDurationMinutes(1440) === 1440)
  check('a non-finite input (NaN) falls back to the 60-minute default, not 1 or 1440', clampDurationMinutes(NaN) === 60)
}

console.log('\n== 17. Recurring effective_from (no fabricated past occurrences) ==')
{
  // 2026-08-24 is a Monday, 08-25 Tuesday, 08-17 the Monday a week earlier.
  // A weekday template created on Mon 24 Aug must render from 24 Aug onward
  // and NEVER on 17 Aug - the exact reported bug ("weekly secince gecmise
  // yonelik de kayit atiyor").
  const weekdayTpl = {
    id: 'rec-eff', title: 'Upper B', start_time: '16:30:00', end_time: '17:30:00',
    days_of_week: [1, 2, 3, 4, 5], effective_from: '2026-08-24',
  }
  check('renders on its own effective_from day (boundary is INCLUSIVE)',
    projectRecurringBlocksForDay('2026-08-24', [weekdayTpl]).length === 1)
  check('renders on a later matching weekday',
    projectRecurringBlocksForDay('2026-08-25', [weekdayTpl]).length === 1)
  check('does NOT render on a matching weekday BEFORE effective_from (the reported bug)',
    projectRecurringBlocksForDay('2026-08-17', [weekdayTpl]).length === 0)
  check('still does not render on a non-matching weekday after effective_from',
    projectRecurringBlocksForDay('2026-08-30', [weekdayTpl]).length === 0)

  // Pre-migration-081 rows carry no effective_from at all -> old behaviour
  // (no lower bound), so the UI degrades instead of hiding everything.
  const legacyTpl = { ...weekdayTpl, effective_from: undefined }
  check('a row with no effective_from keeps the old unbounded behaviour',
    projectRecurringBlocksForDay('2026-08-17', [legacyTpl]).length === 1)
  check('null effective_from is treated the same as absent',
    projectRecurringBlocksForDay('2026-08-17', [{ ...weekdayTpl, effective_from: null }]).length === 1)

  // A cross-midnight template must gate its spillover on the PREVIOUS day -
  // the day that occurrence actually starts on - so its own first day never
  // shows a bogus "continued from yesterday" tail.
  const nightTpl = {
    id: 'rec-night', title: 'Late shift', start_time: '23:00:00', end_time: '01:00:00',
    days_of_week: [1], effective_from: '2026-08-24', // Monday
  }
  const firstDay = projectRecurringBlocksForDay('2026-08-24', [nightTpl])
  check('effective_from day shows only its own occurrence, no spillover from the day before',
    firstDay.length === 1 && firstDay[0].spillover === false)
  const dayAfter = projectRecurringBlocksForDay('2026-08-25', [nightTpl])
  check('the day AFTER shows the spillover tail (its origin day is effective)',
    dayAfter.length === 1 && dayAfter[0].spillover === true)
  check('the Tuesday BEFORE effective_from shows no spillover either',
    projectRecurringBlocksForDay('2026-08-18', [nightTpl]).length === 0)
}

console.log('\n== 18. Repeat choice: one line, day circles, monthly / custom (migration 146) ==')
{
  const C = require('../src/shared/components/plan-modal/planModal.config')
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const base = { recurrence: 'none', weeklyDays: [1, 2, 3, 4, 5], monthWeekday: null, customKind: 'every', repeatEvery: '2', repeatUnit: 'week', repeatDates: [] }
  const f = o => ({ ...base, ...o })

  check('six choices, "No repeat" first; editing a saved plan never offers it',
    same(C.RECURRENCE_OPTIONS.map(o => o.value), ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'custom'])
    && !C.RECURRING_EDIT_OPTIONS.some(o => o.value === 'none') && C.RECURRING_EDIT_OPTIONS.length === 5)
  check('circles run Monday first; the stored numbering keeps 0 = Sunday',
    same(C.DAY_ORDER, [1, 2, 3, 4, 5, 6, 0]) && C.DAY_LABELS[0] === 'S' && C.DAY_NAMES[0] === 'Sunday' && C.DAY_NAMES[1] === 'Monday')

  check('which circles: weekly-style several, monthly one, every N days none, picked dates none',
    C.dayPickerFor(f({ recurrence: 'daily' })) === 'multi' && C.dayPickerFor(f({ recurrence: 'monthly' })) === 'single'
    && C.dayPickerFor(f({ recurrence: 'custom', repeatUnit: 'day' })) === null
    && C.dayPickerFor(f({ recurrence: 'custom', repeatUnit: 'week' })) === 'multi'
    && C.dayPickerFor(f({ recurrence: 'custom', repeatUnit: 'month' })) === 'single'
    && C.dayPickerFor(f({ recurrence: 'custom', customKind: 'dates' })) === null
    && C.dayPickerFor(f({ recurrence: 'none' })) === null)
  check('Every day lights all seven, Weekdays Mon–Fri',
    same(C.litDays(f({ recurrence: 'daily', weeklyDays: [2] })), [0, 1, 2, 3, 4, 5, 6])
    && same(C.litDays(f({ recurrence: 'weekdays', weeklyDays: [2] })), [1, 2, 3, 4, 5]))

  const tapSat = C.toggleRepeatDay(f({ recurrence: 'weekdays' }), 6)
  check('a tap on Sat in Weekdays becomes Weekly Mon–Sat', tapSat.recurrence === 'weekly' && same(tapSat.weeklyDays, [1, 2, 3, 4, 5, 6]))
  const tapWed = C.toggleRepeatDay(f({ recurrence: 'daily' }), 3)
  check('a tap on Wed in Every day becomes Weekly without Wed', tapWed.recurrence === 'weekly' && same(tapWed.weeklyDays, [0, 1, 2, 4, 5, 6]))
  const tapFri = C.toggleRepeatDay(f({ recurrence: 'weekly', weeklyDays: [1, 2, 3, 4] }), 5)
  check('completing Mon–Fri in Weekly reads as Weekdays (as a saved plan opens)', tapFri.recurrence === 'weekdays')
  const tapAll = C.toggleRepeatDay(f({ recurrence: 'weekly', weeklyDays: [0, 1, 2, 3, 4, 5] }), 6)
  check('the seventh day reads as Every day', tapAll.recurrence === 'daily')
  const tapLast = C.toggleRepeatDay(f({ recurrence: 'weekly', weeklyDays: [2] }), 2)
  check('untapping the last day stays Weekly with no day (Save is blocked)', tapLast.recurrence === 'weekly' && same(tapLast.weeklyDays, []))
  check('monthly takes one weekday; a second tap clears it',
    C.toggleRepeatDay(f({ recurrence: 'monthly' }), 6).monthWeekday === 6
    && C.toggleRepeatDay(f({ recurrence: 'monthly', monthWeekday: 6 }), 6).monthWeekday === null
    && C.toggleRepeatDay(f({ recurrence: 'monthly', monthWeekday: 6 }), 1).monthWeekday === 1)
  check('custom every N weeks toggles its own days and stays Custom',
    same(C.toggleRepeatDay(f({ recurrence: 'custom', weeklyDays: [2] }), 4), { weeklyDays: [2, 4] }))
  check('no circles, no change', same(C.toggleRepeatDay(f({ recurrence: 'custom', repeatUnit: 'day' }), 4), {}))

  check('picking Weekly from Weekdays starts from the plan’s weekday, not Mon–Fri',
    same(C.pickRecurrence(f({ recurrence: 'weekdays' }), 'weekly', 2), { recurrence: 'weekly', weeklyDays: [2] }))
  check('picking Weekly keeps a set of its own',
    same(C.pickRecurrence(f({ recurrence: 'daily', weeklyDays: [1, 3] }), 'weekly', 2), { recurrence: 'weekly', weeklyDays: [1, 3] }))
  check('picking Custom from Weekdays starts every-N-weeks from the plan’s weekday too',
    same(C.pickRecurrence(f({ recurrence: 'weekdays' }), 'custom', 4), { recurrence: 'custom', weeklyDays: [4] }))
  check('picking Monthly changes only the choice', same(C.pickRecurrence(f({}), 'monthly', 2), { recurrence: 'monthly' }))

  check('weekly with no day: "Pick at least one day." (hasValidRecurrenceSelection still guards)',
    C.recurrenceProblem(f({ recurrence: 'weekly', weeklyDays: [] })) === 'Pick at least one day.')
  check('every day / weekdays / monthly / no repeat are always complete',
    ['daily', 'weekdays', 'monthly', 'none'].every(r => C.recurrenceProblem(f({ recurrence: r, weeklyDays: [] })) === null))
  check('custom: an N of 0, 100, 1.5 or empty is refused',
    ['0', '100', '1.5', ''].every(n => C.recurrenceProblem(f({ recurrence: 'custom', repeatEvery: n })) === 'Repeat every 1 to 99 weeks.'))
  check('custom every N weeks needs a day', C.recurrenceProblem(f({ recurrence: 'custom', weeklyDays: [] })) === 'Pick at least one day.')
  check('custom every N days needs none', C.recurrenceProblem(f({ recurrence: 'custom', repeatUnit: 'day', weeklyDays: [] })) === null)
  check('picked dates need one', C.recurrenceProblem(f({ recurrence: 'custom', customKind: 'dates' })) === 'Pick at least one date.'
    && C.recurrenceProblem(f({ recurrence: 'custom', customKind: 'dates', repeatDates: ['2026-10-20'] })) === null)
  {
    const R = require('../src/features/daily/recurrence')
    const days = n => Array.from({ length: n }, (_, i) => R.addDaysIso('2026-01-01', i))
    check('picked dates: 366 is the most a plan holds (the database CHECK\'s limit)', R.MAX_REPEAT_DATES === 366
      && C.recurrenceProblem(f({ recurrence: 'custom', customKind: 'dates', repeatDates: days(366) })) === null)
    check('picked dates: 367 can\'t be saved, with a plain message instead of a constraint error',
      C.recurrenceProblem(f({ recurrence: 'custom', customKind: 'dates', repeatDates: days(367) })) === 'Pick at most 366 dates (367 picked).')
    check('picked dates: a date picked twice counts once',
      C.recurrenceProblem(f({ recurrence: 'custom', customKind: 'dates', repeatDates: [...days(366), '2026-01-01'] })) === null)
  }

  const row = o => C.repeatRowFromForm(f(o))
  check('weekly-style choices store as weekly (unchanged meaning)',
    same(row({ recurrence: 'weekdays' }), { days_of_week: [1, 2, 3, 4, 5], repeat_kind: 'weekly', repeat_interval: null, repeat_unit: null, repeat_dates: null })
    && same(row({ recurrence: 'weekly', weeklyDays: [4, 2, 2] }).days_of_week, [2, 4]))
  check('monthly with Saturday / without a weekday',
    same(row({ recurrence: 'monthly', monthWeekday: 6 }), { days_of_week: [6], repeat_kind: 'monthly', repeat_interval: null, repeat_unit: null, repeat_dates: null })
    && same(row({ recurrence: 'monthly' }).days_of_week, []))
  check('every 2 weeks on Tue and Thu',
    same(row({ recurrence: 'custom', weeklyDays: [4, 2] }), { days_of_week: [2, 4], repeat_kind: 'interval', repeat_interval: 2, repeat_unit: 'week', repeat_dates: null }))
  check('every 3 days carries no weekday',
    same(row({ recurrence: 'custom', repeatEvery: '3', repeatUnit: 'day' }), { days_of_week: [], repeat_kind: 'interval', repeat_interval: 3, repeat_unit: 'day', repeat_dates: null }))
  check('every 6 months, the Friday nearest',
    same(row({ recurrence: 'custom', repeatEvery: '6', repeatUnit: 'month', monthWeekday: 5 }), { days_of_week: [5], repeat_kind: 'interval', repeat_interval: 6, repeat_unit: 'month', repeat_dates: null }))
  check('one shape per meaning: every 1 week = weekly, every 1 month = monthly, every 1 day = every day',
    row({ recurrence: 'custom', repeatEvery: '1', weeklyDays: [2] }).repeat_kind === 'weekly'
    && row({ recurrence: 'custom', repeatEvery: '1', repeatUnit: 'month' }).repeat_kind === 'monthly'
    && same(row({ recurrence: 'custom', repeatEvery: '1', repeatUnit: 'day' }).days_of_week, [0, 1, 2, 3, 4, 5, 6]))
  check('picked dates are stored sorted, once each',
    same(row({ recurrence: 'custom', customKind: 'dates', repeatDates: ['2026-12-31', '2026-10-20', '2026-10-20'] }),
      { days_of_week: [], repeat_kind: 'dates', repeat_interval: null, repeat_unit: null, repeat_dates: ['2026-10-20', '2026-12-31'] }))

  // A saved row opens as the same choice, and saving it unchanged writes the same row.
  const rows = [
    { days_of_week: [0, 1, 2, 3, 4, 5, 6] }, { days_of_week: [1, 2, 3, 4, 5], repeat_kind: 'weekly' }, { days_of_week: [1, 4] },
    { days_of_week: [6], repeat_kind: 'monthly' }, { days_of_week: [], repeat_kind: 'monthly' },
    { days_of_week: [2, 4], repeat_kind: 'interval', repeat_interval: 2, repeat_unit: 'week' },
    { days_of_week: [], repeat_kind: 'interval', repeat_interval: 3, repeat_unit: 'day' },
    { days_of_week: [5], repeat_kind: 'interval', repeat_interval: 6, repeat_unit: 'month' },
    { days_of_week: [], repeat_kind: 'dates', repeat_dates: ['2026-10-20', '2026-11-14'] },
  ]
  check('every kind round-trips: row → form → the same row', rows.every(r => {
    const back = C.repeatRowFromForm(f(C.repeatFormFromRow(r)))
    return same(back.days_of_week, r.days_of_week) && back.repeat_kind === (r.repeat_kind ?? 'weekly')
      && back.repeat_interval === (r.repeat_interval ?? null) && back.repeat_unit === (r.repeat_unit ?? null)
      && same(back.repeat_dates, r.repeat_dates ?? null)
  }))
  check('a row from before 146 (no repeat_kind) opens as its weekly-style choice',
    C.repeatFormFromRow({ days_of_week: [1, 2, 3, 4, 5] }).recurrence === 'weekdays')

  check('a repeat starts on the planner’s date; picked dates start at the earliest pick if earlier',
    C.repeatStart(row({ recurrence: 'weekly', weeklyDays: [2] }), '2026-10-14') === '2026-10-14'
    && C.repeatStart(row({ recurrence: 'custom', customKind: 'dates', repeatDates: ['2026-10-10', '2026-11-01'] }), '2026-10-14') === '2026-10-10'
    && C.repeatStart(row({ recurrence: 'custom', customKind: 'dates', repeatDates: ['2026-10-20'] }), '2026-10-14') === '2026-10-14')

  const p = C.repeatPreview(f({ recurrence: 'monthly', monthWeekday: 6 }), '2026-10-13', '2026-10-13')
  check('preview: the owner’s monthly example — summary and the next three days',
    p.summary === 'Every month, the Saturday nearest the 13th' && same(p.next, ['2026-11-14', '2026-12-12', '2027-01-16']))
  const pw = C.repeatPreview(f({ recurrence: 'custom', weeklyDays: [2, 4] }), '2026-10-13', '2026-10-13', ['2026-10-15'])
  check('preview: every 2 weeks, skipping a left-out day',
    pw.summary === 'Every 2 weeks on Tue and Thu' && same(pw.next, ['2026-10-13', '2026-10-27', '2026-10-29']))
  check('preview: none for No repeat or an incomplete choice',
    C.repeatPreview(f({}), '2026-10-13', '2026-10-13') === null
    && C.repeatPreview(f({ recurrence: 'weekly', weeklyDays: [] }), '2026-10-13', '2026-10-13') === null)

  const monthlyTpl = { id: 's', user_id: 'u', title: 'Haircut', days_of_week: [6], start_time: '10:00:00', end_time: '11:00:00', color: 'blue', category: 'daily',
    effective_from: '2026-10-13', repeat_kind: 'monthly', created_at: '', updated_at: '' }
  const opened = buildInitialForm(undefined, undefined, undefined, monthlyTpl)
  check('editing a monthly plan opens as Monthly + Saturday, its start as the date',
    opened.recurrence === 'monthly' && opened.monthWeekday === 6 && opened.date === '2026-10-13')
  const fresh = buildInitialForm({ date: '2026-10-14' })
  check('a new plan starts with No repeat and its own date', fresh.recurrence === 'none' && fresh.date === '2026-10-14' && fresh.repeatUnit === 'week')

  // Editing a saved plan: "Starts" for a choice that counts from it.
  check('what a choice counts from: Monthly and every N months the month, every N weeks / days their unit, the rest nothing',
    C.repeatAnchorOf(f({ recurrence: 'monthly' })) === 'month'
    && C.repeatAnchorOf(f({ recurrence: 'custom', repeatUnit: 'month' })) === 'month'
    && C.repeatAnchorOf(f({ recurrence: 'custom', repeatUnit: 'week' })) === 'week'
    && C.repeatAnchorOf(f({ recurrence: 'custom', repeatUnit: 'day' })) === 'day'
    && ['daily', 'weekdays', 'weekly', 'none'].every(r => C.repeatAnchorOf(f({ recurrence: r })) === null)
    && C.repeatAnchorOf(f({ recurrence: 'custom', customKind: 'dates' })) === null)
  check('…the same for a saved row',
    C.repeatAnchorOfRow({ repeat_kind: 'monthly' }) === 'month' && C.repeatAnchorOfRow({ repeat_kind: 'interval', repeat_unit: 'week' }) === 'week'
    && C.repeatAnchorOfRow({ repeat_kind: 'weekly' }) === null && C.repeatAnchorOfRow({}) === null && C.repeatAnchorOfRow({ repeat_kind: 'dates' }) === null)
  const savedWeekly = { start: '2026-03-05', anchor: null }
  const weeklyForm = f({ recurrence: 'weekly', weeklyDays: [6] })
  const toMonthly = C.withStartForRepeatChange(weeklyForm, { recurrence: 'monthly' }, savedWeekly, '2026-10-13')
  check('the reported case: a weekly plan saved 05.03 turned Monthly starts today (13.10), not on the 5th',
    toMonthly.date === '2026-10-13' && toMonthly.recurrence === 'monthly')
  check('…its preview then reads the 13th',
    C.repeatPreview(f({ recurrence: 'monthly', monthWeekday: 6 }), toMonthly.date, '2026-10-13').summary === 'Every month, the Saturday nearest the 13th')
  check('…and back to Weekly returns the saved start (no anchor, history kept)',
    C.withStartForRepeatChange(f({ recurrence: 'monthly', monthWeekday: 6 }), { recurrence: 'weekly' }, savedWeekly, '2026-10-13').date === '2026-03-05')
  check('a change that keeps what it counts from leaves Starts alone (a day circle, Weekly → Every day)',
    !('date' in C.withStartForRepeatChange(weeklyForm, { weeklyDays: [1, 6] }, savedWeekly, '2026-10-13'))
    && !('date' in C.withStartForRepeatChange(weeklyForm, { recurrence: 'daily' }, savedWeekly, '2026-10-13')))
  const savedMonthly = { start: '2026-05-05', anchor: 'month' }
  check('a saved monthly plan turned every 2 months keeps its anchor (both count from the day of the month)',
    !('date' in C.withStartForRepeatChange(f({ recurrence: 'monthly' }), { recurrence: 'custom', customKind: 'every', repeatUnit: 'month' }, savedMonthly, '2026-10-13')))
  check('a saved monthly plan turned every 2 weeks starts today; back to monthly, its saved start again',
    C.withStartForRepeatChange(f({ recurrence: 'monthly' }), { recurrence: 'custom', customKind: 'every', repeatUnit: 'week' }, savedMonthly, '2026-10-13').date === '2026-10-13'
    && C.withStartForRepeatChange(f({ recurrence: 'custom', repeatUnit: 'week' }), { recurrence: 'monthly' }, savedMonthly, '2026-10-13').date === '2026-05-05')
  const monthlyRow = C.repeatRowFromForm(f({ recurrence: 'monthly', monthWeekday: 6 }))
  check('saving: a choice that counts from its start writes the Starts shown',
    C.editedRepeatStart({ ...f({ recurrence: 'monthly', monthWeekday: 6 }), date: '2026-10-13' }, monthlyRow, '2026-03-05') === '2026-10-13')
  const weeklyRow = C.repeatRowFromForm(weeklyForm)
  check('saving: any other choice keeps the saved start',
    C.editedRepeatStart({ ...weeklyForm, date: '2026-10-13' }, weeklyRow, '2026-03-05') === '2026-03-05')
  const datesForm = f({ recurrence: 'custom', customKind: 'dates', repeatDates: ['2026-02-01', '2026-11-01'] })
  check('saving: picked dates before the saved start still move it earlier',
    C.editedRepeatStart({ ...datesForm, date: '2026-03-05' }, C.repeatRowFromForm(datesForm), '2026-03-05') === '2026-02-01')
  check('saving: a row with no saved start (before 081) and no anchor writes none',
    C.editedRepeatStart({ ...weeklyForm, date: '2026-10-13' }, weeklyRow, undefined) === undefined)
}

console.log('\n== 19. A task planned for a day never gets a retired section ==')
{
  const C = require('../src/shared/components/plan-modal/planModal.config')
  const { todayStr, tomorrowStr } = require('../src/shared/utils/dateUtils')
  check('today → Today', C.sectionForDate(todayStr()) === 'today')
  check('tomorrow → Backlog (was the legacy Tomorrow)', C.sectionForDate(tomorrowStr()) === 'backlog')
  check('next week → Backlog (was the legacy This week)', C.sectionForDate('2099-01-01') === 'backlog')
  check('a past day → Backlog', C.sectionForDate('2020-01-01') === 'backlog')
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
