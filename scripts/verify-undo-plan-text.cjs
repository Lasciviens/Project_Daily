#!/usr/bin/env node
/*
 * Verification — undoPlanText.ts (Developer → Activity → "Undo this save",
 * migrations 150/151): the plan the database returns, in plain words. Against
 * the REAL module via sucrase (no unit-test runner by convention). The plans
 * below have the shape scripts/db-tests/undo-save returns. Also: the table →
 * service map (SYNCED) matches migration 151's app_undo_synced.
 *
 * Run: node scripts/verify-undo-plan-text.cjs
 */
process.env.TZ = 'Europe/Oslo'
require('sucrase/register')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const {
  describeUndoPlan, undoDoneMessage, undoneCount, tableNoun, columnLabel, valueText, nearbyHint, touchesTrakt, SYNCED,
} = require('../src/features/developer/components/undoPlanText')
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
  side_effects: [], side_hidden: 0, outbox: [], sync_save: [], nearby: [],
  can_apply: true, needs_confirm: false, confirm: 'abc', applied: false, result: null, ...o,
})

console.log('\n1 · Names')
check('TV episodes keep their capitals', tableNoun('user_tv_episodes', 73) === 'TV episodes')
check('one task is lower case', tableNoun('tasks', 1) === 'task')
check('diary entries', tableNoun('food_log_entries', 2) === 'diary entries')
check('TV series stays series', tableNoun('user_tv_entries', 3) === 'TV series')
check('Kobo keeps its capital', tableNoun('book_deliveries', 2) === 'Kobo deliveries')
check('an unnamed table reads singular', friendlyTable('media_follows') === 'media follow' && tableNoun('media_follows', 2) === 'media follows')
check('a watch is a Watch', friendlyTable('media_watches') === 'Watch' && tableNoun('media_watches', 3) === 'watches')
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
  check('no grey "reverse change" footnote, no filler about synced data', v.notes.length === 0 && v.outside.length === 0, v.notes)
  check('no hint without saves nearby', v.hint === null)
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
    not_logged: [{ t: 'task_tags', parent: 'tasks', how: 'deleted', rows: 1 }, { t: 'task_comments', parent: 'tasks', how: 'unlinked', rows: 2 }],
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
    "Task tags of a deleted task aren't in the log — if it had any, they can't come back",
    "Task comments that pointed at 2 deleted tasks aren't in the log — if they had any, they stay unlinked",
  ]), v.blocked.map(l => l.text))
  check('also affected, grouped', JSON.stringify(v.also.map(l => l.text)) === JSON.stringify([
    'Also deleted: 1 schedule block not made by this save («Added later»)',
    'Also unlinked: 1 task not made by this save («Child»)',
    "Also deleted: rows of task secrets you can't see",
  ]), v.also.map(l => l.text))
  check('generated column follows', v.notes.includes('kcal x2 (diary entries) is worked out by the database — it follows'), v.notes)
  check('dropped column named', v.notes.includes("note (wishes) no longer exists — its old value can't go back"), v.notes)
  check('a table no longer logged is said', v.notes.includes("Wish changes are no longer logged — this undo can't be undone itself"), v.notes)
  check('no quiet Calendar note any more (the database counts those events)', !v.notes.some(n => /Google Calendar/.test(n)), v.notes)
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
  const t = describeUndoPlan(plan({ can_apply: false, error: { code: '57014', message: 'canceling statement due to statement timeout' } }))
  check('a statement timeout is named plainly', t.error === "Undo can't run: this save is too big to undo here", t.error)
  const apiSrc = readFileSync(join(__dirname, '../src/features/developer/api/undoSaveApi.ts'), 'utf8')
  check('…and so is the request that timed out', /'57014': 'This save is too big to undo here\.'/.test(apiSrc))
  const l = describeUndoPlan(plan({ can_apply: false, error: { code: '55P03', message: 'canceling statement due to lock timeout' } }))
  check('a row another save holds: try again in a moment', l.error === "Undo can't run: another save is writing these rows — try again in a moment", l.error)
  check('…and an apply that waited too long says the same',
    /'55P03': 'Another save is writing these rows — try again in a moment\.'/.test(apiSrc))
  check('an apply\'s other known errors use the preview\'s words, not Postgres text',
    /if \(UNDO_ERROR_TEXT\[code\]\) return new Error\(`Undo can't run: \$\{UNDO_ERROR_TEXT\[code\]\}\.`\)/.test(apiSrc))
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
    "Task «Locked» — a database rule changes status right after Undo · it won't be exactly as before",
    'Schedule block «Slot» — a database rule keeps it after Undo deletes it',
    'Task «#c1234567» — a database rule removes it again after Undo puts it back',
  ]), v.drift.map(l => l.text))
  check('and needs Undo anyway', v.confirmLabel === 'Undo anyway')
}

console.log('\n7 · Outside the app (151): a danger line per service')
{
  const v = describeUndoPlan(plan({
    needs_confirm: true, steps: 3,
    tables: [table('media_watches', { revert: 3, columns: ['watched_at'] })],
    outbox: [{ s: 'trakt', op: 'history_add', n: 3, items: null }, { s: 'trakt', op: 'history_remove_play', n: 3, items: null }],
  }))
  check('Trakt: plays moved back, one line', JSON.stringify(v.outside.map(l => [l.tone, l.text])) === JSON.stringify([
    ['danger', 'Trakt: 3 plays removed and 3 added at the restored dates'],
  ]), v.outside)
  check('…and the button says Undo anyway', v.confirmLabel === 'Undo anyway')
  check('a watch reads as one', v.changes[0].text === '3 watches: watched date put back', v.changes)
}
{
  const v = describeUndoPlan(plan({
    needs_confirm: true,
    outbox: [
      { s: 'trakt', op: 'history_remove', n: 2, items: ['Game of Thrones S01E01', 'Dune'] },
      { s: 'trakt', op: 'rating_add', n: 1 },
      { s: 'google_tasks', op: 'update', n: 2 },
      { s: 'google_calendar', op: 'delete', n: 1 },
    ],
  }))
  check('a whole-item Trakt remove says every play goes and can\'t be undone there', JSON.stringify(v.outside.map(l => l.text)) === JSON.stringify([
    "Trakt: every play of 2 items («Game of Thrones S01E01», «Dune») is removed there — this can't be undone on Trakt",
    'Trakt: 1 rating changed',
    'Google Tasks: 2 tasks changed',
    'Google Calendar: 1 event removed',
  ]), v.outside.map(l => l.text))
  check('every outside line is danger', v.outside.every(l => l.tone === 'danger'))
}
{
  // 173: an undo that touches slots or plans in an Apple Calendar area says it reaches Apple Calendar too.
  const v = describeUndoPlan(plan({ needs_confirm: true, outbox: [{ s: 'apple_calendar', op: 'upsert', n: 2 }], links_kept: [{ t: 'time_blocks', c: 'icloud_area', n: 1 }] }))
  check('Apple Calendar gets its own line and its link is named', JSON.stringify(v.outside.map(l => l.text)) === JSON.stringify([
    'Apple Calendar: 2 events brought up to date',
    "Apple Calendar: 1 schedule block keeps its current event link — Undo doesn't put the old one back",
  ]), v.outside.map(l => l.text))
}
{
  const v = describeUndoPlan(plan({
    needs_confirm: true, actors: ['service'], sync_save: ['user_tv_episodes', 'media_watches', 'tasks'],
  }))
  check('a sync\'s save whose undo sends nothing: the services may bring it back', JSON.stringify(v.outside.map(l => [l.tone, l.text])) === JSON.stringify([
    ['warn', 'This save came from AI / sync. Trakt and Google Tasks still have it — the next sync may bring it back'],
  ]), v.outside)
  check('…and who saved', v.subtitle.endsWith('· AI / sync'))
  const sent = describeUndoPlan(plan({
    needs_confirm: true, actors: ['service'], sync_save: ['user_tv_episodes', 'tasks'],
    outbox: [{ s: 'trakt', op: 'history_add', n: 1, items: null }],
  }))
  check('a service that gets the undo\'s change is named by its outbox line only', JSON.stringify(sent.outside.map(l => l.text)) === JSON.stringify([
    'Trakt: 1 play added at the restored dates',
    'This save came from AI / sync. Google Tasks still has it — the next sync may bring it back',
  ]), sent.outside.map(l => l.text))
  const all = describeUndoPlan(plan({
    needs_confirm: true, actors: ['service'], sync_save: ['tasks'], outbox: [{ s: 'google_tasks', op: 'update', n: 1 }],
  }))
  check('…and no sync line when it would only repeat the outbox lines', JSON.stringify(all.outside.map(l => l.text)) === JSON.stringify([
    'Google Tasks: 1 task changed',
  ]), all.outside.map(l => l.text))
}
{
  const v = describeUndoPlan(plan({
    needs_confirm: true,
    outbox: [{ s: 'google_calendar', op: 'update', n: 2 }, { s: 'google_calendar', op: 'create', n: 1 }, { s: 'google_calendar', op: 'delete', n: 1 }],
    links_kept: [{ t: 'time_blocks', c: 'google_calendar_event_id', n: 1 }, { t: 'tasks', c: 'google_tasklist_id', n: 2 }],
  }))
  check('Calendar: what the queue removes and the browser adds and moves, in one line', v.outside[0].text === 'Google Calendar: 1 event removed · 1 event added · 2 events changed', v.outside[0])
  check('links Undo leaves are said', JSON.stringify(v.outside.slice(1).map(l => [l.tone, l.text])) === JSON.stringify([
    ['warn', "Google Calendar: 1 schedule block keeps its current event link — Undo doesn't put the old one back"],
    ['warn', "Google Tasks: 2 tasks keep their current Google list — Undo doesn't put the old one back"],
  ]), v.outside.map(l => l.text))
  const only = describeUndoPlan(plan({ steps: 0, needs_confirm: true, links_kept: [{ t: 'time_blocks', c: 'google_calendar_event_id', n: 1 }] }))
  check('a save that only changed a link is not "nothing to undo"', !only.nothingToDo && !only.canUndo && only.outside.length === 1)
}
{
  // A plan from before 151 lacks the new fields: nothing breaks.
  const old = plan()
  for (const k of ['side_effects', 'side_hidden', 'outbox', 'sync_save', 'nearby', 'links_kept']) delete old[k]
  const v = describeUndoPlan(old)
  check('a plan from before 151 still reads', v.outside.length === 0 && v.also.length === 0 && v.hint === null)
}

console.log('\n8 · Rows a rule changes besides, rows in an unknown order')
{
  const v = describeUndoPlan(plan({
    needs_confirm: true,
    side_effects: [
      { t: 'time_blocks', id: 'e2200000-0000', op: 'DELETE', columns: null, label: 'Watch S01E05' },
      { t: 'user_tv_episodes', id: 'a1', op: 'UPDATE', columns: ['watched_at'], label: 'S01E01' },
      { t: 'user_tv_episodes', id: 'a2', op: 'UPDATE', columns: ['repeat_count', 'watched_at'], label: 'S01E02' },
    ],
    side_hidden: 1,
    collateral: [{ t: 'time_blocks', id: 'e2000000', how: 'deleted', label: 'Added later' }],
  }))
  check('also affected: collateral, then what a rule does', JSON.stringify(v.also.map(l => l.text)) === JSON.stringify([
    'Also deleted: 1 schedule block not made by this save («Added later»)',
    'Also deleted by a database rule: 1 schedule block («Watch S01E05»)',
    'Also changed by a database rule: 2 TV episodes («S01E01», «S01E02») · watched date, repeat count',
    "1 more change a database rule makes isn't in your log",
  ]), v.also.map(l => l.text))
}
{
  const v = describeUndoPlan(plan({
    needs_confirm: true,
    blocked: [{ t: 'tasks', reason: 'order_unknown', count: 2, rows: 1, labels: ['c'] },
              { t: 'user_tv_episodes', reason: 'order_unknown', count: 6, rows: 3, labels: ['S01E01', 'S01E02', 'S01E03'] }],
  }))
  check('order unknown, plainly, never "already as before"', JSON.stringify(v.blocked.map(l => l.text)) === JSON.stringify([
    '1 task («c») changed more than once in this save, order unknown — Undo leaves it as it is',
    '3 TV episodes («S01E01», «S01E02», «S01E03») changed more than once in this save, order unknown — Undo leaves them as they are',
  ]), v.blocked.map(l => l.text))
}

console.log('\n9 · Saves seconds apart (one Spread makes up to three)')
{
  const at = (s) => `2026-10-14T08:30:0${s}+00:00`
  const two = nearbyHint([{ tx: 3, at: at(4), changes: 3, when: 'after' }, { tx: 2, at: at(2), changes: 3, when: 'after' }])
  check('two after: only if they belong together; opens the newest', two.text
    === '2 more saves seconds later (one Spread?) — if they belong together, undo them too, newest first'
    && two.tx === 3 && two.action === 'Open the newest', two)
  const mixed = nearbyHint([{ tx: 1, at: at(0), changes: 3, when: 'before' }, { tx: 3, at: at(3), changes: 3, when: 'after' }])
  check('one after, one before', mixed.text
    === '1 more save seconds later and 1 earlier (one Spread?) — if they belong together, undo them too, newest first'
    && mixed.tx === 3, mixed)
  const before = nearbyHint([{ tx: 1, at: at(0), changes: 3, when: 'before' }, { tx: 2, at: at(1), changes: 3, when: 'before' }])
  check('two before: opens the one right before', before.text
    === '2 more saves seconds earlier (one Spread?) — if they belong together, undo them too, after this one'
    && before.tx === 2 && before.action === 'Open the one before', before)
  check('none', nearbyHint([]) === null && nearbyHint(undefined) === null)
  check('the sheet shows it', describeUndoPlan(plan({ nearby: [{ tx: 2, at: at(1), changes: 1, when: 'after' }] })).hint.text
    === '1 more save seconds later (one Spread?) — if they belong together, undo it too, newest first')
}

console.log('\n10 · After an undo of media rows, Trakt syncs')
{
  const r = (o) => ({ undo_tx: 9100, reverted: 0, overwritten: 0, deleted: 0, reinserted: 0, reverted_rows: [], reinserted_rows: [], deleted_rows: [], ...o })
  check('a watch reverted', touchesTrakt(plan({ applied: true, result: r({ reverted: 1, reverted_rows: [{ t: 'media_watches', columns: ['watched_at'], row: {} }] }) })))
  check('a movie deleted', touchesTrakt(plan({ applied: true, result: r({ deleted: 1, deleted_rows: [{ table: 'user_movie_entries', pk: 'id', rows: [] }] }) })))
  check('a task: no Trakt sync', !touchesTrakt(plan({ applied: true, result: r({ reverted: 1, reverted_rows: [{ t: 'tasks', columns: ['title'], row: {} }] }) })))
  check('a preview: no sync', !touchesTrakt(plan()))
}

console.log('\n11 · The table → service map matches the database\'s (151)')
{
  const sql = readFileSync(join(__dirname, '../supabase/migrations/151_undo_save_fixes.sql'), 'utf8')
  const body = sql.slice(sql.indexOf('function public.app_undo_synced'), sql.indexOf('$$;', sql.indexOf('function public.app_undo_synced')))
  const fromSql = {}
  for (const m of body.matchAll(/when p_table (?:in \(([^)]*)\)|= ('[a-z_]+')) then '([a-z_]+)'/g)) {
    for (const t of (m[1] ?? m[2]).match(/'[a-z_]+'/g)) fromSql[t.slice(1, -1)] = m[3]
  }
  const sorted = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]))
  check('SYNCED = app_undo_synced', Object.keys(fromSql).length > 0 && sorted(fromSql) === sorted(SYNCED), { sql: fromSql, ts: SYNCED })
}

console.log('\n12 · The toast')
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
