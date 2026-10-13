#!/usr/bin/env node
/*
 * Verification — step 3 (13.10.2026): one delete flow, results said from the
 * write's own answer, and writes that don't wait for re-reads.
 *
 *  1. runDeleteFlow (src/shared/modals/deleteFlowCore.ts): asks first, a "no"
 *     deletes nothing, the delete's answer decides the message (nothing there
 *     = "Already deleted"), Undo restores and says what didn't come back, a
 *     delete with no Undo says so in the question, too-big deletes say so.
 *  2. cachePatch (src/shared/query/cachePatch.ts) against a small fake
 *     QueryClient: rows patched / replaced / removed in every cached list and
 *     single row, other shapes left alone, snapshot + restore.
 *  3. taskWrites (src/features/todo/taskWrites.ts): the optimistic task
 *     (completed_at and focus like migrations 129/143) and the result message.
 *  4. deletedRows helpers: rowsOf, notRestoredNote.
 *  5. Guards over src/: the mutation primitive no longer waits for its
 *     refresh by default and demands a result or a reason to stay silent;
 *     requireUser reads the local session; a raw supabase `.delete()` only
 *     where listed below (a new delete goes through useRowsDelete /
 *     confirmDelete, or is added here with its reason).
 *
 *   Run:  node scripts/verify-delete-flow.cjs
 */
require('sucrase/register')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
let pass = 0
let fail = 0
function ok(cond, msg) {
  if (cond) { pass++; return }
  fail++
  console.error('FAIL', msg)
}

// sucrase/register can't load the live supabase client: stub what the pure
// modules' neighbours import.
const Module = require('module')
const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (/integrations\/supabase\/client$/.test(request)) return { supabase: {} }
  return origLoad.call(this, request, parent, isMain)
}

const { runDeleteFlow, NO_UNDO } = require('../src/shared/modals/deleteFlowCore')
const { mapRowsInCache, putRowsInCache, removeRowsFromCache, snapshotCache, restoreCache } = require('../src/shared/query/cachePatch')
const { applyTaskPatch, taskUpdateMessage } = require('../src/features/todo/taskWrites')
const { rowsOf, notRestoredNote, restoreAnswer } = require('../src/shared/utils/deletedRows')

function deps(answer = true) {
  const log = { asked: null, undo: null, success: [], info: [], warning: [] }
  return {
    log,
    deps: {
      confirm: async o => { log.asked = o; return answer },
      undoToast: (m, onUndo) => { log.undo = { m, onUndo } },
      success: m => log.success.push(m),
      info: m => log.info.push(m),
      warning: m => log.warning.push(m),
    },
  }
}
const tick = () => new Promise(r => setTimeout(r, 0))

;(async () => {
  // ── 1. the flow ─────────────────────────────────────────────────────────
  {
    const { log, deps: d } = deps(false)
    let removed = false
    const r = await runDeleteFlow({ title: 'Delete this task?', remove: async () => { removed = true; return [1] }, restore: async () => {}, done: 'Task deleted' }, d)
    ok(r === 'kept' && !removed, 'a "no" deletes nothing')
    ok(log.asked && log.asked.title === 'Delete this task?' && log.asked.destructive === true && log.asked.confirmLabel === 'Delete', 'it asks with the title, a red Delete')
    ok(log.asked.message === undefined, 'an undoable delete does not say "can\'t be undone"')
  }
  {
    const { log, deps: d } = deps(true)
    let restoredWith = null
    const snap = { rows: [{ id: 'a' }] }
    const r = await runDeleteFlow({ title: 'Delete?', remove: async () => snap, restore: async s => { restoredWith = s }, done: s => `Deleted ${s.rows.length}` }, d)
    ok(r === 'deleted', 'a yes deletes')
    ok(log.undo && log.undo.m === 'Deleted 1', 'the result is said with Undo, from the delete\'s own answer')
    log.undo.onUndo(); await tick()
    ok(restoredWith === snap, 'Undo restores exactly what the delete returned')
    ok(log.success.includes('Restored'), 'Undo says Restored')
  }
  {
    const { log, deps: d } = deps(true)
    await runDeleteFlow({ title: 'Delete?', remove: async () => [1], restore: async () => 'Not brought back: price history', done: 'Deleted', restored: 'Back' }, d)
    log.undo.onUndo(); await tick()
    ok(log.warning[0] === 'Back · Not brought back: price history', 'an Undo that could not bring everything back says so')
  }
  {
    const { log, deps: d } = deps(true)
    await runDeleteFlow({ title: 'Delete?', remove: async () => [1], restore: async () => ({ nothing: "Not restored — it's already there again" }), done: 'Deleted' }, d)
    log.undo.onUndo(); await tick()
    ok(log.warning[0] === "Not restored — it's already there again" && !log.success.length, 'an Undo that brought nothing back never says "Restored"')
  }
  {
    const { log, deps: d } = deps(true)
    const r = await runDeleteFlow({ title: 'Delete?', remove: async () => null, restore: async () => {}, done: 'Deleted' }, d)
    ok(r === 'gone' && log.info[0] === 'Already deleted' && !log.undo, 'nothing deleted (sy-subrc 4): "Already deleted", no Undo')
    const r2 = await runDeleteFlow({ title: 'Delete?', remove: async () => [], restore: async () => {}, done: 'Deleted' }, deps(true).deps)
    ok(r2 === 'gone', 'an empty answer is nothing deleted too')
  }
  {
    const { log, deps: d } = deps(true)
    const r = await runDeleteFlow({ title: 'Delete?', remove: async () => { throw new Error('x') }, restore: async () => {}, done: 'Deleted' }, d)
    ok(r === 'failed' && !log.undo && log.success.length === 0 && log.info.length === 0, 'a failed delete adds no message (its mutation showed the error)')
  }
  {
    const { log, deps: d } = deps(true)
    await runDeleteFlow({ title: 'Delete list?', message: 'On Google too.', remove: async () => true, done: 'List deleted' }, d)
    ok(log.asked.message === `On Google too. ${NO_UNDO}`, 'a delete with no Undo says so in the question')
    ok(log.success[0] === 'List deleted' && !log.undo, 'and reports without an Undo button')
  }
  {
    const { log, deps: d } = deps(true)
    await runDeleteFlow({ title: 'Delete?', remove: async () => ({ too_big: true }), restore: async () => {}, canUndo: s => !s.too_big, done: 'Book deleted' }, d)
    ok(log.success[0] === 'Book deleted · too much to undo' && !log.undo, 'a delete too big to hold says it can\'t be undone')
  }
  {
    const { log, deps: d } = deps(true)
    const r = await runDeleteFlow({ title: 'x', ask: false, remove: async () => [1], restore: async () => {}, done: 'Deleted' }, d)
    ok(r === 'deleted' && log.asked === null, 'ask: false (the screen already asked) skips the question')
  }

  // ── 2. cache patches ────────────────────────────────────────────────────
  function fakeQc(entries) {
    const map = new Map(entries.map(([k, v]) => [JSON.stringify(k), { key: k, data: v }]))
    return {
      getQueriesData: ({ queryKey }) => [...map.values()].filter(e => queryKey.every((p, i) => JSON.stringify(e.key[i]) === JSON.stringify(p))).map(e => [e.key, e.data]),
      setQueryData: (key, data) => { map.set(JSON.stringify(key), { key, data }) },
      get: key => map.get(JSON.stringify(key))?.data,
    }
  }
  {
    const qc = fakeQc([
      [['tasks', 'day', '2026-10-13'], [{ id: 'a', status: 'open' }, { id: 'b', status: 'open' }]],
      [['tasks', 'work'], [{ id: 'a', status: 'open' }]],
      [['tasks', 'by-id', 'a'], { id: 'a', status: 'open' }],
      [['tasks', 'counts'], { open: 2 }],
      [['schedule', 'day', '2026-10-13'], [{ id: 'a', title: 'not a task' }]],
    ])
    const snap = snapshotCache(qc, ['tasks'])
    mapRowsInCache(qc, ['tasks'], new Set(['a']), t => ({ ...t, status: 'done' }))
    ok(qc.get(['tasks', 'day', '2026-10-13'])[0].status === 'done' && qc.get(['tasks', 'day', '2026-10-13'])[1].status === 'open', 'a patch reaches the row in a list, not its neighbours')
    ok(qc.get(['tasks', 'work'])[0].status === 'done' && qc.get(['tasks', 'by-id', 'a']).status === 'done', '…in every list and the single-row read')
    ok(qc.get(['tasks', 'counts']).open === 2, 'other shapes are left to the refresh')
    ok(qc.get(['schedule', 'day', '2026-10-13'])[0].title === 'not a task', 'only under its own root')
    putRowsInCache(qc, ['tasks'], [{ id: 'a', status: 'done', completed_at: '2026-10-13T10:00:00Z' }])
    ok(qc.get(['tasks', 'work'])[0].completed_at === '2026-10-13T10:00:00Z', 'the write\'s answer replaces the guess')
    removeRowsFromCache(qc, ['tasks'], new Set(['a']))
    ok(qc.get(['tasks', 'day', '2026-10-13']).length === 1 && qc.get(['tasks', 'work']).length === 0, 'a deleted row leaves every list')
    ok(qc.get(['tasks', 'by-id', 'a']).id === 'a', 'a single-row read is left for its own re-read')
    restoreCache(qc, snap)
    ok(qc.get(['tasks', 'day', '2026-10-13']).length === 2 && qc.get(['tasks', 'day', '2026-10-13'])[0].status === 'open', 'a failed write puts the snapshot back')
  }

  // ── 3. task writes ──────────────────────────────────────────────────────
  {
    const t = { id: 'a', title: 'T', status: 'in_progress', is_focused: true, completed_at: null }
    const now = '2026-10-13T08:00:00.000Z'
    const done = applyTaskPatch(t, { status: 'done' }, now)
    ok(done.completed_at === now && done.is_focused === false, 'done: closed now, out of the focus (129, 143)')
    const back = applyTaskPatch({ ...done }, { status: 'open' }, now)
    ok(back.completed_at === null && back.is_focused === false, 'reopened: no close time, focus not brought back')
    const same = applyTaskPatch({ ...done }, { title: 'U' }, now)
    ok(same.completed_at === now && same.title === 'U', 'a title edit keeps the close time')
    ok(taskUpdateMessage({ status: 'cancelled' }) === 'Task cancelled', 'cancel says so')
    ok(taskUpdateMessage({ is_focused: true, status: 'in_progress' }) === 'In focus · started', 'focus that starts it says both')
    ok(taskUpdateMessage({ is_focused: false }) === 'Removed from focus', 'unfocus says so')
    ok(taskUpdateMessage({ status: 'waiting', waiting_for: 'Ola' }) === 'Waiting for Ola', 'waiting names who')
    ok(taskUpdateMessage({ title: 'x', description: 'y' }) === 'Task saved', 'an edit says saved')
  }

  // ── 4. deleted rows helpers ─────────────────────────────────────────────
  {
    const snap = { v: 1, root: 'games', deleted: 1, groups: [{ table: 'games', pk: 'id', rows: [{ id: 'g' }] }, { table: 'game_platforms', pk: 'id', rows: [{ id: 'p1' }, { id: 'p2' }] }], links: [], touched: [], hidden: ['secret_table'] }
    ok(rowsOf(snap, 'game_platforms').length === 2 && rowsOf(null, 'x').length === 0, 'rowsOf reads one table\'s deleted rows')
    ok(notRestoredNote(snap, { restored: 3, relinked: 0, skipped: ['scrape_decisions'] }, { scrape_decisions: 'its ScreenScraper history' }) === 'Not brought back: secret table, its ScreenScraper history', 'what didn\'t come back is named plainly')
    ok(notRestoredNote({ ...snap, hidden: [] }, { restored: 3, relinked: 0, skipped: [] }) === '', 'nothing to say when everything came back')
    const clean = { ...snap, hidden: [] }
    const total = clean.groups.reduce((n, g) => n + g.rows.length, 0)
    ok(restoreAnswer(clean, { restored: total, relinked: 0, skipped: [] }) === '', 'everything back: Undo just says "Restored"')
    ok(JSON.stringify(restoreAnswer(clean, { restored: 0, relinked: 0, skipped: [] })) === JSON.stringify({ nothing: "Not restored — it's already there again" }), 'nothing back (it exists again): said instead of "Restored"')
    ok(restoreAnswer(clean, { restored: total - 1, relinked: 0, skipped: [] }) === '1 already there', 'some rows already there are counted')
    ok(typeof restoreAnswer(clean, { restored: 0, relinked: 0, skipped: [clean.groups[0].table] }) === 'object', 'nothing back because it may not be written: not "Restored" either')
  }

  // ── 5. guards ───────────────────────────────────────────────────────────
  const read = p => fs.readFileSync(path.join(root, p), 'utf8')
  const primitive = read('src/shared/hooks/useMutationWithFeedback.ts')
  ok(/refresh = 'background'/.test(primitive) && /if \(refresh === 'wait'\) await refreshed/.test(primitive), 'mutations resolve when the write answers; the refresh runs on its own')
  ok(/\{ successMessage: .*silent\?: never \}\s*\|\s*\{ silent: string/s.test(primitive), 'a mutation must give a result message or a reason to stay silent')
  ok(!/supabase\.auth\.getUser\(\)/.test(read('src/shared/utils/requireUser.ts')), 'requireUser reads the local session (no auth round trip per save)')

  // Every raw `.delete()` left in the client — how many per file, and why
  // none is a user delete with Undo. A new one (also in a listed file) fails
  // here until it goes through the flow or is counted with its reason.
  const ALLOWED_RAW_DELETES = {
    'src/shared/utils/logError.ts': [1, 'trims old error logs'],
    'src/shared/utils/deletedRows.ts': [1, 'the shared delete itself (fallback before migration 144)'],
    'src/shared/hooks/usePushNotifications.ts': [1, 'turning notifications off on this device'],
    'src/security/accountState.ts': [1, 'sign-out clears this device'],
    'src/features/training/api/trainingSkipsApi.ts': [1, 'Undo skip (the undo itself)'],
    'src/features/training/api/trainingPlanApi.ts': [2, 'Undo skip (the undo itself)'],
    'src/features/training/api/athleteProfileApi.ts': [1, 'saving the current program replaces its rows'],
    'src/features/todo/api/googleTasksOutbox.ts': [1, 'a delivered outbox row'],
    'src/features/todo/api/googleTaskListsApi.ts': [1, 'the list deleted on Google (no Undo: confirmDelete says so)'],
    'src/features/shop/api/shopApi.ts': [1, 'shop_delete_items fallback before migration 137'],
    'src/features/recipes/api/recipesApi.ts': [1, 'saving a recipe replaces its ingredient lines (fallback before 123)'],
    'src/features/recipes/api/mealPlanApi.ts': [1, 'the legacy plan table before migration 061'],
    'src/features/recipes/api/foodLogApi.ts': [1, 'a star toggled off (favourite)'],
    'src/features/media/reminders/remindersApi.ts': [1, 'a reminder bell toggled off'],
    'src/features/media/api/watchedEpisodesApi.ts': [1, 'Not watched (step 5 brings its Undo)'],
    'src/features/media/api/followsApi.ts': [1, 'Follow toggled off / a list stops filling (its delete goes through useDeleteFollow)'],
    'src/features/home/api/transitStoreApi.ts': [2, 'a Home/Work place replaced by a new stop; recent searches trimmed'],
    'src/features/developer/api/logsApi.ts': [2, 'Clear all logs (no Undo: confirmDelete says so)'],
    'src/features/daily/api/waterApi.ts': [1, 'the water card\'s own Undo chip (the undo itself)'],
    'src/features/books/api/libraryApi.ts': [1, 'merging two books deletes the duplicate'],
    'src/features/books/api/koboControlApi.ts': [2, 'a Kobo sleep image (its file is deleted: no Undo) and its storage cleanup'],
    'src/features/books/api/booksApi.ts': [3, 'Kobo inbox housekeeping (files leave storage: no Undo)'],
  }
  const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : [])
  const found = new Map()
  for (const f of walk('src')) {
    const n = read(f).split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l))
      .reduce((c, l) => c + (l.match(/\.delete\(\)/g) || []).length, 0)
    if (n) found.set(f.split(path.sep).join('/'), n)
  }
  for (const [f, n] of found) {
    const listed = ALLOWED_RAW_DELETES[f]
    ok(listed && listed[0] === n, `${f} has ${n} raw delete(s), ${listed ? listed[0] : 0} listed — use useRowsDelete / confirmDelete, or count it with its reason`)
  }
  for (const f of Object.keys(ALLOWED_RAW_DELETES)) ok(found.has(f), `${f} is listed but no longer deletes — take it off the list`)

  console.log(`verify-delete-flow: ${pass} passed${fail ? `, ${fail} FAILED` : ''}`)
  process.exit(fail ? 1 : 0)
})()
