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
} = require('../src/shared/components/plan-modal/planModal.config')

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

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
