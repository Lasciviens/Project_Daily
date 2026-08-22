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
  needsGoogleTasksFallback,
} = require('../src/shared/components/plan-modal/planModal.config')
const { buildInitialForm } = require('../src/shared/components/plan-modal/planForm')
const { shouldSkipPendingCreate } = require('../src/features/todo/api/googleTasksOutboxRules')

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

console.log('\n== 6. needsGoogleTaskDedupe — "one task = one Google entry" on EDIT ==')
{
  // The real bug: editing an ALREADY Google-synced task into a
  // calendar-linked schedule used to skip the dedupe entirely (it only ran
  // at create time). Signature deliberately dropped the googleTaskId param
  // — see §8's pending-create scenario for why requiring one was itself a
  // second, related bug.
  check('synced task gaining a GCal schedule -> needs dedupe',
    needsGoogleTaskDedupe(true, true) === true)
  check('not becoming a calendar event -> no dedupe needed',
    needsGoogleTaskDedupe(false, true) === false)
  check('never synced to Google -> nothing to dedupe',
    needsGoogleTaskDedupe(true, false) === false)
  check('sync enabled but no real google_task_id yet (pending create) -> STILL needs dedupe',
    needsGoogleTaskDedupe(true, true) === true)
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

console.log('\n== 10. needsGoogleTasksFallback — the CREATE-side mirror of needsGoogleTaskDedupe ==')
{
  // The real bug: saveTask's plain create and both of saveSchedule's
  // "Also add to Tasks" branches passed skipGoogleTasks=willBeCalendarEvent
  // to useCreateTask SPECULATIVELY, before the calendar link was even
  // attempted. If that link then failed, the task ended up with NEITHER
  // Google representation — this is what pushes it to Google Tasks after
  // the fact instead.
  check('skipped Google Tasks, calendar link then FAILED -> must fall back',
    needsGoogleTasksFallback(true, false) === true)
  check('skipped Google Tasks, calendar link SUCCEEDED -> no fallback needed',
    needsGoogleTasksFallback(true, true) === false)
  check('never skipped (no calendar intent at all) -> nothing to fall back from',
    needsGoogleTasksFallback(false, false) === false)
  check('never skipped, calendar happened to link anyway -> still no-op',
    needsGoogleTasksFallback(false, true) === false)
}

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
