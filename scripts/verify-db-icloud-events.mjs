// Runs migrations 173–177's scenarios (the app's events in Apple Calendar: the
// queue and its triggers, dormant while every area is on Google; 174 the
// security fixes — area keys, never addresses; 175 the switch per area — the
// hand-over of a Google copy, the moments a move finishes, the timer, the
// retired columns dropped; 176 the read-back from the iPhone; 177 the settings
// for every event and the app's own change time) on a throwaway Postgres:
// scripts/db-tests/one-item/base.sql plus the columns 141/155/156/162 added to
// tasks, time_blocks and schedule_blocks, 135/155's calendar_outbox, the real
// 160 list for Undo, 171 and 172, the real 173 as it ran in production, then
// 174 and 175 twice each (they must survive a re-run) and
// scripts/db-tests/icloud-events/scenarios.sql.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-icloud-events.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no
// database URL (a laptop without Postgres) it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const mig173 = mig('173_icloud_events.sql')
const migFile = mig('174_icloud_events_safety.sql')
const mig175 = mig('175_icloud_switch.sql')
const mig176 = mig('176_icloud_readback.sql')
const mig177 = mig('177_icloud_every_event.sql')
const mig178 = mig('178_icloud_games_area.sql')
const mig179 = mig('179_icloud_workouts.sql')

const sql = readFileSync(mig173, 'utf8').replace(/--.*$/gm, '')
const fix = readFileSync(migFile, 'utf8').replace(/--.*$/gm, '')
const sw = readFileSync(mig175, 'utf8').replace(/--.*$/gm, '')
const rb = readFileSync(mig176, 'utf8').replace(/--.*$/gm, '')
const problems = []
if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
if (/\bnet\.http_|vault\./i.test(sql)) problems.push('a call outside the database (a trigger never calls iCloud)')
if (!sql.includes("owner_lock_apply('public.icloud_outbox')")) problems.push('no owner lock on icloud_outbox')
if (!/revoke all on public\.icloud_outbox from anon, authenticated/i.test(sql)) problems.push('icloud_outbox is not closed to the browser')
for (const fn of ['icloud_time_block_changed', 'icloud_schedule_block_changed', 'icloud_task_changed']) {
  const body = sql.slice(sql.indexOf(`function public.${fn}()`))
  if (!/app\.icloud_readback/.test(body.slice(0, 600))) problems.push(`${fn} doesn't stop for the read-back`)
}
// 174 (security review 30.10.2026): area keys, never addresses; the browser can't call the queue helpers.
if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(fix)) problems.push('174: a top-level BEGIN/COMMIT')
if (!/revoke all on function public\.icloud_writes_on\(uuid\) from public, anon, authenticated/i.test(fix)) problems.push('174: icloud_writes_on still open to the browser')
if (!/icloud_area in \('training', 'work', 'personal', 'media', 'football'\)/.test(fix)) problems.push('174: icloud_area takes more than the five area keys')
for (const fn of ['icloud_time_block_changed', 'icloud_schedule_block_changed', 'icloud_task_changed']) {
  const body = fix.slice(fix.indexOf(`function public.${fn}()`), fix.indexOf('$$;', fix.indexOf(`function public.${fn}()`)))
  if (/icloud_href/.test(body)) problems.push(`174: ${fn} still reads the retired icloud_href`)
}
// 175: the switch. Its hand-over is the server's alone, deletes only the item's own event, and the timer reads its secret from Vault.
if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sw)) problems.push('175: a top-level BEGIN/COMMIT')
if (!/revoke all on function public\.icloud_hand_over\(uuid, text, uuid, text\) from public, anon, authenticated/i.test(sw)) problems.push('175: icloud_hand_over open to the browser')
if (!/p_event !~ \('\^' \|\| v_hex \|\| '\(v\[1-4\]\)\?\$'\)/.test(sw)) problems.push('175: the hand-over doesn\'t check the event is the item\'s own')
if (!/vault\.decrypted_secrets where name = 'ICLOUD_SYNC_SECRET'/.test(sw) || /x-sync-secret', '[^']/.test(sw)) problems.push('175: the timer\'s secret isn\'t read from Vault at call time')
for (const fn of ['icloud_time_block_changed', 'icloud_schedule_block_changed', 'icloud_task_changed']) {
  const at = sw.indexOf(`function public.${fn}()`)
  if (at < 0 || !/app\.icloud_readback/.test(sw.slice(at, at + 600))) problems.push(`175: ${fn} doesn't stop for the read-back`)
  if (/icloud_href/.test(sw.slice(at, sw.indexOf('$$;', at)))) problems.push(`175: ${fn} reads the dropped icloud_href`)
}
// 176: the read-back. Its apply function is the server's alone; the sync state is closed to the browser; the timer's secret from Vault.
if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(rb)) problems.push('176: a top-level BEGIN/COMMIT')
if (!/revoke all on function public\.apply_icloud_readback\(uuid, text, uuid, text, jsonb, text\) from public, anon, authenticated/i.test(rb)) problems.push('176: apply_icloud_readback open to the browser')
if (!/revoke all on public\.icloud_sync_state from anon, authenticated/i.test(rb) || !rb.includes("owner_lock_apply('public.icloud_sync_state')")) problems.push('176: icloud_sync_state not closed to the browser or not owner-locked')
if (!/set search_path = ''/.test(rb.slice(rb.indexOf('function public.apply_icloud_readback')))) problems.push('176: apply_icloud_readback has no empty search_path')
if (!/vault\.decrypted_secrets where name = 'ICLOUD_SYNC_SECRET'/.test(rb)) problems.push("176: the timer's secret isn't read from Vault at call time")
if (problems.length) {
  console.error(`verify-db-icloud-events: migrations 173/174/175/176 have ${problems.join('; ')}`)
  process.exit(1)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-icloud-events: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const db = `t173_${process.pid}`
const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// The columns later migrations added to the item tables (base.sql is the 142 schema).
const LATER_COLUMNS = `
  alter table public.tasks add column if not exists google_target text, add column if not exists project_id uuid,
    add column if not exists hevy_routine_id text, add column if not exists schedule_block_id uuid,
    add column if not exists occurrence_date date;
  alter table public.time_blocks add column if not exists busy boolean not null default true;
  alter table public.schedule_blocks alter column start_time drop not null, alter column end_time drop not null,
    add column if not exists busy boolean not null default true, add column if not exists google_target text,
    add column if not exists domain text, add column if not exists notes text;
  create table if not exists public.calendar_outbox (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
    calendar_id text not null default 'primary', event_id text not null,
    operation text not null default 'delete' check (operation in ('delete', 'upsert')),
    time_block_id uuid, payload jsonb not null default '{}'::jsonb, attempts integer not null default 0,
    next_retry_at timestamptz not null default now(), last_error text, requested_at timestamptz not null default now(),
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    constraint calendar_outbox_event_key unique (user_id, calendar_id, event_id));`
// Stand-ins for 155/156's day split and its helpers (the real ones are tested by verify-db-one-item and
// verify-db-repeat-days): enough to run 176's "one day of a repeat moved on the iPhone".
const STAND_INS = `
  create or replace function public.repeat_occurs_on(p public.schedule_blocks, p_day date) returns boolean language sql stable as $$
    select p_day >= coalesce(p.effective_from, p_day) and extract(dow from p_day)::int = any (coalesce(p.days_of_week, '{}'))
       and not (p_day = any (coalesce(p.except_dates, '{}')))
  $$;
  create or replace function public.item_section_for_day(p_day date, p_today date) returns text language sql immutable as $$
    select case when p_day = p_today then 'today' else 'backlog' end
  $$;
  create or replace function public.item_occurrence(p_plan uuid, p_date date, p_today date, p_user uuid default null)
  returns table(block_id uuid, task_id uuid, created boolean) language plpgsql as $$
  declare v_block uuid; v_task uuid; p public.schedule_blocks%rowtype;
  begin
    select * into p from public.schedule_blocks s where s.id = p_plan;
    -- The day's own task when it has one (156), as the real one does.
    select t.id into v_task from public.tasks t where t.schedule_block_id = p_plan and t.occurrence_date = p_date;
    if v_task is null then
      insert into public.tasks (user_id, title, due_date, due_time, schedule_block_id, occurrence_date, google_target)
      values (coalesce(p_user, auth.uid()), p.title, p_date, p.start_time, p_plan, p_date, 'calendar') returning id into v_task;
    end if;
    insert into public.time_blocks (user_id, date, title, start_time, duration_minutes, category, task_id, schedule_block_id, occurrence_date)
    values (coalesce(p_user, auth.uid()), p_date, p.title, p.start_time, 60, p.category, v_task, p_plan, p_date) returning id into v_block;
    return query select v_block, v_task, true;
  end $$;`
// The real 160 list for Undo (173 must keep every entry of it).
const BOOKKEEPING_160 = readFileSync(mig('160_supplement_schedules.sql'), 'utf8')
  .match(/create or replace function public\.app_undo_bookkeeping\(p_table text\)[\s\S]*?\n\$\$;/)?.[0]
if (!BOOKKEEPING_160) { console.error('verify-db-icloud-events: 160\'s app_undo_bookkeeping not found'); process.exit(1) }

psql(url, ['-c', `create database ${db}`])
let failed = null
try {
  const target = withDb(url, db)
  psql(target, ['-f', join(root, 'scripts/db-tests/one-item/base.sql')])
  psql(target, ['-c', 'alter default privileges in schema public grant all on tables to anon, authenticated, service_role'])
  psql(target, ['-c', LATER_COLUMNS])
  psql(target, ['-c', BOOKKEEPING_160])
  psql(target, ['-f', mig('171_icloud_credentials.sql')])
  psql(target, ['-f', mig('172_calendar_prefs.sql')])
  psql(target, ['-f', mig173])
  // A forged address written while 173 was live: 174 must empty it and drop what it queued.
  psql(target, ['-c', "insert into public.time_blocks (id, user_id, date, title, icloud_href) values ('20000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000001', '2026-11-01', 'forged', 'https://p1-caldav.icloud.com/1/calendars/lasci-work/../home/')"])
  psql(target, ['-f', migFile])
  psql(target, ['-f', migFile])
  psql(target, ['-f', mig175])
  psql(target, ['-f', mig175])
  psql(target, ['-c', STAND_INS])
  psql(target, ['-f', mig176])
  psql(target, ['-f', mig176])
  psql(target, ['-f', mig177])
  psql(target, ['-f', mig177])
  psql(target, ['-f', mig178])
  psql(target, ['-f', mig178])
  // 024's workouts and 141's session link, as the live database has them (base.sql is the 142 item schema).
  psql(target, ['-c', `create table if not exists public.hevy_workouts (id text primary key, user_id uuid not null references auth.users(id) on delete cascade,
    title text not null, routine_id text, description text, start_time timestamptz, end_time timestamptz);
    alter table public.tasks add column if not exists hevy_workout_id text references public.hevy_workouts(id) on delete set null;`])
  psql(target, ['-f', mig179])
  psql(target, ['-f', mig179])
  // The timer's condition is text inside cron.schedule (no pg_cron here): run it, so it parses against the real tables.
  for (const [n, file] of [['175', mig175], ['176', mig176]]) {
    const when = readFileSync(file, 'utf8').match(/body := jsonb_build_object\('action', 'cron'\)\n\s*\)\n(\s*where[\s\S]*?);\n\s*\$cron\$/)?.[1]
    if (!when) throw new Error(`${n}: the timer's condition was not found`)
    psql(target, ['-c', `select count(*) from (select 1 ${when}) x`])
  }
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(root, 'scripts/db-tests/icloud-events/scenarios.sql')], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) {
    failed = run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') || run.stderr
    console.error(failed)
  } else {
    console.log(`verify-db-icloud-events: 173, then 174–179 (each applied twice) and ${passed} scenarios passed`)
  }
} finally {
  try { psql(url, ['-c', `drop database if exists ${db}`]) } catch { /* best effort */ }
}
if (failed) process.exit(1)
