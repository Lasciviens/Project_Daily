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
  needsGoogleTasksFallback, hasValidRecurrenceSelection,
} = require('../src/shared/components/plan-modal/planModal.config')
const { buildInitialForm } = require('../src/shared/components/plan-modal/planForm')
const { shouldSkipPendingCreate } = require('../src/features/todo/api/googleTasksOutboxRules')
const { classifyCalendarPushFailure } = require('../src/features/daily/api/scheduleSyncRules')
const { CalendarApiError, isCalendarNotFound } = require('../src/features/calendar/api/calendarApi')
const { GoogleTasksApiError, isGoogleTaskNotFound } = require('../src/features/todo/api/googleTasksApi')
const { projectOneOffBlocksForDay, projectRecurringBlocksForDay } = require('../src/features/daily/components/dayAgendaProjection')

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

console.log('\n== 7. buildInitialForm — gcal seeded from the REAL entity, not a blind default ==')
{
  // Real bug: opening an already-calendar-linked standalone block used to
  // seed gcal=false (only `defaults?.gcal` was consulted), so an unrelated
  // Save silently ran the "toggle went from checked to unchecked" unlink
  // branch against a real Google Calendar event nobody touched.
  const linkedBlock = {
    id: 'b1', date: '2026-08-22', title: 'Gym', start_time: '18:00:00',
    duration_minutes: 60, color: 'accent', category: 'training',
    google_calendar_event_id: 'gcal_evt_1', notes: null,
    created_at: '', updated_at: '',
  }
  const unlinkedBlock = { ...linkedBlock, google_calendar_event_id: null }

  check('editing a calendar-linked block seeds gcal=true',
    buildInitialForm(undefined, undefined, linkedBlock, undefined).gcal === true)
  check('editing a non-linked block seeds gcal=false',
    buildInitialForm(undefined, undefined, unlinkedBlock, undefined).gcal === false)
  check('CREATE (no timeBlock) still falls back to defaults.gcal',
    buildInitialForm({ gcal: true }, undefined, undefined, undefined).gcal === true)
  check('CREATE (no timeBlock), no defaults -> gcal=false',
    buildInitialForm(undefined, undefined, undefined, undefined).gcal === false)
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

  const mondayRecurring = projectRecurringBlocksForDay(1, [recurringTemplate])
  check('Monday (dayOfWeek=1) shows the template clipped to 23:00-24:00',
    mondayRecurring.length === 1 && mondayRecurring[0].startHour === 23 && mondayRecurring[0].endHour === 24 && !mondayRecurring[0].spillover)

  const tuesdayRecurring = projectRecurringBlocksForDay(2, [recurringTemplate])
  check('Tuesday (dayOfWeek=2) shows the spillover tail 00:00-01:00',
    tuesdayRecurring.length === 1 && tuesdayRecurring[0].startHour === 0 && tuesdayRecurring[0].endHour === 1 && tuesdayRecurring[0].spillover === true)

  const wednesdayRecurring = projectRecurringBlocksForDay(3, [recurringTemplate])
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

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
