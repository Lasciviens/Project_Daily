// Runs migration 200's scenarios (trakt_manual_matches: the owner's pick of a TMDB title for a Trakt item with no TMDB id) on a
// throwaway Postgres. The questions: does the owner write only their own picks, and does nobody else read them? Are the ids
// integers in range, one TMDB title per Trakt item and the other way round? Is the table audited and owner-locked?
// Two databases, each from the AI ledger's base.sql and the real 200 applied twice (the second run must leave the catalogue as the
// first did): with the grants Supabase gave every new table before 30.10.2026 (200's own revoke must keep the browser to its
// rights), and without them (production now).
// Static checks first. With no database URL it runs them and passes.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-trakt-manual-matches.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = join(root, 'supabase/migrations/200_trakt_manual_matches.sql')
const fail = msg => { console.error(`verify-db-trakt-manual-matches: ${msg}`); process.exit(1) }
const noComments = text => text.replace(/--.*$/gm, '')

{
  const sql = noComments(readFileSync(FILE, 'utf8'))
  const stmts = sql.split(';').map(s => s.trim().replace(/\s+/g, ' ')).filter(Boolean)
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT')
  if (!/create table if not exists public\.trakt_manual_matches \([\s\S]*?\);\s*alter table public\.trakt_manual_matches enable row level security;/i.test(sql)) problems.push('no row level security right after the table')
  if (!/select public\.owner_lock_apply\('public\.trakt_manual_matches'\);/i.test(sql)) problems.push('no owner_lock_apply')
  if (!/user_id\s+uuid not null default auth\.uid\(\) references auth\.users\(id\) on delete cascade/i.test(sql)) problems.push('user_id is not "uuid not null default auth.uid() references auth.users(id) on delete cascade"')
  if (!/kind\s+text not null check \(kind in \('movie', 'show'\)\)/i.test(sql)) problems.push('kind is not bounded to movie, show')
  if (!/trakt_id\s+integer not null check \(trakt_id > 0\)/i.test(sql) || !/tmdb_id\s+integer not null check \(tmdb_id > 0\)/i.test(sql)) problems.push('an id is not a positive integer')
  if (!/unique \(user_id, kind, trakt_id\)/i.test(sql) || !/unique \(user_id, kind, tmdb_id\)/i.test(sql)) problems.push('a unique key is missing (one pick per Trakt item, one Trakt item per TMDB title)')
  if (!/using \(\(select auth\.uid\(\)\) = user_id\) with check \(\(select auth\.uid\(\)\) = user_id\)/i.test(sql)) problems.push('no owner policy')
  if (!stmts.includes('revoke all on public.trakt_manual_matches from anon, authenticated')) problems.push('no revoke from anon, authenticated')
  if (stmts.some(s => /^grant .* on (table )?public\.trakt_manual_matches to .*\banon\b/i.test(s))) problems.push('a grant to anon')
  if (!/create trigger trg_audit after insert or update or delete on public\.trakt_manual_matches/i.test(sql)) problems.push('no audit trigger')
  if (!/alter table public\.trakt_sync_state add column if not exists matches_fingerprint text;/i.test(sql)) problems.push('no matches_fingerprint column on trakt_sync_state')
  if (/security definer/i.test(sql)) problems.push('a SECURITY DEFINER function (none is needed)')
  if (problems.length) fail(`migration 200 has ${problems.join('; ')}`)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-trakt-manual-matches: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const step = (name, fn) => { try { return fn() } catch (e) { console.error(`FAILED at ${name}:\n${(e.stderr || e.message).toString().split('\n').filter(l => /FAIL|ERROR|LINE|CONTEXT|DETAIL/.test(l)).slice(0, 8).join('\n')}`); throw e } }
const FINGERPRINT = `
select coalesce(string_agg(x, E'\\n' order by x), '') from (
  select 'policy ' || policyname || ' ' || permissive || ' ' || roles::text || ' ' || cmd || ' ' || coalesce(qual, '') || ' ' || coalesce(with_check, '')
    from pg_policies where schemaname = 'public' and tablename = 'trakt_manual_matches'
  union all select 'table rls=' || relrowsecurity from pg_class where oid = 'public.trakt_manual_matches'::regclass
  union all select 'grant ' || a.grantee::regrole || ' ' || a.privilege_type from pg_class c, aclexplode(c.relacl) a where c.oid = 'public.trakt_manual_matches'::regclass
  union all select 'column ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
    from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.trakt_manual_matches'::regclass and a.attnum > 0 and not a.attisdropped
  union all select 'constraint ' || conname || ' ' || pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.trakt_manual_matches'::regclass
  union all select 'fingerprint column ' || format_type(a.atttypid, a.atttypmod) from pg_attribute a where a.attrelid = 'public.trakt_sync_state'::regclass and a.attname = 'matches_fingerprint'
  union all select 'trigger ' || tgname || ' ' || pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'public.trakt_manual_matches'::regclass and not tgisinternal
) t(x)`
const OLD_DEFAULTS = [
  '-c', 'alter default privileges in schema public grant all on tables to anon, authenticated, service_role',
  '-c', 'alter default privileges in schema public grant execute on functions to anon, authenticated, service_role',
]
const suites = [
  { key: 'old', db: `t200a_${process.pid}`, before: OLD_DEFAULTS },
  { key: 'now', db: `t200b_${process.pid}`, before: [] },
]
let code = 0
const done = {}
for (const s of suites) {
  psql(url, ['-c', `create database ${s.db}`])
  try {
    const target = withDb(url, s.db)
    step(`${s.key}: base`, () => psql(target, ['-f', join(root, 'scripts/db-tests/ai-ledger/base.sql')]))
    if (s.before.length) step(`${s.key}: old default grants`, () => psql(target, s.before))
    // 116's table, as far as 200 touches it (the real one is service-role only).
    step(`${s.key}: trakt_sync_state`, () => psql(target, ['-c', 'create table public.trakt_sync_state (user_id uuid primary key references auth.users(id) on delete cascade, last_sync_at timestamptz); alter table public.trakt_sync_state enable row level security; revoke all on public.trakt_sync_state from anon, authenticated; grant select, insert, update, delete on public.trakt_sync_state to service_role']))
    step(`${s.key}: 200`, () => psql(target, ['-f', FILE]))
    const first = step(`${s.key}: fingerprint`, () => psql(target, ['-At', '-c', FINGERPRINT]))
    step(`${s.key}: 200 again`, () => psql(target, ['-f', FILE]))
    const second = psql(target, ['-At', '-c', FINGERPRINT])
    if (first.split('\n').length < 15) throw Object.assign(new Error('fingerprint'), { stderr: 'ERROR: the catalogue fingerprint is nearly empty (it read nothing?)' })
    if (first !== second) throw Object.assign(new Error('not idempotent'), { stderr: 'ERROR: a second run of 200 changed the database' })
    const run = spawnSync('psql', [target, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(root, 'scripts/db-tests/trakt-manual-matches/scenarios.sql')], { encoding: 'utf8' })
    done[s.key] = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
    if (run.status !== 0) throw Object.assign(new Error('scenarios failed'), { stderr: run.stderr.split('\n').filter(l => !/NOTICE: {2}ok/.test(l)).slice(0, 12).join('\n') })
  } catch (e) {
    code = 1
    if (e.stderr) console.error(e.stderr.toString())
  } finally {
    try { psql(url, ['-c', `drop database if exists ${s.db}`]) } catch { /* best effort */ }
  }
  if (code) break
}
if (code) process.exit(code)
console.log(`verify-db-trakt-manual-matches: 200 ran twice on two databases and left each as its first run did; ${done.old} scenarios passed with the old default grants and ${done.now} without them`)
