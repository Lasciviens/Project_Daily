// Runs migration 160's scenarios (supplement schedules and reminders) on a
// throwaway Postgres: a fresh database from
// scripts/db-tests/supplement-schedules/base.sql, 156's repeat rule functions
// as 156 wrote them (160 replaces repeat_occurs_on with a call of the one
// rule), the real migration 144 (the delete with Undo), the real 160 TWICE
// (a re-run must be a no-op), then:
//   1. supplement-schedules/scenarios.sql — the table rules, the refused
//      rows, Take (a food, a recipe, a custom line, twice, from the phone),
//      the doses' states, the reminders (once, until taken, a snooze, the
//      window, a late dose, the owner lock), the job's own command, the
//      phone's log_supplement match and a delete with Undo;
//   2. the SQL dose rules against src/features/supplements/supplementDoses.ts
//      on the same rows: scheduleOn = supplement_schedule_on day by day over
//      two years for every repeat kind (with a pause and an end), every dose's
//      status = supplement_doses at several instants, and the due reminders =
//      supplement_doses_due every 5 minutes over two days (one of them the
//      autumn clock change).
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-supplement-schedules.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const migFile = mig('160_supplement_schedules.sql')

// ── Static: the migration's shape ───────────────────────────────────────────
const raw = readFileSync(migFile, 'utf8')
const sql = raw.replace(/--.*$/gm, '')
const staticFail = []
if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) staticFail.push('no top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
if (!/cron\.unschedule\('lascis-supplement-reminders'\)/.test(sql) || !/cron\.schedule\('lascis-supplement-reminders',\s*'\*\/15 \* \* \* \*'/.test(sql)) {
  staticFail.push('the job is (re)scheduled with cron.unschedule + cron.schedule every 15 minutes')
}
if (!/vault\.decrypted_secrets where name = 'PUSH_CRON_SECRET'/.test(sql)) staticFail.push('the job reads PUSH_CRON_SECRET from Vault inside the job')
if (!/<repeat-rule>[\s\S]*create or replace function public\.repeat_occurs_on[\s\S]*<\/repeat-rule>/.test(raw)) {
  staticFail.push('the repeat rule section (<repeat-rule> … </repeat-rule>) holds repeat_occurs_on — verify-db-repeat-days applies it')
}
if (!/<repeat-rule>/.test(readFileSync(join(root, 'scripts/verify-db-repeat-days.mjs'), 'utf8'))) {
  staticFail.push('verify-db-repeat-days applies 160\'s repeat rule section, so its day-by-day comparison runs on the refactored rule')
}
if (!/owner_lock_apply\('public\.supplement_schedules'\)/.test(sql) || !/owner_lock_apply\('public\.supplement_dose_state'\)/.test(sql)) {
  staticFail.push('both tables get the owner lock')
}
// 160 redefines Undo's bookkeeping list: every entry of the latest earlier
// definition must still be in it (only supplement_schedules is added).
{
  const lists = readdirSync(join(root, 'supabase/migrations')).filter(f => /^\d{3}_.*\.sql$/.test(f) && f < '160_')
    .sort().map(f => readFileSync(mig(f), 'utf8').match(/function public\.app_undo_bookkeeping\(p_table text\)[\s\S]*?\n\$\$;/)?.[0]).filter(Boolean)
  const whens = s => (s.match(/when '[a-z_]+' then array\[[^\]]*\]/g) || []).map(w => w.replace(/\s+/g, ' '))
  const before = whens(lists.at(-1) ?? ''), now = whens(raw.match(/function public\.app_undo_bookkeeping\(p_table text\)[\s\S]*?\n\$\$;/)?.[0] ?? '')
  const lost = before.filter(w => !now.includes(w))
  if (!before.length || lost.length || !now.some(w => w.includes("'supplement_schedules' then array['stock_set_at']"))) {
    staticFail.push(`app_undo_bookkeeping keeps the earlier entries and adds supplement_schedules.stock_set_at (lost: ${lost.join('; ') || '—'})`)
  }
}
if (staticFail.length) {
  console.error(`verify-db-supplement-schedules: migration 160 — ${staticFail.join('; ')}`)
  process.exit(1)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-supplement-schedules: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const dir = join(root, 'scripts/db-tests/supplement-schedules')
const db = `t160_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args, input) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args],
  { encoding: 'utf8', input, stdio: [input == null ? 'ignore' : 'pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })
const json = (u, query) => JSON.parse(psql(u, ['-At', '-c', query]).trim() || 'null')

// 156's rule functions, as 156 wrote them.
const m156 = readFileSync(mig('156_repeat_days_as_tasks.sql'), 'utf8')
const fn156 = name => {
  const m = m156.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;\\n`))
  if (!m) throw new Error(`verify-db-supplement-schedules: no ${name} in migration 156`)
  return m[0]
}

// ── The app's rules ─────────────────────────────────────────────────────────
const require = createRequire(import.meta.url)
require('sucrase/register')
const D = require('../src/features/supplements/supplementDoses.ts')
const R = require('../src/features/daily/recurrence.ts')

/** The home clock (Europe/Oslo) at an instant — what the device shows the owner. */
const OSLO = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
function osloNow(iso) {
  const ms = Date.parse(iso)
  const p = Object.fromEntries(OSLO.formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), ms }
}

const U2 = '00000000-0000-0000-0000-000000000002'
// Every repeat kind, a pause and an end, every reminder kind, a dose after the
// window's end, a dose just before midnight.
const COMPARE = [
  { title: 'c01 MWF', times: ['08:00', '20:00'], days_of_week: [1, 3, 5], effective_from: '2026-01-05' },
  { title: 'c02 daily once', times: ['07:15'], remind: 'once', effective_from: '2026-02-01' },
  { title: 'c03 monthly Sat', times: ['09:00'], days_of_week: [6], repeat_kind: 'monthly', effective_from: '2026-10-13', remind_every_min: 30, remind_until: '12:00' },
  { title: 'c04 every 3 days', times: ['21:30'], days_of_week: [], repeat_kind: 'interval', repeat_interval: 3, repeat_unit: 'day', effective_from: '2026-02-27', remind_every_min: 120, remind_until: '21:00' },
  { title: 'c05 2 weeks Tue Thu off', times: ['12:00'], days_of_week: [2, 4], repeat_kind: 'interval', repeat_interval: 2, repeat_unit: 'week', effective_from: '2026-01-07', remind: 'off' },
  { title: 'c06 2 months', times: ['10:00'], days_of_week: [], repeat_kind: 'interval', repeat_interval: 2, repeat_unit: 'month', effective_from: '2026-01-31' },
  { title: 'c07 picked dates', times: ['11:00', '18:00'], days_of_week: [], repeat_kind: 'dates', repeat_dates: ['2026-02-28', '2026-10-16', '2026-10-25', '2027-12-31'], effective_from: '2026-02-28' },
  { title: 'c08 paused and ending', times: ['06:00'], effective_from: '2026-03-01', paused_from: '2026-05-10', paused_until: '2026-06-01', ends_on: '2027-03-31' },
  { title: 'c09 late night', times: ['23:50'], effective_from: '2026-01-01', remind_until: '22:00' },
  { title: 'c10 except days', times: ['13:00'], effective_from: '2026-01-01', except_dates: ['2026-10-16', '2026-12-24'], remind_every_min: 15, remind_until: '23:00' },
  { title: 'c11 open pause', times: ['08:30'], effective_from: '2026-01-01', paused_from: '2026-11-15' },
  { title: 'c12 3 months Wed', times: ['10:00'], days_of_week: [3], repeat_kind: 'interval', repeat_interval: 3, repeat_unit: 'month', effective_from: '2026-01-29' },
  { title: 'c13 two capsules', times: ['07:00', '12:00', '19:00'], effective_from: '2026-10-10', dose_amount: 2, dose_unit: 'capsule', remind_every_min: 30 },
  { title: 'c14 a portion', times: ['21:00'], effective_from: '2026-10-10', dose_amount: 1.5, dose_unit: 'serving', remind: 'once' },
]
const lit = v => (v == null ? 'null' : `'${v}'`)
const arr = (a, type) => (a == null ? 'null' : `'{${a.join(',')}}'::${type}[]`)
const compareRows = COMPARE.map((c, i) => `('${`11000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`}', '${U2}', '${c.title}', ${c.dose_amount ?? 1}, '${c.dose_unit ?? 'g'}',
  ${arr(c.times, 'time')}, ${arr(c.days_of_week ?? [0, 1, 2, 3, 4, 5, 6], 'integer')}, ${lit(c.repeat_kind ?? 'weekly')}, ${c.repeat_interval ?? 'null'},
  ${lit(c.repeat_unit)}, ${arr(c.repeat_dates, 'date')}, ${lit(c.effective_from)}, ${arr(c.except_dates ?? [], 'date')}, ${lit(c.ends_on)},
  ${lit(c.remind ?? 'until_taken')}, ${c.remind_every_min ?? 60}, ${lit(c.remind_until ?? '22:00')}, ${lit(c.paused_from)}, ${lit(c.paused_until)})`).join(',\n')
const sid = i => `11000000-0000-4000-8000-${String(i).padStart(12, '0')}`
// What happened on the compared days: lines (taken) and states.
const factsSql = `
insert into public.supplement_schedules (id, user_id, title, dose_amount, dose_unit, times, days_of_week, repeat_kind, repeat_interval,
  repeat_unit, repeat_dates, effective_from, except_dates, ends_on, remind, remind_every_min, remind_until, paused_from, paused_until) values
${compareRows};
insert into public.food_log_entries (user_id, date, meal_slot, custom_title, supplement_schedule_id, dose_time, created_at) values
  ('${U2}', '2026-10-16', 'supplement', 'c01', '${sid(1)}', '08:00', '2026-10-16 08:40+02'),
  ('${U2}', '2026-10-15', 'supplement', 'c02', '${sid(2)}', '07:15', '2026-10-15 07:20+02'),
  ('${U2}', '2026-10-16', 'supplement', 'c07', '${sid(7)}', '18:00', '2026-10-16 17:00+02'),
  ('${U2}', '2026-10-25', 'supplement', 'c02', '${sid(2)}', '07:15', '2026-10-25 09:00+01');
insert into public.supplement_dose_state (user_id, schedule_id, dose_date, dose_time, skipped_at, snoozed_until, last_reminded_at, reminders_sent) values
  ('${U2}', '${sid(1)}', '2026-10-16', '20:00', null, '2026-10-16 20:40+02', '2026-10-16 20:00+02', 1),
  ('${U2}', '${sid(2)}', '2026-10-16', '07:15', null, null, '2026-10-16 07:15+02', 1),
  ('${U2}', '${sid(9)}', '2026-10-16', '23:50', null, null, '2026-10-16 23:50+02', 1),
  ('${U2}', '${sid(10)}', '2026-10-15', '13:00', '2026-10-15 13:05+02', null, null, 0),
  ('${U2}', '${sid(7)}', '2026-10-16', '11:00', null, null, '2026-10-16 11:00+02', 3),
  ('${U2}', '${sid(4)}', '2026-10-25', '21:30', null, '2026-10-25 22:00+01', '2026-10-25 21:30+01', 1),
  ('${U2}', '${sid(1)}', '2026-10-14', '08:00', '2026-10-14 09:00+02', null, null, 0);
`

psql(url, ['-c', `create database ${db}`])
const scratch = mkdtempSync(join(tmpdir(), 'verify160-'))
let failed = null
let checks = 0
try {
  const target = withDb(url, db)
  psql(target, ['-f', join(dir, 'base.sql')])
  const ruleFile = join(scratch, 'rule156.sql')
  writeFileSync(ruleFile, ['repeat_monthly_day', 'repeat_monthly_hits', 'repeat_occurs_on'].map(fn156).join('\n'))
  psql(target, ['-f', ruleFile])
  psql(target, ['-f', mig('144_delete_with_undo.sql')])
  psql(target, ['-f', migFile])
  psql(target, ['-f', migFile])

  // 1. The scenarios. Each passing one prints a NOTICE ("ok  …"); a failing one raises.
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(dir, 'scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) {
    failed = run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT/.test(l)).join('\n') || run.stderr
    console.error(failed)
  } else {
    // 2. SQL = supplementDoses.ts on the same rows (a second account's).
    psql(target, ['-c', factsSql])
    const schedules = json(target, `select json_agg(s order by s.id) from public.supplement_schedules s where user_id = '${U2}'`)
      .map(s => ({ ...s, dose_amount: Number(s.dose_amount) }))
    const facts = {
      taken: json(target, `select coalesce(json_agg(json_build_object('id', id, 'supplement_schedule_id', supplement_schedule_id, 'date', date,
                 'dose_time', dose_time, 'created_at', created_at)), '[]') from public.food_log_entries
                 where user_id = '${U2}' and supplement_schedule_id is not null and status = 'eaten'`),
      states: json(target, `select coalesce(json_agg(st), '[]') from public.supplement_dose_state st where user_id = '${U2}'`),
    }
    const bad = []

    // 2a. A schedule's days: two years, day by day.
    const FROM = '2026-01-01', TO = '2027-12-31'
    const sqlDays = new Map(schedules.map(s => [s.id, []]))
    const daysOut = psql(target, ['-At', '-F', '|', '-c', `select s.id, to_char(d, 'YYYY-MM-DD') from public.supplement_schedules s,
      generate_series('${FROM}'::date, '${TO}'::date, interval '1 day') d
      where s.user_id = '${U2}' and public.supplement_schedule_on(s, d::date) order by s.id, d`])
    for (const line of daysOut.split('\n').filter(Boolean)) { const [id, day] = line.split('|'); sqlDays.get(id).push(day) }
    for (const s of schedules) {
      const want = R.occurrencesBetween(s, FROM, TO).filter(d => D.scheduleOn(s, d))
      const all = []
      for (let d = FROM; d <= TO; d = R.addDaysIso(d, 1)) if (D.scheduleOn(s, d)) all.push(d)
      const have = sqlDays.get(s.id)
      if (JSON.stringify(all) !== JSON.stringify(have) || JSON.stringify(want) !== JSON.stringify(have)) {
        bad.push(`${s.title}: TS ${all.length} days, SQL ${have.length} — first difference ${all.find((d, n) => d !== have[n]) ?? have[all.length]}`)
      } else checks += have.length
    }

    // 2b. Every dose's status at a few instants (October, both clocks).
    const statusAt = ['2026-10-14T06:00:00Z', '2026-10-16T05:59:00Z', '2026-10-16T06:00:00Z', '2026-10-16T18:30:00Z', '2026-10-25T00:30:00Z', '2026-10-25T23:30:00Z']
    for (const at of statusAt) {
      const sqlDoses = json(target, `select coalesce(json_agg(json_build_object('key', d.schedule_id || '|' || d.dose_date || '|' || to_char(d.dose_time, 'HH24:MI'),
          'status', d.status, 'entry', d.entry_id, 'label', d.dose_label, 'snoozed', d.snoozed_until is not null, 'sent', d.reminders_sent)), '[]')
        from public.supplement_doses('${U2}', '2026-10-01', '2026-10-31', '${at}') d`)
      const tsDoses = D.dosesBetween(schedules, '2026-10-01', '2026-10-31', facts, osloNow(at))
        .map(d => ({ key: d.key, status: d.status, entry: d.entryId, label: d.label, snoozed: d.snoozedUntil != null, sent: d.remindersSent }))
      const norm = list => list.map(x => JSON.stringify(x)).sort()
      const a = norm(sqlDoses), b = norm(tsDoses)
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        const onlySql = a.filter(x => !b.includes(x)).slice(0, 2), onlyTs = b.filter(x => !a.includes(x)).slice(0, 2)
        bad.push(`doses at ${at}: SQL ${a.length}, TS ${b.length} — SQL only ${onlySql.join(' ')} · TS only ${onlyTs.join(' ')}`)
      } else checks += a.length
    }

    // 2c. The due reminders every 5 minutes over 16.10 and 25.10 (the clock change).
    const instants = []
    for (const [from, to] of [['2026-10-15T22:00:00Z', '2026-10-16T22:00:00Z'], ['2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z']]) {
      for (let t = Date.parse(from); t <= Date.parse(to); t += 5 * 60_000) instants.push(new Date(t).toISOString())
    }
    const dueOut = json(target, `select coalesce(json_object_agg(n, keys), '{}') from (
        select to_char(n at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"') as n,
               (select coalesce(json_agg(d.schedule_id || '|' || d.dose_date || '|' || to_char(d.dose_time, 'HH24:MI') order by d.schedule_id, d.dose_time), '[]')
                  from public.supplement_doses_due(n) d where d.user_id = '${U2}') as keys
          from unnest(array[${instants.map(i => `'${i}'::timestamptz`).join(',')}]) n) x`)
    let dueSeen = 0
    for (const at of instants) {
      const want = D.remindersDue(schedules, facts, osloNow(at)).map(d => d.key).sort()
      const have = [...(dueOut[at] ?? [])].sort()
      if (JSON.stringify(want) !== JSON.stringify(have)) bad.push(`reminders at ${at}: TS [${want.join(', ')}], SQL [${have.join(', ')}]`)
      else { checks++; dueSeen += have.length }
    }
    if (dueSeen < 20) bad.push(`only ${dueSeen} due reminders over the two days — the comparison data no longer exercises the rule`)

    if (bad.length) {
      failed = `FAIL  the SQL dose rules differ from supplementDoses.ts:\n${bad.slice(0, 12).join('\n')}`
      console.error(failed)
    } else {
      console.log(`verify-db-supplement-schedules: 144 + 160 (applied twice), ${passed} scenarios, and the SQL dose rules = supplementDoses.ts `
        + `(${schedules.length} schedules: their days over two years, every dose's status at ${statusAt.length} instants, the due reminders at ${instants.length} instants, ${dueSeen} reminders): ${checks + passed} checks passed`)
    }
  }
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
  rmSync(scratch, { recursive: true, force: true })
}
if (failed) process.exit(1)
