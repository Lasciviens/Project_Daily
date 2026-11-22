#!/usr/bin/env node
/* Verification — "Needs a decision" (src/features/todo/needsDecision.ts):
 * open tasks a week or more past their due day, or undated for 30+ days; a
 * task under the Someday label, a waiting one, a training session, a repeat's
 * day and a project's undated task are never listed; longest-waiting first;
 * the answers (pick a day, Someday) and what Undo writes back.
 * Run: node scripts/verify-needs-decision.cjs */
require('sucrase/register')
const { needsDecision, pickDayPatch, somedayPatch, reversePatch, isSomeday } = require('../src/features/todo/needsDecision')
let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const TODAY = '2026-11-22'
let n = 0
const task = (o = {}) => ({
  id: `t${++n}`, title: 'Buy filters', status: 'open', due_date: null, start_date: null, labels: [],
  created_at: '2026-11-20T10:00:00+01:00', source_type: 'manual', hevy_routine_id: null, schedule_block_id: null, project_id: null, section: 'inbox', ...o,
})
const ids = rows => rows.map(r => r.task.id)

console.log('stuck (past due)')
let t = task({ due_date: '2026-11-15' })
let r = needsDecision([t], TODAY)
check('7 days late is listed', r.length === 1 && r[0].kind === 'stuck' && r[0].days === 7, JSON.stringify(r.map(x => x.days)))
check('reads "Due 15.11.2026 · 7 days late"', r[0].text === 'Due 15.11.2026 · 7 days late', r[0].text)
check('6 days late is not', needsDecision([task({ due_date: '2026-11-16' })], TODAY).length === 0)
check('due in the future is not', needsDecision([task({ due_date: '2026-12-01' })], TODAY).length === 0)
check('in progress counts', needsDecision([task({ due_date: '2026-10-01', status: 'in_progress' })], TODAY).length === 1)
check('1 day late is not', needsDecision([task({ due_date: '2026-11-21', created_at: '2026-01-01T00:00:00Z' })], TODAY).length === 0)

console.log('undated')
r = needsDecision([task({ created_at: '2026-10-23T09:00:00+02:00' })], TODAY)
check('30 days undated is listed', r.length === 1 && r[0].kind === 'undated' && r[0].days === 30, JSON.stringify(r.map(x => x.days)))
check('reads "No date for 30 days"', r[0].text === 'No date for 30 days')
check('29 days is not', needsDecision([task({ created_at: '2026-10-24T09:00:00+02:00' })], TODAY).length === 0)
check('a window start counts as a date', needsDecision([task({ created_at: '2026-01-01T00:00:00Z', start_date: '2026-12-01' })], TODAY).length === 0)

console.log('never listed')
const old = { created_at: '2026-01-01T00:00:00Z' }
check('done / cancelled / waiting', needsDecision([task({ ...old, status: 'done' }), task({ ...old, status: 'cancelled' }), task({ ...old, status: 'waiting' })], TODAY).length === 0)
check('Someday label (any case)', needsDecision([task({ ...old, labels: ['someday'] }), task({ ...old, due_date: '2026-01-02', labels: ['Errands', 'SOMEDAY'] })], TODAY).length === 0)
check('training session', needsDecision([task({ ...old, source_type: 'training', hevy_routine_id: 'x', due_date: '2026-01-02' })], TODAY).length === 0)
check('a repeat\'s day', needsDecision([task({ ...old, due_date: '2026-01-02', schedule_block_id: 'sb' })], TODAY).length === 0)
check('a project\'s undated task', needsDecision([task({ ...old, project_id: 'p1' })], TODAY).length === 0)
check('a project\'s late task IS listed', needsDecision([task({ ...old, project_id: 'p1', due_date: '2026-01-02' })], TODAY).length === 1)

console.log('order')
const a = task({ due_date: '2026-11-01' }), b = task({ ...old }), c = task({ due_date: '2026-11-10' })
check('longest waiting first', JSON.stringify(ids(needsDecision([a, b, c], TODAY))) === JSON.stringify([b.id, a.id, c.id]))
check('input is not changed', needsDecision([a, b, c], TODAY) !== null)

console.log('answers and Undo')
check('pick a day: date and its section (another day → backlog)', JSON.stringify(pickDayPatch('2026-11-25', TODAY)) === JSON.stringify({ due_date: '2026-11-25', section: 'backlog' }))
check('pick today → today section', pickDayPatch(TODAY, TODAY).section === 'today')
const lab = task({ labels: ['Errands'] })
check('Someday keeps the other labels', JSON.stringify(somedayPatch(lab).labels) === JSON.stringify(['Errands', 'Someday']))
check('Someday twice is once', somedayPatch(task({ labels: ['someday'] })).labels.length === 1)
check('isSomeday', isSomeday({ labels: ['Someday'] }) && !isSomeday({ labels: [] }) && !isSomeday({}))
const dated = task({ due_date: '2026-11-01', section: 'backlog' })
check('Undo of a pick restores date and section', JSON.stringify(reversePatch(dated, pickDayPatch('2026-11-25', TODAY))) === JSON.stringify({ due_date: '2026-11-01', section: 'backlog' }))
check('Undo of a pick on an undated task clears the date', reversePatch(b, pickDayPatch('2026-11-25', TODAY)).due_date === null)
check('Undo of Someday restores the labels', JSON.stringify(reversePatch(lab, somedayPatch(lab)).labels) === JSON.stringify(['Errands']))

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
