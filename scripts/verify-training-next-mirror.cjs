// "Next" is one rule everywhere (owner-critic, 27.11.2026): the app's This week (sessionState.planWeek), the phone's
// brief (phone-gateway) and the morning push (push-send) pick it with src/features/training/plan/nextRule.ts — the
// functions carry its <training-next-rule> block verbatim (scripts/sync-training-next-shared.mjs). Checks the copies
// and that the server's reading of the rows gives the app's next.
//   node scripts/verify-training-next-mirror.cjs
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
const R = require('../src/features/training/plan/nextRule.ts')
const S = require('../src/features/training/plan/sessionState.ts')

let passed = 0, failed = 0
const check = (name, ok, detail) => { if (ok) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) } }
const read = f => fs.readFileSync(path.join(root, f), 'utf8')
const block = t => { const a = t.indexOf('// <training-next-rule>'), b = t.indexOf('// </training-next-rule>'); return a < 0 || b < a ? null : t.slice(a, b) }
const strip = t => t && t.replace(/\/\/ GENERATED from[^\n]*\n/, '')

const source = block(read('src/features/training/plan/nextRule.ts'))
for (const f of ['supabase/functions/phone-gateway/index.ts', 'supabase/functions/push-send/index.ts']) {
  const text = read(f)
  check(`${path.basename(path.dirname(f))}: carries the rule verbatim (run node scripts/sync-training-next-shared.mjs)`, strip(block(text)) === source)
  check(`${path.basename(path.dirname(f))}: its next comes from the rule (pickNextCandidate over trainingCandidatesFrom)`, /pickNextCandidate\(list, trainingProgramOrder\(/.test(text) && /await nextTrainingFor\(userId, today\)/.test(text))
}
check('planWeek picks next with the same rule', /pickNextCandidate\(/.test(read('src/features/training/plan/sessionState.ts')))
check('push-send\'s morning line is English (no Turkish words)', !/bugün|açık iş/.test(read('supabase/functions/push-send/index.ts')))

// The same week read both ways. Fri 27.11.2026; Upper A done Wed (late), Lower A missed Tue (still open), Upper B
// today, Lower B a weekly plan on Sat with no task yet.
const today = '2026-11-27'
const routines = [{ id: 'ua', title: 'Upper A' }, { id: 'la', title: 'Lower A' }, { id: 'ub', title: 'Upper B' }, { id: 'lb', title: 'Lower B' }]
const templates = [
  { id: 'p-ua', title: 'Upper A', category: 'training', days_of_week: [1], start_time: '07:00:00', effective_from: '2026-09-01', except_dates: [] },
  { id: 'p-la', title: 'Lower A', category: 'training', days_of_week: [2], start_time: '07:00:00', effective_from: '2026-09-01', except_dates: [] },
  { id: 'p-ub', title: 'Upper B', category: 'training', days_of_week: [5], start_time: '07:00:00', effective_from: '2026-09-01', except_dates: [] },
  { id: 'p-lb', title: 'Lower B', category: 'training', days_of_week: [6], start_time: '10:00:00', effective_from: '2026-09-01', except_dates: [] },
]
const task = (r, date, extra = {}) => ({ title: routines.find(x => x.id === r).title, due_date: date, status: 'open', hevy_routine_id: r, first_plan_date: date, schedule_block_id: `p-${r}`, occurrence_date: date, ...extra })
const cases = [
  ['a missed session still counting comes before today\'s', [task('ua', '2026-11-23', { status: 'done', hevy_workout_id: 'w' }), task('la', '2026-11-24'), task('ub', '2026-11-27')], 'Lower A'],
  ['today\'s comes next when nothing passed is open', [task('ua', '2026-11-23', { status: 'done', hevy_workout_id: 'w' }), task('la', '2026-11-24', { status: 'cancelled' }), task('ub', '2026-11-27')], 'Upper B'],
  ['after today\'s is done: the weekly plan\'s Saturday (no task yet)', [task('la', '2026-11-24', { status: 'done', hevy_workout_id: 'w2' }), task('ub', '2026-11-27', { status: 'done', hevy_workout_id: 'w3' })], 'Lower B'],
]
for (const [name, tasks, want] of cases) {
  const list = R.trainingCandidatesFrom({ today, to: '2026-12-11', tasks, templates, routines })
  const order = R.trainingProgramOrder(templates, t => routines.find(r => r.title === t)?.id ?? null)
  const server = R.pickNextCandidate(list, order, today)
  const app = S.planWeek({
    today, monday: '2026-11-23', order, trainedToday: false,
    sessions: list.filter(c => c.date >= '2026-11-16' && c.date <= '2026-11-29').map(c => {
      const t = tasks.find(x => x.due_date === c.date && x.title === c.title)
      return { key: `${c.title}@${c.date}`, title: c.title, routineId: c.routineId, date: c.date,
        status: S.sessionStatus({ date: c.date, today, taskStatus: t ? (t.status === 'done' ? 'done' : t.status) : null, taskWorkoutId: t?.hevy_workout_id ?? null, taskRoutineId: c.routineId, firstDate: c.date }) }
    }),
  }).next
  check(`${name}: phone and push say ${want}, as the app`, server?.title === want && app?.title === want, `server ${server?.title}, app ${app?.title}`)
}

console.log(`\nverify-training-next-mirror: ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
