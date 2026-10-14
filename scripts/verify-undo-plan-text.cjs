#!/usr/bin/env node
/*
 * Verification — undoPlanText.ts (Developer → Activity → "Undo this save",
 * migration 150): the plan the database returns, in plain words. Against the
 * REAL module via sucrase (no unit-test runner by convention). The plans
 * below have the shape scripts/db-tests/undo-save returns.
 *
 * Run: node scripts/verify-undo-plan-text.cjs
 */
process.env.TZ = 'Europe/Oslo'
require('sucrase/register')

const { describeUndoPlan, undoDoneMessage, undoneCount, tableNoun, columnLabel, valueText } = require('../src/features/developer/components/undoPlanText')
const { friendlyTable } = require('../src/features/developer/components/activityLogMeta')

let passed = 0
let failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + JSON.stringify(detail) : ''}`) }
}

const table = (t, o = {}) => ({
  t, audited: true, revert: 0, delete: 0, reinsert: 0, overwrite: 0, skip: 0, already: 0, same: 0,
  columns: [], skipped_columns: {}, ...o,
})
const plan = (o = {}) => ({
  tx_id: 2108, at: '2026-10-14T08:30:00+00:00', actors: ['web'], changes: 1, hidden: 0, steps: 1,
  tables: [], conflicts: [], kept: [], blocked: [], collateral: [], not_logged: [], drift: [], error: null,
  can_apply: true, needs_confirm: false, confirm: 'abc', applied: false, result: null, ...o,
})

console.log('\n1 · Names')
check('TV episodes keep their capitals', tableNoun('user_tv_episodes', 73) === 'TV episodes')
check('one task is lower case', tableNoun('tasks', 1) === 'task')
check('diary entries', tableNoun('food_log_entries', 2) === 'diary entries')
check('TV series stays series', tableNoun('user_tv_entries', 3) === 'TV series')
check('Kobo keeps its capital', tableNoun('book_deliveries', 2) === 'Kobo deliveries')
check('an unnamed table reads singular', friendlyTable('media_watches') === 'media watch' && tableNoun('media_watches', 2) === 'media watches')
check('…and a series table stays as it is', friendlyTable('tv_series') === 'tv series')
check('watched_at → watched date', columnLabel('watched_at') === 'watched date')
check('parent_task_id → parent task link', columnLabel('parent_task_id') === 'parent task link')
check('a timestamp value reads DD.MM.YYYY HH:MM', valueText('2026-10-14T08:30:00+00:00') === '14.10.2026 10:30')
check('a date value reads DD.MM.YYYY', valueText('2026-10-20') === '20.10.2026')
check('empty reads empty', valueText(null) === 'empty' && valueText('') === 'empty')
check('text is quoted', valueText('Three') === '«Three»')

console.log('\n2 · The 73-episode save')
{
  const v = describeUndoPlan(plan({
    changes: 73, steps: 73,
    tables: [table('user_tv_episodes', { revert: 73, columns: ['watched_at'] })],
  }))
  check('subtitle: count, date and who', v.subtitle === '73 changes · 14.10.2026 10:30 · You', v.subtitle)
  check('one plain line', v.changes.length === 1 && v.changes[0].text === '73 TV episodes: watched date put back', v.changes)
  check('no conflicts, nothing blocked', v.conflicts.length === 0 && v.blocked.length === 0 && v.also.length === 0)
  check('Undo, enabled', v.canUndo && v.confirmLabel === 'Undo' && !v.nothingToDo && v.error === null)
  check('says Trakt follows', v.notes.includes('Trakt gets the reverse change too'), v.notes)
  check('says what the log does not keep', v.notes.some(n => /synced data \(Hevy, Health, Strava\)/.test(n)))
}

console.log('\n3 · Conflicts first, with the later time')
{
  const v = describeUndoPlan(plan({
    changes: 2, steps: 2, needs_confirm: true,
    tables: [table('tasks', { revert: 2, columns: ['title'] })],
    conflicts: [{
      t: 'tasks', id: 'd0000000-0000-0000-0000-00000000000d', label: 'Three', action: 'revert', reason: 'changed_later',
      columns: ['title'], now: { title: 'Three' }, undo: { title: 'One' },
      later: [{ tx: 2109, at: '2026-10-14T08:45:00+00:00', op: 'UPDATE', actor: 'web', columns: ['title'] }],
    }],
    kept: [{ t: 'tasks', id: 'd1', label: 'y', later: [{ tx: 2110, at: '2026-10-14T08:50:00+00:00', op: 'UPDATE', actor: 'web', columns: ['status'] }] }],
  }))
  check('the conflict reads plainly', v.conflicts[0].text === 'Task «Three» — changed again later at 10:45 (title) · Undo would overwrite it', v.conflicts[0].text)
  check('with the values now and after Undo', v.conflicts[0].detail === 'Now «Three» · Undo puts back «One»', v.conflicts[0].detail)
  check('the button says Undo anyway', v.confirmLabel === 'Undo anyway' && v.canUndo)
  check('a later edit of another field is kept', v.notes[0] === '1 row was changed again later in other fields — Undo keeps those changes', v.notes)
  check('Google Tasks follows', v.notes.includes('Google Tasks gets the reverse change too'))
}
{
  const v = describeUndoPlan(plan({
    conflicts: [{
      t: 'user_tv_episodes', id: 'e1', label: 'S01E03', action: 'revert', reason: 'changed_later', columns: ['watched_at'],
      now: { watched_at: '2026-10-15T18:00:00+00:00' }, undo: { watched_at: null },
      later: [{ tx: 3, at: '2026-10-15T18:00:00+00:00', op: 'UPDATE', actor: 'service', columns: ['watched_at'] }],
    }, {
      t: 'tasks', id: 'a', label: null, action: 'skip', reason: 'deleted_later', columns: ['title'], now: null, undo: { title: 'x' },
      later: [{ tx: 4, at: '2026-10-14T09:00:00+00:00', op: 'DELETE', actor: 'web', columns: null }],
    }, {
      t: 'tasks', id: 'b', label: 'Back', action: 'overwrite', reason: 'exists_again', columns: ['title'],
      now: { title: 'Edited' }, undo: { title: 'Old' }, later: [],
    }, {
      t: 'tasks', id: 'c', label: 'Made', action: 'delete', reason: 'changed_later', columns: ['status'],
      now: { status: 'done' }, undo: null, later: [],
    }],
  }))
  check('a later day shows the full date', v.conflicts[0].text === 'TV episode «S01E03» — changed again later at 15.10.2026 20:00 (watched date) · Undo would overwrite it', v.conflicts[0].text)
  check('…and the values as dates', v.conflicts[0].detail === 'Now 15.10.2026 20:00 · Undo puts back empty', v.conflicts[0].detail)
  check('deleted later: stays deleted (no label → the id)', v.conflicts[1].text === "Task «#a» — deleted later at 11:00 · its old values can't go back", v.conflicts[1].text)
  check('back again: would replace it', v.conflicts[2].text === 'Task «Back» — back again since and changed (title) · Undo would replace it with the old one', v.conflicts[2].text)
  check('made and changed since, not in the log', v.conflicts[3].text === 'Task «Made» — made by this save, changed since (not in the log) (status) · Undo deletes it with that change', v.conflicts[3].text)
}

console.log('\n4 · A mixed save, what goes along, what can\'t be undone')
{
  const v = describeUndoPlan(plan({
    changes: 6, steps: 5, needs_confirm: true, actors: ['web', 'service'],
    tables: [
      table('tasks', { revert: 1, delete: 1, reinsert: 1, columns: ['status', 'title'] }),
      table('time_blocks', { delete: 1, reinsert: 1, already: 2 }),
      table('food_log_entries', { revert: 1, columns: ['calories'], skipped_columns: { kcal_x2: 'generated' } }),
      table('wish_items', { revert: 1, columns: ['title'], skipped_columns: { note: 'dropped' }, audited: false }),
    ],
    blocked: [{ reason: 'hidden', count: 1 }, { t: 'pairs', reason: 'no_key', count: 2 }, { t: 'projects', reason: 'no_access', count: 1 }],
    not_logged: [{ t: 'task_tags', parent: 'tasks' }],
    collateral: [
      { t: 'time_blocks', id: 'e2000000', how: 'deleted', label: 'Added later' },
      { t: 'tasks', id: 'f1', how: 'unlinked', label: 'Child' },
      { t: 'task_secrets', id: null, how: 'hidden', label: null },
    ],
  }))
  check('who: both', v.subtitle.endsWith('· You and AI / sync'), v.subtitle)
  check('table lines', JSON.stringify(v.changes.map(l => l.text)) === JSON.stringify([
    '1 task: status, title put back', '1 task deleted by this save: put back', '1 task made by this save: deleted',
    '1 schedule block deleted by this save: put back', '1 schedule block made by this save: deleted', '2 schedule blocks already as before',
    '1 diary entry: calories put back', '1 wish: title put back',
  ]), v.changes.map(l => l.text))
  check('blocked: hidden, no key, not logged', JSON.stringify(v.blocked.map(l => l.text)) === JSON.stringify([
    "1 change of this save isn't in your log (written for no account) — Undo can't see it",
    "2 changes to pairs — rows without an id can't be undone",
    '1 change to projects — you may not read that table',
    "Task tags that went with a deleted task aren't in the log — they can't come back",
  ]), v.blocked.map(l => l.text))
  check('also affected, grouped', JSON.stringify(v.also.map(l => l.text)) === JSON.stringify([
    'Also deleted: 1 schedule block not made by this save («Added later»)',
    'Also unlinked: 1 task not made by this save («Child»)',
    "Also deleted: rows of task secrets you can't see",
  ]), v.also.map(l => l.text))
  check('generated column follows', v.notes.includes('kcal x2 (diary entries) is worked out by the database — it follows'), v.notes)
  check('dropped column named', v.notes.includes("note (wishes) no longer exists — its old value can't go back"), v.notes)
  check('a table no longer logged is said', v.notes.includes("Wish changes are no longer logged — this undo can't be undone itself"), v.notes)
  check('both Google services follow', v.notes.includes('Google Tasks and Google Calendar get the reverse change too'), v.notes)
  check('blocked → Undo anyway', v.confirmLabel === 'Undo anyway')
}

console.log('\n5 · Nothing to do, can\'t run')
{
  const v = describeUndoPlan(plan({ steps: 0, tables: [table('user_tv_episodes', { already: 73 })], changes: 73 }))
  check('already undone: nothing to do, Undo off', v.nothingToDo && !v.canUndo && v.changes[0].text === '73 TV episodes already as before')
  const e = describeUndoPlan(plan({ can_apply: false, error: { code: '23503', message: 'insert or update on table "time_blocks" violates foreign key constraint' } }))
  check('a failed trial run: why, plainly, and Undo off', e.error === "Undo can't run: a row it needs was deleted since" && !e.canUndo)
  const u = describeUndoPlan(plan({ can_apply: false, error: { code: 'P0001', message: 'custom rule' } }))
  check('an unknown failure shows its message', u.error === "Undo can't run: custom rule")
}

console.log('\n6 · A rule changes a row again after Undo')
{
  const v = describeUndoPlan(plan({
    needs_confirm: true,
    drift: [
      { t: 'tasks', id: 'a1', how: 'changed', columns: ['status'], label: 'Locked' },
      { t: 'time_blocks', id: 'b1', how: 'still_there', columns: null, label: 'Slot' },
      { t: 'tasks', id: 'c1234567-x', how: 'missing', columns: null, label: null },
    ],
  }))
  check('drift reads as a warning of its own', v.conflicts.length === 0 && JSON.stringify(v.drift.map(l => l.text)) === JSON.stringify([
    "Task «Locked» — a database rule sets status again after Undo · it won't be exactly as before",
    'Schedule block «Slot» — a database rule keeps it after Undo deletes it',
    'Task «#c1234567» — a database rule removes it again after Undo puts it back',
  ]), v.drift.map(l => l.text))
  check('and needs Undo anyway', v.confirmLabel === 'Undo anyway')
}

console.log('\n7 · The toast')
{
  const r = (o) => ({ undo_tx: 9100, reverted: 0, overwritten: 0, deleted: 0, reinserted: 0, reverted_rows: [], reinserted_rows: [], deleted_rows: [], ...o })
  check('the count of an applied undo', undoneCount(plan({ applied: true, result: r({ reverted: 2, deleted: 1 }) })) === 3 && undoneCount(plan()) === 0)
  check('73 put back', undoDoneMessage(plan({ applied: true, result: r({ reverted: 73 }) })) === 'Save undone · 73 changes put back')
  check('counts every kind', undoDoneMessage(plan({ applied: true, result: r({ reverted: 1, deleted: 2, reinserted: 2, overwritten: 1 }) })) === 'Save undone · 6 changes put back')
  check('one change', undoDoneMessage(plan({ applied: true, result: r({ reinserted: 1 }) })) === 'Save undone · 1 change put back')
  check('nothing', undoDoneMessage(plan({ applied: true, result: r({}) })) === 'Nothing to undo — already as before')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
