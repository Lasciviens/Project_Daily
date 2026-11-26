// Runs migration 210's scenarios (a task's link to the thing it plans: the exclusive arc, one open plan per thing,
// the owner check for every writer, the item save with p_link, the old back-pointers in step, the data move and its
// second run) on a throwaway Postgres built as verify-db-item-calendar-fields builds it — the live item chain
// (135–193) — then scripts/db-tests/task-links/seed.sql (the old links), the real 210 twice and
// scripts/db-tests/task-links/scenarios.sql.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-task-links.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no database URL it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const mig210 = mig('210_task_links.sql')
const fail = msg => { console.error(`verify-db-task-links: ${msg}`); process.exit(1) }

// Static: one transaction, no new table, every function granted, invoker rights, the lists the browser shares.
{
  const sql = readFileSync(mig210, 'utf8').replace(/--.*$/gm, '')
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
  if (/\bnet\.http_|vault\.|googleapis|icloud_enqueue/i.test(sql)) problems.push('a call outside the database')
  if (/create table/i.test(sql)) problems.push('a new table (it would need the owner lock, grants and audit)')
  if (/security definer/i.test(sql)) problems.push('a SECURITY DEFINER function (210 acts with the caller\'s rights)')
  if (/drop (table|column)|drop function public\.app_save_item\(jsonb\)/i.test(sql)) problems.push('a drop of a table, a column or the 1-argument save (the old pointers stay one release)')
  for (const f of sql.matchAll(/create or replace function (public\.\w+)\(([^)]*)\)/g)) {
    const args = f[2].replace(/\bp_\w+\s+/g, '').trim()
    if (!sql.includes(`grant execute on function ${f[1]}(${args})`)) problems.push(`no grant for ${f[1]}(${args})`)
    const body = sql.slice(f.index, sql.indexOf('$$;', f.index))
    if (!/set search_path = ''/.test(body)) problems.push(`${f[1]} without search_path ''`)
  }
  const types = readFileSync(join(root, 'src/features/todo/types.ts'), 'utf8')
  const tsSources = [...(types.match(/export type TaskSourceType =([\s\S]*?)\n\n/)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort().join(',')
  const dbSources = [...(sql.match(/tasks_source_type_check check \(source_type in \(([\s\S]*?)\)\)/)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort().join(',')
  if (!dbSources || tsSources !== dbSources) problems.push(`TaskSourceType (${tsSources}) differs from 210's source_type list (${dbSources})`)
  const itemTypes = readFileSync(join(root, 'src/features/items/itemTypes.ts'), 'utf8')
  const tsKinds = [...(itemTypes.match(/export type ItemLinkKind = ([^\n]+)/)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort().join(',')
  const dbKinds = [...(sql.match(/if v_kind not in \(([^)]+)\)/)?.[1] ?? '').matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort().join(',')
  if (!dbKinds || tsKinds !== dbKinds) problems.push(`ItemLinkKind (${tsKinds}) differs from the kinds app_save_item takes (${dbKinds})`)
  // NEVER_HIDES: no task read filters on a link column (a link only adds facts to a row).
  const linkCols = ['movie_entry_id', 'tv_entry_id', 'link_season', 'link_episode', 'shop_item_id', 'wish_item_id', 'football_plan_id', 'game_id', 'book_id']
  for (const f of ['src/features/todo/api/tasksApi.ts', 'supabase/functions/phone-gateway/index.ts', 'supabase/functions/push-send/index.ts']) {
    const text = readFileSync(join(root, f), 'utf8')
    const hit = linkCols.find(c => new RegExp(`\\.(eq|is|not|neq|in)\\('${c}'`).test(text))
    if (hit) problems.push(`${f} filters tasks on ${hit} (NEVER_HIDES)`)
  }
  // The callers that wrote a back-pointer after the save now send the link with it — since 211 through THE Plan
  // helper (items/planThis.ts builds every kind's link; verify-plan-this checks no screen builds one by hand).
  {
    const planThis = readFileSync(join(root, 'src/features/items/planThis.ts'), 'utf8')
    for (const kind of ['shop_item', 'wish', 'movie', 'tv', 'training', 'game', 'football']) {
      if (!new RegExp(`link: \\{ kind: '${kind}'|link = [^\\n]*\\{ kind: '${kind}'|ItemLink \\| undefined = [^\\n]*\\{ kind: '${kind}'`).test(planThis)
          && !new RegExp(`\\{ kind: '${kind}', id: thing`).test(planThis)) problems.push(`items/planThis.ts does not send a ${kind} link with the save`)
    }
    for (const f of ['src/features/shop/components/WishlistView.tsx', 'src/features/shop/components/record/useShopRecord.tsx', 'src/features/wishes/pages/WishesPage.tsx']) {
      const text = readFileSync(join(root, f), 'utf8')
      if (/patch: \{ (task_id|status: 'planned', \.\.\.\(result\.taskId \? \{ promoted_task_id)/.test(text)) problems.push(`${f} still writes the back-pointer in a second request`)
    }
  }
  if (problems.length) fail(`migration 210 has ${problems.join('; ')}`)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-task-links: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const section = (file, re, what) => {
  const m = readFileSync(mig(file), 'utf8').match(re)
  if (!m) throw new Error(`verify-db-task-links: no ${what} in ${file}`)
  return m[1] ?? m[0]
}
const step = (name, fn) => { try { return fn() } catch (e) { console.error(`FAILED at ${name}:\n${(e.stderr || e.message).toString().split('\n').filter(l => /ERROR|LINE|CONTEXT|DETAIL/.test(l)).slice(0, 6).join('\n')}`); throw e } }
const runScenarios = (target, file) => {
  const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', file], { encoding: 'utf8' })
  const passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
  if (run.status !== 0) throw Object.assign(new Error('scenarios failed'), { stderr: run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') })
  return passed
}

// The live chain (verify-db-item-calendar-fields'), up to and with 193.
const skips = `${section('112_training_skips.sql', /CREATE TABLE IF NOT EXISTS public\.training_skips[\s\S]*?\n\);/, 'training_skips')}
alter table public.training_skips enable row level security;
create policy own on public.training_skips for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.training_skips to authenticated;`
const ruleSection = section('160_supplement_schedules.sql', /-- <repeat-rule>\n([\s\S]*?)-- <\/repeat-rule>/, '<repeat-rule> section')
const googleTasks = [
  section('071_google_tasks_integration.sql', /CREATE OR REPLACE FUNCTION public\.google_task_status_bucket\(p_status TEXT\)[\s\S]*?\n\$\$;/, 'google_task_status_bucket'),
  section('071_google_tasks_integration.sql', /CREATE OR REPLACE FUNCTION public\.stamp_google_local_edit\(\)[\s\S]*?\n\$\$;/, 'stamp_google_local_edit'),
  section('140_security_fixes.sql', /CREATE OR REPLACE FUNCTION public\.enqueue_google_tasks_outbox\(\)[\s\S]*?\n\$function\$;/, 'enqueue_google_tasks_outbox'),
  `create or replace function public.effective_user_id(p_user_id uuid) returns uuid language sql stable as $$
  select case when auth.role() = 'service_role' then p_user_id else auth.uid() end
$$;`,
].join('\n')
const bookkeeping160 = section('160_supplement_schedules.sql', /create or replace function public\.app_undo_bookkeeping\(p_table text\)[\s\S]*?\n\$\$;/, 'app_undo_bookkeeping')

let code = 0
const name = `tl_${process.pid}_${Date.now() % 100000}`
let passed = 0
psql(url, ['-c', `create database ${name}`])
try {
  const a = withDb(url, name)
  step('base', () => { psql(a, ['-f', join(root, 'scripts/db-tests/one-item/base.sql')]); psql(a, ['-f', join(root, 'scripts/db-tests/repeat-days/base.sql')]) })
  step('skips', () => psql(a, ['-c', skips]))
  step('google tasks', () => psql(a, ['-c', googleTasks]))
  for (const f of ['141_training_task_links.sql', '142_training_session_one_model.sql', '135_calendar_outbox.sql', '144_delete_with_undo.sql',
    '147_schedule_block_calendar_series.sql', '148_google_today_and_series_start.sql', '150_undo_save.sql', '151_undo_save_fixes.sql',
    '155_one_item.sql', '156_repeat_days_as_tasks.sql']) step(f, () => psql(a, ['-f', mig(f)]))
  step('160 rule', () => psql(a, ['-c', ruleSection]))
  step('160 bookkeeping', () => psql(a, ['-c', bookkeeping160]))
  step('162 column', () => psql(a, ['-c', 'alter table public.tasks add column if not exists project_id uuid']))
  for (const f of ['163_football.sql', '165_football_category.sql', '166_training_moves_recheck.sql', '167_training_week_rules.sql',
    '168_football_favourite.sql', '169_training_and_stock_fixes.sql', '171_icloud_credentials.sql', '172_calendar_prefs.sql',
    '173_icloud_events.sql', '174_icloud_events_safety.sql', '175_icloud_switch.sql', '176_icloud_readback.sql', '177_icloud_every_event.sql',
    '178_icloud_games_area.sql']) step(f, () => psql(a, ['-f', mig(f)]))
  step('before 179', () => psql(a, ['-c', 'alter table public.hevy_workouts add column if not exists description text']))
  for (const f of ['179_icloud_workouts.sql', '180_task_labels.sql', '183_item_time_zones.sql', '186_item_places.sql',
    '193_item_calendar_fields.sql']) step(f, () => psql(a, ['-f', mig(f)]))
  step('seed', () => psql(a, ['-f', join(root, 'scripts/db-tests/task-links/seed.sql')]))
  step('210 first run', () => psql(a, ['-f', mig210]))
  step('snapshot after the first run', () => psql(a, ['-c', `create table public.t_after1 as select id, source_type, source_id, hevy_routine_id, movie_entry_id, tv_entry_id,
    link_season, link_episode, shop_item_id, wish_item_id, football_plan_id, game_id, book_id, status, title from public.tasks;
    create table public.t_old1 as select 's' k, id, task_id t, null::text st from public.shop_items union all select 'w', id, promoted_task_id, status from public.wish_items
    union all select 'f', id, task_id, null from public.football_plans;`]))
  step('210 second run', () => psql(a, ['-f', mig210]))
  step('scenarios', () => { passed = runScenarios(a, join(root, 'scripts/db-tests/task-links/scenarios.sql')) })
} catch (e) {
  code = 1
  if (e.stderr) console.error(e.stderr.toString())
} finally {
  if (!process.env.KEEP_DB) try { psql(url, ['-c', `drop database if exists ${name}`]) } catch { /* best effort */ }
}
if (code) process.exit(code)
console.log(`verify-db-task-links: static checks passed; on the live item chain (135–193) with the old links, 210 ran twice and ${passed} scenarios passed`)
