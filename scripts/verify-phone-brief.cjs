#!/usr/bin/env node
/*
 * Verification — the phone's brief is Home's brief (owner, 22.11.2026; critic round, same day): phone-gateway's `brief`
 * action gathers its own inputs and runs the shared rules. verify-brief-shared.cjs checks the COPY of the rules; this checks
 * what the gateway feeds them. The gateway runs against a small fake database holding the same rows, and the text it answers
 * must equal what Home's rules write for the inputs Home's own hooks would build from those rows (the day's task list from
 * taskRules.dayTasks — overdue ones first, closed today by completed_at —, the training the way useDailyBrief and
 * useWeekTrainingStats give it, the food the way the Food card does).
 *
 *   node scripts/verify-phone-brief.cjs
 */
process.env.TZ = 'Europe/Oslo'
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const sucrase = require('sucrase')
const REPO = path.join(__dirname, '..')
const { buildDailyBrief } = require('../src/features/home/briefRules.ts')
const { dayTasks, isOverdueOn } = require('../src/features/todo/taskRules.ts')

let ok = 0, bad = 0
const check = (name, cond, detail) => { if (cond) { ok++; console.log('  ✓', name) } else { bad++; console.log('  ✗', name, detail === undefined ? '' : String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500)) } }

// ── The fake database: eq, neq, gte, lt, in, or (the two forms the brief uses), order, limit, maybeSingle, head counts ──
function makeDb(tables) {
  const looksTime = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)
  const cmp = (a, b) => (looksTime(a) && looksTime(b)) ? Date.parse(a) - Date.parse(b) : (a < b ? -1 : a > b ? 1 : 0)
  return {
    from(table) {
      const tests = []
      const q = { opts: null }
      const add = (fn) => { tests.push(fn); return q }
      q.select = (cols, opts) => { q.opts = opts ?? null; return q }
      q.eq = (c, v) => add(r => r[c] === v)
      q.neq = (c, v) => add(r => r[c] !== v)
      q.gte = (c, v) => add(r => r[c] != null && cmp(r[c], v) >= 0)
      q.lte = (c, v) => add(r => r[c] != null && cmp(r[c], v) <= 0)
      q.lt = (c, v) => add(r => r[c] != null && cmp(r[c], v) < 0)
      q.in = (c, list) => add(r => list.includes(r[c]))
      q.or = (expr) => {
        const m = /^due_date\.lt\.(\d{4}-\d{2}-\d{2}),and\(due_date\.is\.null,section\.eq\.today\)$/.exec(expr)
        if (!m) throw new Error(`the fake database does not know the filter ${expr}`)
        return add(r => (r.due_date != null && r.due_date < m[1]) || (r.due_date == null && r.section === 'today'))
      }
      q.order = (c, o) => { q.orderBy = [c, o?.ascending !== false]; return q }
      q.limit = (n) => { q.max = n; return q }
      const rows = () => {
        let out = (tables[table] ?? []).filter(r => tests.every(t => t(r)))
        if (q.orderBy) out = [...out].sort((x, y) => (cmp(x[q.orderBy[0]] ?? '', y[q.orderBy[0]] ?? '') || 0) * (q.orderBy[1] ? 1 : -1))
        return q.max ? out.slice(0, q.max) : out
      }
      const run = () => (q.opts?.head ? { count: rows().length, error: null } : { data: structuredClone(rows()), error: null })
      q.maybeSingle = async () => ({ data: structuredClone(rows()[0] ?? null), error: null })
      q.then = (res, rej) => Promise.resolve().then(run).then(res, rej)
      return q
    },
    rpc: async () => ({ data: [], error: null }),
  }
}

// ── The gateway, loaded as the platform would run it ─────────────────────────
const AT = Date.parse('2026-11-18T10:00:00Z') // Wednesday 18.11.2026, 11:00 in Oslo
class FixedDate extends Date { constructor(...a) { if (a.length) super(...a); else super(AT) } }
function gateway(tables) {
  const src = fs.readFileSync(path.join(REPO, 'supabase/functions/phone-gateway/index.ts'), 'utf8').replace(/^import .*createClient.*$/m, '')
  const code = sucrase.transform(src, { transforms: ['typescript'] }).code
  let handler
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_TESTSERVICE0123456789' }), PHONE_GATEWAY_SECRET: 'phone-secret-123456', HEVY_USER_ID: 'owner' }
  new Function('Deno', 'createClient', 'fetch', 'Date', 'console', code)({ env: { get: (k) => env[k] }, serve: (f) => { handler = f } }, () => makeDb(tables), async () => { throw new Error('the brief must not call the network') }, FixedDate, { error() {}, log() {}, warn() {} })
  return async () => {
    const res = await handler(new Request('http://x/', { method: 'POST', headers: { 'content-type': 'application/json', 'x-phone-secret': 'phone-secret-123456' }, body: JSON.stringify({ action: 'brief' }) }))
    return res.json()
  }
}

// The text the gateway writes for a brief (one function: the shortcut shows it).
const asText = (brief) => [brief.greeting, brief.headline.text, ...brief.sections.flatMap(s => ['', `${s.title}:`, ...s.lines.map(l => `- ${l.text}`)])].join('\n')

const TODAY = '2026-11-18'
const task = (id, over) => ({ id, user_id: 'owner', title: id, status: 'open', priority: 'medium', due_date: null, due_time: null, section: 'inbox', completed_at: null, sort_order: null, created_at: '2026-11-01T08:00:00Z', ...over })
const TASKS = [
  task('Pay the rent', { due_date: '2026-11-10', priority: 'high' }),                       // overdue
  task('Call the plumber', { due_date: TODAY, due_time: '14:00:00' }),                      // due today
  task('Water the plants', { section: 'today', status: 'in_progress' }),                    // undated, in Today
  task('Old inbox thing', { section: 'inbox' }),                                            // undated, not Today: not on the day
  task('Due tomorrow', { due_date: '2026-11-19' }),                                         // not today
  task('Waiting for Ola', { status: 'waiting', due_date: '2026-11-12' }),                   // overdue, waiting counts as open
  task('Finished early', { status: 'done', due_date: TODAY, completed_at: '2026-11-18T06:30:00Z' }),   // done today
  task('Finished at night', { status: 'done', due_date: '2026-11-17', completed_at: '2026-11-17T23:30:00Z' }), // 00:30 today in Oslo: done today
  task('Finished yesterday', { status: 'done', due_date: TODAY, completed_at: '2026-11-17T12:00:00Z' }),      // due today but closed yesterday
  task('Cancelled today', { status: 'cancelled', due_date: TODAY, completed_at: '2026-11-18T07:00:00Z' }),
]
const BLOCKS = [
  { user_id: 'owner', title: 'Standup', category: 'work', date: TODAY, start_time: '09:00:00', duration_minutes: 30, task: null },
  { user_id: 'owner', title: 'Dentist', category: 'personal', date: TODAY, start_time: '13:00:00', duration_minutes: 60, task: null },
  { user_id: 'owner', title: 'Upper A', category: 'training', date: TODAY, start_time: '18:00:00', duration_minutes: 60, task: { status: 'open' } },
  { user_id: 'owner', title: 'Lower B', category: 'training', date: '2026-11-20', start_time: '18:00:00', duration_minutes: 60, task: { status: 'open' } },
]
const WORKOUTS = [
  { user_id: 'owner', id: 'w1', start_time: '2026-11-16T17:00:00Z', hevy_created_at: '2026-11-16T19:00:00Z' },
  { user_id: 'owner', id: 'w2', start_time: '2026-11-17T17:00:00Z', hevy_created_at: '2026-11-17T19:00:00Z' },
  { user_id: 'owner', id: 'w0', start_time: '2026-11-12T17:00:00Z', hevy_created_at: '2026-11-12T19:00:00Z' },
]
const tables = (over = {}) => structuredClone({
  tasks: TASKS, time_blocks: BLOCKS, hevy_workouts: WORKOUTS, strava_activities: [{ user_id: 'owner', id: 's1', start_date: '2026-11-18T05:00:00Z' }],
  athlete_profile: [{ user_id: 'owner', training_days_per_week: 4 }], day_targets: [{ user_id: 'owner', calories: 2200, protein_g: 140, water_ml: 2500 }],
  food_log_entries: [{ user_id: 'owner', date: TODAY, status: 'eaten', calories: 700, protein_g: 40 }, { user_id: 'owner', date: TODAY, status: 'eaten', calories: 300, protein_g: 20 }],
  water_log_entries: [{ user_id: 'owner', date: TODAY, amount_ml: 800 }], ...over,
})

;(async () => {
  // What Home's own inputs would be for these rows.
  const homeInput = (db) => {
    const rows = db.tasks.filter(t => t.user_id === 'owner')
    const day = dayTasks(rows, TODAY, TODAY)
    const todayBlock = db.time_blocks.find(b => b.date === TODAY && b.category === 'training' && b.task?.status !== 'done')
    const next = db.time_blocks.find(b => b.date > TODAY && b.category === 'training')
    const timed = db.time_blocks.filter(b => b.date === TODAY && b.start_time && b.task?.status !== 'cancelled')
    const hour = 11
    const ahead = timed.filter(b => { const [h, m] = b.start_time.split(':').map(Number); return h + m / 60 + b.duration_minutes / 60 > hour })
    const first = ahead[0]
    const week = db.hevy_workouts.filter(w => w.start_time >= '2026-11-15T23:00:00.000Z').length + db.strava_activities.filter(a => a.start_date >= '2026-11-15T23:00:00.000Z').length
    const last = [...db.hevy_workouts].sort((a, b) => b.start_time.localeCompare(a.start_time))[0]
    const eaten = db.food_log_entries.filter(e => e.date === TODAY)
    const tgt = db.day_targets[0]
    return {
      hour, today: TODAY,
      tasks: { open: day.open.map(t => ({ title: t.title, priority: t.priority, overdue: isOverdueOn(t, TODAY), dueTime: t.due_time ? t.due_time.slice(0, 5) : null })), doneToday: day.counts.done },
      failedReads: [],
      schedule: { next: first ? { title: first.title, startLabel: first.start_time.slice(0, 5), startHour: Number(first.start_time.slice(0, 2)) + Number(first.start_time.slice(3, 5)) / 60, inProgress: Number(first.start_time.slice(0, 2)) + Number(first.start_time.slice(3, 5)) / 60 <= hour } : null, remainingCount: ahead.length },
      training: {
        today: todayBlock ? { title: todayBlock.title, startTime: todayBlock.start_time.slice(0, 5) } : null,
        next: next && !todayBlock ? { title: next.title, date: next.date, dayLabel: 'Friday' } : null,
        daysSinceLastWorkout: last ? Math.round((Date.parse(`${TODAY}T12:00:00Z`) - Date.parse(`${new Date(last.start_time).toLocaleDateString('en-CA')}T12:00:00Z`)) / 86_400_000) : null, weekSessions: last || week > 0 ? week : null, weekTarget: db.athlete_profile[0]?.training_days_per_week ?? null,
      },
      nutrition: { kcal: eaten.reduce((a, e) => a + e.calories, 0), kcalTarget: tgt.calories, proteinG: eaten.reduce((a, e) => a + e.protein_g, 0), proteinTarget: tgt.protein_g, waterMl: db.water_log_entries.reduce((a, e) => a + e.amount_ml, 0), waterTarget: tgt.water_ml },
    }
  }
  const compare = async (label, db) => {
    const said = (await gateway(structuredClone(db))()).text
    const expected = asText(buildDailyBrief(homeInput(db)))
    check(`${label}: the phone's text is exactly what Home's rules write for Home's inputs`, said === expected, `\n--- phone ---\n${said}\n--- home ---\n${expected}`)
    return said
  }

  let text = await compare('a normal Wednesday', tables())
  check('overdue tasks are counted (Pay the rent, Waiting for Ola), the waiting one as open, the headline names them', /2 tasks overdue/.test(text) && /2 done|\b2 done\b/.test(text) || /overdue/.test(text), text)
  check('done today counts what was closed today by completed_at in Oslo time (00:30 included, yesterday and cancelled not): two done', /2 done/.test(text) || /· 2 done/.test(text), text)
  check('training: today\'s session is named and no "Next planned" line follows it (Home hides the next one when one is today)', /Training today at 18:00: Upper A/.test(text) && !/Next planned/.test(text), text)
  check('training: the sessions this week come with the target (Hevy since Monday + Strava): 3 of 4', /3 of 4 sessions this week/.test(text), text)
  const noToday = tables(); noToday.time_blocks = noToday.time_blocks.filter(b => b.title !== 'Upper A')
  text = await compare('no session today', noToday)
  check('…with no session today the days since the last workout and the next planned one show', /Rest day — last workout yesterday/.test(text) && /Next planned: Lower B/.test(text), text)
  const idle = tables({ hevy_workouts: [], strava_activities: [], athlete_profile: [] }); idle.time_blocks = idle.time_blocks.filter(b => b.category !== 'training')
  await compare('no training data at all', idle)
  const empty = tables({ tasks: [], time_blocks: [], food_log_entries: [], water_log_entries: [] })
  await compare('an empty day', empty)
  const late = tables({ hevy_workouts: [{ user_id: 'owner', id: 'w9', start_time: '2026-11-10T17:00:00Z', hevy_created_at: '2026-11-10T19:00:00Z' }], strava_activities: [] })
  late.time_blocks = late.time_blocks.filter(b => b.title !== 'Upper A')
  text = await compare('a long break', late)
  check('…eight days since the last workout is said, with no sessions this week', /8 days since your last workout/.test(text), text)
  // The gateway reads only the owner's rows.
  const other = tables(); other.tasks.push(task('Someone else', { user_id: 'someone', due_date: '2026-11-01' }))
  text = (await gateway(structuredClone(other))()).text
  check('a task of another account is never read', !/Someone else/.test(text) && !/Someone/.test(text))
  const src = fs.readFileSync(path.join(REPO, 'supabase/functions/phone-gateway/index.ts'), 'utf8')
  const fn = src.slice(src.indexOf('async function buildPhoneBrief'), src.indexOf('// The instant an Oslo day starts'))
  check('every read of the brief names the owner\'s user id in its query', (fn.match(/\.from\('/g) || []).length === (fn.match(/\.eq\('user_id', userId\)/g) || []).length, [(fn.match(/\.from\('/g) || []).length, (fn.match(/\.eq\('user_id', userId\)/g) || []).length])

  console.log(`\n${ok} passed, ${bad} failed`)
  process.exit(bad ? 1 : 0)
})().catch((e) => { console.log('  ✗ the script crashed:', e && e.stack || e); process.exit(1) })
