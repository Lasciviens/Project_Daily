// Runs migration 212's scenarios (notifications, Phase 3 B1–B3: the kinds and their shapes, the browser's read and
// read_at/acted_at only, followed-film notices from the server only, where each kind goes, the Claude key's dates, the
// nightly 14/7/1-day warnings, a service rejecting a sign-in, push-send's claim and the timers) on a throwaway Postgres:
// scripts/db-tests/one-item/base.sql, notifications/seed.sql, the real 091/101 (psn_tokens) and 119 (media follows),
// 211's notifications section, then the real 212 twice and notifications/scenarios.sql.
//   VERIFY_DB_URL=postgresql://… node scripts/verify-db-notifications.mjs
// CI (PR check) passes its Postgres service as DEPLOY_TEST_DB_URL. With no database URL it runs the static checks and passes.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const mig = f => join(root, 'supabase/migrations', f)
const mig212 = mig('212_notifications.sql')
const fail = msg => { console.error(`verify-db-notifications: ${msg}`); process.exit(1) }

// Static: one transaction, the rights of every function, the server-only writes, no text or URL column, the registry.
{
  const sql = readFileSync(mig212, 'utf8').replace(/--.*$/gm, '')
  const problems = []
  if (/^\s*(begin|commit|rollback|savepoint)\s*;/im.test(sql)) problems.push('a top-level BEGIN/COMMIT (the deploy runs it as one transaction)')
  if (/drop (table|column)/i.test(sql)) problems.push('a drop of a table or a column')
  for (const f of sql.matchAll(/create or replace function (public\.\w+)\(([^)]*)\)/g)) {
    const body = sql.slice(f.index, sql.indexOf('$$;', f.index))
    const args = f[2].replace(/\bp_\w+\s+/g, '').replace(/\s+default\s+[^,]+/g, '').replace(/\s+/g, ' ').trim()
    if (!/set search_path = ''/.test(body)) problems.push(`${f[1]} without search_path ''`)
    if (!sql.replace(/\s+/g, ' ').includes(`revoke all on function ${f[1]}(${args})`)) problems.push(`no revoke for ${f[1]}(${args})`)
    if (/security definer/.test(body)) {
      const grant = sql.match(new RegExp(`grant execute on function ${f[1].replace('.', '\\.')}\\([^)]*\\) to ([^;]+);`))
      if (grant && /authenticated|anon|public/.test(grant[1])) problems.push(`${f[1]} is SECURITY DEFINER and granted to ${grant[1]}`)
    }
  }
  for (const t of ['notification_prefs', 'integration_expiry']) {
    if (!sql.includes(`select public.owner_lock_apply('public.${t}')`)) problems.push(`no owner lock on ${t}`)
    if (!new RegExp(`create trigger trg_audit after insert or update or delete on public\\.${t}`).test(sql)) problems.push(`${t} is not audited`)
    if (!sql.includes(`alter table public.${t} enable row level security`)) problems.push(`${t} without row level security`)
  }
  if (/grant (insert|delete|all)[^;]*on public\.notifications to authenticated/.test(sql)) problems.push('notifications grants the browser a write')
  if (!sql.includes('grant update (read_at, acted_at) on public.notifications to authenticated')) problems.push('the browser should change only read_at and acted_at')
  for (const c of sql.matchAll(/alter table public\.notifications add column if not exists (\w+)\s+(\w+)/g)) {
    if (c[2] === 'text' && c[1] !== 'service') problems.push(`notifications gets a text column ${c[1]} (no free text, no URL)`)
  }
  if (!/notifications_service_check check \(service in \(/.test(sql)) problems.push('notifications.service is not an allow-list')
  // The outside call is only the timers', and their secret comes from Vault inside the job.
  const calls = [...sql.matchAll(/net\.http_post/g)].length
  const vaultReads = [...sql.matchAll(/vault\.decrypted_secrets where name = 'PUSH_CRON_SECRET'/g)].length
  if (calls !== 2 || vaultReads !== 2) problems.push('net.http_post outside the two timers, or a timer without its Vault secret')

  // The registry and the database list the same kinds, and the same default for each.
  const ts = readFileSync(join(root, 'src/features/notifications/notificationKinds.ts'), 'utf8')
  const tsDefaults = Object.fromEntries([...ts.matchAll(/\{ kind: '(\w+)', label: [^\n]*defaultChannel: '(\w+)' \}/g)].map(m => [m[1], m[2]]))
  const sqlDefaults = Object.fromEntries([...(sql.match(/function public\.notification_default_channel[\s\S]*?\$\$;/)?.[0] ?? '')
    .matchAll(/when '(\w+)'\s+then '(\w+)'/g)].map(m => [m[1], m[2]]))
  const sorted = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]))
  if (!Object.keys(tsDefaults).length || sorted(tsDefaults) !== sorted(sqlDefaults)) {
    problems.push(`the defaults differ: notificationKinds.ts ${sorted(tsDefaults)} vs notification_default_channel ${sorted(sqlDefaults)}`)
  }
  const kinds = s => (s.match(/\(([^()]*)\)/)?.[1] ?? '').match(/'(\w+)'/g)?.map(x => x.slice(1, -1)).sort().join(',')
  const checkKinds = kinds(sql.match(/notifications_kind_check check \(kind in \([^)]*\)\)/)?.[0] ?? '')
  const prefKinds = kinds(sql.match(/kind\s+text not null check \(kind in \([^)]*\)\)/)?.[0]?.replace(/^[^(]*\(/, '(') ?? '')
  const tsKinds = (ts.match(/export type NoticeKind =([\s\S]*?)\nexport /)?.[1] ?? '').match(/'(\w+)'/g)?.map(x => x.slice(1, -1)).sort().join(',')
  if (!tsKinds || checkKinds !== tsKinds || prefKinds !== tsKinds) problems.push(`the kinds differ: NoticeKind ${tsKinds}, notifications ${checkKinds}, prefs ${prefKinds}`)
  if (problems.length) fail(`migration 212 has ${problems.join('; ')}`)
}

const url = process.env.VERIFY_DB_URL || process.env.DEPLOY_TEST_DB_URL
if (!url) {
  console.log('verify-db-notifications: static checks passed; database scenarios skipped (no VERIFY_DB_URL / DEPLOY_TEST_DB_URL)')
  process.exit(0)
}

const withDb = (u, name) => { const x = new URL(u); x.pathname = `/${name}`; return x.toString() }
const psql = (u, args) => execFileSync('psql', [u, '-v', 'ON_ERROR_STOP=1', '-q', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const step = (name, fn) => { try { return fn() } catch (e) { console.error(`FAILED at ${name}:\n${(e.stderr || e.message).toString().split('\n').filter(l => /ERROR|LINE|CONTEXT|DETAIL|FAIL/.test(l)).slice(0, 6).join('\n')}`); throw e } }
const notifications211 = (() => {
  const s = readFileSync(mig('211_linked_plans.sql'), 'utf8')
  const m = s.match(/-- ── A5\. notifications[\s\S]*?(?=-- ── A3\.)/)
  if (!m) fail('no notifications section in 211')
  return `${m[0]}\nselect public.owner_lock_apply('public.notifications');`
})()

let code = 0
const name = `nt_${process.pid}_${Date.now() % 100000}`
let passed = 0
psql(url, ['-c', `create database ${name}`])
try {
  const a = withDb(url, name)
  step('base', () => psql(a, ['-f', join(root, 'scripts/db-tests/one-item/base.sql')]))
  step('seed', () => psql(a, ['-f', join(root, 'scripts/db-tests/notifications/seed.sql')]))
  for (const f of ['091_psn_tokens.sql', '101_psn_npsso_expiry.sql', '119_media_follows.sql']) step(f, () => psql(a, ['-f', mig(f)]))
  // Supabase's default grants of those older tables (before 30.10.2026 a new table got them by itself).
  step('older grants', () => psql(a, ['-c', 'grant select, insert, update, delete on public.psn_tokens, public.media_follows, public.media_follow_events to authenticated, service_role']))
  step('211 notifications', () => psql(a, ['-c', notifications211]))
  step('212 first run', () => psql(a, ['-f', mig212]))
  step('212 second run', () => psql(a, ['-f', mig212]))
  step('scenarios', () => {
    const run = spawnSync('psql', [a, '-v', 'ON_ERROR_STOP=1', '-q', '-f', join(root, 'scripts/db-tests/notifications/scenarios.sql')], { encoding: 'utf8' })
    passed = (run.stderr.match(/NOTICE: {2}ok {2}/g) || []).length
    if (run.status !== 0) throw Object.assign(new Error('scenarios failed'), { stderr: run.stderr.split('\n').filter(l => /FAIL|ERROR|CONTEXT|LINE/.test(l)).join('\n') })
  })
} catch (e) {
  code = 1
  if (e.stderr) console.error(e.stderr.toString())
} finally {
  if (!process.env.KEEP_DB) try { psql(url, ['-c', `drop database if exists ${name}`]) } catch { /* best effort */ }
}
if (code) process.exit(code)
console.log(`verify-db-notifications: static checks passed; 212 ran twice and ${passed} scenarios passed`)
